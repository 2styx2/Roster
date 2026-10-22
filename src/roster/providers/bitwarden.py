"""Bitwarden CLI provider:  auth: bw:ITEM  /  bw:ITEM#FIELD"""

import json
import os

from ..common import say, user_config_dir
from . import SecretError, errtext, register, split_field

# ---- built-in: Bitwarden

def _bw(ctx, *args, env=None):
    return ctx.run(["bw", *args, "--nointeraction"], env=env)


def session_file():
    return user_config_dir() / "bw-session"


def load_session_file():
    """BW_SESSION from ~/.config/roster/bw-session, so sessions without your shell's env (background jobs,
    other terminals) can use an unlocked vault. Ignored unless only you can read it."""
    f = session_file()
    if os.environ.get("BW_SESSION") or not f.is_file():
        return False
    if f.stat().st_mode & 0o077:
        say(f"warning      {f} is readable by others - ignored (chmod 600 {f})")
        return False
    key = f.read_text().strip()
    if key:
        os.environ["BW_SESSION"] = key                     # this process only
    return bool(key)


def _bw_ready(ctx):
    if ctx.state.get("ready"):
        return
    from_file = load_session_file()
    try:
        status = json.loads(_bw(ctx, "status").stdout or "{}").get("status")
    except json.JSONDecodeError:
        raise SecretError("couldn't read `bw status` output")
    if status == "unauthenticated":
        if not (os.environ.get("BW_CLIENTID") and os.environ.get("BW_CLIENTSECRET")):
            raise SecretError("Bitwarden CLI isn't logged in on this box - run `bw login` once "
                              "(or set BW_CLIENTID and BW_CLIENTSECRET to use an API key)")
        if _bw(ctx, "login", "--apikey").returncode != 0:
            raise SecretError("`bw login --apikey` failed - check BW_CLIENTID / BW_CLIENTSECRET")
        status = "locked"
    if status == "locked" and from_file:
        os.environ.pop("BW_SESSION", None)
        if not (os.environ.get("BW_PASSWORD") or ctx.interactive):
            raise SecretError(f"the Bitwarden session in {session_file()} has expired (vault locked) - refresh it: "
                              f"(umask 077; bw unlock --raw > {session_file()})")
    if status == "locked":
        if os.environ.get("BW_PASSWORD"):
            r = _bw(ctx, "unlock", "--raw", "--passwordenv", "BW_PASSWORD")
        elif ctx.interactive:
            r = _bw(ctx, "unlock", "--raw", "--passwordenv", "ROSTER_BW_MASTER",
                    env={"ROSTER_BW_MASTER": ctx.ask("Bitwarden master password: ")})
        else:
            raise SecretError("Bitwarden vault is locked and there's no terminal to unlock it. In the shell "
                              "you start Claude (or roster) from, run:  export BW_SESSION=$(bw unlock --raw)  "
                              f"- or, for every session on this box:  (umask 077; bw unlock --raw > {session_file()})")
        if r.returncode != 0 or not r.stdout.strip():
            raise SecretError("Bitwarden unlock failed (wrong master password?)")
        os.environ["BW_SESSION"] = r.stdout.strip()       # this process only
    if ctx.settings.get("sync", True) and _bw(ctx, "sync").returncode != 0:
        say("warning      `bw sync` failed - using the vault as last synced")
    ctx.state["ready"] = True


def _bw_item(ctx, ref):
    r = _bw(ctx, "get", "item", ref)
    if r.returncode == 0:
        return json.loads(r.stdout)
    err = errtext(r)
    if "More than one" in err:
        listed = _bw(ctx, "list", "items", "--search", ref)
        exact = [i for i in json.loads(listed.stdout or "[]") if i.get("name") == ref]
        if len(exact) == 1:
            return exact[0]
        raise SecretError(f"several Bitwarden items match '{ref}' - use the item's id instead "
                          f"(find it with: bw list items --search \"{ref}\")")
    if "Not found" in err:
        raise SecretError(f"no Bitwarden item matches '{ref}'")
    raise SecretError(f"`bw get item` failed: {err}")


@register("bw", tool="bw", help="Bitwarden CLI:  bw:ITEM (login password), bw:ITEM#FIELD "
          "(custom field, #username, #notes). Install: https://bitwarden.com/help/cli/")
def _bitwarden(spec, ctx):
    name, field = split_field(spec)
    if not name:
        raise SecretError("bw: needs an item name or id, e.g. bw:Orion servers")
    _bw_ready(ctx)
    item = _bw_item(ctx, name)
    login = item.get("login") or {}
    if field == "password":
        val = login.get("password")
    elif field == "username":
        val = login.get("username")
    elif field == "notes":
        val = item.get("notes")
    else:
        fields = item.get("fields") or []
        hit = ([f for f in fields if f.get("name") == field]
               or [f for f in fields if str(f.get("name", "")).lower() == field.lower()])
        val = hit[0].get("value") if hit else None
    if not val:
        what = field if field in ("password", "username", "notes") else f"field '{field}'"
        raise SecretError(f"Bitwarden item '{item.get('name', name)}' has no {what} set")
    return val
