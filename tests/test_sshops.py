import os
import subprocess

from roster.config import load_config
from roster.sshops import add_key_script, public_key_line, remove_key_script, write_ssh_config

PUB = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyForTestsOnly roster-managed:ws1"
TAG_RE = " (roster-managed|fleet-managed):ws1$"


def run_remote(script, home):
    """Run the script the way a host would: `sh -c ...` with that account's HOME."""
    r = subprocess.run(["sh", "-c", script], env={**os.environ, "HOME": str(home)}, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return r.stdout


def test_add_key_is_idempotent_and_replaces_old_keys(tmp_path):
    ak = tmp_path / ".ssh" / "authorized_keys"
    ak.parent.mkdir()
    ak.write_text("ssh-rsa AAAAother someone@laptop\n"
                  "ssh-ed25519 AAAAold fleet-managed:ws1\n"
                  "ssh-ed25519 AAAAkeep roster-managed:ws10")              # different box; no trailing newline
    for _ in range(2):
        assert "ROSTER_OK" in run_remote(add_key_script(PUB, TAG_RE), tmp_path)
    lines = ak.read_text().splitlines()
    assert lines == ["ssh-rsa AAAAother someone@laptop", "ssh-ed25519 AAAAkeep roster-managed:ws10", PUB]
    assert oct(ak.stat().st_mode & 0o777) == "0o600"


def test_add_key_creates_ssh_dir(tmp_path):
    run_remote(add_key_script(PUB, TAG_RE), tmp_path)
    assert (tmp_path / ".ssh" / "authorized_keys").read_text() == PUB + "\n"
    assert oct((tmp_path / ".ssh").stat().st_mode & 0o777) == "0o700"


def test_remove_key_only_touches_this_box(tmp_path):
    run_remote(add_key_script(PUB, TAG_RE), tmp_path)
    ak = tmp_path / ".ssh" / "authorized_keys"
    ak.write_text("ssh-rsa AAAAother someone@laptop\n" + ak.read_text())
    assert "ROSTER_OK" in run_remote(remove_key_script(TAG_RE), tmp_path)
    assert ak.read_text() == "ssh-rsa AAAAother someone@laptop\n"
    assert "ROSTER_OK" in run_remote(remove_key_script(TAG_RE), tmp_path / "nobody-home")   # no file: fine


def test_public_key_line_carries_box_tag(write_config):
    cfg = load_config(write_config("box_name: ws1\nkey_path: ~/k\ngroups: {a: {user: u, hosts: {h: 1.2.3.4}}}\n"))
    cfg["pub"].write_text("ssh-ed25519 AAAAxyz someone@else\n")
    assert public_key_line(cfg) == "ssh-ed25519 AAAAxyz roster-managed:ws1"


def test_ssh_config_written_and_included_once(isolated, write_config):
    main_cfg = isolated["home"] / ".ssh" / "config"
    main_cfg.parent.mkdir()
    main_cfg.write_text("Host personal\n    HostName example.org\n")
    cfg = load_config(write_config(
        "groups:\n"
        "  web: {user: deploy, hosts: {web01: {ip: 10.0.1.15, title: Web box}}}\n"
        "  net: {user: netops, enroll: false, hosts: {sw01: {ip: 10.0.0.2, port: 2222}}}\n"))
    write_ssh_config(cfg)
    write_ssh_config(cfg)
    text = main_cfg.read_text()
    assert text.count("Include") == 1 and text.startswith("Include ")
    assert "Host personal" in text
    generated = (isolated["home"] / ".ssh" / "config.d" / "roster").read_text()
    web, sw = generated.split("Host web01")[1], generated.split("Host sw01")[1].split("Host ")[0]
    assert "# Web box" in generated
    assert "IdentityFile" in web and "IdentityFile" not in sw
    assert "Port 2222" in sw


def test_ssh_config_offers_only_rosters_key_or_none(isolated, write_config):
    """Catalog row 19: an ssh agent full of keys mustn't use up the Host's tries before the password.
    Key Hosts offer only roster's key; password Hosts offer none. `auth: agent` Hosts keep the agent."""
    cfg = load_config(write_config(
        "groups:\n"
        "  g:\n"
        "    user: u\n"
        "    hosts:\n"
        "      key: 10.0.0.1\n"
        "      pw: {ip: 10.0.0.2, enroll: false, auth: 'bw:pw ssh'}\n"
        "      agent: {ip: 10.0.0.3, enroll: false, auth: agent}\n"))
    write_ssh_config(cfg)
    text = (isolated["home"] / ".ssh" / "config.d" / "roster").read_text()
    block = {name: text.split(f"Host {name}\n")[1].split("\n\n")[0] for name in ("key", "pw", "agent")}
    assert "IdentitiesOnly yes" in block["key"] and "IdentityFile" in block["key"]
    assert "IdentitiesOnly yes" in block["pw"] and "IdentityFile" not in block["pw"]
    assert "PubkeyAuthentication no" in block["pw"]
    assert "IdentitiesOnly" not in block["agent"]
