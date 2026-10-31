"""`roster serve`'s discover.* methods (ticket 44): a scan of a network that runs in serve, in the background, with its
progress and results to poll, a way to stop it, and the Hosts the user picks added as a Pending change. The app's UI
for it is the first-party Plugin plugins/discover. Nothing here touches a network: nmap is tests/fakes/nmap, which
answers from the stand-in Hosts under FAKE_HOSTS."""

import shutil
import subprocess
import time

import pytest
import yaml

from roster import discover

INVENTORY = """\
groups:
  lab:
    user: ops
    hosts:
      esx-02: {ip: 10.0.0.5}
"""


def git(cwd, *args):
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", *args], cwd=cwd, check=True,
                   capture_output=True)


@pytest.fixture
def net(fakes, isolated, monkeypatch):
    """Stand-in Hosts on 10.0.0.0/24, and the stand-in nmap (never the real one) to find them."""
    assert shutil.which("nmap").startswith(str(fakes)), "the tests must never run the real nmap"
    root = isolated["home"].parent / "hosts"

    def add(name, address, ports, hostname="", title=""):
        d = root / name
        d.mkdir(parents=True)
        (d / "address").write_text(address)
        (d / "ports").write_text("\n".join(ports) + "\n")
        hostname and (d / "hostname").write_text(hostname)
        title and (d / "title").write_text(title)
        return d

    add("esx-02", "10.0.0.5", ["22 ssh OpenSSH 9.6", "443 https VMware ESXi"])
    add("appliance", "10.0.0.7", ["443 https lighttpd"], hostname="appliance.lab", title="Appliance login")
    add("db", "10.0.0.9", ["22 ssh OpenSSH 9.6", "5432 postgresql"])
    add("elsewhere", "10.0.1.4", ["22 ssh OpenSSH 9.6"])
    monkeypatch.setenv("FAKE_HOSTS", str(root))
    monkeypatch.setenv("FAKE_LOG", str(isolated["home"].parent / "log"))
    return root


@pytest.fixture
def inventory(write_config):
    """roster.yml committed in a git repo, so adding to it is a Pending change."""
    path = write_config(INVENTORY)
    git(path.parent, "init", "-q")
    git(path.parent, "add", path.name)
    git(path.parent, "commit", "-qm", "inventory")
    return path


def finished(s, scan, tries=200):
    """discover.status until the scan is over."""
    for _ in range(tries):
        r = s.call("discover.status", {"scan": scan})["result"]
        if r["state"] not in ("running", "stopping"):
            return r
        time.sleep(0.05)
    raise AssertionError("the scan never finished")


def test_plan_says_what_a_scan_would_do_and_changes_nothing(serve, net, inventory, isolated):
    r = serve("-c", str(inventory)).call("discover.plan", {"targets": ["10.0.0.0/24"]})["result"]
    assert r == {"targets": ["10.0.0.0/24"], "addresses": 254, "ports": len(discover.DEFAULT_SCAN_PORTS.split(",")),
                 "scanner": "nmap", "limit": 4096, "max": 65536}
    assert not (isolated["home"].parent / "log").exists()                   # nothing was scanned


def test_bad_targets_and_too_many_addresses_are_refused(serve, net, inventory):
    s = serve("-c", str(inventory))
    for bad in ([], ["10.0.0.0/33"], ["esx-02"], "10.0.0.0/24", [7]):
        assert s.call("discover.plan", {"targets": bad})["error"]["code"] == -32602
    e = s.call("discover.start", {"targets": ["10.0.0.0/19"]})["error"]
    assert e["code"] == 121 and e["data"] == {"addresses": 8190, "limit": 4096, "max": 65536,
                                              "fix": "scan a smaller range, or confirm the larger scan (force)"}
    assert s.call("discover.plan", {"targets": ["10.0.0.0/19"], "force": True})["result"]["addresses"] == 8190
    assert s.call("discover.plan", {"targets": ["10.0.0.0/15"], "force": True})["error"]["code"] == 121
    assert s.call("discover.plan", {"targets": ["10.0.0.0/24"], "ports": "22,abc"})["error"]["code"] == -32602


def test_a_scan_runs_in_the_background_and_its_results_come_in_as_they_are_found(serve, net, inventory):
    s = serve("-c", str(inventory))
    started = s.call("discover.start", {"targets": ["10.0.0.0/24"]})["result"]
    assert started["state"] == "running" and started["total"] == 254 and started["scanner"] == "nmap"
    r = finished(s, started["scan"])
    assert r["state"] == "done" and r["done"] == r["total"] == 254 and r["error"] is None
    assert [f["address"] for f in r["found"]] == ["10.0.0.5", "10.0.0.7", "10.0.0.9"]     # not 10.0.1.4
    esx, app, db = r["found"]
    assert esx["known"] == "esx-02" and esx["name"] is None                 # already in the Inventory
    assert app == {"address": "10.0.0.7", "name": "appliance", "type": "appliance", "hostname": "appliance.lab",
                   "title": "Appliance login", "web": "https://10.0.0.7", "known": None, "added": None,
                   "vendor": "", "os": "", "mac": "",
                   "ports": [{"port": 443, "name": "https", "product": "lighttpd", "title": "Appliance login"}]}
    assert db["name"] == "db-10-0-0-9" and db["type"] == "db"
    assert r["count"] == 3
    # since: only what came after
    again = s.call("discover.status", {"scan": started["scan"], "since": 2})["result"]
    assert [f["address"] for f in again["found"]] == ["10.0.0.9"] and again["count"] == 3


