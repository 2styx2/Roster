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
import re
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
    HOST_KEY_CHANGED_WHILE_ASKED,
    HOST_KEY_UNKNOWN,
    INVALID_HOST,
    INVENTORY_ERROR,
    ITEM_EXISTS,
    LOGIN_NOT_SEEN,
    NAME_TAKEN,
    NO_ASKPASS,
    NO_SIGN_IN,
    NOT_CREATED_HERE,
    NOT_LOGGED_IN,
    NOT_REVIEWED,
    NOT_SET_UP,
    NOT_VERIFIED,
    NOTHING_HELD,
    PASSWORD_NEEDED,
    READ_ONLY_TARGET,
    ROSTER_ERROR,
    UNKNOWN_GROUP,
    UNKNOWN_HOST,
    UNKNOWN_TARGET,
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
from .sshops import fingerprint, in_ssh_config, record_host_key, recorded_host_keys, write_ssh_config

API_VERSION = 13            # bump when a method or result changes in a way the app has to know about

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
        self.verified = {}                  # host.verify_login successes: login_key -> (time, host key to pin)
        self.held = {}                      # typed passwords held for "Save to vault", by id: Held (T15, T16)
        # state.held is also changed on the askpass channel's threads (a login report), so it has a lock of its own:
        # never state.lock, which a long request holds for up to its deadline and would hold up askpass's answers.
        self.held_lock = threading.RLock()
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
    known_hosts and connection sharing all come from the config, as `roster run` does, except that ssh checks the
    host key strictly: a Host with no recorded key is refused with 44 before anything connects, so the app can
    ask (ticket 36: host.scan_key, then host.trust_key)."""
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
    if not h["enroll"] and prompted(h):
        return prompt_session(state, h, ssh, params)
    if params.get("password") is not None or params.get("save") is not None:
        raise RpcError(INVALID_PARAMS, f"params.password and params.save are only for a Host whose Login is auth: "
                                       f"prompt; {h['name']}'s password comes from its Login")
    if not h["enroll"] and diagnose.password_login(h):
        return password_session(state, h, ssh)
    known_key(h)
    return {"argv": [ssh, *STRICT, "-o", "BatchMode=yes", h["name"]], "env": {},
            "host": h["name"], "auth": "key"}


def known_key(h):
    """Refuse (44, with the address to ask about) a Session to a Host roster has recorded no host key for. It comes
    after every other check, so the app only asks about a key when trusting it is all that's left to do."""
    if not recorded_host_keys(h):
        raise RpcError(HOST_KEY_UNKNOWN, f"roster hasn't seen {h['name']}'s host key before",
                       {"address": h["ip"], "port": h["ssh"]["port"]},
                       fix="compare its fingerprint with the Host's console or owner, then trust it when the app "
                           f"asks, or run `roster setup --only {h['name']}`")


# An app Session never trusts a host key on its own (Q60): the key must already be in roster's known hosts, put
# there by `roster setup`, a verified add or edit, or host.trust_key after the app asked. On the command line it
# wins over the `StrictHostKeyChecking accept-new` in the Host block, which `roster ssh`/`run` keep.
STRICT = ["-o", "StrictHostKeyChecking=yes"]


def password_session(state, h, ssh):
    """ssh that asks `roster askpass` for the password: the env carries a one-time token, never the
    password. The Login is resolved now, in this process, so whatever is wrong with it (provider not set up,
    vault locked, item missing, several items, no password: errors.py 11-14, 30-35) is reported before ssh
    starts instead of as a failed login in the terminal. ssh's prompt then gets the value from memory."""
    if state.askpass is None:
        raise RpcError(NO_ASKPASS, "the askpass channel isn't open in this process - password sessions "
                                   "need `roster serve`")
    diagnose.check_login(h)
    known_key(h)
    token = state.askpass.mint(h, h["name"])
    return {"argv": [ssh, *STRICT, "-o", "NumberOfPasswordPrompts=1",
                     "-o", "PreferredAuthentications=password,keyboard-interactive", h["name"]],
            "env": state.askpass.env(token), "host": h["name"], "auth": "password"}


def prompted(h):
    """Is the Host's ssh Login `auth: prompt`: a password nobody saved, which the user types (ticket 16)?"""
    login = diagnose.password_login(h)
    return login is not None and str(login["auth"]).partition(":")[0].strip() == "prompt"


