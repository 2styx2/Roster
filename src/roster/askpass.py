"""The askpass channel: how a password Session's ssh gets its password from `roster serve` (ADR 0002).

Server side (Channel, run by serve): a Unix socket in a fresh user-only directory. session.prepare mints a
one-time token for one Host's ssh Login; the token is good once, for TTL seconds, and until vault.lock.
Helper side (main, run by ssh as SSH_ASKPASS with the prompt as argv[1]): answers only a Login password
prompt, by sending the token over the socket and printing the password ssh asked for.

Wire format, one exchange per connection: the helper sends "TOKEN\\n"; serve answers "ok\\nPASSWORD" or
"no\\nREASON" (a reason safe to show in the terminal), then closes.

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
    """Raised by a Channel's lookup: its message is safe to show in the terminal (never the secret)."""


# ---------------------------------------------------------------- the helper ssh runs

def main(argv=None):
    """`roster askpass PROMPT`: print the Login password and exit 0, or print nothing and exit 1."""
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1 or not is_password_prompt(argv[0]):
        return 1
    path, token = os.environ.get(SOCKET_ENV), os.environ.get(TOKEN_ENV)
    if not path or not token:
        return 1
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(REPLY_TIMEOUT)
            s.connect(path)
            s.sendall(token.encode() + b"\n")
            reply = b""
            while chunk := s.recv(4096):
                reply += chunk
    except OSError as e:
        print(f"roster askpass: can't reach roster serve ({e.strerror or type(e).__name__})", file=sys.stderr)
        return 1
    status, _, body = reply.partition(b"\n")
    if status != b"ok" or not body:
        reason = body.decode(errors="replace").strip() or "no answer"
        print(f"roster askpass: {reason}", file=sys.stderr)
        return 1
    sys.stdout.buffer.write(body + b"\n")
    sys.stdout.flush()
    return 0


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


class Channel:
    """serve's end. lookup(login) -> password, raising with a message safe to show when it can't;
    it runs on the channel's threads, so it must be thread-safe (providers.get_secret is)."""

    def __init__(self, lookup, log=None):
        self.lookup, self.log = lookup, log or (lambda msg: None)
        self.ttl = ttl()
        self.tokens = {}                     # token -> (login, label, expires at: time.monotonic())
        self.lock = threading.Lock()
        self.dir = runtime_dir()
        os.chmod(self.dir, 0o700)
        self.socket_path = os.path.join(self.dir, "socket")
        self.helper = os.path.join(self.dir, "askpass")
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
        return token

    def redeem(self, token):
        """The token's (login, label), once; None if unknown, used, expired or forgotten."""
        with self.lock:
            entry = self.tokens.pop(token, None)
        if entry is None or entry[2] <= time.monotonic():
            return None
        return entry[:2]

    def forget(self):
        with self.lock:
            self.tokens.clear()

    def env(self, token):
        return {"SSH_ASKPASS": self.helper, "SSH_ASKPASS_REQUIRE": "force",
                SOCKET_ENV: self.socket_path, TOKEN_ENV: token}

    # ---- the socket

    def _accept_loop(self):
        while not self.stopping.is_set():
            try:
                conn, _ = self.server.accept()
            except TimeoutError:
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
                while b"\n" not in data and len(data) < 512:
                    chunk = conn.recv(512)
                    if not chunk:
                        break
                    data += chunk
                conn.sendall(self._reply(data.partition(b"\n")[0].decode(errors="replace")))
            except OSError:
                pass

    def _reply(self, token):
        found = self.redeem(token) if token else None
        if found is None:
            self.log("askpass: refused a token that is unknown, used, expired or cleared by vault.lock")
            return b"no\nthe askpass token is used up, expired or cleared by a lock - open the Session again"
        login, label = found
        try:
            password = self.lookup(login)
            reason = None
        except Refused as e:
            reason = str(e)
        except Exception as e:                  # its text might not be safe to show: name it only
            reason = f"looking up the password failed: {type(e).__name__}"
        if reason is not None:
            self.log(f"askpass: {label}: {reason}")
            return b"no\n" + reason.encode()
        self.log(f"askpass: {label}: password handed to ssh")
        return b"ok\n" + password.encode()

    def close(self):
        self.stopping.set()
        self.thread.join(timeout=2)
        self.server.close()
        self.forget()
        for f in (self.socket_path, self.helper):
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
