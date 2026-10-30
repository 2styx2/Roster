"""`roster serve`: the backend API for the desktop app (roster-desk). JSON-RPC 2.0 over stdin/stdout,
one JSON object per line. Only responses go to stdout; anything else roster prints goes to stderr.
The one other channel is askpass (roster/askpass.py): a private Unix socket, open while serve runs, that
hands a password Session's ssh its password.
It answers with the Host, group and resource objects load_config already builds - no new schema.
Logins come back as references (bw:ITEM), never as values. Requests are handled one at a time.

Add a method by writing a function (state, params) -> result and listing it in METHODS.
"""

import json
import os
import shutil
import signal
import sys

from . import __version__, askpass, diagnose, providers
from .common import not_reviewed, ssh_config_file
from .config import find_config, load_config
from .errors import (  # noqa: F401 (the codes are part of serve's API)
    CLI_MISSING,
    INVENTORY_ERROR,
    NO_ASKPASS,
    NOT_LOGGED_IN,
    NOT_REVIEWED,
    NOT_SET_UP,
    ROSTER_ERROR,
    UNKNOWN_HOST,
    UNSUPPORTED,
    VAULT_LOCKED,
    WRONG_PASSWORD,
    Problem,
    inventory_problem,
    vault_problem,
)
from .providers import PROVIDERS, setup_providers
from .sshops import in_ssh_config

API_VERSION = 2             # bump when a method or result changes in a way the app has to know about

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
        only_vault_unlock_unlocks()
        try:
            self.path = find_config(config_arg)
            self.cfg = load_config(self.path)
            self.path = self.cfg["path"]
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
    result = {"provider": name, "status": STATUS_WORDS.get(status, status)}
    message = providers.status_message(name, status)
    return result | ({"message": message} if message else {})


def vault_status(state, params):
    """The vault to unlock (the most used provider that has a master password) and where every provider
    the Inventory uses stands."""
    names = referenced_providers(state.inventory())
    lockable = [n for n in names if PROVIDERS[n].get("unlock")]
    main = provider_status(lockable[0]) if lockable else {"provider": None, "status": "unsupported"}
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
        for line in sys.stdin:
            if not line.strip():
                continue
            response = handle(state, line)
            if response is not None:
                out.write(json.dumps(response, default=str) + "\n")
                out.flush()
    return 0
