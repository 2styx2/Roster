"""Password providers: registry, plugin loading, and the built-ins."""

import getpass
import os
import re
import shlex
import subprocess
import sys
import threading
from pathlib import Path

from ..common import die, say, time_left, user_config_dir

# ---------------------------------------------------------------- password providers
#
# An `auth:` value is NAME:SPEC (or just NAME). NAME picks a provider; SPEC is handed to it.
#   Built in:  prompt, agent, env, cmd, bw (Bitwarden), op (1Password)
#   Add more without editing this file:
#     - a command template in roster.yml under `providers:` (no code), or
#     - a Python plugin in ~/.config/roster/providers/ or a providers/ folder next to roster.yml
#       (see examples/providers/pass_store.py for a complete example).
# Every provider runs lazily, only when a password is actually needed, and values stay in memory.

class SecretError(RuntimeError):
    """Raise this from a provider with a message that's safe to show (never the secret itself)."""


# Kinds of SecretError a caller (`roster serve`) can tell apart. Providers and plugins raise these where they fit.
class TimedOut(SecretError):
    """A helper command didn't finish in time (it was stopped): what it was doing may or may not have happened."""


class WrongPassword(SecretError):
    """The master password didn't unlock the vault."""


class NotLoggedIn(SecretError):
    """The vault CLI isn't logged in on this box; the message says what to run."""


class CliMissing(SecretError):
    """The provider's command isn't installed."""


class Unsupported(SecretError):
    """The provider has no master password to unlock with."""


class VaultLocked(SecretError):
    """The vault is locked and this process may not unlock it by itself (see MANUAL_UNLOCK)."""


# What can go wrong signing in (`roster serve`'s vault.login). `step`: where the sign-in carries on (the provider
# restarted it, e.g. after a wrong code), or None when it's over. Messages are roster's; never a secret.
class LoginError(SecretError):
    """A sign-in failed some other way; the message has the provider's own words."""

    def __init__(self, message, step=None):
        super().__init__(message)
        self.step = step


class CodeRejected(LoginError):
    """The two-step or new-device code was wrong or expired."""


class MethodUnsupported(LoginError):
    """The account's only two-step methods (or its SSO decryption) are ones the provider's CLI can't do."""


class RateLimited(LoginError):
    """The server refused: too many attempts."""


class ServerUnreachable(LoginError):
    """The vault's server didn't answer (network, wrong address, TLS)."""


class AlreadyLoggedIn(LoginError):
    """The CLI is already logged in on this box: unlock instead."""


class BrowserLoginFailed(LoginError):
    """SSO in the browser failed or didn't finish in time."""


class BadServer(LoginError):
    """The server address given isn't one."""


class ApiKeyRejected(LoginError):
    """The API key (client id / secret) wasn't accepted, or is an organization key."""


class WrongLogin(LoginError):
    """The email or master password wasn't accepted (WrongPassword's sign-in twin)."""


# What can be wrong with the item a Login names. They carry item NAMES (and dates, URIs), never a value.
class ItemNotFound(SecretError):
    """No item by that name. near: names of similar items, closest first."""

    def __init__(self, message, item, near=()):
        super().__init__(message)
        self.item, self.near = item, list(near)


class SeveralItems(SecretError):
    """More than one item matches. matches: [{name, revised, uris}]; exact: they all have that exact name."""

    def __init__(self, message, item, matches, exact):
        super().__init__(message)
        self.item, self.matches, self.exact = item, matches, exact


class NoField(SecretError):
    """The item exists but has no value in the field the Login asks for ("password", or a #FIELD)."""

    def __init__(self, message, item, field):
        super().__init__(message)
        self.item, self.field = item, field


# Writing Vault items (ticket 13: "Save to vault", Q43's verified adds). Names only, never a value.
class CantWrite(SecretError):
    """The provider can only read Logins: it can't create or delete Vault items."""


class ItemExists(SecretError):
    """An item by exactly that name is already there. matches: [{name, revised, uris}]."""

    def __init__(self, message, item, matches):
        super().__init__(message)
        self.item, self.matches = item, matches


class WriteFailed(SecretError):
    """The provider's CLI refused the create or delete; the message has its words (minus any value)."""


