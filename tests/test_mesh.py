"""The Mesh (ticket 39, decision Q63): roster.yml's mesh: and links:, and `roster mesh` against stand-in Hosts
(tests/fakes/ssh with FAKE_HOSTS). Nothing here connects anywhere: each Host is a directory."""
import json
import os
import shutil
import subprocess

import pytest
from conftest import posix_shell

from roster import mesh
from roster.cli import main
from roster.config import load_config

# The stand-in Hosts run their side with sh (tests/fakes/ssh, FAKE_HOSTS), and ESXi's datastore is a symlink.
pytestmark = posix_shell

HOSTS = {"orion-2": "10.0.0.2", "orion-3": "10.0.0.3", "esx-02": "10.0.0.12", "sw-1": "10.0.0.20",
         "nas-1": "10.0.0.30", "db-9": "10.0.9.9", "new-1": "10.0.0.40"}

CONFIG = """\
defaults:
  user: admin
groups:
  lab:
    mesh: true
    hosts:
      orion-2: 10.0.0.2
      orion-3: 10.0.0.3
      esx-02: { ip: 10.0.0.12, user: root }
      sw-1: { ip: 10.0.0.20, enroll: false, auth: prompt }
      new-1: { ip: 10.0.0.40, reviewed: false }
  storage:
    hosts:
      nas-1: 10.0.0.30
  far:
    hosts:
      db-9: 10.0.9.9
links:
  - { from: orion-2, to: storage }
  - { from: orion-3, to: db-9, both: true }
"""


@pytest.fixture(scope="module")
def host_key(tmp_path_factory):
    d = tmp_path_factory.mktemp("hk")
    subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(d / "k")], check=True)
    return (d / "k.pub").read_text().split()[1]


class Net:
    """The stand-in Hosts: one directory each under FAKE_HOSTS."""

    def __init__(self, root, cfg_path):
        self.root, self.cfg_path = root, cfg_path

    def host(self, name):
        return self.root / name

    def ak(self, name):
        d = self.host(name)
        p = d / "etc/ssh/keys-root/authorized_keys" if (d / "esxi").exists() else d / "home/.ssh/authorized_keys"
        return p.read_text() if p.exists() else ""

    def mesh_lines(self, name):
        return sorted(line for line in self.ak(name).splitlines() if " roster-mesh:" in line)

    def file(self, name, rel):
        """A file on Host NAME. On ESXi, with the paths in it as the Host itself sees them."""
        p = self.host(name) / rel
        if not p.exists():
            return None
        return p.read_text().replace(str(self.host(name)), "") if (self.host(name) / "esxi").exists() else p.read_text()

    def down(self, name, is_down=True):
        f = self.host(name) / "down"
        f.touch() if is_down else f.unlink(missing_ok=True)

    def reboot(self, name):
        """ESXi rebuilds / and /etc from its boot image: only what it keeps (its /etc/ssh/keys-*, datastores) stays."""
        shutil.rmtree(self.host(name) / "home")
        (self.host(name) / "home").mkdir()

    def connections(self):
        f = self.root / "connections"
        return f.read_text().splitlines() if f.exists() else []

    def cfg(self):
        return load_config(self.cfg_path)

    def snapshot(self):
        return {str(p.relative_to(self.root)): p.read_bytes() for p in sorted(self.root.rglob("*"))
                if p.is_file() and p.name != "connections"}


