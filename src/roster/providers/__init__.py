"""Password providers: registry, plugin loading, and the built-ins."""

import getpass
import os
import re
import shlex
import subprocess
import sys
import threading
from pathlib import Path

from ..common import die, say, user_config_dir

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


PROVIDERS = {}            # name -> {"get": fn(spec, ctx) -> str, "help": str, "tool": str, "kind": str}
                          #   optional: "unlock": fn(password, ctx), "lock": fn(ctx), "status": fn(ctx) -> str,
                          #             "not_logged_in": what to run when status is "unauthenticated"
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

    def run(self, args, env=None, shell=False, interactive=False, timeout=120):
        """Run a helper command, capturing output. A missing tool becomes a friendly error."""
        tool = args if isinstance(args, str) else args[0]
        try:
            return subprocess.run(args, shell=shell, capture_output=True, text=True, timeout=timeout,
                                  stdin=None if interactive else subprocess.DEVNULL,
                                  env={**os.environ, **(env or {})})
        except FileNotFoundError:
            raise CliMissing(not_installed(self.provider, tool))
        except subprocess.TimeoutExpired:
            raise SecretError(f"`{tool}` timed out")


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
        return p.get("not_logged_in") or f"`{p.get('tool') or name}` isn't logged in on this box"
    return None


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
        PROVIDER_SETTINGS[name] = conf
        if conf.get("command"):
            if not re.match(r"^[a-z0-9_-]+$", name):
                die(f"provider name {name!r} must be lowercase letters, digits, _ or -")
            add_template_provider(name, conf)



# Built-in providers register themselves on import.
from . import bitwarden, builtin, onepassword  # noqa: E402,F401
