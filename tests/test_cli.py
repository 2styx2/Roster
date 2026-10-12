import os
import subprocess

import pytest

import roster.cli as cli
from roster.cli import main
from roster.sshops import sudo_wrap


def run(capsys, *argv):
    rc = main(list(argv))
    return rc, capsys.readouterr().out


def test_version(capsys):
    with pytest.raises(SystemExit) as e:
        main(["--version"])
    assert e.value.code == 0 and "roster" in capsys.readouterr().out


def test_init_hosts_info(capsys, isolated):
    assert run(capsys, "init")[0] in (0, None)
    assert (isolated["work"] / "roster.yml").exists()
    rc, out = run(capsys, "hosts", "--find", "orion prod")
    assert rc == 0 and "orion-web-01" in out and "orion-dev-01" not in out
    rc, out = run(capsys, "info", "core", "switch")
    assert "net-sw-core-01" in out and "Uplinks" in out
    with pytest.raises(SystemExit, match="did you mean"):
        main(["info", "orion"])


def test_setup_skips_unreviewed_hosts(capsys, write_config):
    write_config("groups:\n  found:\n    reviewed: false\n    user: u\n    hosts:\n      h1: 10.9.9.9\n")
    rc, out = run(capsys, "setup")
    assert rc == 0 and "skipping     1 hosts with reviewed: false" in out


def test_providers_flags_unknown(capsys, write_config):
    write_config("groups:\n  g: {user: u, auth: 'keeper:x', hosts: {h1: 10.0.0.1}}\n")
    rc, out = run(capsys, "providers")
    assert rc == 1 and "UNKNOWN providers used in roster.yml: keeper" in out


def test_auth_check(capsys, write_config, monkeypatch):
    monkeypatch.setenv("GOOD_PW", "x")
    write_config("groups:\n"
                 "  a: {user: u, auth: 'env:GOOD_PW', hosts: {h1: 10.0.0.1}}\n"
                 "  b: {user: u, auth: 'env:MISSING_PW', hosts: {h2: 10.0.0.2}}\n")
    rc, out = run(capsys, "auth-check")
    assert rc == 1
    assert "ok    a" in out and "FAIL  b" in out and "MISSING_PW is not set" in out


def test_discover_rejects_huge_ranges(capsys):
    with pytest.raises(SystemExit, match="narrow it down"):
        main(["discover", "10.0.0.0/8"])


# ---- roster run --sudo

SUDO_CFG = ("groups:\n  g:\n    user: ops\n    auth: env:ROSTER_TEST_PW\n    hosts:\n"
            "      pw-host: { ip: 10.0.0.5, enroll: false }\n"
            "      key-host: { ip: 10.0.0.6 }\n"
            "      agent-host: { ip: 10.0.0.7, auth: agent }\n"
            "      new-host: { ip: 10.0.0.8, reviewed: false }\n")


def test_sudo_wrap_keeps_password_away_from_the_command(tmp_path):
    fake = tmp_path / "sudo"        # stand-in sudo that, like a NOPASSWD rule, never reads stdin
    fake.write_text('#!/bin/sh\nwhile [ "$1" != "--" ]; do shift; done; shift; exec "$@"\n')
    fake.chmod(0o755)
    env = {**os.environ, "PATH": f"{tmp_path}:{os.environ['PATH']}"}
    r = subprocess.run(["sh", "-c", sudo_wrap("cat; echo \"it's done\"")], input="s3cret\n",
                       capture_output=True, text=True, env=env)
    assert r.returncode == 0 and r.stdout == "it's done\n"          # cat saw /dev/null, not the password


def test_run_sudo_password_host(capsys, write_config, monkeypatch):
    write_config(SUDO_CFG)
    monkeypatch.setenv("ROSTER_TEST_PW", "s3cret")
    seen = {}

    def fake_exec(h, command, password, timeout=15, stdin=None):
        seen.update(command=command, password=password, stdin=stdin)
        return 0, "uid=0(root) s3cret\n", ""
    monkeypatch.setattr(cli, "password_exec", fake_exec)
    rc = main(["run", "--sudo", "pw-host", "--", "id"])
    out = capsys.readouterr().out
    assert rc == 0 and seen["command"].startswith("sudo -S -p '' -- sh -c ")
    assert seen["stdin"] == "s3cret\n" and seen["password"] == "s3cret"
    assert out == "uid=0(root) ********\n"                         # echoed password is masked


def test_run_sudo_key_host(capsys, write_config, monkeypatch):
    write_config(SUDO_CFG)
    monkeypatch.setenv("ROSTER_TEST_PW", "s3cret")
    seen = {}

    def fake_run(argv, input=None, **kw):
        seen.update(argv=argv, input=input)
        return subprocess.CompletedProcess(argv, 0, "root\n", "")
    monkeypatch.setattr(cli.subprocess, "run", fake_run)
    assert main(["run", "--sudo", "key-host", "--", "whoami"]) == 0
    assert seen["argv"][:4] == ["ssh", "-o", "BatchMode=yes", "key-host"] and seen["input"] == "s3cret\n"
    assert "sudo -S" in seen["argv"][4] and capsys.readouterr().out == "root\n"


def test_run_sudo_needs_a_password(write_config):
    write_config(SUDO_CFG)
    with pytest.raises(SystemExit, match="--sudo needs the login's password"):
        main(["run", "--sudo", "agent-host", "--", "id"])


def test_run_refuses_unreviewed_hosts(write_config):
    write_config(SUDO_CFG)
    with pytest.raises(SystemExit, match="not reviewed"):
        main(["run", "new-host", "--", "id"])


def test_run_hints_at_sudo_flag(capsys, write_config, monkeypatch):
    write_config(SUDO_CFG)
    monkeypatch.setenv("ROSTER_TEST_PW", "s3cret")
    monkeypatch.setattr(cli, "password_exec", lambda *a, **k: (1, "", "sudo: a password is required\n"))
    assert main(["run", "pw-host", "--", "sudo", "id"]) == 1
    assert "roster run --sudo pw-host -- id" in capsys.readouterr().err
