"""`roster serve`: the backend API for the desktop app (the roster app, app/). JSON-RPC 2.0 over stdin/stdout,
one JSON object per line. Only responses go to stdout; anything else roster prints goes to stderr.
The one other channel is askpass (roster/askpass.py): a private Unix socket, open while serve runs, that
hands a password Session's ssh its password.
It answers with the Host, group and resource objects load_config already builds - no new schema.
Logins come back as references (bw:ITEM), never as values. Requests are handled one at a time.

Add a method by writing a function (state, params) -> result and listing it in METHODS.
"""

import json
import os
import secrets
import shutil
import signal
import sys
import time

from . import __version__, askpass, changes, diagnose, edit, providers
from .common import not_reviewed, ssh_config_file
from .config import find_config, load_config
from .errors import (  # noqa: F401 (the codes are part of serve's API)
    CANT_WRITE,
    CLI_MISSING,
    INVENTORY_ERROR,
    ITEM_EXISTS,
    NO_ASKPASS,
    NO_SIGN_IN,
    NOT_CREATED_HERE,
    NOT_LOGGED_IN,
    NOT_REVIEWED,
    NOT_SET_UP,
    NOT_VERIFIED,
    ROSTER_ERROR,
    UNKNOWN_HOST,
    UNSUPPORTED,
    VAULT_LOCKED,
    WRITE_FAILED,
    WRONG_PASSWORD,
    Problem,
    inventory_problem,
    sign_in_problem,
    vault_problem,
    write_problem,
)
from .providers import PROVIDERS, setup_providers
from .sshops import in_ssh_config

API_VERSION = 5             # bump when a method or result changes in a way the app has to know about

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
        """Load roster.yml again (after a pull, an edit or a discard, so hosts.list shows the file as it is)."""
        try:
            self.cfg = load_config(self.path)
            self.path, self.error = self.cfg["path"], None
            setup_providers(self.cfg)
        except SystemExit as e:
            self.cfg, self.error = None, die_message(e)

    def inventory(self):
        if self.cfg is None:
            p = inventory_problem(self.error, self.path)
            p.data |= versions()
            raise p
        return self.cfg


def versions():
    return {"roster_version": __version__, "api_version": API_VERSION}


# ---------------------------------------------------------------- methods

def inventory_info(state, params):
    cfg = state.inventory()
    return {"path": str(cfg["path"]), "box": cfg["box"], "host_count": len(cfg["hosts"]),
            "providers": sorted(PROVIDERS), **versions()}


def hosts_list(state, params):
    cfg = state.inventory()
    return {"hosts": list(cfg["hosts"].values()), "groups": cfg["groups"]}


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
    state.reload()
    h = state.inventory()["hosts"].get(name)
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


METHODS["inventory.pull"] = inventory_pull
METHODS["host.verify_login"] = host_verify_login
METHODS["host.update"] = host_update
METHODS["changes.diff"] = changes_diff
METHODS["changes.discard"] = changes_discard


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
    return {"jsonrpc": "2.0", "id": rid, "error": err}


def log_line(msg):
    print(f"serve: {msg}", file=sys.stderr, flush=True)


def serve(config_arg):
    out = sys.stdout
    sys.stdout = sys.stderr             # whatever else roster prints (warnings, say()) must not corrupt the stream
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))      # so the askpass directory is still removed
    state = State(config_arg)
    with askpass.Channel(askpass_lookup, log=log_line) as state.askpass:
        try:
            for line in sys.stdin:
                if not line.strip():
                    continue
                response = handle(state, line)
                if response is not None:
                    out.write(json.dumps(response, default=str) + "\n")
                    out.flush()
        finally:
            end_sign_in(state)              # a half-done `bw login` doesn't outlive serve
    return 0