def prompt_session(state, h, ssh, params):
    """A Session to an `auth: prompt` Host (ticket 16): roster has no password to look up, so the app asks for it
    (39 until it's sent) and it goes to ssh through an askpass token, like a vault password. With save: true serve
    holds it for "Save to vault" (host.save_login) until that Session has logged in with it; that Session then
    never reuses a shared connection (ControlPath=none), so the login really is made with the typed password."""
    if state.askpass is None:
        raise RpcError(NO_ASKPASS, "the askpass channel isn't open in this process - password sessions "
                                   "need `roster serve`")
    diagnose.check_user(h)
    known_key(h)
    password = params.get("password")
    if password is None:
        raise RpcError(PASSWORD_NEEDED, f"{h['name']}'s Login is auth: prompt - type its password",
                       {"user": h["ssh"]["user"], "address": h["ip"], "port": h["ssh"]["port"]},
                       fix="type the password when the app asks; tick Save to vault to keep it in the vault "
                           "once it has logged in")
    if not isinstance(password, str) or not password:
        raise RpcError(INVALID_PARAMS, "params.password must be a non-empty string")
    save = save_param(params, password)
    if save:
        saving_provider(state, params)
    typed = askpass.Typed(password)
    del password
    argv = [ssh, *STRICT, "-o", "NumberOfPasswordPrompts=1",
            "-o", "PreferredAuthentications=password,keyboard-interactive"]
    held = {}
    if save:
        held = {"held": hold(state, secrets.token_hex(8), typed, "host", h["name"],
                             {"host": h["name"], "login": login_key(h)})}
        argv += [*state.askpass.login_options(), "-o", "ControlPath=none"]
    token = state.askpass.mint(typed, h["name"])
    return {"argv": [*argv, h["name"]], "env": state.askpass.env(token), "host": h["name"], "auth": "password",
            **held}


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
        state.verified[login_key(new)] = (time.monotonic(), result.pop("host_key", None))
    return result


def host_update(state, params):
    """Edit one Host in roster.yml, keeping everything else byte for byte (edit.edited), as a Pending change.
    A change to its address, user or Login needs a host.verify_login of exactly those values first."""
    h, new, wanted = edited_host(state, params)
    if not wanted:
        return {"changed": False, "host": h, "backup": None}
    key = login_key(new)
    pin = None
    if set(wanted) & set(edit.LOGIN_FIELDS):
        at, pin = state.verified.get(key, (None, None))
        if at is None or time.monotonic() - at > VERIFIED_FOR:
            raise RpcError(NOT_VERIFIED, f"{h['name']}'s new address, user or Login hasn't passed a test login",
                           fix="test the login (host.verify_login) with these values, then save again")
    repo = changes.Repo(state.path)
    old_text, new_text, _ = edit.edited(repo.path, h["name"], wanted)
    backup = repo.backup(old_text)
    edit.replace_file(repo.path, new_text)
    state.verified.pop(key, None)
    warnings = []
    if pin:                     # it moved: the key it was verified with is now recorded for its new address
        try:
            record_host_key(new, pin["type"], pin["base64"])
        except Exception as e:
            warnings.append(f"{h['name']} was changed, but its host key couldn't be recorded for {new['ip']} "
                            f"({failure_text(e)}) - test the login again before connecting")
    state.reload()
    return {"changed": True, "host": state.inventory()["hosts"][h["name"]], "backup": str(backup),
            "warnings": warnings}


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


def save_to_param(params):
    """params.save_to (ticket 35): where to save, chosen at save time, or None for the setting's."""
    value = params.get("save_to")
    if value is None:
        return None
    try:
        return providers.check_save_to(value)
    except ValueError as e:
        raise RpcError(INVALID_PARAMS, f"params.save_to {e}") from None


def typed_login(state, params, name):
    """{password, provider, item, save_to} for a password typed into the form, or None. Checked, never echoed."""
    password = params.get("password")
    if password is None:
        return None
    if not isinstance(password, str) or not password:
        raise RpcError(INVALID_PARAMS, "params.password must be a non-empty string")
    if params.get("auth") is not None:
        raise RpcError(INVALID_PARAMS, "give params.auth (an existing vault item) or params.password (a new one), "
                                       "not both")
    return {"password": password, "provider": vault_provider(state, params), "item": item_param(params, name),
            "save_to": save_to_param(params)}


