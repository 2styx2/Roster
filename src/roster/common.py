"""Small shared helpers: output, paths, text."""

import re
import shlex
import shutil
import socket
import sys
import threading
import time
from contextlib import contextmanager
from pathlib import Path

KEY_TAG = "roster-managed"
LEGACY_KEY_TAGS = ("fleet-managed",)       # tags used by earlier versions; still recognized
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


def ssh_dir():
    return Path.home() / ".ssh"


def ssh_config_file():
    return ssh_dir() / "config.d" / "roster"


def known_hosts_file():
    return ssh_dir() / "roster_known_hosts"


def user_config_dir():
    return Path.home() / ".config" / "roster"


def roster_command():
    """How Claude (or anyone) should invoke roster on this box."""
    if shutil.which("roster"):
        return "roster"
    return f"{shlex.quote(sys.executable)} -m roster"     # e.g. inside a uv venv that isn't on PATH


def die(msg):
    sys.exit(f"error: {msg}")


def not_reviewed(h):
    """Why roster won't log in to a Host discover found (`roster run`, `roster serve` session.prepare)."""
    return f"{h['name']} is not reviewed yet (reviewed: false in roster.yml) - not logging in"


def say(msg=""):
    print(msg, flush=True)


def oneline(v):
    return " ".join(str(v or "").split())


def tcp_ok(host, port, timeout=3):
    try:
        with socket.create_connection((host, int(port)), timeout=timeout):
            return True
    except (OSError, ValueError):
        return False


# ---------------------------------------------------------------- a request's deadline (roster serve)
# serve gives each long method an overall deadline below the app's timeout for it, so the app never gives up
# on a call that is still going to finish. Every subprocess and network step asks time_left() for its timeout.
# Per thread: the askpass channel's lookups run on their own thread and aren't held to a request's deadline.

_deadline = threading.local()


@contextmanager
def deadline(seconds):
    """Hold the steps run inside to SECONDS in all (None: no deadline)."""
    before = getattr(_deadline, "at", None)
    _deadline.at = None if seconds is None else time.monotonic() + seconds
    try:
        yield
    finally:
        _deadline.at = before


def time_left(timeout, floor=1):
    """TIMEOUT, cut to what's left of this thread's deadline, but never below FLOOR: a step that has to run
    (an undo, a check of what a timed-out step did) still gets FLOOR seconds."""
    at = getattr(_deadline, "at", None)
    if at is None:
        return timeout
    return max(floor, min(timeout, at - time.monotonic()))
