"""Bitwarden CLI provider:  auth: bw:ITEM  /  bw:ITEM#FIELD"""

import base64
import json
import os
import shutil

from ..common import say, user_config_dir
from . import (
    PROVIDERS,
    ItemExists,
    ItemNotFound,
    NoField,
    NotLoggedIn,
    SecretError,
    SeveralItems,
    TimedOut,
    VaultLocked,
    WriteFailed,
    WrongPassword,
    errtext,
    manual_unlock,
    near_names,
    register,
    split_field,
)

# ---- built-in: Bitwarden

def _bw(ctx, *args, env=None, input=None, floor=1):
    return ctx.run(["bw", *args, "--nointeraction"], env=env, input=input, floor=floor)


NOT_LOGGED_IN = "Bitwarden CLI isn't logged in on this box - run `bw login` once"


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


def _bw_status_json(ctx):
    """`bw status` as a dict: status, and (when it says) userEmail and serverUrl (None for bitwarden.com)."""
    try:
        return json.loads(_bw(ctx, "status").stdout or "{}")
    except json.JSONDecodeError:
        raise SecretError("couldn't read `bw status` output")


def _bw_status(ctx):
    return _bw_status_json(ctx).get("status")


def _bw_ready(ctx):
    if ctx.state.get("ready"):
        return
    from_file = False if manual_unlock() else load_session_file()
    status = _bw_status(ctx)
    if status == "unauthenticated":
        if not (os.environ.get("BW_CLIENTID") and os.environ.get("BW_CLIENTSECRET")):
            raise NotLoggedIn(f"{NOT_LOGGED_IN} "
                              "(or set BW_CLIENTID and BW_CLIENTSECRET to use an API key)")
        if _bw(ctx, "login", "--apikey").returncode != 0:
            raise SecretError("`bw login --apikey` failed - check BW_CLIENTID / BW_CLIENTSECRET")
        status = "locked"
    if status == "locked" and from_file:
        os.environ.pop("BW_SESSION", None)
        if not (os.environ.get("BW_PASSWORD") or ctx.interactive):
            raise SecretError(f"the Bitwarden session in {session_file()} has expired (vault locked) - refresh it: "
                              f"(umask 077; bw unlock --raw > {session_file()})")
    if status == "locked" and manual_unlock():
        raise VaultLocked("Bitwarden vault is locked - unlock it first")
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
            raise WrongPassword("Bitwarden unlock failed (wrong master password?)")
        os.environ["BW_SESSION"] = r.stdout.strip()       # this process only
    if ctx.settings.get("sync", True) and _bw(ctx, "sync").returncode != 0:
        say("warning      `bw sync` failed - using the vault as last synced")
    ctx.state["ready"] = True


def _bw_unlock(password, ctx):
    """Unlock with a master password given as a value (from `roster serve`), via the env-var path."""
    if _bw_status(ctx) == "unauthenticated":
        raise NotLoggedIn(NOT_LOGGED_IN)
    r = _bw(ctx, "unlock", "--raw", "--passwordenv", "ROSTER_BW_MASTER", env={"ROSTER_BW_MASTER": password})
    if r.returncode != 0 or not r.stdout.strip():
        raise WrongPassword("Bitwarden unlock failed (wrong master password?)")
    os.environ["BW_SESSION"] = r.stdout.strip()           # this process only


def _bw_vault_status(ctx):
    """`bw status` as-is (BW_SESSION from this process only, never the session file); "missing" if no bw."""
    return _bw_status(ctx) if shutil.which("bw") else "missing"


def _bw_lock(ctx):
    try:
        _bw(ctx, "lock")
    finally:
        os.environ.pop("BW_SESSION", None)


def _bw_list(ctx, *search):
    r = _bw(ctx, "list", "items", *(("--search", search[0]) if search else ()))
    try:
        return json.loads(r.stdout or "[]") if r.returncode == 0 else []
    except json.JSONDecodeError:
        return []


def _bw_summary(item):
    """What may be shown about an item: its name, when it was last edited, its URIs. Never a value."""
    uris = [u.get("uri") for u in (item.get("login") or {}).get("uris") or [] if u.get("uri")]
    return {"name": item.get("name", ""), "revised": str(item.get("revisionDate") or "")[:10] or None, "uris": uris}


def _bw_item(ctx, ref):
    r = _bw(ctx, "get", "item", ref)
    if r.returncode == 0:
        return json.loads(r.stdout)
    err = errtext(r)
    if "More than one" in err:
        listed = _bw_list(ctx, ref)
        exact = [i for i in listed if i.get("name") == ref]
        if len(exact) == 1:
            return exact[0]
        matches = [_bw_summary(i) for i in (exact or listed)]
        raise SeveralItems(f"several Bitwarden items match '{ref}' - use the item's id instead "
                           f"(find it with: bw list items --search \"{ref}\")", ref, matches, exact=bool(exact))
    if "Not found" in err:
        near = near_names(ref, [i.get("name", "") for i in _bw_list(ctx)])
        raise ItemNotFound(f"no Bitwarden item matches '{ref}'", ref, near)
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
        raise NoField(f"Bitwarden item '{item.get('name', name)}' has no {what} set", item.get("name", name), field)
    return val


