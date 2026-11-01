"""Filling a password prompt in a Session (ticket 119, decision Q129): which of a Host's Logins answers the prompt its
Session shows, or why none may. The prompt is the line at the Session's cursor, read off its screen: the Host's text,
so it can lie. It can only narrow what roster fills (a prompt naming another Host or account is refused); it can never
widen it: whatever it says, the password is one of this Host's own Logins.

`session.fill` (serve.py) looks the password up; the app's core types it into the Session's PTY after checking that
the prompt doesn't echo (crates/roster-core/src/session.rs, `SessionManager::fill`)."""

import re

from . import providers
from .errors import FILL_REFUSED, NOTHING_TO_FILL, Problem

# sudo's own prompt; ssh's (OpenSSH: "user@host's password: "); and the rest: su, login, passwd's "Password: ", which
# may name the account ("Password for ops: "). Nothing else: a key's passphrase, a code, a username aren't Logins.
SUDO = re.compile(r"\[sudo\] password for (?P<user>[^\s:]+):", re.I)
SSH = re.compile(r"(?P<user>[^\s@']+)@(?P<host>[^\s@']+)'s password:", re.I)
PLAIN = re.compile(r"password(?: for (?P<user>[^\s:]+))?:", re.I)
# What a nested ssh to the Host itself may name besides its name and address.
SELF = {"localhost", "127.0.0.1", "::1", "[::1]"}


def cursor_line(prompt):
    """The last line of PROMPT (what's left of the cursor), without the spaces around it."""
    return re.split(r"[\r\n]", prompt)[-1].strip()


def login_for(h, prompt, sudo=None):
    """(which, reference) for Host H at PROMPT: which is "ssh" (its ssh Login) or "sudo" (SUDO, its `sudo:` reference).
    Raises Problem 130 when PROMPT isn't a password prompt or asks for another Host or account, 131 when the Login
    that would answer it has no saved password."""
    line = cursor_line(prompt)
    user = h["ssh"]["user"]
    if m := SSH.fullmatch(line):
        who, where = m["user"], m["host"]
        if who != user or where not in {h["name"], h["ip"], *SELF}:
            raise refused(h, f"the prompt asks for {who}@{where}'s password, not {user}@{h['name']}'s",
                          "ssh", "roster fills only the Session's own Host; type that password yourself")
        return "ssh", saved(h, h["ssh"]["auth"], "ssh")
    m = SUDO.fullmatch(line) or PLAIN.fullmatch(line)
    if m is None:
        raise refused(h, f"{line!r} isn't a password prompt roster fills (sudo's, su's or ssh's)", None,
                      "fill only at a password prompt the Session shows")
    kind = "sudo" if m.re is SUDO else "su"
    if m["user"] is not None and m["user"] != user:
        raise refused(h, f"the prompt asks for {m['user']}'s password, and roster has {user}'s on {h['name']}",
                      kind, "type that password yourself")
    if sudo:
        return "sudo", sudo
    return "ssh", saved(h, h["ssh"]["auth"], "ssh")


def saved(h, ref, what):
    """REF, when it's a vault reference with a password to fill; else Problem 131."""
    name = str(ref or "").partition(":")[0].strip()
    if name in ("", "prompt", *providers.NO_PASSWORD):
        raise Problem(NOTHING_TO_FILL, f"{h['name']}'s {what} Login has no saved password to fill (auth: "
                                       f"{ref or 'none'})",
                      fix=f"add a sudo: {{auth: VAULT-REFERENCE}} to {h['name']} in roster.yml for its own "
                          "sudo password, or type it yourself")
    return ref


def refused(h, message, kind, fix):
    return Problem(FILL_REFUSED, f"won't fill on {h['name']}: {message}", {"prompt": kind}, fix=fix)
