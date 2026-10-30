"""`roster serve`: the backend API for the desktop app (the roster app, app/). JSON-RPC 2.0 over stdin/stdout,
one JSON object per line. Only responses go to stdout; anything else roster prints goes to stderr.
The one other channel is askpass (roster/askpass.py): a private Unix socket, open while serve runs, that
hands a password Session's ssh its password.
It answers with the Host, group and resource objects load_config already builds - no new schema.
Logins come back as references (bw:ITEM), never as values. Requests are handled one at a time.

Add a method by writing a function (state, params) -> result and listing it in METHODS.
"""

import hashlib
import json
import os
import secrets
import shutil
import signal
import sys
import threading
import time

from . import __version__, askpass, changes, diagnose, edit, providers
from .claude import write_claude_files
from .common import deadline, not_reviewed, ssh_config_file
from .config import find_config, load_config
from .errors import (  # noqa: F401 (the codes are part of serve's API)
    CANT_WRITE,
    CLI_MISSING,
    GROUP_NOT_EMPTY,
    HOST_EXISTS,
    INVALID_HOST,
    INVENTORY_ERROR,
    ITEM_EXISTS,
    NAME_TAKEN,
    NO_ASKPASS,
    NO_SIGN_IN,
    NOT_CREATED_HERE,
    NOT_LOGGED_IN,
    NOT_REVIEWED,
    NOT_SET_UP,
    NOT_VERIFIED,
    ROSTER_ERROR,
    UNKNOWN_GROUP,
    UNKNOWN_HOST,
    UNSUPPORTED,
    VAULT_LOCKED,
    WOULD_CHANGE,
    WRITE_FAILED,
    WRONG_PASSWORD,
    Problem,
    inventory_problem,
    sign_in_problem,
    vault_problem,
    write_problem,
)
from .providers import PROVIDERS, setup_providers
from .sshops import in_ssh_config, record_host_key, write_ssh_config

API_VERSION = 8             # bump when a method or result changes in a way the app has to know about

# JSON-RPC's own error codes
PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INVALID_PARAMS, INTERNAL_ERROR = -32700, -32600, -32601, -32602, -32603
# roster's own codes are in errors.py: stable, the app switches on them; the message is ready to show
RpcError = Problem


def die_message(e):
    """The text of a die() (SystemExit("error: ...")), without the prefix."""
    msg = str(e.code) if e.code is not None else "exited"
    return msg.removeprefix("error: ")


class State:
    """What serve holds for its lifetime: the loaded Inventory, or why it didn't load."""

    def __init__(self, config_arg):
        self.cfg, self.path, self.error = None, None, None
        self.digest = None                  # what roster.yml held at the last load (good or not): the watcher's base
        self.noticed = None                 # an outside edit already reported as not applied (auto off)
        self.auto = False                   # inventory.watch: apply outside edits as they're saved
        self.watcher = None                 # the Watcher thread, once inventory.watch started it
        self.notify = None                  # fn(method, params): a JSON-RPC notification to the app (serve() sets it)
        self.lock = threading.RLock()       # one request, or one reload by the watcher, at a time
        self.unlocked = set()               # providers vault.unlock opened (vault.lock locks them again)
        self.askpass = None                 # the askpass Channel, while serve() runs
        self.login = None                   # the sign-in in progress (vault.login): SignIn
        self.created = {}                   # item id -> provider, for the items vault.create_item made (undo)
        self.verified = {}                  # host.verify_login successes: login_key -> time.monotonic()
        only_vault_unlock_unlocks()
        try:
            self.path = find_config(config_arg)
        except SystemExit as e:
            self.error = die_message(e)
            return
        self.reload()

    def reload(self):
        """Load roster.yml again (after a pull, an edit, a discard, `:source` or an outside edit, so hosts.list shows
        the file as it is). A file that doesn't load keeps the last good Inventory, with the error beside it."""
        self.digest, self.noticed = file_digest(self.path), None
        try:
            cfg = load_config(self.path)
        except SystemExit as e:
            self.error = die_message(e)
            return
        self.cfg, self.path, self.error = cfg, cfg["path"], None
        setup_providers(cfg)

    def problem(self):
        """Why roster.yml doesn't load right now (code 1, with its line), or None."""
        if self.error is None:
            return None
        p = inventory_problem(self.error, self.path)
        p.data |= versions()
        return p

    def fresh(self):
        """roster.yml loaded again, for an edit: refuses (code 1) when the file as it is now doesn't load, even
        though the last good Inventory is still shown."""
        self.reload()
        p = self.problem()
        if p:
            raise p
        return self.cfg

    def inventory(self):
        if self.cfg is None:
            raise self.problem()
        return self.cfg


def versions():
    return {"roster_version": __version__, "api_version": API_VERSION}


def file_digest(path):
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest() if path else None
    except OSError:
        return None


def broken(state):
    """hosts.list's and inventory.reload's `error`: why roster.yml as it is now doesn't load, while the last good
    Inventory is shown ({message, path, line?}); None when it loads."""
    p = state.problem()
    if p is None:
        return None
    return {"message": p.message, "path": p.data.get("path"), **({"line": p.data["line"]} if "line" in p.data else {}),
            "fix": p.data.get("fix")}


# ---------------------------------------------------------------- methods