def test_only_one_scan_at_a_time_and_stop_ends_it(serve, net, inventory, monkeypatch):
    monkeypatch.setenv("FAKE_NMAP_DELAY", "30")
    s = serve("-c", str(inventory))
    scan = s.call("discover.start", {"targets": ["10.0.0.0/24"]})["result"]["scan"]
    e = s.call("discover.start", {"targets": ["10.0.1.0/24"]})["error"]
    assert e["code"] == 120 and e["data"]["scan"] == scan
    t = time.monotonic()
    assert s.call("discover.stop", {"scan": scan})["result"] == {"scan": scan, "stopping": True}
    r = finished(s, scan)
    assert r["state"] == "stopped" and time.monotonic() - t < 10            # nmap was killed, not waited for
    assert s.call("discover.stop", {"scan": scan})["result"] == {"scan": scan, "stopping": False}
    # a new one may start now
    assert s.call("discover.start", {"targets": ["10.0.1.0/24"]})["result"]["scan"] != scan


def test_a_failed_nmap_is_the_scans_state_not_a_hang(serve, net, inventory, monkeypatch):
    monkeypatch.setenv("FAKE_NMAP_FAIL", "nmap: you need root for that")
    s = serve("-c", str(inventory))
    r = finished(s, s.call("discover.start", {"targets": ["10.0.0.0/28"]})["result"]["scan"])
    assert r["state"] == "failed" and "you need root" in r["error"]


def test_unknown_scans(serve, net, inventory):
    s = serve("-c", str(inventory))
    for method in ("discover.status", "discover.stop"):
        assert s.call(method, {})["error"]["code"] == 122              # none yet
    s.call("discover.start", {"targets": ["10.0.0.0/30"]})
    assert s.call("discover.status", {"scan": "nope"})["error"]["code"] == 122
    assert s.call("discover.add", {"scan": "nope", "addresses": ["10.0.0.7"]})["error"]["code"] == 122


def test_add_writes_the_picked_hosts_as_a_pending_change_unreviewed(serve, net, inventory):
    s = serve("-c", str(inventory))
    scan = s.call("discover.start", {"targets": ["10.0.0.0/24"]})["result"]["scan"]
    finished(s, scan)
    before = inventory.read_text()
    r = s.call("discover.add", {"scan": scan, "addresses": ["10.0.0.9", "10.0.0.7"]})["result"]
    group = r["group"]
    assert group.startswith("discovered-")
    assert r["added"] == [{"address": "10.0.0.7", "name": "appliance"}, {"address": "10.0.0.9", "name": "db-10-0-0-9"}]
    assert r["backup"]
    text = inventory.read_text()
    assert text.startswith(before.rstrip("\n").split("\n")[0])
    raw = yaml.safe_load(text)["groups"]
    assert raw["lab"] == yaml.safe_load(before)["groups"]["lab"]             # nothing else changed
    assert raw[group]["reviewed"] is False
    hosts = {h["name"]: h for h in s.call("hosts.list")["result"]["hosts"]}
    assert hosts["appliance"]["reviewed"] is False and hosts["appliance"]["ip"] == "10.0.0.7"
    assert "appliance" in s.call("changes.diff")["result"]["diff"]          # a Pending change, not committed
    # the scan says what was added; adding them again is refused
    found = {f["address"]: f for f in s.call("discover.status", {"scan": scan})["result"]["found"]}
    assert found["10.0.0.7"]["added"] == "appliance"
    e = s.call("discover.add", {"scan": scan, "addresses": ["10.0.0.7", "10.0.0.5", "10.0.0.99"]})["error"]
    assert e["code"] == 123 and e["data"]["addresses"] == ["10.0.0.7", "10.0.0.5", "10.0.0.99"]


def test_add_into_a_named_group_and_without_a_git_repo(serve, net, inventory):
    s = serve("-c", str(inventory))
    scan = s.call("discover.start", {"targets": ["10.0.0.0/24"]})["result"]["scan"]
    finished(s, scan)
    r = s.call("discover.add", {"scan": scan, "addresses": ["10.0.0.7"], "group": "lab"})
    assert r["error"]["code"] == 100                                           # a group that's there is taken
    r = s.call("discover.add", {"scan": scan, "addresses": ["10.0.0.7"], "group": "found-today"})["result"]
    assert r["group"] == "found-today"
    shutil.rmtree(inventory.parent / ".git")
    assert s.call("discover.add", {"scan": scan, "addresses": ["10.0.0.9"]})["error"]["code"] == 70


def test_the_builtin_scanner_when_nmap_isnt_installed(monkeypatch):
    """No nmap: roster's own TCP connect scan, in batches, stoppable. tcp_ok is the stand-in here: nothing connects."""
    open_ = {("10.0.0.7", 443), ("10.0.0.9", 22)}
    monkeypatch.setattr(discover, "tcp_ok", lambda ip, port, timeout=None: (ip, port) in open_)
    monkeypatch.setattr(discover.socket, "gethostbyaddr", lambda ip: (_ for _ in ()).throw(OSError()))
    monkeypatch.setattr(discover.socket, "create_connection", lambda *a, **k: (_ for _ in ()).throw(OSError()))
    scan = discover.Scan("s1", ["10.0.0.0/24"], "22,443", "built-in", {}, set())
    scan.run()
    r = scan.status()
    assert r["state"] == "done" and r["done"] == 254
    assert [(f["address"], [p["port"] for p in f["ports"]]) for f in r["found"]] == [("10.0.0.7", [443]),
                                                                                   ("10.0.0.9", [22])]
