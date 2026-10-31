"""roster natively on Windows (ticket 19): finding tools by PATHEXT and refusing a batch file an argument cmd.exe would
act on, paths, the ssh config Windows' OpenSSH reads, and the askpass channel as a named pipe only this user can open.
The first tests pretend to be on Windows (they run everywhere); the rest need Windows itself."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from conftest import WINDOWS
from test_serve import INVENTORY, PASSWORD, run_askpass, unlocked_serve

from roster import common, sshops

windows_only = pytest.mark.skipif(not WINDOWS, reason="needs Windows itself")


@pytest.fixture
def as_windows(monkeypatch):
    monkeypatch.setattr(common, "WINDOWS", True)
    monkeypatch.setattr(sshops, "WINDOWS", True)


def test_a_tool_is_found_by_its_extension_and_an_exe_takes_any_argument(as_windows, monkeypatch):
    monkeypatch.setattr(common.shutil, "which", lambda name: rf"C:\tools\{name}.exe")
    assert common.program_argv(["git", "commit", "-m", 'say "hi" & 100%']) == \
        [r"C:\tools\git.exe", "commit", "-m", 'say "hi" & 100%']


@pytest.mark.parametrize("arg", ['a"b', "50%", "a^b", "a&b", "a|b", "a<b", "a>b", "a!b", "a\nb"])
def test_a_batch_file_is_never_handed_what_cmd_would_act_on(as_windows, monkeypatch, arg):
    """npm installs bw as bw.cmd, which runs through cmd.exe: an item name from roster.yml or the vault with one of
    these could run something else, so roster refuses it and says why."""
    monkeypatch.setattr(common.shutil, "which", lambda name: rf"C:\npm\{name}.cmd")
    assert common.program_argv(["bw", "get", "item", "esx ssh"]) == [r"C:\npm\bw.cmd", "get", "item", "esx ssh"]
    with pytest.raises(ValueError, match="batch file"):
        common.program_argv(["bw", "get", "item", arg])


def test_a_batch_file_refusal_is_a_provider_error_not_a_crash(as_windows, monkeypatch):
    from roster import providers
    monkeypatch.setattr(common.shutil, "which", lambda name: rf"C:\npm\{name}.cmd")
    with pytest.raises(providers.SecretError, match="batch file"):
        providers.Ctx("bw", "g").run(["bw", "get", "item", "a & b"])


def test_roster_keeps_its_files_in_appdata_on_windows(as_windows, isolated):
    assert common.user_config_dir() == isolated["home"] / "AppData" / "Roaming" / "roster"


def test_the_ssh_config_on_windows_has_forward_slashes_and_no_shared_connections(as_windows, isolated, write_config):
    from roster.config import load_config
    cfg = load_config(write_config(INVENTORY))
    block = "\n".join(sshops.host_block(cfg, "esx", cfg["hosts"]["esx"]))
    assert "Control" not in block                     # Windows' OpenSSH has no Unix sockets to share one on
    assert f'UserKnownHostsFile "{common.known_hosts_file().as_posix()}"' in block
    assert "\\" not in block


# ---------------------------------------------------------------- on Windows itself

@windows_only
def test_the_askpass_pipe_is_the_users_alone_and_goes_away(serve, write_config, capsys, fakes):
    from roster import winpipe
    s = unlocked_serve(serve, write_config, capsys)
    spec = s.call("session.prepare", {"host": "esx"})["result"]
    pipe, helper = spec["env"]["ROSTER_ASKPASS_SOCKET"], spec["env"]["SSH_ASKPASS"]
    assert pipe.startswith("\\\\.\\pipe\\roster-askpass-") and len(pipe) > len("\\\\.\\pipe\\roster-askpass-") + 30
    assert Path(helper).name == "roster-askpass.exe" and Path(helper).is_file()
    # Nobody can take the name over: a second server for it is refused (first-instance flag, the user-only DACL).
    with pytest.raises(OSError):
        winpipe.Server(pipe)
    assert run_askpass(spec).stdout == PASSWORD + "\n"
    assert s.close()[0] == 0
    with pytest.raises(OSError):
        winpipe.connect(pipe, timeout=0.2).close()


@windows_only
def test_the_pipes_security_names_this_user_and_nobody_else():
    from roster import winpipe
    sid = winpipe.user_sid()
    assert sid.startswith("S-1-5-")
    assert winpipe.only_user_sddl(sid) == f"O:{sid}D:P(A;;GA;;;{sid})"     # protected: nothing inherited


@windows_only
def test_the_pipe_answers_one_exchange_and_times_out_a_silent_client():
    import threading

    from roster import askpass, winpipe
    name = f"\\\\.\\pipe\\roster-test-{os.getpid()}"
    server = winpipe.Server(name)
    seen = []

    def answer():
        with server.accept() as conn:
            conn.settimeout(5)
            seen.append(conn.recv(100))
            conn.sendall(b"ok\nsecret")
        with server.accept() as conn:
            conn.settimeout(0.3)
            try:
                conn.recv(100)
            except TimeoutError:
                seen.append("timed out")

    t = threading.Thread(target=answer)
    t.start()
    assert askpass.exchange(name, "token", 5) == b"ok\nsecret"
    silent = winpipe.connect(name, timeout=5)
    t.join(5)
    silent.close()
    server.close()
    assert seen == [b"token\n", "timed out"]


@windows_only
def test_signing_in_with_a_password_says_how_to_on_windows(serve, write_config, fakes, monkeypatch, tmp_path):
    state = tmp_path / "bw-state.json"
    state.write_text(json.dumps({"logged_in": False, "server": None, "email": None}))
    monkeypatch.setenv("FAKE_BW_STATE", str(state))
    write_config(INVENTORY)
    s = serve()
    err = s.call("vault.login", {"email": "you@example.com", "password": "pw"})["error"]
    assert err["code"] == 59 and "roster bw login" in err["message"] and "API key" in err["message"]


@windows_only
def test_roster_run_hands_over_to_ssh_and_passes_on_its_code(write_config, fakes, monkeypatch):
    write_config("groups:\n  lab:\n    user: ops\n    hosts:\n      box: {ip: 10.0.0.5, enroll: true}\n")
    monkeypatch.setenv("FAKE_SSH_EXIT", "7")
    r = subprocess.run([sys.executable, "-m", "roster", "run", "box", "--", "true"], capture_output=True, text=True,
                       env=os.environ, timeout=60)
    assert r.returncode == 7 and "not connecting to" in r.stderr