def inventory_info(state, params):
    cfg = state.inventory()
    return {"path": str(cfg["path"]), "box": cfg["box"], "host_count": len(cfg["hosts"]),
            "providers": sorted(PROVIDERS), **versions()}


def hosts_list(state, params):
    """Every Host and group. While roster.yml doesn't load (an outside edit), the last good ones, and `error`."""
    cfg = state.inventory()
    return {"hosts": list(cfg["hosts"].values()), "groups": cfg["groups"], "error": broken(state)}


def host_get(state, params):
    """One Host by its exact name (the app picks from hosts.list; no fuzzy matching here)."""
    name = text_param(params, "name")
    h = state.inventory()["hosts"].get(name)
    if h is None:
        raise RpcError(UNKNOWN_HOST, f"unknown host {name!r}")
    return h


def text_param(params, key):
    v = params.get(key)
    if not isinstance(v, str) or not v:
        raise RpcError(INVALID_PARAMS, f"params.{key} must be a non-empty string")
    return v


# ---------------------------------------------------------------- sessions (ticket 05; ADR 0002)

def session_prepare(state, params):
    """What the app runs in a PTY to open a Session: the system ssh, never a secret.
    It uses the ssh-config alias `roster setup`/`sync` writes (Host NAME), so the key, user, port,
    known_hosts and connection sharing all come from the config, exactly as `roster run` does."""
    name = text_param(params, "host")
    h = state.inventory()["hosts"].get(name)
    if h is None:
        raise RpcError(UNKNOWN_HOST, f"unknown host {name!r}")
    if not h["reviewed"]:
        raise RpcError(NOT_REVIEWED, not_reviewed(h))
    diagnose.check_user(h)
    ssh = shutil.which("ssh")         # absolute: the app spawns it with `wsl.exe --exec`, where PATH is thin
    if ssh is None:
        raise RpcError(NOT_SET_UP, "no ssh client on this box's PATH - install OpenSSH (openssh-client)")
    if not in_ssh_config(h["name"]):
        raise RpcError(NOT_SET_UP, f"{h['name']} isn't in this box's ssh config ({ssh_config_file()}) - "
                                   "run `roster sync`, or `roster setup` if this box isn't set up yet")
    if not h["enroll"] and diagnose.password_login(h):
        return password_session(state, h, ssh)
    return {"argv": [ssh, "-o", "BatchMode=yes", h["name"]], "env": {},
            "host": h["name"], "auth": "key"}


def password_session(state, h, ssh):
    """ssh that asks `roster askpass` for the password: the env carries a one-time token, never the
    password. The Login is resolved now, in this process, so whatever is wrong with it (provider not set up,
    vault locked, item missing, several items, no password: errors.py 11-14, 30-35) is reported before ssh
    starts instead of as a failed login in the terminal. ssh's prompt then gets the value from memory."""
    if state.askpass is None:
        raise RpcError(NO_ASKPASS, "the askpass channel isn't open in this process - password sessions "
                                   "need `roster serve`")
    diagnose.check_login(h)
    token = state.askpass.mint(h, h["name"])
    return {"argv": [ssh, "-o", "NumberOfPasswordPrompts=1",
                     "-o", "PreferredAuthentications=password,keyboard-interactive", h["name"]],
            "env": state.askpass.env(token), "host": h["name"], "auth": "password"}


askpass_lookup = diagnose.askpass_lookup


def host_check(state, params):
    """`roster check HOST` for the app: the diagnostic steps in order, stopping at the first failure (see
    diagnose.check_host). The password login, if it gets that far, goes through serve's askpass channel."""
    name = text_param(params, "host")
    return diagnose.check_host(name, state.inventory, state.askpass)


METHODS = {
    "inventory.info": inventory_info,
    "hosts.list": hosts_list,
    "host.get": host_get,
    "session.prepare": session_prepare,
    "host.check": host_check,
}


# ---------------------------------------------------------------- editing: Pending changes (ticket 10)

VERIFIED_FOR = 600          # s: how long a successful host.verify_login lets host.update make that change


def inventory_path(state):
    """roster.yml's path, even when it doesn't load (a pull or a discard may be what fixes it)."""
    if state.path is None:
        state.inventory()                   # raises the "no roster.yml" problem
    return state.path


def inventory_pull(state, params):
    """Fast-forward the infra repo before an edit (changes.pull), then load roster.yml again."""
    result = changes.pull(inventory_path(state))
    state.reload()
    return result


def edit_params(params):
    """params.changes, checked: {field: value} for edit.EDITABLE fields only."""
    fields = params.get("changes")
    if not isinstance(fields, dict) or not fields:
        raise RpcError(INVALID_PARAMS, f"params.changes must be an object of {', '.join(edit.EDITABLE)}")
    try:
        return {k: edit.check_value(k, v) for k, v in fields.items()}
    except ValueError as e:
        raise RpcError(INVALID_PARAMS, f"params.changes: {e}") from None


def edited_host(state, params):
    """(the Host now, the Host as params would leave it, the fields that really change). Reads roster.yml afresh."""
    name = text_param(params, "host")
    h = state.fresh()["hosts"].get(name)
    if h is None:
        raise RpcError(UNKNOWN_HOST, f"unknown host {name!r}")
    now = edit.current(h)
    wanted = {k: v for k, v in edit_params(params).items() if now[k] != v}
    after = {**now, **wanted}
    new = {**h, "ip": after["ip"], "ssh": {"user": after["user"], "port": after["port"], "auth": after["auth"]}}
    return h, new, wanted