def near_names(name, names, n=5):
    """Item names that look like NAME (a typo, other case, a word missing), closest first."""
    import difflib
    lowered = {x.lower(): x for x in names}
    close = difflib.get_close_matches(name.lower(), list(lowered), n=n, cutoff=0.6)
    words = [w for w in name.lower().split() if len(w) > 2]
    contains = [low for low in lowered if low not in close and words and all(w in low for w in words[:1])]
    return [lowered[x] for x in (close + sorted(contains))[:n]]


PROVIDERS = {}            # name -> {"get": fn(spec, ctx) -> str, "help": str, "tool": str, "kind": str}
                          #   optional: "unlock": fn(password, ctx), "lock": fn(ctx), "status": fn(ctx) -> str,
                          #             "not_logged_in": what to run when status is "unauthenticated" (or
                          #                              fn(ctx) -> that text)
                          #             "login": fn(ctx) -> a sign-in flow (vault.login; see bw_login.py)
                          #             "login_help": why this provider has no sign-in here, and what to do
                          #             "create": fn(item, ctx) -> {"id", "name"}, item = {name, username,
                          #                       password, uri}; refuses a name that exists (ItemExists)
                          #             "delete": fn(id, ctx), the undo of a create (Q43)
PROVIDER_SETTINGS = {}    # name -> settings dict from roster.yml `providers:`
PROVIDER_STATE = {}       # name -> per-run scratch space (e.g. "already unlocked")
NO_PASSWORD = ("agent", "key", "none")
MANUAL_UNLOCK = False     # True (`roster serve`): only unlock() unlocks - no session file, no BW_PASSWORD, no prompt
_secrets = {}
_secret_lock = threading.Lock()


def register(name, help="", tool=""):
    """Decorator for provider functions:  @register("vault", help="...", tool="vault")"""
    if not re.match(r"^[a-z0-9_-]+$", name):
        raise ValueError(f"provider name {name!r} must be lowercase letters, digits, _ or -")

    def deco(fn):
        PROVIDERS[name] = {"get": fn, "help": help, "tool": tool,
                           "kind": "built-in" if fn.__module__.startswith("roster.") else "plugin"}
        return fn
    return deco


def split_field(spec, default="password"):
    """'Item name#field' -> ('Item name', 'field');  'Item name' -> ('Item name', default)."""
    item, _, field = spec.partition("#")
    return item.strip(), field.strip() or default


class Ctx:
    """What a provider gets besides its SPEC."""

    def __init__(self, name, group):
        self.provider = name
        self.group = group                                   # roster.yml group asking for the password
        self.settings = PROVIDER_SETTINGS.get(name, {})      # this provider's block under `providers:`
        self.state = PROVIDER_STATE.setdefault(name, {})     # remembered for the rest of this run
        self.interactive = sys.stdin.isatty()

    def ask(self, prompt):
        """Hidden prompt on the terminal; fails cleanly when there is none (e.g. under Claude)."""
        if not self.interactive:
            raise SecretError(f"needs input ({prompt.strip().rstrip(':')}) but there's no terminal to ask in")
        return getpass.getpass(f"  {prompt}")

    def run(self, args, env=None, shell=False, interactive=False, timeout=120, input=None, floor=1):
        """Run a helper command, capturing output. A missing tool becomes a friendly error.
        INPUT goes to its stdin (the way to hand a tool a secret: never in args). The timeout is held to serve's
        deadline (common.time_left), but never below FLOOR; past it, TimedOut."""
        tool = args if isinstance(args, str) else args[0]
        stdin = {} if input is not None else {"stdin": None if interactive else subprocess.DEVNULL}
        try:
            return subprocess.run(args, shell=shell, capture_output=True, text=True, timeout=time_left(timeout, floor),
                                  input=input, env={**os.environ, **(env or {})}, **stdin)
        except FileNotFoundError:
            raise CliMissing(not_installed(self.provider, tool))
        except subprocess.TimeoutExpired:
            raise TimedOut(f"`{tool}` timed out")


def not_installed(name, tool=None):
    hint = PROVIDERS.get(name, {}).get("help", "")
    tool = tool or PROVIDERS.get(name, {}).get("tool") or name
    return f"`{tool}` is not installed on this box" + (f" ({hint})" if hint else "")