@pytest.fixture
def net(fakes, isolated, write_config, monkeypatch, host_key):
    for f in (fakes / "host").iterdir():
        f.chmod(0o755)
    root = isolated["home"].parent / "hosts"
    for name in HOSTS:
        d = root / name
        (d / "home/.ssh").mkdir(parents=True)
        (d / "home/.ssh/authorized_keys").write_text(
            "ssh-ed25519 AAAAown own@laptop\nssh-ed25519 AAAAbox roster-managed:box\n")
        (d / "home/.ssh/config").write_text("Host *\n    ServerAliveInterval 60\n")
    esx = root / "esx-02"
    (esx / "esxi").touch()
    shutil.rmtree(esx / "home/.ssh")
    (esx / "etc/ssh/keys-root").mkdir(parents=True)
    (esx / "etc/ssh/keys-root/authorized_keys").write_text("ssh-ed25519 AAAAbox roster-managed:box\n")
    (esx / "vmfs/volumes/5f0e-uuid").mkdir(parents=True)
    (esx / "vmfs/volumes/datastore1").symlink_to("5f0e-uuid")
    (root / "orion-2/home/.claude").mkdir()
    (root / "orion-2/home/.claude/CLAUDE.md").write_text("# my notes\n")
    kh = isolated["home"] / ".ssh"
    kh.mkdir()
    (kh / "roster_known_hosts").write_text("".join(f"{ip} ssh-ed25519 {host_key}\n" for ip in HOSTS.values()))
    monkeypatch.setenv("FAKE_HOSTS", str(root))
    return Net(root, write_config(CONFIG))


def key_line_of(net, src, dst_ip):
    d = "vmfs/volumes/5f0e-uuid/.roster-mesh" if (net.host(src) / "esxi").exists() else "home/.ssh/roster-mesh"
    pub = (net.host(src) / d / "id_ed25519.pub").read_text().split()
    return f'from="{dst_ip}",no-agent-forwarding,no-X11-forwarding {pub[0]} {pub[1]} roster-mesh:{src}'


# ---------------------------------------------------------------- inventory

def test_mesh_cascades_from_defaults_to_group_to_host(write_config):
    cfg = load_config(write_config("""\
defaults: { user: u, mesh: true }
groups:
  a: { hosts: { a1: 10.0.0.1, a2: { ip: 10.0.0.2, mesh: false } } }
  b: { mesh: false, hosts: { b1: 10.0.0.3, b2: { ip: 10.0.0.4, mesh: true } } }
  c: { hosts: { c1: 10.0.0.5, c2: { ip: 10.0.0.6, reviewed: false } } }
"""))
    assert {n: h["mesh"] for n, h in cfg["hosts"].items()} == {
        "a1": True, "a2": False, "b1": False, "b2": True, "c1": True, "c2": True}
    g = mesh.graph(cfg)
    assert [(x["from"], x["to"]) for x in g["links"]] == []          # every group has one meshed Host left
    assert g["excluded"] == {"a2": "mesh: false", "b1": "mesh: false", "c2": "not reviewed (reviewed: false)"}


def test_a_meshed_group_reaches_itself_both_ways_and_links_add_one_way_reach(net):
    g = mesh.graph(net.cfg())
    pairs = {(x["from"], x["to"]): x for x in g["links"]}
    lab = ["esx-02", "orion-2", "orion-3", "sw-1"]
    assert {p for p in pairs if p[0] in lab and p[1] in lab} == {(a, b) for a in lab for b in lab if a != b}
    assert ("orion-2", "nas-1") in pairs and ("nas-1", "orion-2") not in pairs       # one-way
    assert ("orion-3", "db-9") in pairs and ("db-9", "orion-3") in pairs             # both: true
    assert "new-1" not in {p for pair in pairs for p in pair}                        # unreviewed never joins
    assert pairs[("orion-2", "sw-1")]["kind"] == "password"
    assert pairs[("sw-1", "orion-2")]["skip"] == "password-source"
    assert g["sources"] == ["db-9", "esx-02", "orion-2", "orion-3"]
    assert g["visit"] == ["db-9", "esx-02", "nas-1", "orion-2", "orion-3"]
    assert mesh.reach(g)["orion-2"] == 4


@pytest.mark.parametrize("links, message", [
    ("[{from: lab, to: nope}]", "entry 1: to: 'nope' isn't a Host or a group"),
    ("[{from: a1, to: a1}]", "entry 1 links 'a1' to itself"),
    ("[{from: a1}]", "entry 1 must be a mapping with from: and to:"),
    ("[{from: a1, to: lab, via: x}]", "entry 1 must be a mapping"),
    ("[{from: a1, to: lab, both: yes-please}]", "both: must be true or false"),
    ("{from: a1, to: lab}", "links: must be a list"),
])
def test_bad_links_are_refused_with_a_clean_error(write_config, links, message):
    p = write_config(f"defaults: {{user: u}}\ngroups:\n  lab: {{hosts: {{a1: 10.0.0.1, a2: 10.0.0.2}}}}\nlinks: {links}\n")
    with pytest.raises(SystemExit) as e:
        load_config(p)
    assert message in str(e.value)