def login_key(h):
    return (h["name"], h["ip"], h["ssh"]["user"], h["ssh"]["port"], h["ssh"]["auth"], h["enroll"])


def host_verify_login(state, params):
    """A test login to the Host as params.changes would leave it (diagnose.verify_login): exactly one attempt.
    Success lets host.update make exactly that change for the next VERIFIED_FOR seconds."""
    h, new, _ = edited_host(state, params)
    result = diagnose.verify_login(new, state.cfg["key"], previous=h)
    if result["ok"]:
        state.verified[login_key(new)] = time.monotonic()
    return result


def host_update(state, params):
    """Edit one Host in roster.yml, keeping everything else byte for byte (edit.edited), as a Pending change.
    A change to its address, user or Login needs a host.verify_login of exactly those values first."""
    h, new, wanted = edited_host(state, params)
    if not wanted:
        return {"changed": False, "host": h, "backup": None}
    key = login_key(new)
    if set(wanted) & set(edit.LOGIN_FIELDS):
        at = state.verified.get(key)
        if at is None or time.monotonic() - at > VERIFIED_FOR:
            raise RpcError(NOT_VERIFIED, f"{h['name']}'s new address, user or Login hasn't passed a test login",
                           fix="test the login (host.verify_login) with these values, then save again")
    repo = changes.Repo(state.path)
    old_text, new_text, _ = edit.edited(repo.path, h["name"], wanted)
    backup = repo.backup(old_text)
    edit.replace_file(repo.path, new_text)
    state.verified.pop(key, None)
    state.reload()
    return {"changed": True, "host": state.inventory()["hosts"][h["name"]], "backup": str(backup)}


def changes_diff(state, params):
    return changes.diff(inventory_path(state))


def changes_discard(state, params):
    result = changes.discard(inventory_path(state))
    state.reload()
    return result


def changes_publish(state, params):
    """Commit and push the Pending changes (changes.publish), then `roster sync`, so this Box's ssh config
    follows what it just published. A failed sync doesn't undo the Publish: it's reported in result.sync."""
    message = params.get("message")
    if message is not None and not isinstance(message, str):
        raise RpcError(INVALID_PARAMS, "params.message must be a string")
    result = changes.publish(inventory_path(state), message)
    state.reload()
    try:
        cfg = state.inventory()
        write_ssh_config(cfg)
        write_claude_files(cfg)
        result["sync"] = {"ok": True}
    except (Problem, SystemExit, OSError) as e:
        why = e.message if isinstance(e, Problem) else die_message(e) if isinstance(e, SystemExit) else str(e)
        result["sync"] = {"ok": False, "error": why, "fix": "run `roster sync` on this box"}
    return result


# ---------------------------------------------------------------- adding a Host (ticket 11, decision Q43)

ADD_PARAMS = {"address": "ip", "user": "user", "port": "port", "auth": "auth", "enroll": "enroll", "type": "type",
              "title": "title", "description": "description"}


def add_fields(params):
    """host.add's params as edit.added's fields (checked), leaving out the ones not given."""
    try:
        return {f: edit.check_new(f, params[p]) for p, f in ADD_PARAMS.items() if params.get(p) is not None}
    except ValueError as e:
        raise RpcError(INVALID_PARAMS, f"params: {e}") from None


def save_to(state, params):
    """Where a typed password is saved: params.provider, else the Inventory's vault. Ticket 35 adds the choice
    of target (a personal or a shared vault/collection); this is the one place it goes."""
    return vault_provider(state, params)


def typed_login(state, params, name):
    """{password, provider, item} for a password typed into the form, or None. Checked, never echoed."""
    password = params.get("password")
    if password is None:
        return None
    if not isinstance(password, str) or not password:
        raise RpcError(INVALID_PARAMS, "params.password must be a non-empty string")
    if params.get("auth") is not None:
        raise RpcError(INVALID_PARAMS, "give params.auth (an existing vault item) or params.password (a new one), "
                                       "not both")
    item = params.get("item") or f"{name} ssh"
    if not isinstance(item, str) or not item.strip() or "\n" in item or ":" in item:
        raise RpcError(INVALID_PARAMS, "params.item must be one line, without ':' (e.g. 'esx-02 ssh')")
    return {"password": password, "provider": save_to(state, params), "item": " ".join(item.split())}


def host_scan_key(state, params):
    """The host key at an address, to show the user before host.add's first login there (diagnose.scan_key)."""
    fields = add_fields({"address": params.get("address"), "port": params.get("port")})
    if "ip" not in fields:
        raise RpcError(INVALID_PARAMS, "params.address must be a non-empty string")
    port = fields.get("port", 22)
    h = {"name": params.get("name") or fields["ip"], "ip": fields["ip"], "ssh": {"port": port}}
    return {"address": fields["ip"], "port": port, **diagnose.scan_key(h)}


def host_add(state, params):
    """Add a Host to roster.yml as a Pending change (edit.added). With a Login (an existing vault item in auth, or
    a password typed into the form) it's a verified add (Q43): the test login first; then, for a typed password,
    the Vault item; then the Host. Nothing is written when the test login fails, and the item is taken back out
    when writing the Host fails. Without a Login the Host goes in unreviewed, as discover adds them."""
    try:
        return add_host(state, params)
    except (RpcError, SystemExit):
        raise
    except Exception as e:                      # never let the generic handler log text that might hold the password
        raise RpcError(INTERNAL_ERROR, f"adding the Host failed: {type(e).__name__}") from None


