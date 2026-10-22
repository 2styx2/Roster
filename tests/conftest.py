import os
import stat
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
    providers._secrets.clear()
    providers.PROVIDER_STATE.clear()
    providers.PROVIDER_SETTINGS.clear()
    yield {"home": home, "work": work}
    providers.PROVIDERS.clear()
    providers.PROVIDERS.update(saved_providers)
    os.environ.clear()
    os.environ.update(saved_env)


@pytest.fixture
def fakes(monkeypatch):
    """Put stand-in bw / op / pass commands first on PATH."""
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