def host_scan_key(state, params):
    """The host key at an address, to show the user before host.add's first login there (diagnose.scan_key).
    With params.host instead, a Host's (its address and port): the key a Session asks about (ticket 36)."""
    if "host" in params:
        h = known_host(state, params)
        return {"host": h["name"], "address": h["ip"], "port": h["ssh"]["port"], **diagnose.scan_key(h)}
    fields = add_fields({"address": params.get("address"), "port": params.get("port")})
    if "ip" not in fields:
        raise RpcError(INVALID_PARAMS, "params.address must be a non-empty string")
    port = fields.get("port", 22)
    h = {"name": params.get("name") or fields["ip"], "ip": fields["ip"], "ssh": {"port": port}}
    return {"address": fields["ip"], "port": port, **diagnose.scan_key(h)}


def known_host(state, params):
    """The Host named by params.host (exact name)."""
    name = text_param(params, "host")
    h = state.inventory()["hosts"].get(name)
    if h is None:
        raise RpcError(UNKNOWN_HOST, f"unknown host {name!r}")
    return h


def host_trust_key(state, params):
    """Record the host key the user was shown (host.scan_key {host}) and trusted, so the Session can open (ticket
    36, decision Q60). It fetches the key again first and records it only if the Host still offers exactly that
    fingerprint (else 23); a key that differs from one already recorded is never trusted here (43, Q44)."""
    h = known_host(state, params)
    asked = params.get("fingerprint")
    if not isinstance(asked, str) or not asked.startswith("SHA256:"):
        raise RpcError(INVALID_PARAMS, "params.fingerprint must be the SHA256:... fingerprint the user was shown")
    key, recorded = diagnose.offered_key(h)
    if recorded == "changed":
        raise diagnose.changed_key(h, recorded_host_keys(h), key)
    offered = fingerprint(key)
    if offered != asked:
        raise RpcError(HOST_KEY_CHANGED_WHILE_ASKED,
                       f"{h['name']}'s host key changed while roster was asking - nothing was recorded",
                       {"asked": asked, "offered": offered},
                       fix="don't trust it blindly: compare the new fingerprint with the Host's console or owner, "
                           "then open the Session again to see it",
                       details=f"asked about {asked}; now offered {key.get_name()} {offered}")
    if recorded == "none":
        record_host_key(h, key.get_name(), key.get_base64())
    return {"host": h["name"], "address": h["ip"], "port": h["ssh"]["port"], "key_type": key.get_name(),
            "fingerprint": offered, "recorded": recorded == "none"}


# ---------------------------------------------------------------- Quick Connect (ticket 14)
# A Session to user@address[:port], a box that isn't in the Inventory. The app shows the key host.scan_key
# {address, port} fetched; quick.prepare fetches it again and goes on only if it's still exactly that one. The key
# is trusted for this Session only: it goes into serve's own known-hosts file (in the askpass channel's private
# directory, gone when serve exits) under an alias of its own, never into roster's known hosts, so a box nobody
# added stays unknown to every Host-to-be at that address (T15's "Save to vault" records it, after the login).
# A typed password goes to ssh through the askpass channel, exactly like a vault password: once, within 60 s,
# and forgotten by vault.lock. Nothing is written to roster.yml.

QUICK_USER = re.compile(r"[A-Za-z0-9_][A-Za-z0-9._-]*")
QUICK_ADDRESS = re.compile(r"[A-Za-z0-9_.:%][A-Za-z0-9_.:%-]*")     # a name, IPv4 or IPv6 (no brackets, no '-' first)


def quick_target(params):
    """(user, address, port) from quick.prepare's params, checked: nothing ssh could read as an option."""
    user, address, port = params.get("user"), params.get("address"), params.get("port", 22)
    if not isinstance(user, str) or not QUICK_USER.fullmatch(user):
        raise RpcError(INVALID_PARAMS, "params.user must be a user name (letters, digits, '.', '_', '-'; not "
                                       "starting with '-')")
    if not isinstance(address, str) or not QUICK_ADDRESS.fullmatch(address):
        raise RpcError(INVALID_PARAMS, "params.address must be a host name or an IP address")
    if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
        raise RpcError(INVALID_PARAMS, "params.port must be a number from 1 to 65535")
    return user, address, port