def add_host(state, params):
    name, group = text_param(params, "name"), text_param(params, "group")
    fields = add_fields(params)
    if "ip" not in fields:
        raise RpcError(INVALID_PARAMS, "params.address must be a non-empty string")
    host_key = params.get("host_key")
    if host_key is not None and not isinstance(host_key, str):
        raise RpcError(INVALID_PARAMS, "params.host_key must be a fingerprint (SHA256:...)")
    typed = typed_login(state, params, name)
    if typed:
        fields["auth"] = f"{typed['provider']}:{typed['item']}"
    state.fresh()
    repo = changes.Repo(state.path)
    _, _, h = edit.added(repo.path, group, name, fields)      # a dry run: the name, group and user, before the network
    login = typed is not None or diagnose.stored_password(h) is not None
    fields["reviewed"] = login
    verify = None
    if login:
        # a new Host's key isn't installed yet, so even an enroll: true Host is tested with its password
        verify = diagnose.verify_login({**h, "enroll": False}, state.cfg["key"], typed=typed, host_key=host_key)
        if not verify["ok"]:
            raise verify_failed(name, verify)
    made = None
    if typed:
        password, typed["password"] = typed["password"], None
        port = h["ssh"]["port"]
        uri = f"ssh://{h['ip']}" + ("" if port == 22 else f":{port}")
        try:
            made = providers.create_item(typed["provider"], name=typed["item"], password=password,
                                         username=h["ssh"]["user"], uri=uri)
        except providers.SecretError as e:
            raise write_problem(e) from None
        finally:
            del password
        made = {"provider": typed["provider"], **made}
    try:                                        # until the Host is written, any failure takes the item back out
        old_text, new_text, _ = edit.added(repo.path, group, name, fields)
        backup = repo.backup(old_text)
        edit.replace_file(repo.path, new_text)
    except BaseException as e:
        raise take_back(made, write_failed(name, repo.path, e)) from None
    warnings = []                               # the Host is in roster.yml now: what follows can't un-add it
    if verify and verify.get("host_key"):
        k = verify["host_key"]
        try:
            record_host_key(h, k["type"], k["base64"])
        except Exception as e:
            warnings.append(f"{name} was added, but its host key couldn't be recorded in ~/.ssh/roster_known_hosts "
                            f"({failure_text(e)}) - run `roster sync`, or test the login again before connecting")
    state.reload()
    return {"added": True, "host": state.inventory()["hosts"][name], "backup": str(backup), "verify": verify,
            "item": made, "warnings": warnings}


def failure_text(e):
    """What went wrong, safe to show: an OSError's own words (paths only), else just the exception's type."""
    if isinstance(e, OSError):
        return f"{e.strerror or type(e).__name__}" + (f": {e.filename}" if e.filename else "")
    return type(e).__name__


def write_failed(name, path, e):
    """Writing the Host failed: as a Problem (a Problem or a die() keeps its own words)."""
    if isinstance(e, Problem):
        return e
    if isinstance(e, SystemExit):
        return Problem(ROSTER_ERROR, f"{name} wasn't added: {die_message(e)}")
    return Problem(ROSTER_ERROR, f"{name} wasn't added: couldn't write {path} ({failure_text(e)})")


def verify_failed(name, verify):
    """A failed test login as host.add's error: the failed step's own code and message, and every step."""
    fail = next(s for s in verify["steps"] if s["status"] == "fail")
    data = {"step": fail["step"], "steps": verify["steps"], **fail.get("data", {})}
    return Problem(fail["code"], f"{name} wasn't added: {fail['message']} - nothing was saved", data,
                   fix=fail.get("fix"), details=fail.get("details"))


def take_back(made, e):
    """Writing the Host failed after its Vault item was made: delete the item again (Q43), and say so."""
    if made is None:
        return e
    try:
        with deadline(UNDO_TIME):
            providers.delete_item(made["provider"], made["id"])
    except Exception as undo:
        what = str(undo) if isinstance(undo, providers.SecretError) else type(undo).__name__
        return Problem(e.code, f"{e.message}; the vault item '{made['name']}' couldn't be taken back out ({what}) "
                               "- delete it in the vault", {**(e.data or {}), "left": made},
                       fix=f"delete '{made['name']}' in the vault, then fix what stopped the add", details=e.details)
    return Problem(e.code, f"{e.message}; the vault item '{made['name']}' was taken back out",
                   {**(e.data or {}), "undone": made}, details=e.details)


def host_review(state, params):
    """Mark a Host reviewed (reviewed: true on the Host itself, nothing else changes), as a Pending change."""
    name = text_param(params, "host")
    h = state.fresh()["hosts"].get(name)
    if h is None:
        raise RpcError(UNKNOWN_HOST, f"unknown host {name!r}")
    if h["reviewed"]:
        return {"changed": False, "host": h, "backup": None}
    repo = changes.Repo(state.path)
    old_text, new_text, _ = edit.edited(repo.path, name, {"reviewed": True})
    backup = repo.backup(old_text)
    edit.replace_file(repo.path, new_text)
    state.reload()
    return {"changed": True, "host": state.inventory()["hosts"][name], "backup": str(backup)}