def errtext(r, limit=160):
    """A tool's error output minus noise (node deprecation warnings etc.), shortened."""
    lines = [line for line in (r.stderr + "\n" + r.stdout).splitlines()
             if line.strip() and not line.startswith(("(node", "(Use "))]
    return " ".join(lines)[:limit]


def manual_unlock():
    """For providers: is unlocking by themselves (session file, password env var, prompt) off in this process?"""
    return MANUAL_UNLOCK


def get_secret(ref, group):
    """Resolve an auth reference via its provider. Cached for this run, never written anywhere."""
    if ref in (None, "") or ref in NO_PASSWORD:
        return None
    name, _, spec = str(ref).partition(":")
    name = name.strip()
    if name not in PROVIDERS:
        raise SecretError(f"unknown password source {name!r} in auth {ref!r} - available: "
                          f"{', '.join(sorted(PROVIDERS))} (see `roster providers`)")
    cache_key = (ref, group) if name == "prompt" else ref
    with _secret_lock:
        if cache_key in _secrets:
            return _secrets[cache_key]
        try:
            val = PROVIDERS[name]["get"](spec, Ctx(name, group))
        except SecretError:
            raise
        except Exception as e:                       # a buggy plugin shouldn't crash the whole run
            raise SecretError(f"provider '{name}' failed: {type(e).__name__}: {e}")
        if not isinstance(val, str) or val == "":
            raise SecretError(f"provider '{name}' returned no value for {ref!r}")
        _secrets[cache_key] = val
        return val


# ---- unlock / lock without a terminal (for `roster serve`, which gets the master password from a GUI)

def _vault_op(name, op):
    if name not in PROVIDERS:
        raise SecretError(f"unknown password source {name!r}")
    return PROVIDERS[name].get(op)


def unlock(name, password):
    """Unlock provider NAME with this master password. Never prompts, never touches a session file,
    and the password never goes on a command line or into an error message."""
    fn = _vault_op(name, "unlock")
    if not fn:
        raise Unsupported(f"provider '{name}' can't be unlocked with a master password")
    with _secret_lock:
        PROVIDER_STATE.pop(name, None)                   # re-check readiness on the next lookup
        fn(password, Ctx(name, None))


def vault_status(name):
    """Where provider NAME stands, without prompting: "unlocked", "locked", "unauthenticated" (CLI not
    logged in), "missing" (CLI not installed), or "unsupported" (a provider with no lock to speak of)."""
    fn = _vault_op(name, "status")
    return fn(Ctx(name, None)) if fn else "unsupported"


def status_message(name, status):
    """What to tell a person about a vault_status() that needs fixing on this box, or None."""
    if status == "missing":
        return not_installed(name)
    if status == "unauthenticated":
        p = PROVIDERS.get(name, {})
        hint = p.get("not_logged_in")
        if callable(hint):                               # it depends on this box (e.g. KeePassXC's database path)
            hint = hint(Ctx(name, None))
        return hint or f"`{p.get('tool') or name}` isn't logged in on this box"
    return None


def login(name):
    """A new sign-in flow for provider NAME (an object with start(params), answer(params) and close(), each
    step a dict; see bw_login.py). Unsupported when the provider signs in some other way."""
    fn = _vault_op(name, "login")
    if not fn:
        raise Unsupported(PROVIDERS[name].get("login_help")
                          or f"provider '{name}' has no sign-in roster can drive - set it up on the box itself")
    return fn(Ctx(name, None))


def lock(name):
    """Forget every cached secret and NAME's state, then run the provider's own lock (if it has one).
    Memory is cleared first, so it is forgotten even if the provider's lock then fails."""
    _vault_op(name, "lock")
    with _secret_lock:
        _secrets.clear()
        PROVIDER_STATE.pop(name, None)
        fn = PROVIDERS[name].get("lock")
        if fn:
            fn(Ctx(name, None))


# ---- writing Vault items (ticket 13)

def can_write(name):
    """Can provider NAME create Vault items (and undo a create)?"""
    p = PROVIDERS.get(name, {})
    return bool(p.get("create") and p.get("delete"))