def quick_prepare(state, params):
    """What the app runs in a PTY for a Quick Connect: ssh to user@address:port, checking the host key strictly
    against the one the user was shown (params.fingerprint, from host.scan_key). With params.password the Session
    logs in with it, through an askpass token; without, with this box's own keys (BatchMode). Refuses a key that
    changed since the user was asked (23) or differs from one roster recorded for the address (43), and 40-42 when
    it can't get there; nothing is kept on any error."""
    user, address, port = quick_target(params)
    asked = params.get("fingerprint")
    if not isinstance(asked, str) or not asked.startswith("SHA256:"):
        raise RpcError(INVALID_PARAMS, "params.fingerprint must be the SHA256:... fingerprint the user was shown")
    password = params.get("password")
    if password is not None and (not isinstance(password, str) or not password):
        raise RpcError(INVALID_PARAMS, "params.password must be a non-empty string, or left out to log in with "
                                       "this box's keys")
    save = save_param(params, password)
    if save:
        saving_provider(state, params)
    ssh = shutil.which("ssh")
    if ssh is None:
        raise RpcError(NOT_SET_UP, "there's no ssh on this box's PATH - install OpenSSH's client")
    if state.askpass is None:
        raise RpcError(NO_ASKPASS, "the askpass channel isn't open in this process - Quick Connect needs "
                                   "`roster serve`")
    label = quick_label(user, address, port)
    h = {"name": label, "ip": address, "ssh": {"port": port, "user": user}}
    key, recorded = diagnose.offered_key(h)
    if recorded == "changed":
        p = diagnose.changed_key(h, recorded_host_keys(h), key)
        p.data["fix"] = ("don't accept it blindly: compare the new fingerprint with the box's console or owner. If "
                         "the change is expected (reinstall), delete its line in ~/.ssh/roster_known_hosts")
        raise p
    offered = fingerprint(key)
    if offered != asked:
        raise RpcError(HOST_KEY_CHANGED_WHILE_ASKED,
                       f"{label}'s host key changed while roster was asking - not connecting",
                       {"asked": asked, "offered": offered},
                       fix="don't trust it blindly: compare the new fingerprint with the box's console or owner, "
                           "then Quick Connect again to see it",
                       details=f"asked about {asked}; now offered {key.get_name()} {offered}")
    qid = secrets.token_hex(8)
    alias = f"roster-quick-{qid}"
    known = state.askpass.known_hosts
    fd = os.open(known, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(fd, "a") as f:
        f.write(f"{alias} {key.get_name()} {key.get_base64()}\n")
    quick = {"user": user, "address": address, "port": port, "key_type": key.get_name(), "fingerprint": offered,
             "base64": key.get_base64()}        # what quick.save needs, kept only with a held password (T15)
    argv = [ssh, *STRICT, "-o", f"UserKnownHostsFile={ssh_value(known)}", "-o", "GlobalKnownHostsFile=/dev/null",
            "-o", f"HostKeyAlias={alias}", "-o", "UpdateHostKeys=no", "-o", "ControlPath=none",
            "-o", "ConnectTimeout=10"]
    held = {}
    if password is None:
        argv += ["-o", "BatchMode=yes"]
        env, auth = {}, "key"
    else:
        argv += ["-o", "NumberOfPasswordPrompts=1", "-o", "PreferredAuthentications=password,keyboard-interactive",
                 "-o", "PubkeyAuthentication=no"]
        typed = askpass.Typed(password)
        del password
        if save:
            held = {"held": hold(state, qid, typed, "quick", label, quick)}
            argv += state.askpass.login_options()
        token = state.askpass.mint(typed, label)
        env, auth = state.askpass.env(token), "password"
    argv += ["-p", str(port), "-l", user, "--", address]
    return {"argv": argv, "env": env, "host": label, "auth": auth, "quick": qid, "user": user, "address": address,
            "port": port, "key_type": key.get_name(), "fingerprint": offered, **held}


# ---------------------------------------------------------------- "Save to vault" after the Session's login (T15, T16)
# Q43 says a password enters the vault only after a login with exactly it succeeded. For a Session that's that
# Session's own login: with save: true, serve keeps the typed password in memory, bound to an id (the Quick Connect's,
# or the Host Session's), and ssh runs askpass's logged-in script as its LocalCommand, which ssh does only once it has
# logged in. The report counts only if that Session's token handed this password to ssh. The save then refers to
# the id; the password is never sent again. It's forgotten after one save, by vault.forget_typed (the Session ended
# without saving), by vault.lock, or HOLD_FOR after it was typed (the askpass channel's tick enforces it).

HOLD_FOR = 600              # s: how long a typed password waits for its "Save to vault"
HELD_LIMIT = 64             # typed passwords held at once; a new one beyond it forgets the oldest


class Held:
    """A typed password held for "Save to vault": what it's for (target: a Quick Connect's box and confirmed key, or a
    Host Session's Host and Login), and whether its Session has logged in with it. Nothing else of the Session is
    kept: it all goes with the Held."""

    __slots__ = ("typed", "kind", "label", "target", "until", "logged_in")

    def __init__(self, typed, kind, label, target):
        self.typed, self.kind, self.label, self.target = typed, kind, label, target
        self.until, self.logged_in = time.monotonic() + HOLD_FOR, False

    def forget(self):
        self.typed.password, self.typed.on_login = None, None


def save_param(params, password):
    save = params.get("save", False)
    if not isinstance(save, bool):
        raise RpcError(INVALID_PARAMS, "params.save must be true or false")
    if save and password is None:
        raise RpcError(INVALID_PARAMS, "params.save needs params.password: only a typed password can be saved")
    return save


def saving_provider(state, params):
    """The provider "Save to vault" will save in (params.provider, else the Inventory's vault), checked before the
    Session starts: it must be one that can save (61)."""
    name = vault_provider(state, params)
    if not providers.can_write(name):
        raise write_problem(providers.CantWrite(
            f"provider '{name}' can't save to the vault - roster only reads its Logins; connect without Save to "
            "vault and create the item in the password manager itself"))
    return name


def hold(state, hid, typed, kind, label, target=None):
    """Hold TYPED under HID until it's saved or forgotten; its Session's login report marks it (and tells the app:
    the session.logged_in notification)."""
    held = Held(typed, kind, label, target)

    def on_login():                             # on the askpass channel's thread
        with state.held_lock:
            if state.held.get(hid) is not held or held.typed.password is None:
                return
            held.logged_in = True
        if state.notify:                        # outside the lock: it writes to the app
            state.notify("session.logged_in", {"held": hid})
    typed.on_login = on_login
    with state.held_lock:
        prune_held(state)
        while len(state.held) >= HELD_LIMIT:
            forget_held(state, next(iter(state.held)))
        state.held[hid] = held
    return hid


def open_channel(state):
    """serve's askpass channel, which also forgets the held passwords whose HOLD_FOR is up (on its tick), so none
    outlives its time waiting for a request that would prune it."""
    return askpass.Channel(askpass_lookup, log=log_line, tick=lambda: prune_held(state))


def prune_held(state):
    with state.held_lock:
        now = time.monotonic()
        for hid, held in list(state.held.items()):
            if held.until <= now:
                held.forget()
                del state.held[hid]


def logged_in_with(state, hid, kind):
    """The Held for HID, once its Session logged in with it (66 before, 67 if there's none), and its password (read
    now: the Held may be forgotten on another thread meanwhile)."""
    with state.held_lock:
        prune_held(state)
        held = state.held.get(hid) if isinstance(hid, str) else None
        password = held.typed.password if held is not None else None
    if held is None or held.kind != kind:
        raise RpcError(NOTHING_HELD, "there's no typed password to save for that Session: it was saved already, or "
                                     "forgotten (the Session ended, the vault was locked, or 10 minutes passed)",
                       fix="connect again with Save to vault ticked")
    if not held.logged_in:
        raise RpcError(LOGIN_NOT_SEEN, f"{held.label} hasn't logged in with that password - roster saves it only "
                                       "after the login succeeded",
                       fix="wait until the Session has logged in; if the box refused the password, nothing is saved")
    return held, password


def forget_held(state, hid=None):
    """Forget one held password (HID; whether there was one), or all of them (vault.lock)."""
    found = False
    with state.held_lock:
        for key in [hid] if hid is not None else list(state.held):
            held = state.held.pop(key, None)
            if held is not None:
                held.forget()
                found = True
    return found


def vault_forget_typed(state, params):
    """Forget the typed password held for a Session's "Save to vault" (the Session ended, or the offer was turned
    down). Never fails."""
    hid = text_param(params, "held")
    return {"forgotten": forget_held(state, hid)}


def make_item(provider, item, password, user, address, port, save_to):
    """The Vault item for a password that just logged in: the user in its username field, ssh://address[:port] in
    its URI field. Raises the write_problem (60-65, 14) when the vault refuses."""
    uri = f"ssh://{address}" + ("" if port == 22 else f":{port}")
    try:
        made = providers.create_item(provider, name=item, password=password, username=user, uri=uri,
                                     save_to=save_to)
    except providers.SecretError as e:
        raise write_problem(e) from None
    return {"provider": provider, **made}


def item_param(params, name):
    item = params.get("item") or f"{name} ssh"
    if not isinstance(item, str) or not item.strip() or "\n" in item or ":" in item:
        raise RpcError(INVALID_PARAMS, "params.item must be one line, without ':' (e.g. 'esx-02 ssh')")
    return " ".join(item.split())


def quick_save(state, params):
    """Save a Quick Connect that logged in (ticket 15, Q43): its typed password as the Vault item `<name> ssh`, then
    the box as the Host NAME in GROUP (reviewed, enroll: false, its Login that item) as a Pending change, then the
    host key the user confirmed for the Session recorded for it. The item is taken back out if the Host can't be
    written. The password is forgotten once it's saved."""
    try:
        return save_quick(state, params)
    except (RpcError, SystemExit):
        raise
    except Exception as e:                      # never let the generic handler log text that might hold the password
        raise RpcError(INTERNAL_ERROR, f"saving the Quick Connect failed: {type(e).__name__}") from None


def save_quick(state, params):
    hid = text_param(params, "quick")
    name, group = text_param(params, "name"), text_param(params, "group")
    item = item_param(params, name)
    save_to = save_to_param(params)
    held, password = logged_in_with(state, hid, "quick")
    provider = saving_provider(state, params)
    q = held.target
    fields = {"ip": q["address"], "user": q["user"], "port": q["port"], "auth": f"{provider}:{item}",
              "enroll": False, "reviewed": True}
    for f in ("title", "type", "description"):
        if params.get(f):
            fields[f] = params[f]
    try:
        fields = {f: edit.check_new(f, v) if f != "reviewed" else v for f, v in fields.items()}
    except ValueError as e:
        raise RpcError(INVALID_PARAMS, f"params: {e}") from None
    state.fresh()
    repo = changes.Repo(state.path)
    _, _, h = edit.added(repo.path, group, name, fields)      # a dry run: the name and group, before the vault
    made = make_item(provider, item, password, q["user"], q["address"], q["port"], save_to)
    try:                                        # until the Host is written, any failure takes the item back out
        old_text, new_text, _ = edit.added(repo.path, group, name, fields)
        backup = repo.backup(old_text)
        edit.replace_file(repo.path, new_text)
    except BaseException as e:
        raise take_back(made, write_failed(name, repo.path, e)) from None
    forget_held(state, hid)
    warnings = []
    try:                                        # the key the user confirmed for this Session, never a fresh scan
        record_host_key(h, q["key_type"], q["base64"])
    except Exception as e:
        warnings.append(f"{name} was added, but its host key couldn't be recorded in ~/.ssh/roster_known_hosts "
                        f"({failure_text(e)}) - the first Session to it will ask about the key")
    state.reload()
    return {"added": True, "host": state.inventory()["hosts"][name], "backup": str(backup), "item": made,
            "warnings": warnings}


def host_save_login(state, params):
    """Save an `auth: prompt` Host's typed password once its Session logged in with it (ticket 16, Q43): the Vault
    item `<host> ssh`, then the Host's Login pointed at it, as a Pending change (comments and every other byte kept).
    The item is taken back out if the Host can't be changed. Refused (75) if the Host's address, user, port or Login
    changed since that Session logged in: it would save a password for a login nobody tested."""
    try:
        return save_login(state, params)
    except (RpcError, SystemExit):
        raise
    except Exception as e:                      # never let the generic handler log text that might hold the password
        raise RpcError(INTERNAL_ERROR, f"saving the Login failed: {type(e).__name__}") from None


def save_login(state, params):
    hid = text_param(params, "held")
    held, password = logged_in_with(state, hid, "host")
    name = held.target["host"]
    item = item_param(params, name)
    save_to = save_to_param(params)
    provider = saving_provider(state, params)
    h = state.fresh()["hosts"].get(name)
    if h is None or login_key(h) != held.target["login"]:
        raise RpcError(NOT_VERIFIED, f"{name} changed since its Session logged in (its address, user, port or "
                                     "Login) - nothing was saved",
                       fix=f"open a new Session to {name} and save from there")
    wanted = {"auth": f"{provider}:{item}"}
    repo = changes.Repo(state.path)
    edit.edited(repo.path, name, wanted)        # a dry run: the edit must be possible before the vault is touched
    made = make_item(provider, item, password, h["ssh"]["user"], h["ip"], h["ssh"]["port"], save_to)
    try:                                        # until the Login is written, any failure takes the item back out
        old_text, new_text, _ = edit.edited(repo.path, name, wanted)
        backup = repo.backup(old_text)
        edit.replace_file(repo.path, new_text)
    except BaseException as e:
        problem = e if isinstance(e, Problem) else Problem(
            ROSTER_ERROR, f"{name}'s Login wasn't changed: "
                          + (die_message(e) if isinstance(e, SystemExit) else
                             f"couldn't write {repo.path} ({failure_text(e)})"))
        raise take_back(made, problem) from None
    forget_held(state, hid)
    state.reload()
    return {"changed": True, "host": state.inventory()["hosts"][name], "backup": str(backup), "item": made,
            "warnings": []}


def quick_label(user, address, port):
    """How a Quick Connect is named in messages and the log, as the app writes it: user@address, with :port when
    it isn't 22 (an IPv6 address then in brackets)."""
    if port == 22:
        return f"{user}@{address}"
    return f"{user}@[{address}]:{port}" if ":" in address else f"{user}@{address}:{port}"


def ssh_value(path):
    """A path as an ssh -o value: quoted when it has a space (ssh splits a known-hosts list on whitespace)."""
    return f'"{path}"' if re.search(r"\s", path) else path


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
                                         username=h["ssh"]["user"], uri=uri, save_to=typed["save_to"])
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
    """Mark a Host reviewed (reviewed: true on the Host itself, nothing else changes), as a Pending change.
    With reviewed: false (API 9), mark it unreviewed again: a review made by mistake has a way back."""
    name = text_param(params, "host")
    wanted = params.get("reviewed", True)
    if not isinstance(wanted, bool):
        raise RpcError(INVALID_PARAMS, "params.reviewed must be true or false")
    h = state.fresh()["hosts"].get(name)
    if h is None:
        raise RpcError(UNKNOWN_HOST, f"unknown host {name!r}")
    if h["reviewed"] == wanted:
        return {"changed": False, "host": h, "backup": None}
    repo = changes.Repo(state.path)
    old_text, new_text, _ = edit.reviewed(repo.path, name, wanted)
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
METHODS["host.trust_key"] = host_trust_key
METHODS["quick.prepare"] = quick_prepare
METHODS["quick.save"] = quick_save
METHODS["host.save_login"] = host_save_login
METHODS["vault.forget_typed"] = vault_forget_typed
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