# ---------------------------------------------------------------- the Live Inventory (ticket 28, decision Q45)
# Removing, renaming and moving Hosts, and adding, renaming and deleting groups: each a text edit of roster.yml
# (edit.py) written as a Pending change, like host.update. Removing a Host never touches the vault.

def write_edit(state, old_text, new_text):
    """Write an edit of roster.yml (a Pending change), keeping what it replaced as the backup; load it again."""
    repo = changes.Repo(state.path)
    backup = repo.backup(old_text)
    edit.replace_file(repo.path, new_text)
    state.reload()
    return str(backup)


def name_param(params, key):
    v = params.get(key)
    if not isinstance(v, str) or not v.strip():
        raise RpcError(INVALID_PARAMS, f"params.{key} must be a non-empty string")
    return v.strip()


def live_repo(state):
    """roster.yml as it is now, loaded, and in a git repo (Pending changes need one: 70)."""
    state.fresh()
    return changes.Repo(state.path)


def host_remove(state, params):
    """Take a Host out of roster.yml (its entry's lines), as a Pending change. Never touches the vault: its vault
    item, if any, stays where it is."""
    name = name_param(params, "host")
    repo = live_repo(state)
    old_text, new_text, h = edit.removed(repo.path, name)
    backup = write_edit(state, old_text, new_text)
    return {"removed": name, "group": h["group"], "backup": backup}


def host_rename(state, params):
    """Rename a Host (its key in roster.yml, nothing else), as a Pending change. Its vault item keeps its name."""
    name, to = name_param(params, "host"), name_param(params, "to")
    repo = live_repo(state)
    old_text, new_text, h = edit.renamed(repo.path, name, to)
    if old_text == new_text:
        return {"changed": False, "host": h, "backup": None}
    backup = write_edit(state, old_text, new_text)
    return {"changed": True, "host": state.inventory()["hosts"][to], "backup": backup}


def host_move(state, params):
    """Move a Host to the end of another group, as a Pending change. What it inherited from its old group and
    wouldn't from the new one is written on the Host, so it stays the same Host (`pinned` names those fields)."""
    name, group = name_param(params, "host"), name_param(params, "group")
    repo = live_repo(state)
    old_text, new_text, h, pinned = edit.moved(repo.path, name, group)
    if old_text == new_text:
        return {"changed": False, "host": h, "pinned": [], "backup": None}
    backup = write_edit(state, old_text, new_text)
    return {"changed": True, "host": state.inventory()["hosts"][name], "pinned": pinned, "backup": backup}


def group_new(state, params):
    """Add an empty group after the last one (`NAME:` with `hosts: {}`), as a Pending change."""
    name = name_param(params, "name")
    title = params.get("title") or ""
    if not isinstance(title, str) or "\n" in title:
        raise RpcError(INVALID_PARAMS, "params.title must be one line")
    repo = live_repo(state)
    old_text, new_text = edit.group_added(repo.path, name, title)
    backup = write_edit(state, old_text, new_text)
    return {"group": name, "backup": backup}


def group_rename(state, params):
    """Rename a group (its key in roster.yml); its Hosts go with it. A Pending change."""
    group, to = name_param(params, "group"), name_param(params, "to")
    repo = live_repo(state)
    old_text, new_text = edit.group_renamed(repo.path, group, to)
    if old_text == new_text:
        return {"changed": False, "group": to, "backup": None}
    backup = write_edit(state, old_text, new_text)
    return {"changed": True, "group": to, "backup": backup}


def group_delete(state, params):
    """Delete a group. One that still has Hosts is refused (102, data.hosts) unless `to` names the group they move
    to first (as host.move moves them). A Pending change."""
    group = name_param(params, "group")
    to = params.get("to")
    if to is not None:
        to = name_param(params, "to")
    repo = live_repo(state)
    old_text, new_text, moved = edit.group_deleted(repo.path, group, to)
    backup = write_edit(state, old_text, new_text)
    return {"deleted": group, "moved": moved, "to": to if moved else None, "backup": backup}


# ---------------------------------------------------------------- reloading: `:source` and auto_reload (Q58)

def inventory_reload(state, params):
    """`:source` for roster.yml: load it again now. A file that doesn't load keeps the last good Inventory, and
    `error` says why ({message, path, line?, fix}); `changed`: the file differs from what was loaded before."""
    before = state.digest
    state.reload()
    cfg = state.inventory()
    return {"changed": state.digest != before, "host_count": len(cfg["hosts"]), "error": broken(state)}


WATCH_EVERY = 0.2           # s: how often the watcher looks at roster.yml (an outside edit shows within a second)