def test_mesh_must_be_true_or_false(write_config):
    with pytest.raises(SystemExit) as e:
        load_config(write_config("groups:\n  lab: {mesh: 1, user: u, hosts: {a1: 10.0.0.1}}\n"))
    assert "mesh: must be true or false" in str(e.value)


# ---------------------------------------------------------------- plan

def test_dry_run_shows_the_plan_and_changes_nothing(net, capsys):
    before = net.snapshot()
    assert main(["mesh", "--dry-run"]) == 0
    out = capsys.readouterr().out
    assert net.snapshot() == before
    assert "orion-2 -> sw-1" in out and "password" in out
    assert "orion-2: make key" in out
    assert "nas-1: add key from orion-2" in out
    assert "left out: new-1 (not reviewed" in out
    assert "dry run: nothing was changed" in out


def test_one_connection_at_a_time(net):
    mesh.run(net.cfg(), apply=True)
    log = [x for x in net.connections() if not x.startswith("down")]
    assert log and all(a.split()[0] == "start" and b == "end " + a.split()[1] for a, b in zip(log[::2], log[1::2], strict=True))


# ---------------------------------------------------------------- apply

def test_apply_installs_tagged_keys_and_writes_each_sources_files(net):
    r = mesh.run(net.cfg(), apply=True)
    assert r["pending"] == {}
    o2 = net.host("orion-2") / "home/.ssh/roster-mesh"
    assert (o2 / "id_ed25519").exists()                              # made there; roster never reads it
    assert net.mesh_lines("nas-1") == [key_line_of(net, "orion-2", "10.0.0.2")]
    assert key_line_of(net, "orion-3", "10.0.0.3") in net.mesh_lines("orion-2")
    assert "ssh-ed25519 AAAAown own@laptop" in net.ak("orion-2")       # everything else kept
    assert "roster-managed:box" in net.ak("orion-2")
    config = (o2 / "config").read_text()
    assert "Host nas-1\n    HostName 10.0.0.30\n    User admin" in config
    assert "Host esx-02\n    HostName 10.0.0.12\n    User root" in config        # the peer's own user
    assert "Host sw-1" in config and "PubkeyAuthentication no" in config.split("Host sw-1")[1]
    assert "StrictHostKeyChecking yes" in config
    assert (o2 / "known_hosts").read_text().count("ssh-ed25519") == 4
    main_config = net.file("orion-2", "home/.ssh/config")
    assert main_config.splitlines()[:2] == [mesh.MARK, f"Include {o2}/config"]
    assert main_config.endswith("Host *\n    ServerAliveInterval 60\n")
    md = net.file("orion-2", "home/ROSTER.md")
    assert "| sw-1 | admin@10.0.0.20:22 | password |" in md and "ask the user to log in" in md
    assert "db-9" not in md
    assert net.file("orion-2", "home/.claude/CLAUDE.md") == "# my notes\n@~/ROSTER.md\n"
    assert net.file("orion-3", "home/.claude/CLAUDE.md") is None     # no Claude there: nothing to import from
    assert net.mesh_lines("sw-1") == []                              # a password peer gets no key


def test_esxi_keeps_its_key_on_a_datastore_and_takes_keys_in_etc_ssh(net):
    mesh.run(net.cfg(), apply=True)
    esx = net.host("esx-02")
    assert (esx / "vmfs/volumes/5f0e-uuid/.roster-mesh/id_ed25519").exists()
    assert key_line_of(net, "orion-2", "10.0.0.2") in net.mesh_lines("esx-02")
    assert "roster-managed:box" in net.ak("esx-02")
    config = net.file("esx-02", "vmfs/volumes/5f0e-uuid/.roster-mesh/config")
    assert "IdentityFile /vmfs/volumes/5f0e-uuid/.roster-mesh/id_ed25519" in config
    md = net.file("esx-02", "vmfs/volumes/5f0e-uuid/.roster-mesh/ROSTER.md")
    assert net.file("esx-02", "home/.ssh/config").splitlines()[1] == \
        "Include /vmfs/volumes/5f0e-uuid/.roster-mesh/config"
    assert "ssh -F /vmfs/volumes/5f0e-uuid/.roster-mesh/config <name>" in md


