"""The askpass channel: how a password Session's ssh gets its password from `roster serve` (ADR 0002).

Server side (Channel, run by serve): a Unix socket in a fresh user-only directory. session.prepare mints a
one-time token for one Host's ssh Login; the token is good once, for TTL seconds, and until vault.lock.
quick.prepare mints one for a password the user typed (Typed, Quick Connect): the token holds it as is, and it goes
with the token (spent, expired and pruned, or vault.lock).
Helper side (main, run by ssh as SSH_ASKPASS with the prompt as argv[1]): answers only a Login password
prompt, by sending the token over the socket and printing the password ssh asked for.

Wire format, one exchange per connection, then serve closes:
  helper: "TOKEN\\n"                   serve: "ok\\nPASSWORD", or "no CODE\\nREASON"
  helper: "prompt TOKEN PROMPT\\n"     serve: "no 36\\nREASON"   (a prompt the helper won't answer, reported
                                                               so serve can log it; the token isn't spent)
REASON is safe to show in the terminal; CODE is one of errors.py's stable codes. The helper prints it as
the one line "roster askpass: [CODE] REASON" on stderr, which the app's classifier parses.

Stdlib only, and nothing else from roster: ssh runs the helper for every prompt, it must start fast and
never load roster.yml.
"""

import os
import re
import secrets
import shlex
import socket
import struct
import sys
import tempfile
import threading
import time

SOCKET_ENV, TOKEN_ENV = "ROSTER_ASKPASS_SOCKET", "ROSTER_ASKPASS_TOKEN"
TTL = 60.0                  # seconds a token lives; ROSTER_ASKPASS_TTL may shorten it (tests), never lengthen
REPLY_TIMEOUT = 30          # the helper waits this long for serve (a vault lookup can take a few seconds)
PROMPT_LIMIT = 300          # characters of an unexpected prompt that are reported (it comes from the Host)

# Stable codes (errors.py imports these; the rest of its codes arrive here inside Refused)
LOOKUP_FAILED = 35          # the lookup failed some other way
UNEXPECTED_PROMPT = 36      # the Host asked something other than the Login password
TOKEN_SPENT = 37            # the one-time token is used, expired or cleared by vault.lock
NO_SERVE = 38               # the helper couldn't reach `roster serve`

# ---------------------------------------------------------------- which prompts get the password

# Only these shapes, whole (case and runs of spaces ignored):
#   "user@host's password:"              ssh's password authentication
#   "password:", "(user@host) password:" keyboard-interactive (OpenSSH adds the prefix)
#   "password for user@host:"            some PAM stacks
# Everything else is refused - a host-key yes/no, a key passphrase, an OTP code, "(current) UNIX
# password:" or "New password:" from an expired-password change - so ssh fails instead of being
# handed the Login password for something that isn't the login.
PASSWORD_PROMPTS = re.compile(r"(?:\S+@\S+'s password|(?:\(\S+@\S+\) )?password|password for \S+):")


def is_password_prompt(prompt):
    return bool(PASSWORD_PROMPTS.fullmatch(" ".join(prompt.lower().split())))


class Refused(Exception):
    """Raised by a Channel's lookup: its message is safe to show in the terminal (never the secret), and
    code is its stable code (errors.py)."""

    def __init__(self, message, code):
        super().__init__(message)
        self.code = code


def shown_prompt(prompt):
    """An unexpected prompt as one line, shortened: what may be logged and shown (it's the Host's text)."""
    text = " ".join("".join(c if c.isprintable() else " " for c in prompt).split())
    return text if len(text) <= PROMPT_LIMIT else text[:PROMPT_LIMIT] + "..."


def refused_prompt_reason(label, prompt):
    who = label or "the Host"
    return f"{who} asked something roster won't answer: '{shown_prompt(prompt)}' - log in by hand once to deal with it"


# ---------------------------------------------------------------- the helper ssh runs