class Watcher(threading.Thread):
    """Looks at roster.yml every WATCH_EVERY s: its size, time and inode, so an editor that saves by writing a new
    file and renaming it over is seen too. A change that has settled (the same for one more look) and differs from
    what serve last loaded (its own writes don't count) is either applied (inventory.watch's auto: reload, then
    `inventory.changed {applied: true, error}`) or only reported once (`{applied: false}`: the app's status bar
    hint, applied by `:source`)."""

    def __init__(self, state):
        super().__init__(daemon=True, name="roster-watch")
        self.state, self.stop = state, threading.Event()

    @staticmethod
    def look(path):
        try:
            st = path.stat()
        except OSError:
            return None
        return st.st_mtime_ns, st.st_size, st.st_ino

    def run(self):
        last = settling = self.look(self.state.path)
        while not self.stop.wait(WATCH_EVERY):
            now = self.look(self.state.path)
            if now == last:
                continue
            if now != settling:                     # still being written: look again once it's settled
                settling = now
                continue
            last = now
            self.changed()

    def changed(self):
        state = self.state
        with state.lock:
            digest = file_digest(state.path)
            if digest is None or digest in (state.digest, state.noticed):
                return
            if state.auto:
                state.reload()
                params = {"applied": True, "error": broken(state)}
            else:
                state.noticed = digest
                params = {"applied": False, "error": None}
            notify = state.notify
        if notify:
            notify("inventory.changed", params)


def inventory_watch(state, params):
    """Start watching roster.yml for outside edits (once), and say whether to apply them (auto, the Config's
    auto_reload) or only report them. Without a notification channel (in-process use) it can't watch."""
    auto = params.get("auto", False)
    if not isinstance(auto, bool):
        raise RpcError(INVALID_PARAMS, "params.auto must be true or false")
    state.auto = auto
    if state.notify is None or state.path is None:
        return {"watching": False, "auto": auto}
    if state.watcher is None:
        state.watcher = Watcher(state)
        state.watcher.start()
    return {"watching": True, "auto": auto, "path": str(state.path)}


METHODS["host.remove"] = host_remove
METHODS["host.rename"] = host_rename
METHODS["host.move"] = host_move
METHODS["group.new"] = group_new
METHODS["group.rename"] = group_rename
METHODS["group.delete"] = group_delete
METHODS["inventory.reload"] = inventory_reload
METHODS["inventory.watch"] = inventory_watch
METHODS["host.scan_key"] = host_scan_key
METHODS["host.add"] = host_add
METHODS["host.review"] = host_review
METHODS["inventory.pull"] = inventory_pull
METHODS["host.verify_login"] = host_verify_login
METHODS["host.update"] = host_update
METHODS["changes.diff"] = changes_diff
METHODS["changes.discard"] = changes_discard
METHODS["changes.publish"] = changes_publish


# ---------------------------------------------------------------- vault: the lock screen

STATUS_WORDS = {"unauthenticated": "not-logged-in", "missing": "missing-cli"}   # providers' word -> the API's


secret_error = vault_problem          # a provider's SecretError as the error to answer with (safe to show)


def referenced_providers(cfg):
    """Providers the Inventory's Host Logins use (ssh and services), most used first, known ones only."""
    counts = {}
    for h in cfg["hosts"].values():
        for login in (h["ssh"], h["login"], *h["services"].values()):
            name = str(login.get("auth") or "").partition(":")[0].strip()
            if name and name not in providers.NO_PASSWORD and name in PROVIDERS:
                counts[name] = counts.get(name, 0) + 1
    return sorted(counts, key=lambda n: (-counts[n], n))


def provider_status(name):
    try:
        status = providers.vault_status(name)
    except providers.SecretError as e:
        raise secret_error(e) from None
    result = {"provider": name, "status": STATUS_WORDS.get(status, status), "can_write": providers.can_write(name)}
    message = providers.status_message(name, status)
    if status == "unauthenticated" and PROVIDERS[name].get("login_info"):
        try:
            result["sign_in"] = PROVIDERS[name]["login_info"](providers.Ctx(name, None))
        except providers.SecretError:
            pass
    return result | ({"message": message} if message else {})


def vault_status(state, params):
    """The vault to unlock (the most used provider that has a master password) and where every provider
    the Inventory uses stands."""
    names = referenced_providers(state.inventory())
    lockable = [n for n in names if PROVIDERS[n].get("unlock")]
    main = provider_status(lockable[0]) if lockable else {"provider": None, "status": "unsupported",
                                                          "can_write": False}
    return {**main, "providers": [main if n == main["provider"] else provider_status(n) for n in sorted(names)]}


def only_vault_unlock_unlocks():
    """The app opens locked and only its lock screen unlocks: forget a BW_PASSWORD / BW_SESSION this process
    inherited, and tell providers not to unlock by themselves (no bw-session file, no prompt)."""
    for var in ("BW_PASSWORD", "BW_SESSION"):
        os.environ.pop(var, None)
    providers.MANUAL_UNLOCK = True


def vault_provider(state, params):
    """params.provider, or the Inventory's vault (vault.status's "provider")."""
    name = params.get("provider")
    if name is None:
        name = vault_status(state, params)["provider"]
        if name is None:
            raise RpcError(UNSUPPORTED, "no Host Login uses a vault with a master password")
    if not isinstance(name, str) or name not in PROVIDERS:
        raise RpcError(INVALID_PARAMS, f"params.provider must be one of: {', '.join(sorted(PROVIDERS))}")
    return name


def vault_unlock(state, params):
    """Unlock with the master password. It goes to the provider through an environment variable; the
    session key stays in this process's memory and is never written to the bw-session file."""
    password = text_param(params, "password")
    name = vault_provider(state, params)
    try:
        providers.unlock(name, password)
    except providers.SecretError as e:
        raise secret_error(e) from None
    except Exception as e:                      # never let the generic handler log text that might hold it
        raise RpcError(INTERNAL_ERROR, f"unlocking {name} failed: {type(e).__name__}") from None
    state.unlocked.add(name)
    return provider_status(name)