def test_applying_twice_changes_nothing_and_says_already_in_the_mesh(net, capsys):
    mesh.run(net.cfg(), apply=True)
    before = net.snapshot()
    assert main(["mesh"]) == 0
    assert net.snapshot() == before
    assert "already in the mesh" in capsys.readouterr().out


def test_an_esxi_reboot_is_drift_that_check_reports_and_apply_repairs(net, capsys):
    mesh.run(net.cfg(), apply=True)
    net.reboot("esx-02")
    lines = net.mesh_lines("orion-2")
    assert key_line_of(net, "esx-02", "10.0.0.12").split()[1] in "\n".join(lines)   # its key survived the reboot
    main(["check"])
    out = capsys.readouterr().out
    assert "mesh drift" in out and "esx-02: write Include in ~/.ssh/config" in out
    r = mesh.run(net.cfg(), apply=True)
    assert [h["changes"] for h in r["hosts"] if h["host"] == "esx-02"] == [["write Include in ~/.ssh/config"]]
    assert mesh.run(net.cfg())["already"]


def test_unreachable_links_are_reported_and_not_written(net, capsys):
    (net.host("orion-3") / "blocked").write_text("10.0.9.9:22\n")
    r = mesh.run(net.cfg(), apply=True)
    link = next(x for x in r["links"] if (x["from"], x["to"]) == ("orion-3", "db-9"))
    assert link["status"] == "unreachable" and link["why"] == "orion-3 can't reach 10.0.9.9:22"
    assert "Host db-9" not in net.file("orion-3", "home/.ssh/roster-mesh/config")
    assert not any("roster-mesh:orion-3" in x for x in net.mesh_lines("db-9"))
    assert any("roster-mesh:db-9" in x for x in net.mesh_lines("orion-3"))     # the other way works


def test_a_peer_without_a_recorded_host_key_is_left_out(net, isolated):
    kh = isolated["home"] / ".ssh/roster_known_hosts"
    kh.write_text("".join(x + "\n" for x in kh.read_text().splitlines() if not x.startswith("10.0.0.30 ")))
    r = mesh.run(net.cfg(), apply=True)
    link = next(x for x in r["links"] if x["to"] == "nas-1")
    assert link["status"] == "no-host-key" and "roster setup --only nas-1" in link["why"]
    assert net.mesh_lines("nas-1") == []


def test_a_down_host_is_pending_and_finished_when_it_is_back(net, capsys):
    net.down("nas-1")
    r = mesh.run(net.cfg(), apply=True)
    assert list(r["pending"]) == ["nas-1"]
    assert mesh.status(net.cfg())["pending"] == {"nas-1": r["pending"]["nas-1"]}
    main(["mesh", "status"])
    assert "pending on 1 Host: nas-1" in capsys.readouterr().out
    net.down("nas-1", False)
    r = mesh.run(net.cfg(), apply=True)
    assert r["pending"] == {} and net.mesh_lines("nas-1") == [key_line_of(net, "orion-2", "10.0.0.2")]
    assert mesh.status(net.cfg())["pending"] == {}


def test_a_down_source_keeps_its_keys_on_peers(net):
    mesh.run(net.cfg(), apply=True)
    before = net.mesh_lines("nas-1")
    net.down("orion-2")
    r = mesh.run(net.cfg(), apply=True)
    assert "orion-2" in r["pending"]
    assert net.mesh_lines("nas-1") == before