def main_vault(names):
    """The vault to unlock: the most used provider that has a master password, or None."""
    return next((n for n in names if PROVIDERS[n].get("unlock")), None)


def vault_status(state, params):
    """The vault to unlock (main_vault) and where every provider the Inventory uses stands."""
    names = referenced_providers(state.inventory())
    lockable = main_vault(names)
    main = provider_status(lockable) if lockable else {"provider": None, "status": "unsupported",
                                                       "can_write": False}
    others = [main if n == main["provider"] else provider_status(n) for n in sorted(names)]
    if main["can_write"]:                       # where "Save to vault" goes by default (ticket 35), as set
        main = {**main, "save_to": providers.default_target(lockable)}
    return {**main, "providers": others}


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
        name = main_vault(referenced_providers(state.inventory()))     # no status call: that'd be a `bw` run
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
    return {"provider": name, "status": "unlocked", "can_write": providers.can_write(name)}   # no second `bw status`


ON_VAULT_LOCK = []          # fn(state) run by vault.lock: whatever else holds secrets (askpass tokens) forgets them


def forget_askpass_tokens(state):
    if state.askpass is not None:
        state.askpass.forget()


ON_VAULT_LOCK.append(forget_askpass_tokens)
ON_VAULT_LOCK.append(forget_held)


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