def main(argv=None):
    """`roster askpass PROMPT`: print the Login password and exit 0, or print nothing and exit 1."""
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1:
        return 1
    prompt, path, token = argv[0], os.environ.get(SOCKET_ENV), os.environ.get(TOKEN_ENV)
    expected = is_password_prompt(prompt)
    if not path or not token:
        return 1 if expected else complain(UNEXPECTED_PROMPT, refused_prompt_reason(None, prompt))
    request = token if expected else f"prompt {token} {shown_prompt(prompt)}"
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(REPLY_TIMEOUT)
            s.connect(path)
            s.sendall(request.encode() + b"\n")
            reply = b""
            while chunk := s.recv(4096):
                reply += chunk
    except OSError as e:
        if not expected:
            return complain(UNEXPECTED_PROMPT, refused_prompt_reason(None, prompt))
        return complain(NO_SERVE, f"can't reach roster serve ({e.strerror or type(e).__name__})")
    status, _, body = reply.partition(b"\n")
    if status != b"ok" or not body or not expected:
        word, _, code = status.decode(errors="replace").partition(" ")
        reason = body.decode(errors="replace").strip() or "no answer"
        return complain(int(code) if code.isdigit() else UNEXPECTED_PROMPT if not expected else TOKEN_SPENT, reason)
    sys.stdout.buffer.write(body + b"\n")
    sys.stdout.flush()
    return 0


def complain(code, reason):
    """The one line the terminal shows and the app's classifier reads; nothing goes to stdout, exit 1."""
    print(f"roster askpass: [{code}] {' '.join(reason.split())}", file=sys.stderr)
    return 1


# ---------------------------------------------------------------- serve's side

def runtime_dir():
    """A fresh directory only this user can open: under $XDG_RUNTIME_DIR, else the temp dir."""
    base = os.environ.get("XDG_RUNTIME_DIR")
    if base and os.path.isdir(base):
        d = tempfile.mkdtemp(prefix="roster-askpass-", dir=base)
        if len(os.path.join(d, "socket")) < 100:        # a Unix socket path is at most ~107 bytes
            return d
        os.rmdir(d)
    return tempfile.mkdtemp(prefix="roster-askpass-")    # mkdtemp makes it 0700


def ttl():
    try:
        return min(TTL, float(os.environ.get("ROSTER_ASKPASS_TTL", TTL)))
    except ValueError:
        return TTL


class Typed:
    """A password the user typed (Quick Connect, ticket 14), as a token's login: the Channel answers with it as is,
    without a lookup. It lives only as long as its token (spent, expired, or forgotten by vault.lock) and never
    shows in a repr."""

    __slots__ = ("password",)

    def __init__(self, password):
        self.password = password

    def __repr__(self):
        return "Typed(...)"