def interrupt(tmp_path, monkeypatch):
    """From now on, every Host's run dies part way through writing a file on the Host (a timeout, a deadline, a dropped link):
    a stand-in `cat` that writes one line to a file under the Host, then kills the shell running roster's script."""
    if not os.path.exists("/proc/self/fd/1"):
        pytest.skip("needs /proc to see where cat writes")
    d = tmp_path / "interrupt"
    d.mkdir()
    (d / "cat").write_text(f"""#!/bin/sh
out=$(readlink /proc/$$/fd/1)
case "$out" in
  "$FAKE_HOST_ROOT"/*) {shutil.which("cat")} "$@" | head -n 1; kill -9 $PPID; exit 1;;
esac
exec {shutil.which("cat")} "$@"
""")
    (d / "cat").chmod(0o755)
    monkeypatch.setenv("PATH", f"{d}{os.pathsep}{os.environ['PATH']}")


@pytest.fixture
def interrupted(tmp_path, monkeypatch):
    interrupt(tmp_path, monkeypatch)


def assert_no_file_was_damaged(net, before):
    """Each file is as it was, or (one roster owns, which a cut removes whole) gone; authorized_keys always there."""
    after = net.snapshot()
    for path, data in before.items():
        if "/roster-mesh/" in path and path not in after:
            continue
        assert after.get(path) == data, f"{path} was damaged by an interrupted run"


def test_an_interrupted_apply_never_leaves_a_file_half_written(net, interrupted):
    before = net.snapshot()
    r = mesh.run(net.cfg(), apply=True)
    assert set(r["pending"]) == set(mesh.graph(net.cfg())["visit"])
    assert_no_file_was_damaged(net, before)                      # the Box's key and the user's keys included


def test_an_interrupted_cut_never_leaves_a_file_half_written(net, monkeypatch, tmp_path):
    mesh.run(net.cfg(), apply=True)
    before = net.snapshot()
    interrupt(tmp_path, monkeypatch)
    r = mesh.cut(net.cfg(), "orion-2")
    assert {"orion-2", "orion-3", "esx-02", "nas-1"} <= set(r["pending"])
    assert_no_file_was_damaged(net, before)


def test_rewriting_a_file_keeps_its_mode(net):
    ak = net.host("orion-2") / "home/.ssh/authorized_keys"
    ak.chmod(0o640)
    mesh.run(net.cfg(), apply=True)
    assert "roster-mesh:orion-3" in ak.read_text()
    assert ak.stat().st_mode & 0o7777 == 0o640
    assert not list(net.host("orion-2").rglob("*.roster-new"))


# ---------------------------------------------------------------- removal, rotation, drift

def test_removing_a_link_removes_exactly_its_tagged_entries(net):
    mesh.run(net.cfg(), apply=True)
    nas_before = net.ak("nas-1")
    net.cfg_path.write_text(CONFIG.replace("  - { from: orion-2, to: storage }\n", ""))
    r = mesh.run(net.cfg(), apply=True)
    nas = next(h for h in r["hosts"] if h["host"] == "nas-1")
    assert nas["changes"] == ["remove key from orion-2"]
    assert net.ak("nas-1") == "".join(x + "\n" for x in nas_before.splitlines() if "roster-mesh:" not in x)
    assert "Host nas-1" not in net.file("orion-2", "home/.ssh/roster-mesh/config")


def test_taking_mesh_away_leaves_the_hosts_exactly_as_before(net):
    before = net.snapshot()
    mesh.run(net.cfg(), apply=True)
    net.cfg_path.write_text(CONFIG.replace("    mesh: true\n", "").split("links:")[0])
    r = mesh.run(net.cfg(), apply=True)
    assert r["pending"] == {}
    assert net.snapshot() == before
    assert mesh.load_state()["members"] == []


def test_rotate_replaces_one_hosts_key_everywhere(net, capsys):
    mesh.run(net.cfg(), apply=True)
    old = key_line_of(net, "orion-3", "10.0.0.3")
    plan = mesh.run(net.cfg(), rotate=["orion-3"])
    o3 = next(h for h in plan["hosts"] if h["host"] == "orion-3")
    assert o3["changes"][0] == "replace key"
    assert "replace key from orion-3" in next(h for h in plan["hosts"] if h["host"] == "orion-2")["changes"]
    assert main(["mesh", "--rotate", "orion-3"]) == 0
    new = key_line_of(net, "orion-3", "10.0.0.3")
    assert new != old
    for peer in ("orion-2", "esx-02", "db-9"):
        assert new in net.mesh_lines(peer) and old not in net.mesh_lines(peer)