# ---------------------------------------------------------------- vault.configure: this Box's settings (ticket 41)
# The app sends what its init.lua says about the vault at start and after every `:source`. They're this Box's own
# (a local KeePassXC database is personal, not team Inventory) and win over roster.yml's. Paths and choices only:
# a key that isn't one of these is refused, so nothing else (a secret above all) can ride along.

BOX_PATHS = {"kp": ("database", "key_file")}


def box_path(value, field):
    if not isinstance(value, str) or not value.strip():
        raise RpcError(INVALID_PARAMS, f"params.{field} must be a path")
    if not os.path.isabs(os.path.expanduser(value)):
        raise RpcError(INVALID_PARAMS, f"params.{field} must be an absolute path or start with ~ (a path on the "
                                       f"Box roster runs on): {value!r}")
    return value



def box_settings(params):
    """vault.configure's params as providers.configure_box's {provider: {key: value}}, checked."""
    box = {}
    save_to = save_to_param(params)
    if save_to is not None:
        # init.lua has one save_to; it goes to the provider it fits: a collection is Bitwarden's, a group KeePassXC's
        fits = ("bw", "kp") if save_to == providers.PERSONAL else ("kp",) if "group" in save_to else ("bw",)
        for name in fits:
            box.setdefault(name, {})["save_to"] = save_to
    for name, given in params.items():
        if name == "save_to":
            continue
        if name not in BOX_PATHS:
            raise RpcError(INVALID_PARAMS, f"params.{name} isn't a setting roster takes from init.lua (it takes: "
                                           f"save_to, {', '.join(sorted(BOX_PATHS))})")
        if not isinstance(given, dict):
            raise RpcError(INVALID_PARAMS, f"params.{name} must be an object")
        for key, value in given.items():
            if key not in BOX_PATHS[name]:
                raise RpcError(INVALID_PARAMS, f"params.{name}.{key} isn't a setting roster takes from init.lua "
                                               f"(it takes: {', '.join(BOX_PATHS[name])})")
            if value is not None:
                box.setdefault(name, {})[key] = box_path(value, f"{name}.{key}")
    return box


