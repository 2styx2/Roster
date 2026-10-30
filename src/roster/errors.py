"""Stable error codes and the Problem they come in: what `roster serve`, the askpass channel and
`roster check HOST` report when opening a Session can't work (roster-desk docs/errors.md is the catalog).
The app switches on the code; the message is roster's usual wording, ready to show to a person, and never
holds a secret. `fix` says what to do about it, in a sentence."""

import re

from . import providers

# ---- the codes (README "`roster serve` API" lists them all)
INVENTORY_ERROR = 1         # roster.yml wasn't found or doesn't load (catalog row 1)
UNKNOWN_HOST = 2            # no Host by that name
ROSTER_ERROR = 3            # any other refusal roster gives on the command line ("error: ...")

WRONG_PASSWORD = 10         # vault.*: the master password didn't unlock the vault
NOT_LOGGED_IN = 11          # the vault CLI isn't logged in on this box (row 6)
CLI_MISSING = 12            # the vault CLI isn't installed (row 6)
UNSUPPORTED = 13            # the provider has no master password, or no Host Login uses one
VAULT_LOCKED = 14           # a secret was needed but the vault is locked (row 7)

NOT_REVIEWED = 20           # session.*: the Host has reviewed: false (row 3)
NOT_SET_UP = 21             # this box can't run `ssh NAME` yet: no ssh, or not in roster's ssh config (row 2)
NO_ASKPASS = 22             # a password Session, but this process has no askpass channel (in-process use only)

# Logins: what's wrong with a Host's ssh Login or its vault item (rows 4, 5, 8-10, 18)
NO_USER = 30                # the Host's ssh user is discover's placeholder CHANGE-ME (row 4)
NO_PROVIDER = 31            # the Login's provider (the `kp:` in kp:ITEM) isn't set up on this box (row 5)
ITEM_NOT_FOUND = 32         # no vault item by that name (row 8); data.near: similar item names
SEVERAL_ITEMS = 33          # several vault items match (row 9); data.matches: [{name, revised, uris}]
NO_FIELD = 34               # the item has no password, or no such #FIELD (row 10)
# 35 LOOKUP_FAILED          the provider failed some other way; the message is the provider's
# 36 UNEXPECTED_PROMPT      askpass: the Host asked something other than the Login password (row 18)
# 37 TOKEN_SPENT            askpass: the one-time token is used, expired or cleared by vault.lock
# 38 NO_SERVE               askpass: the helper couldn't reach `roster serve`
from .askpass import LOOKUP_FAILED, NO_SERVE, TOKEN_SPENT, UNEXPECTED_PROMPT  # noqa: E402,F401 (stdlib-only helper)

# host.check's network and Host steps (rows 11-17, 19)
NO_DNS = 40                 # the address doesn't resolve (row 15)
REFUSED = 41                # the ssh port refused the connection (row 16)
TIMEOUT = 42                # no answer from the ssh port (row 17; on 10.19.x often the rate limiter)
HOST_KEY_CHANGED = 43       # the Host's key isn't the recorded one (row 13): never accepted automatically
HOST_KEY_UNKNOWN = 44       # no recorded host key for this Host (row 14)
PASSWORD_REFUSED = 45       # the Host refused the Login's password (row 11)
KEY_REFUSED = 46            # the Host refused this box's key (row 12)
TOO_MANY_AUTH = 47          # the Host cut the connection after too many key attempts (row 19)
AUTH_FAILED = 48            # the login failed some other way; details has ssh's own message


class Problem(Exception):
    """A clean error: a stable code, roster's message, and (optionally) the fix and extra data."""

    def __init__(self, code, message, data=None, fix=None, details=None):
        super().__init__(message)
        self.code, self.message, self.fix, self.details = code, message, fix, details
        self.data = data if fix is None else {**(data or {}), "fix": fix}


VAULT_ERRORS = {providers.WrongPassword: WRONG_PASSWORD, providers.NotLoggedIn: NOT_LOGGED_IN,
                providers.CliMissing: CLI_MISSING, providers.Unsupported: UNSUPPORTED,
                providers.VaultLocked: VAULT_LOCKED}


def vault_problem(e):
    """A provider's SecretError about the vault itself (locked, not logged in, ...) as a Problem."""
    return Problem(VAULT_ERRORS.get(type(e), ROSTER_ERROR), str(e))


def login_problem(e, h, what="ssh"):
    """A SecretError from looking up Host H's Login as a Problem naming the Host, with its fix.
    Item names, revision dates and URIs may be shown; a value never is (providers never put one in)."""
    where = f"{what} Login of {h['name']}"
    if isinstance(e, providers.ItemNotFound):
        near = f" - did you mean: {', '.join(repr(n) for n in e.near)}" if e.near else ""
        return Problem(ITEM_NOT_FOUND, f"no vault item named '{e.item}' ({where}){near}", {"near": e.near},
                       fix=f"fix the name in {h['name']}'s auth: in roster.yml, or rename the item in the vault")
    if isinstance(e, providers.SeveralItems):
        how = "are named" if e.exact else "match"
        listed = "; ".join(f"'{m['name']}' (edited {m['revised'] or '?'}"
                           + (f", {', '.join(m['uris'])}" if m["uris"] else "") + ")" for m in e.matches)
        return Problem(SEVERAL_ITEMS, f"{len(e.matches)} vault items {how} '{e.item}' ({where}): {listed}",
                       {"matches": e.matches},
                       fix="delete or rename the extra items in the vault, or use the item's id in auth:")
    if isinstance(e, providers.NoField):
        what_ = "password" if e.field == "password" else f"field '{e.field}'"
        return Problem(NO_FIELD, f"vault item '{e.item}' has no {what_} ({where})", {"field": e.field},
                       fix=f"add the {what_} to the item in the vault, or fix the #FIELD in auth:")
    if type(e) in VAULT_ERRORS:                 # the vault, not the item: its message already says what to run
        code = VAULT_ERRORS[type(e)]
        return Problem(code, str(e), fix="unlock the vault" if code == VAULT_LOCKED else str(e))
    return Problem(LOOKUP_FAILED, f"{e} ({where})", fix="see the message; `roster auth-check` tests every Login")


def inventory_problem(message, path=None):
    """roster.yml didn't load (row 1). data: path (or None) and, for a YAML error, the line it's at."""
    m = re.search(r"line (\d+)", message)
    data = {"path": str(path.resolve()) if path else None} | ({"line": int(m.group(1))} if m else {})
    where = f"{path or 'roster.yml'}" + (f" at line {data['line']}" if m else "")
    return Problem(INVENTORY_ERROR, message, data, fix=f"fix {where}, or run `roster init` if there's none yet")


def unknown_provider(h, auth, what="ssh"):
    name = str(auth).partition(":")[0].strip()
    return Problem(NO_PROVIDER, f"{h['name']}'s {what} Login uses '{name}:', which isn't set up on this box",
                   {"provider": name}, fix="see `roster providers` for the ones that are, then fix auth: in "
                                           "roster.yml (or add the provider)")


def no_user(h):
    return Problem(NO_USER, f"no SSH user for {h['name']} (user: {h['ssh']['user']} in roster.yml)",
                   fix=f"set user: for {h['name']} (or its group) in roster.yml")