def test_rotate_refuses_a_host_that_is_not_a_source(net):
    before = net.snapshot()
    with pytest.raises(SystemExit) as e:
        main(["mesh", "--rotate", "nas-1"])
    assert "nas-1 isn't a Mesh source" in str(e.value)
    assert net.connections() == [] and net.snapshot() == before


def test_check_reports_a_hand_removed_key_as_drift(net, capsys):
    mesh.run(net.cfg(), apply=True)
    ak = net.host("nas-1") / "home/.ssh/authorized_keys"
    ak.write_text("".join(x + "\n" for x in ak.read_text().splitlines() if "roster-mesh" not in x))
    assert main(["check"]) == 1
    assert "nas-1: add key from orion-2" in capsys.readouterr().out


def test_a_roster_md_that_is_not_rosters_is_left_alone(net):
    (net.host("orion-3") / "home/ROSTER.md").write_text("my own notes\n")
    r = mesh.run(net.cfg(), apply=True)
    assert net.file("orion-3", "home/ROSTER.md") == "my own notes\n"
    assert any("orion-3" in w and "isn't roster's" in w for w in r["warnings"])


# ---------------------------------------------------------------- cut

def git(cwd, *args):
    subprocess.run(["git", "-C", str(cwd), *args], check=True, capture_output=True)


def test_cut_takes_a_host_out_everywhere_and_keeps_the_boxs_access(net, capsys):
    git(net.cfg_path.parent, "init", "-q")
    git(net.cfg_path.parent, "add", "roster.yml")
    git(net.cfg_path.parent, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "x")
    mesh.run(net.cfg(), apply=True)
    assert main(["mesh", "cut", "orion-2", "--yes"]) == 0
    out = capsys.readouterr().out
    for peer in ("orion-3", "esx-02", "nas-1"):
        assert not any("roster-mesh:orion-2" in x for x in net.mesh_lines(peer))
    assert net.mesh_lines("orion-2") == []                           # every peer off orion-2
    assert "roster-managed:box" in net.ak("orion-2")                 # the Box can still investigate
    assert not (net.host("orion-2") / "home/.ssh/roster-mesh").exists()
    assert any("roster-mesh:orion-3" in x for x in net.mesh_lines("esx-02"))   # the rest of the Mesh stays
    cfg = net.cfg()
    assert cfg["hosts"]["orion-2"]["mesh"] is False                  # a Pending change, so the cut survives
    assert "mesh: false" in subprocess.run(["git", "-C", str(net.cfg_path.parent), "diff"], capture_output=True,
                                           text=True).stdout
    assert "cut orion-2: confirmed on" in out
    r = mesh.run(cfg, apply=True)                                    # the next apply tidies the peers' configs
    assert "remove key from orion-2" not in str(r) and "Host orion-2" not in net.file("orion-3", "home/.ssh/roster-mesh/config")
    assert not any("roster-mesh:orion-2" in x for p in HOSTS for x in net.mesh_lines(p))
    assert mesh.run(cfg)["already"]


def test_cut_warns_loudly_about_down_peers_until_they_are_done(net, capsys):
    mesh.run(net.cfg(), apply=True)
    net.down("nas-1")
    assert main(["mesh", "cut", "orion-2", "--yes"]) == 1
    out = capsys.readouterr()
    assert "CUT PENDING ON 1 HOST: nas-1" in out.out + out.err
    assert mesh.status(net.cfg())["cut_pending"] == {"orion-2": ["nas-1"]}
    main(["mesh", "status"])
    assert "cut pending on 1 Host" in capsys.readouterr().out
    net.down("nas-1", False)
    r = mesh.run(net.cfg(), apply=True)
    assert r["cut_pending"] == {} and net.mesh_lines("nas-1") == []


def test_cut_without_a_git_repo_still_writes_mesh_false(net, capsys):
    assert main(["mesh", "cut", "orion-3", "--yes"]) == 0
    assert net.cfg()["hosts"]["orion-3"]["mesh"] is False
    assert "isn't in a git repo" in capsys.readouterr().out


