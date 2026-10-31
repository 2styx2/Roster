import json
import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest

FAKES = Path(__file__).parent / "fakes"
EXAMPLES = Path(__file__).parent.parent / "examples"


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    """Every test gets its own HOME and working dir, clean provider state, and an untouched environment."""
    from roster import providers

    home = tmp_path / "home"
    home.mkdir()
    work = tmp_path / "work"
    work.mkdir()
    saved_env = dict(os.environ)
    saved_providers = dict(providers.PROVIDERS)
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("XDG_RUNTIME_DIR", str(tmp_path / "run"))
    for var in ("BW_SESSION", "BW_PASSWORD", "BW_CLIENTID", "BW_CLIENTSECRET", "OP_SERVICE_ACCOUNT_TOKEN",
                "OP_SESSION_test", "ROSTER_CONFIG", "OLD_OP"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.chdir(work)
    monkeypatch.setattr(sys.stdin, "isatty", lambda: False, raising=False)
    monkeypatch.setattr(providers, "MANUAL_UNLOCK", False)         # an in-process serve test sets it
    providers._secrets.clear()
    providers.PROVIDER_STATE.clear()
    providers.PROVIDER_SETTINGS.clear()
    providers.BOX_SETTINGS.clear()
    yield {"home": home, "work": work}
    providers.PROVIDERS.clear()
    providers.PROVIDERS.update(saved_providers)
    os.environ.clear()
    os.environ.update(saved_env)


@pytest.fixture
def fakes(monkeypatch):
    """Put stand-in bw / op / pass / ssh commands first on PATH."""
    for f in FAKES.iterdir():
        f.chmod(f.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    monkeypatch.setenv("PATH", f"{FAKES}{os.pathsep}{os.environ['PATH']}")
    return FAKES


@pytest.fixture
def write_config(isolated):
    def _write(text, name="roster.yml"):
        p = isolated["work"] / name
        p.write_text(text)
        return p
    return _write


# ---------------------------------------------------------------- `roster serve`, as the desktop app drives it

class Serve:
    def __init__(self, *args):
        self.p = subprocess.Popen([sys.executable, "-m", "roster", *args, "serve"], stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.next_id = 0
        self.responses = []             # every line serve wrote to stdout, as read
        self.notes = []                 # the notifications (no id) serve sent before a response, in order

    def send(self, line):
        self.p.stdin.write(line + "\n")
        self.p.stdin.flush()
        while True:
            self.responses.append(self.p.stdout.readline())
            msg = json.loads(self.responses[-1])
            if "id" in msg or "method" not in msg:
                return msg
            self.notes.append(msg)

    def call(self, method, params=None):
        self.next_id += 1
        msg = {"jsonrpc": "2.0", "id": self.next_id, "method": method}
        if params is not None:
            msg["params"] = params
        r = self.send(json.dumps(msg))
        assert r["jsonrpc"] == "2.0" and r["id"] == self.next_id
        return r

    def close(self):
        """Close stdin; returns (exit code, anything else written to stdout, stderr)."""
        out, err = self.p.communicate(timeout=10)
        return self.p.returncode, out, err


@pytest.fixture
def serve():
    started = []

    def _start(*args):
        started.append(Serve(*args))
        return started[-1]
    yield _start
    for s in started:
        if s.p.poll() is None:
            s.p.kill()
            s.p.wait()


# ---------------------------------------------------------------- a vault edited by hand (ticket 26)

SECRET = "s3cret-esx-pw"                # the one password in this vault; it must never show up in any output

ITEMS = [
    {"id": "aaaa-1111", "name": "esx ssh", "revisionDate": "2026-10-01T10:00:00.000Z",
     "login": {"username": "root", "password": SECRET, "uris": [{"uri": "ssh://10.0.0.6"}]},
     "fields": [{"name": "enable", "value": "s3cret-enable"}]},
    {"id": "bbbb-2222", "name": "dup ssh", "revisionDate": "2026-09-01T08:00:00.000Z",
     "login": {"password": "s3cret-dup-1", "uris": [{"uri": "ssh://10.0.0.7"}]}},
    {"id": "bbbb-3333", "name": "dup ssh", "revisionDate": "2026-10-20T09:30:00.000Z",
     "login": {"password": "s3cret-dup-2", "uris": [{"uri": "https://10.0.0.7"}]}},
    {"id": "cccc-4444", "name": "nopw ssh", "revisionDate": "2026-08-01T00:00:00.000Z", "login": {"username": "x"}},
]
ALL_SECRETS = [SECRET, "s3cret-enable", "s3cret-dup-1", "s3cret-dup-2"]


@pytest.fixture
def vault(fakes, isolated, monkeypatch):
    """The fake bw serves ITEMS (the test may rewrite the file between calls)."""
    f = isolated["home"].parent / "items.json"
    f.write_text(json.dumps(ITEMS))
    monkeypatch.setenv("FAKE_BW_ITEMS", str(f))
    return f