ON_VAULT_LOCK = []          # fn(state) run by vault.lock: whatever else holds secrets (askpass tokens) forgets them


def forget_askpass_tokens(state):
    if state.askpass is not None:
        state.askpass.forget()


ON_VAULT_LOCK.append(forget_askpass_tokens)


def vault_lock(state, params):
    """Forget every cached secret and session key, and run each provider's own lock: the ones vault.unlock
    opened and the ones the Inventory uses. Memory is cleared even if a provider's lock fails."""
    names = set(state.unlocked) | (set(referenced_providers(state.cfg)) if state.cfg else set())
    end_sign_in(state)
    for forget in ON_VAULT_LOCK:
        forget(state)
    for name in sorted(names):
        try:
            providers.lock(name)
        except providers.SecretError as e:
            print(f"serve: warning: locking {name}: {e}", file=sys.stderr, flush=True)
    state.unlocked.clear()
    return {"locked": sorted(n for n in names if PROVIDERS[n].get("lock"))}


METHODS["vault.status"] = vault_status
METHODS["vault.unlock"] = vault_unlock
METHODS["vault.lock"] = vault_lock


# ---------------------------------------------------------------- vault.create_item: "Save to vault" (ticket 13)
# Q43's order is verify, create the Vault item, add the Pending change; if the add fails, vault.undo_create takes
# the item back out. It only deletes items this serve created, so it can't be pointed at anything else.

def vault_create_item(state, params):
    """Create a login Vault item: name, username, password, and the address in its URI field. Refuses a name
    that's already there (code 60). The password goes to the provider on stdin; it's never answered back."""
    name, password = text_param(params, "name"), text_param(params, "password")
    extra = {k: params.get(k) or "" for k in ("username", "uri")}
    if not all(isinstance(v, str) for v in extra.values()):
        raise RpcError(INVALID_PARAMS, "params.username and params.uri must be strings")
    provider = vault_provider(state, params)
    try:
        made = providers.create_item(provider, name=name, password=password, **extra)
    except providers.SecretError as e:
        raise write_problem(e) from None
    except Exception as e:                      # never let the generic handler log text that might hold it
        raise RpcError(INTERNAL_ERROR, f"saving to {provider} failed: {type(e).__name__}") from None
    state.created[made["id"]] = provider
    return {"provider": provider, **made}


def vault_undo_create(state, params):
    """Delete an item vault.create_item made in this serve (Q43's undo). Bitwarden moves it to the trash."""
    item_id = text_param(params, "id")
    provider = state.created.get(item_id)
    if provider is None:
        raise RpcError(NOT_CREATED_HERE, f"item {item_id} wasn't created by this roster serve (or is already "
                       "undone) - roster only takes back the items it just saved")
    try:
        providers.delete_item(provider, item_id)
    except providers.SecretError as e:
        raise write_problem(e) from None
    del state.created[item_id]
    return {"provider": provider, "id": item_id}


METHODS["vault.create_item"] = vault_create_item
METHODS["vault.undo_create"] = vault_undo_create


# ---------------------------------------------------------------- vault.login: signing in (ticket 31)

SIGN_IN_IDLE = 600          # s: a sign-in nobody answers for this long is ended (and forgets the password it held)
SIGN_IN_METHODS = {"password": ("email", "password"), "apikey": ("client_id", "client_secret"), "sso": ()}
ANSWERS = {"two_factor_code": "code", "new_device_code": "code", "master_password": "password"}


class SignIn:
    def __init__(self, provider, flow):
        self.id, self.provider, self.flow = secrets.token_hex(8), provider, flow


def end_sign_in(state):
    """Stop the sign-in in progress (its CLI process too) and forget what it held."""
    login, state.login = state.login, None
    if login is not None:
        login.flow.close()


def sign_in_step(state, login, fn):
    """Run one step. A failure that says where to carry on keeps the sign-in; any other ends it."""
    try:
        step = fn()
    except providers.SecretError as e:
        if getattr(e, "step", None) is None:
            end_sign_in(state)
        raise sign_in_problem(e, login.id) from None
    except (KeyError, TypeError, ValueError) as e:      # an answer that doesn't fit the step: the step stays
        raise RpcError(INVALID_PARAMS, f"vault.login: {e}" if isinstance(e, ValueError) else
                       "vault.login: params don't fit the step") from None
    except Exception as e:                      # never let the generic handler log text that might hold a secret
        end_sign_in(state)
        raise RpcError(INTERNAL_ERROR, f"signing in to {login.provider} failed: {type(e).__name__}") from None
    if step["step"] == "done":
        state.unlocked.add(login.provider)
        end_sign_in(state)
    return {**step, "login": login.id}