class Channel:
    """serve's end. lookup(login) -> password, raising with a message safe to show when it can't;
    it runs on the channel's threads, so it must be thread-safe (providers.get_secret is)."""

    def __init__(self, lookup, log=None):
        self.lookup, self.log = lookup, log or (lambda msg: None)
        self.ttl = ttl()
        self.tokens = {}                     # token -> (login, label, expires at: time.monotonic())
        self.labels = {}                     # token -> (label, until): names a spent token's prompt reports
        self.lock = threading.Lock()
        self.dir = runtime_dir()
        os.chmod(self.dir, 0o700)
        self.socket_path = os.path.join(self.dir, "socket")
        self.helper = os.path.join(self.dir, "askpass")
        self.known_hosts = os.path.join(self.dir, "quick_known_hosts")   # Quick Connect's keys (serve writes it)
        self.stopping = threading.Event()
        old = os.umask(0o177)                # the socket is created 0600
        try:
            self.server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            self.server.bind(self.socket_path)
        finally:
            os.umask(old)
        os.chmod(self.socket_path, 0o600)
        self.server.listen(8)
        self.server.settimeout(0.2)          # so close() can stop the accept loop
        write_helper(self.helper)
        self.thread = threading.Thread(target=self._accept_loop, name="askpass", daemon=True)
        self.thread.start()

    # ---- tokens

    def mint(self, login, label):
        """A one-time token for LOGIN (whatever lookup takes); LABEL names it in serve's log."""
        token = secrets.token_urlsafe(32)
        with self.lock:
            now = time.monotonic()
            self.tokens = {t: v for t, v in self.tokens.items() if v[2] > now}   # drop expired ones
            self.tokens[token] = (login, label, now + self.ttl)
            self.labels = {t: v for t, v in self.labels.items() if v[1] > now}
            self.labels[token] = (label, now + 2 * self.ttl)
        return token

    def _prune(self):
        with self.lock:
            now = time.monotonic()
            if any(v[2] <= now for v in self.tokens.values()):
                self.tokens = {t: v for t, v in self.tokens.items() if v[2] > now}

    def redeem(self, token):
        """The token's (login, label), once; None if unknown, used, expired or forgotten."""
        with self.lock:
            entry = self.tokens.pop(token, None)
        if entry is None or entry[2] <= time.monotonic():
            return None
        return entry[:2]

    def label(self, token):
        """Which Session a token was minted for, without spending it (also shortly after it was spent:
        an expired-password prompt comes right after the password was accepted)."""
        with self.lock:
            entry = self.labels.get(token)
        return entry[0] if entry and entry[1] > time.monotonic() else None

    def forget(self):
        with self.lock:
            self.tokens.clear()
            self.labels.clear()

    def env(self, token):
        return {"SSH_ASKPASS": self.helper, "SSH_ASKPASS_REQUIRE": "force",
                SOCKET_ENV: self.socket_path, TOKEN_ENV: token}

    # ---- the socket

    def _accept_loop(self):
        while not self.stopping.is_set():
            try:
                conn, _ = self.server.accept()
            except TimeoutError:
                self._prune()               # an unused token (a typed password above all) goes once it expires
                continue
            except OSError:
                return
            threading.Thread(target=self._answer, args=(conn,), daemon=True).start()

    def _answer(self, conn):
        with conn:
            try:
                conn.settimeout(5)
                if not same_user(conn):
                    return
                data = b""
                while b"\n" not in data and len(data) < 1024:
                    chunk = conn.recv(1024)
                    if not chunk:
                        break
                    data += chunk
                conn.sendall(self._reply(data.partition(b"\n")[0].decode(errors="replace")))
            except OSError:
                pass

    def _reply(self, request):
        if request.startswith("prompt "):
            _, token, prompt = (request.split(" ", 2) + [""])[:3]
            label = self.label(token)
            reason = refused_prompt_reason(label, prompt)
            self.log(f"askpass: {label or 'unknown Session'}: refused an unexpected prompt: '{shown_prompt(prompt)}'")
            return f"no {UNEXPECTED_PROMPT}\n{reason}".encode()
        found = self.redeem(request) if request else None
        if found is None:
            self.log("askpass: refused a token that is unknown, used, expired or cleared by vault.lock")
            return (f"no {TOKEN_SPENT}\nthe askpass token is used up, expired or cleared by a lock - "
                    "open the Session again").encode()
        login, label = found
        try:
            password = login.password if isinstance(login, Typed) else self.lookup(login)
            reason = None
        except Refused as e:
            reason, code = str(e), e.code
        except Exception as e:                  # its text might not be safe to show: name it only
            reason, code = f"looking up the password failed: {type(e).__name__}", LOOKUP_FAILED
        if reason is not None:
            self.log(f"askpass: {label}: {reason}")
            return f"no {code}\n{reason}".encode()
        self.log(f"askpass: {label}: password handed to ssh")
        return b"ok\n" + password.encode()

    def close(self):
        self.stopping.set()
        self.thread.join(timeout=2)
        self.server.close()
        self.forget()
        for f in (self.socket_path, self.helper, self.known_hosts):
            try:
                os.unlink(f)
            except FileNotFoundError:
                pass
        try:
            os.rmdir(self.dir)
        except OSError:
            pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def same_user(conn):
    """Is the other end this user? (the directory's 0700 already says so; this checks it on Linux)"""
    if not hasattr(socket, "SO_PEERCRED"):
        return True
    _pid, uid, _gid = struct.unpack("3i", conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED,
                                                          struct.calcsize("3i")))
    return uid == os.getuid()


def write_helper(path):
    """SSH_ASKPASS must be one absolute executable (ssh runs it without a shell or the login PATH):
    a two-line script that runs this module with the Python serve runs on. -I keeps ssh's working
    directory and PYTHON* variables out of the import path."""
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o700)
    with os.fdopen(fd, "w") as f:
        f.write(f'#!/bin/sh\nexec {shlex.quote(sys.executable)} -I -m roster.askpass "$@"\n')


if __name__ == "__main__":
    raise SystemExit(main())