# ---- writing: "Save to vault" (ticket 13). `bw create item` takes the item as base64 JSON, the way
# `bw encode` makes it, on stdin when no argument is given (bw 2026.9.1's create.command.ts), so the
# password never goes on a command line. bw prints the new item back, password and all: only its id is kept.

def _scrub(text, *values):
    for v in values:
        if v:
            text = text.replace(v, "…")
    return text


def _bw_create(item, ctx):
    _bw_ready(ctx)
    name, password = item["name"], item["password"]
    if _bw(ctx, "sync").returncode != 0:                   # see items made elsewhere since this run's first sync
        say("warning      `bw sync` failed - checking for a duplicate name in the vault as last synced")
    r = _bw(ctx, "list", "items", "--search", name)
    try:
        listed = json.loads(r.stdout) if r.returncode == 0 else None
    except json.JSONDecodeError:
        listed = None
    if listed is None:
        raise WriteFailed(f"couldn't check the vault for an item named '{name}': {errtext(r)}")
    same = [_bw_summary(i) for i in listed if i.get("name") == name]
    if same:
        raise ItemExists(f"a Bitwarden item named '{name}' already exists - Logins look items up by exact name, "
                         "so roster won't make a second one", name, same)
    login = {"username": item["username"] or None, "password": password, "totp": None,
             "uris": [{"uri": item["uri"], "match": None}] if item["uri"] else []}
    encoded = base64.b64encode(json.dumps({
        "type": 1, "name": name, "notes": None, "favorite": False, "fields": [], "reprompt": 0,
        "organizationId": None, "folderId": None, "login": login}).encode()).decode()
    try:
        r = _bw(ctx, "create", "item", input=encoded)
    except TimedOut:                                       # bw was stopped: the item may be saved all the same
        return _created_anyway(ctx, name)
    if r.returncode != 0:                                  # stderr only: stdout would be the item itself
        err = _scrub(" ".join(r.stderr.split()), password, encoded)[:160]
        raise WriteFailed(f"Bitwarden didn't create '{name}': {err or f'exit {r.returncode}'}")
    try:
        made = json.loads(r.stdout)
    except json.JSONDecodeError:
        made = {}
    if not made.get("id"):                                 # bw's answer didn't parse: find it, so it can be undone
        made = next((i for i in _bw_list(ctx, name) if i.get("name") == name), None)
        if made is None:
            raise WriteFailed(f"Bitwarden said it created '{name}' but it isn't in the vault - check it there")
    return {"id": made["id"], "name": made.get("name", name)}


LOOKUP_FLOOR = 7            # s for each of the sync and the list after a create timed out, even past serve's deadline


def _bw_lookup(ctx, name):
    """The items named exactly NAME, synced from the server first. Raises SecretError if bw can't say."""
    _bw(ctx, "sync", floor=LOOKUP_FLOOR)
    r = _bw(ctx, "list", "items", "--search", name, floor=LOOKUP_FLOOR)
    try:
        listed = json.loads(r.stdout) if r.returncode == 0 else None
    except json.JSONDecodeError:
        listed = None
    if listed is None:
        raise SecretError(errtext(r) or f"`bw list items` failed (exit {r.returncode})")
    return [i for i in listed if i.get("name") == name]


def _created_anyway(ctx, name):
    """`bw create item` timed out. No item had that exact name before (checked just before), so one that has it now
    is this one: it counts as made (and can be undone). None: nothing was saved. Can't tell: says so, naming it."""
    try:
        found = _bw_lookup(ctx, name)
    except SecretError as e:
        raise WriteFailed(f"Bitwarden didn't answer `bw create item` in time, and roster couldn't check whether "
                          f"'{name}' was saved ({e}) - look for it in the vault, and delete it if it's not wanted")
    if len(found) == 1:
        return {"id": found[0]["id"], "name": found[0].get("name", name)}
    if not found:
        raise WriteFailed(f"Bitwarden didn't answer `bw create item` in time, and there's no '{name}' in the vault: "
                          "nothing was saved")
    raise WriteFailed(f"Bitwarden didn't answer `bw create item` in time, and now {len(found)} items are named "
                      f"'{name}' - check them in the vault and delete the extra one")


def _bw_delete(item_id, ctx):
    _bw_ready(ctx)
    r = _bw(ctx, "delete", "item", item_id)
    if r.returncode != 0:
        raise WriteFailed(f"Bitwarden didn't delete item {item_id}: {errtext(r)}")


PROVIDERS["bw"].update(unlock=_bw_unlock, lock=_bw_lock, status=_bw_vault_status, not_logged_in=NOT_LOGGED_IN,
                       create=_bw_create, delete=_bw_delete)