def vault_login(state, params):
    """Sign the vault CLI in on this box, a step at a time (README "Signing in: vault.login").
    action "start" (the default) begins a new one, "answer" answers the current step, "cancel" stops it.
    Secrets arrive as values, go to the CLI through env vars or its own prompts, and are never echoed."""
    action = params.get("action", "start")
    if action == "cancel":
        cancelled = state.login is not None
        end_sign_in(state)
        return {"cancelled": cancelled}
    if action == "answer":
        login = state.login
        if login is None or params.get("login") != login.id:
            raise RpcError(NO_SIGN_IN, "no sign-in in progress (it finished, was cancelled or timed out) - "
                                       "start again", fix="start the sign-in again")
        if time.monotonic() - login.flow.touched > SIGN_IN_IDLE:
            end_sign_in(state)
            raise RpcError(NO_SIGN_IN, f"the sign-in timed out ({SIGN_IN_IDLE // 60} minutes without an answer) "
                                       "- start again", fix="start the sign-in again")
        key = ANSWERS.get(login.flow.step["step"])
        if key:
            text_param(params, key)
        return sign_in_step(state, login, lambda: login.flow.answer(params))
    if action != "start":
        raise RpcError(INVALID_PARAMS, "params.action must be start, answer or cancel")
    method = params.get("method", "password")
    if method not in SIGN_IN_METHODS:
        raise RpcError(INVALID_PARAMS, f"params.method must be one of: {', '.join(SIGN_IN_METHODS)}")
    for key in SIGN_IN_METHODS[method]:
        text_param(params, key)
    for key in ("server", "identifier"):
        if params.get(key) is not None and not isinstance(params[key], str):
            raise RpcError(INVALID_PARAMS, f"params.{key} must be a string")
    end_sign_in(state)
    name = vault_provider(state, params)
    try:
        flow = providers.login(name)
    except providers.SecretError as e:
        raise sign_in_problem(e) from None
    state.login = SignIn(name, flow)
    return sign_in_step(state, state.login, lambda: flow.start({**params, "method": method}))


METHODS["vault.login"] = vault_login


# ---------------------------------------------------------------- the loop

# Each long method's overall deadline (s). The app waits longer for each (app/src-tauri/src/lib.rs CALL_SECS),
# at least the deadline plus AFTER_DEADLINE: a few steps still run once it's past (a 1 s floor each, up to 15 s
# to check what a step that timed out did: changes.CHECK_TIMEOUT, bitwarden's lookup after a create; and UNDO_TIME
# to take a new Vault item back out). So serve
# always answers before the app gives up, and the answer says what happened. Other methods: the app's 60 s.
DEADLINES = {"host.add": 100, "changes.publish": 110, "inventory.pull": 45, "host.check": 45,
             "host.verify_login": 45, "vault.create_item": 45}
AFTER_DEADLINE = 40
UNDO_TIME = 15              # s: taking a new Vault item back out gets this much, even past the deadline


def handle(state, line):
    """One request line -> the response object, or None for a notification."""
    try:
        req = json.loads(line)
    except ValueError as e:
        return error_response(None, RpcError(PARSE_ERROR, f"not valid JSON: {e}"))
    if not isinstance(req, dict) or req.get("jsonrpc") != "2.0" or not isinstance(req.get("method"), str):
        rid = req.get("id") if isinstance(req, dict) else None
        return error_response(rid, RpcError(INVALID_REQUEST, "expected a JSON-RPC 2.0 request object"))
    rid, notification = req.get("id"), "id" not in req
    try:
        fn = METHODS.get(req["method"])
        if fn is None:
            raise RpcError(METHOD_NOT_FOUND, f"unknown method {req['method']!r}")
        params = req.get("params", {})
        if not isinstance(params, dict):
            raise RpcError(INVALID_PARAMS, "params must be an object")
        with deadline(DEADLINES.get(req["method"])):
            result = {"jsonrpc": "2.0", "id": rid, "result": fn(state, params)}
    except RpcError as e:
        result = error_response(rid, e)
    except SystemExit as e:                     # a die() inside roster: its message is the answer
        result = error_response(rid, RpcError(ROSTER_ERROR, die_message(e)))
    except Exception as e:
        print(f"serve: {req['method']} failed: {type(e).__name__}: {e}", file=sys.stderr, flush=True)
        result = error_response(rid, RpcError(INTERNAL_ERROR, f"{type(e).__name__}: {e}"))
    return None if notification else result


def error_response(rid, e):
    err = {"code": e.code, "message": e.message}
    if e.data is not None:
        err["data"] = e.data
    if getattr(e, "details", None):         # the raw words (git's, ssh's) for the app's "Details"
        err["data"] = {**err.get("data", {}), "details": e.details}
    return {"jsonrpc": "2.0", "id": rid, "error": err}


def log_line(msg):
    print(f"serve: {msg}", file=sys.stderr, flush=True)


def serve(config_arg):
    out = sys.stdout
    sys.stdout = sys.stderr             # whatever else roster prints (warnings, say()) must not corrupt the stream
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))      # so the askpass directory is still removed
    state = State(config_arg)
    out_lock = threading.Lock()

    def send(message):
        with out_lock:
            out.write(json.dumps(message, default=str) + "\n")
            out.flush()

    # the one message serve sends unasked: a JSON-RPC notification (no id), e.g. inventory.changed
    state.notify = lambda method, params: send({"jsonrpc": "2.0", "method": method, "params": params})
    with askpass.Channel(askpass_lookup, log=log_line) as state.askpass:
        try:
            for line in sys.stdin:
                if not line.strip():
                    continue
                with state.lock:
                    response = handle(state, line)
                if response is not None:
                    send(response)
        finally:
            if state.watcher is not None:
                state.watcher.stop.set()
            end_sign_in(state)              # a half-done `bw login` doesn't outlive serve
    return 0
