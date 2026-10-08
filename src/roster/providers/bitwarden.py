"""Bitwarden CLI provider:  auth: bw:ITEM  /  bw:ITEM#FIELD"""

import json
import os

from ..common import say
from . import SecretError, errtext, register, split_field

# ---- built-in: Bitwarden

def _bw(ctx, *args, env=None):
    return ctx.run(["bw", *args, "--nointeraction"], env=env)


def _bw_ready(ctx):
    if ctx.state.get("ready"):
        return
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
    if status == "locked":
        if os.environ.get("BW_PASSWORD"):
            r = _bw(ctx, "unlock", "--raw", "--passwordenv", "BW_PASSWORD")
        elif ctx.interactive:
            r = _bw(ctx, "unlock", "--raw", "--passwordenv", "ROSTER_BW_MASTER",
                    env={"ROSTER_BW_MASTER": ctx.ask("Bitwarden master password: ")})
        else:
            raise SecretError("Bitwarden vault is locked and there's no terminal to unlock it. In the shell "
                              "you start Claude (or roster) from, run:  export BW_SESSION=$(bw unlock --raw)")
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