def vault_configure(state, params):
    """This Box's vault settings from the app's init.lua, replacing the last ones (a key left out is roster.yml's
    again). A KeePassXC database or key file that changed forgets the master password held for the old one:
    `locked` names the providers that were unlocked and now aren't."""
    locked = providers.configure_box(box_settings(params))
    state.unlocked.difference_update(locked)
    return {"configured": True, "locked": locked}


METHODS["vault.configure"] = vault_configure


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
    save_to = save_to_param(params)
    try:
        made = providers.create_item(provider, name=name, password=password, save_to=save_to, **extra)
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


def vault_targets(state, params):
    """Where "Save to vault" can put an item (ticket 35): the personal vault and every collection of the organizations
    you're in (Bitwarden), or the top level and every group (KeePassXC), and the default. A default that doesn't
    resolve doesn't fail the list: `default` is null and `problem` says why (code 64 or 65, its message names the
    setting). Needs the vault unlocked (14)."""
    provider = vault_provider(state, params)
    try:
        found = providers.save_targets(provider)
    except providers.SecretError as e:
        raise write_problem(e) from None
    problem = found["problem"] and write_problem(found["problem"])
    return {"provider": provider, **found,
            "problem": problem and {"code": problem.code, "message": problem.message, "fix": problem.data["fix"]}}


METHODS["vault.create_item"] = vault_create_item
METHODS["vault.undo_create"] = vault_undo_create
METHODS["vault.targets"] = vault_targets


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
    """Sign the vault CLI in on this box, a step at a time (docs/serve-api.md "Signing in: vault.login").
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
             "host.verify_login": 45, "vault.create_item": 45, "quick.save": 45,
             "host.save_login": 45}
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
    with open_channel(state) as state.askpass:
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