def _writer(name, op):
    fn = _vault_op(name, op)
    if not (fn and can_write(name)):
        raise CantWrite(f"provider '{name}' can't save to the vault - roster only reads its Logins; "
                        "create the item in the password manager itself")
    return fn


def create_item(provider, *, name, password, username="", uri=""):
    """Create a login Vault item NAME in PROVIDER: username, password, and the address in its URI field
    (docs/adding-hosts.md). Refuses a NAME that's already there. Returns {id, name}, never the password;
    the password never goes on a command line or into an error."""
    fn = _writer(provider, "create")
    if not str(name).strip() or not password:
        raise SecretError("a Vault item needs a name and a password")
    made = fn({"name": name, "username": username or "", "password": password, "uri": uri or ""},
              Ctx(provider, None))
    return {"id": made["id"], "name": made["name"]}


def delete_item(provider, item_id):
    """Delete the Vault item ITEM_ID from PROVIDER: the undo of create_item (Q43). Bitwarden moves it to the
    trash, where it can still be restored for 30 days."""
    fn = _writer(provider, "delete")
    with _secret_lock:                                   # a value cached from that item must go too
        for ref in [r for r in _secrets if str(r[0] if isinstance(r, tuple) else r).startswith(provider + ":")]:
            del _secrets[ref]
    fn(item_id, Ctx(provider, None))


# ---- extension points

def add_template_provider(name, conf):
    """roster.yml:  providers: { NAME: { command: "tool get {item} --field {field}", ... } }"""
    command = str(conf["command"])
    default_field = str(conf.get("default_field", "password"))

    def get(spec, ctx):
        item, field = split_field(spec, default_field)
        try:
            line = command.format(item=shlex.quote(item), field=shlex.quote(field), ref=shlex.quote(spec))
        except (KeyError, IndexError, ValueError) as e:
            raise SecretError(f"provider '{name}': bad command template ({e}); "
                              "use {item}, {field}, {ref}, and {{ }} for literal braces")
        r = ctx.run(line, shell=True, interactive=bool(conf.get("interactive")))
        if r.returncode != 0:
            raise SecretError(f"provider '{name}' failed for '{item}' (exit {r.returncode}): {errtext(r)}")
        out = r.stdout.rstrip("\r\n")
        return out.splitlines()[0] if conf.get("first_line") and out else out

    PROVIDERS[name] = {"get": get, "help": str(conf.get("help") or f"command: {command}"),
                       "tool": command.split()[0] if command.split() else "", "kind": "roster.yml"}


def load_plugins(dirs):
    import importlib.util
    sys.dont_write_bytecode = True               # don't litter providers/ with __pycache__
    seen = set()
    for d in dirs:
        d = Path(d).expanduser().resolve()
        if d in seen or not d.is_dir():
            continue
        seen.add(d)
        for f in sorted(d.glob("*.py")):
            if f.name.startswith("_"):
                continue
            spec = importlib.util.spec_from_file_location(f"roster_provider_{f.stem}", f)
            mod = importlib.util.module_from_spec(spec)
            # what a plugin can use without importing anything from roster:
            mod.register, mod.SecretError, mod.split_field, mod.errtext = register, SecretError, split_field, errtext
            try:
                spec.loader.exec_module(mod)
            except Exception as e:
                say(f"warning      provider plugin {f} didn't load: {type(e).__name__}: {e}")


def setup_providers(cfg):
    base = cfg["path"].parent if cfg else Path.cwd()
    dirs = [user_config_dir() / "providers", base / "providers"] + [base / Path(os.path.expanduser(str(d)))
                                                      for d in (cfg or {}).get("provider_dirs", [])]
    load_plugins(dirs)
    for name, conf in ((cfg or {}).get("providers") or {}).items():
        conf = conf or {}
        if not isinstance(conf, dict):
            die(f"providers.{name} in roster.yml must be a mapping")
        PROVIDER_SETTINGS[name] = {**conf, "_base": base}     # _base: where relative paths in it start
        if conf.get("command"):
            if not re.match(r"^[a-z0-9_-]+$", name):
                die(f"provider name {name!r} must be lowercase letters, digits, _ or -")
            add_template_provider(name, conf)



# Built-in providers register themselves on import.
from . import bitwarden, builtin, bw_login, keepassxc, onepassword  # noqa: E402,F401
