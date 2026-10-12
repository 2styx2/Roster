import pytest

from roster.cli import main


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
