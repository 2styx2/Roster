"""Small shared helpers: output, paths, text."""

import re
import shlex
import shutil
import socket
import sys
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