def test_cut_keeps_the_peers_that_confirmed_it_in_the_meshs_bookkeeping(net):
    mesh.run(net.cfg(), apply=True)
    r = mesh.cut(net.cfg(), "esx-02")
    assert r["pending"] == {} and "orion-2" in r["confirmed"]
    members = mesh.load_state()["members"]
    assert "esx-02" not in members
    assert {"orion-2", "orion-3", "nas-1", "db-9"} <= set(members)     # they still hold each other's keys
    net.cfg_path.write_text(CONFIG.replace("    mesh: true\n", "").split("links:")[0])
    assert mesh.run(net.cfg(), apply=True)["pending"] == {}           # so taking the Mesh away still visits them
    for h in HOSTS:
        assert net.mesh_lines(h) == [] and not (net.host(h) / "home/.ssh/roster-mesh").exists()
    assert "roster-mesh" not in net.file("orion-2", "home/.ssh/config")
    assert net.file("orion-2", "home/.claude/CLAUDE.md") == "# my notes\n"


# ---------------------------------------------------------------- setup and serve

def test_setup_applies_the_mesh_for_meshed_groups(net, capsys, monkeypatch):
    from roster import cli
    monkeypatch.setattr(cli, "record_fingerprints", lambda cfg, hosts: set())
    monkeypatch.setattr(cli, "ssh_ok", lambda name: True)
    monkeypatch.setattr(cli, "ensure_key", lambda cfg: None)
    monkeypatch.setattr(cli, "public_key_line", lambda cfg: "ssh-ed25519 AAAAbox roster-managed:box")
    main(["setup"])
    assert "mesh" in capsys.readouterr().out
    assert net.mesh_lines("nas-1") == [key_line_of(net, "orion-2", "10.0.0.2")]


def test_serve_plans_applies_cuts_and_reports_status(net, serve, monkeypatch):
    s = serve("-c", str(net.cfg_path))
    st = s.call("mesh.status")["result"]
    assert st["out_of_date"] is True and st["reach"]["orion-2"] == 4
    plan = s.call("mesh.plan")["result"]
    assert plan["applied"] is False and not plan["already"]
    r = s.call("mesh.apply")["result"]
    assert r["applied"] is True and r["pending"] == {}
    assert s.call("mesh.status")["result"]["out_of_date"] is False
    assert s.call("mesh.apply")["result"]["already"] is True
    err = s.call("mesh.plan", {"rotate": ["nas-1"]})["error"]
    assert err["code"] == 110 and err["data"]["hosts"] == ["nas-1"]
    assert s.call("mesh.cut", {"host": "nope"})["error"]["code"] == 2
    cut = s.call("mesh.cut", {"host": "orion-2"})["result"]
    assert cut["pending"] == {} and "nas-1" in cut["confirmed"]
    assert cut["change"]["written"] is True
    assert s.call("hosts.list")["result"]["hosts"][0]["mesh"] is False
    json.dumps(cut)


def test_private_keys_never_leave_their_host_and_no_secret_is_looked_up(net, monkeypatch, isolated, capsys):
    from roster import providers

    def no_secrets(*a, **kw):
        raise AssertionError("the Mesh looked up a password")
    monkeypatch.setattr(providers, "get_secret", no_secrets)
    r = mesh.run(net.cfg(), apply=True)
    main(["mesh", "--dry-run"])
    shown = json.dumps(r) + capsys.readouterr().out
    private = (net.host("orion-2") / "home/.ssh/roster-mesh/id_ed25519").read_text()
    body = "".join(private.splitlines()[1:-1])
    assert body and body not in shown
    box = [p.read_text(errors="replace") for p in isolated["home"].rglob("*") if p.is_file()]
    assert not any(body[-60:-20] in t for t in box)
    for h in HOSTS:                                      # and no other Host holds a copy of it
        for p in net.host(h).rglob("*"):
            if p.is_file() and h != "orion-2":
                assert body[-60:-20] not in p.read_text(errors="replace")
