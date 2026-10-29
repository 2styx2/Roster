"""`roster serve`: JSON-RPC 2.0 over stdin/stdout, driven as the desktop app drives it - a subprocess."""

import json
import os
import shutil
import subprocess
import sys

import pytest
from conftest import EXAMPLES

from roster import __version__
from roster.cli import main


class Serve:
    def __init__(self, *args):
        self.p = subprocess.Popen([sys.executable, "-m", "roster", *args, "serve"], stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.next_id = 0

    def send(self, line):
        self.p.stdin.write(line + "\n")
        self.p.stdin.flush()
        return json.loads(self.p.stdout.readline())

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


def test_inventory_info(serve, isolated):
    example = isolated["work"] / "roster.yml"
    example.write_text((EXAMPLES / "roster.example.yml").read_text())
    s = serve()
    info = s.call("inventory.info")["result"]
    assert info["path"] == str(example.resolve())
    assert info["box"] and info["host_count"] == 5
    assert {"bw", "op", "env", "prompt"} <= set(info["providers"])
    assert info["roster_version"] == __version__ and info["api_version"] == 1
    assert s.close() == (0, "", "")


INVENTORY = """\
groups:
  lab:
    title: Lab gear
    user: ops
    auth: bw:lab ssh
    hosts:
      box: {ip: 10.0.0.5, title: Lab box, web: "https://10.0.0.5"}
      esx:
        ip: 10.0.0.6
        user: root
        enroll: false
        services:
          admin: {url: "https://10.0.0.6:943", user: webadmin, auth: env:WEB}
  found:
    reviewed: false
    user: CHANGE-ME
    hosts:
      server-10-0-0-9: {ip: 10.0.0.9, port: 2222}
"""


def roster_hosts(capsys, *argv):
    """`roster hosts ...` rows as {name: [columns]}."""
    assert main(["hosts", *argv]) == 0
    rows = [ln.split() for ln in capsys.readouterr().out.splitlines() if ln.strip()]
    return {r[0]: r for r in rows[1:] if not r[0].isdigit()}


def test_hosts_list_agrees_with_roster_hosts(serve, write_config, capsys):
    write_config(INVENTORY)
    listing = serve().call("hosts.list")["result"]
    hosts = {h["name"]: h for h in listing["hosts"]}

    every = roster_hosts(capsys, "--all")
    assert set(hosts) == set(every) == {"box", "esx", "server-10-0-0-9"}
    for name, row in every.items():
        ssh = hosts[name]["ssh"]
        assert row[1] == hosts[name]["ip"] + ("" if ssh["port"] == 22 else f":{ssh['port']}")
    for group in ("lab", "found"):
        assert {n for n, h in hosts.items() if h["group"] == group} == set(roster_hosts(capsys, "--only", group))
    assert {n for n, h in hosts.items() if h["reviewed"]} == set(roster_hosts(capsys)) == {"box", "esx"}

    assert listing["groups"] == {"lab": {"title": "Lab gear", "description": ""},
                                 "found": {"title": "", "description": ""}}


def test_hosts_come_back_as_roster_builds_them(serve, write_config):
    """The resolved ssh login, services, default login and text fields - auth as a reference, never a value."""
    write_config(INVENTORY)
    hosts = {h["name"]: h for h in serve().call("hosts.list")["result"]["hosts"]}
    esx = hosts["esx"]
    assert esx["ssh"] == {"user": "root", "port": 22, "auth": "bw:lab ssh"}
    assert esx["login"] == {"user": "root", "auth": "bw:lab ssh"}
    assert esx["enroll"] is False and esx["title"] == "" and hosts["box"]["title"] == "Lab box"
    assert esx["services"]["admin"]["url"] == "https://10.0.0.6:943"
    assert esx["services"]["admin"]["auth"] == "env:WEB" and esx["services"]["admin"]["user"] == "webadmin"
    assert hosts["box"]["web"] == "https://10.0.0.5"


def test_host_get(serve, write_config):
    write_config(INVENTORY)
    s = serve()
    box = s.call("host.get", {"name": "box"})["result"]
    assert box["name"] == "box" and box["ip"] == "10.0.0.5" and box["group"] == "lab"
    err = s.call("host.get", {"name": "nope"})["error"]
    assert err["code"] == 2 and err["message"] == "unknown host 'nope'"
    assert s.call("host.get", {})["error"]["code"] == -32602
    assert s.call("host.get", {"name": "esx"})["result"]["name"] == "esx"      # still serving
    assert s.close()[0] == 0


def test_bad_requests_get_errors_and_the_server_keeps_going(serve, write_config):
    write_config(INVENTORY)
    s = serve()
    r = s.send("{not json")
    assert r["id"] is None and r["error"]["code"] == -32700
    assert s.send("[1, 2]")["error"]["code"] == -32600
    assert s.send('{"id": 7, "method": "hosts.list"}') == {          # no "jsonrpc": "2.0"
        "jsonrpc": "2.0", "id": 7, "error": {"code": -32600, "message": "expected a JSON-RPC 2.0 request object"}}
    assert s.call("hosts.delete")["error"] == {"code": -32601, "message": "unknown method 'hosts.delete'"}
    assert s.call("host.get", ["box"])["error"]["code"] == -32602
    s.p.stdin.write('{"jsonrpc": "2.0", "method": "hosts.list"}\n\n')   # a notification and a blank line: no reply
    assert s.call("inventory.info")["result"]["host_count"] == 3
    assert s.close() == (0, "", "")


def test_stdout_carries_only_responses(serve, write_config, isolated):
    """roster's own warnings (here: a provider plugin that doesn't load) go to stderr."""
    write_config(INVENTORY)
    (isolated["work"] / "providers").mkdir()
    (isolated["work"] / "providers" / "broken.py").write_text("raise ValueError('boom')\n")
    s = serve()
    assert s.call("inventory.info")["result"]["host_count"] == 3
    code, out, err = s.close()
    assert code == 0 and out == "" and "broken.py didn't load" in err


def test_an_inventory_that_doesnt_load_is_an_error_not_an_exit(serve, write_config):
    path = write_config("groups:\n  lab:\n    hosts:\n      box: {ip: 10.0.0.5}\n")
    s = serve()
    err = s.call("inventory.info")["error"]
    assert err["code"] == 1
    assert err["message"] == "host 'box' has no user (set it on the host, its group, or defaults)"
    assert err["data"] == {"path": str(path), "roster_version": __version__, "api_version": 1}
    assert s.call("hosts.list")["error"]["code"] == 1
    assert s.call("host.get", {"name": "box"})["error"]["code"] == 1
    assert s.close() == (0, "", "")


def test_no_inventory_at_all(serve):
    err = serve().call("inventory.info")["error"]
    assert err["code"] == 1 and "no roster.yml found" in err["message"] and err["data"]["path"] is None


def test_config_path_from_flag_or_environment(serve, write_config, monkeypatch):
    other = write_config(INVENTORY, name="other.yml")
    assert serve("--config", str(other)).call("inventory.info")["result"]["path"] == str(other)
    monkeypatch.setenv("ROSTER_CONFIG", str(other))
    assert serve().call("inventory.info")["result"]["host_count"] == 3


# ---------------------------------------------------------------- session.prepare (ticket 05)

def synced(write_config, capsys, text=INVENTORY):
    """roster.yml written and `roster sync` run, so this box's ssh config has every Host's alias."""
    write_config(text)
    assert main(["sync"]) == 0
    capsys.readouterr()


def test_session_prepare_for_an_enrolled_host(serve, write_config, capsys):
    """The ssh command the app starts in a PTY: the ssh-config alias `roster setup`/`sync` writes, no secret."""
    synced(write_config, capsys)
    spec = serve().call("session.prepare", {"host": "box"})["result"]
    assert spec == {"argv": [shutil.which("ssh"), "-o", "BatchMode=yes", "box"], "env": {},
                    "host": "box", "auth": "key"}
    assert os.path.isabs(spec["argv"][0])


def test_session_prepare_refuses_an_unreviewed_host_as_roster_run_does(serve, write_config, capsys):
    synced(write_config, capsys)
    with pytest.raises(SystemExit) as run:
        main(["run", "server-10-0-0-9", "--", "uptime"])
    err = serve().call("session.prepare", {"host": "server-10-0-0-9"})["error"]
    assert err == {"code": 10, "message": "server-10-0-0-9 is not reviewed yet (reviewed: false in roster.yml) "
                                          "- not logging in"}
    assert run.value.code == f"error: {err['message']}"


def test_session_prepare_for_a_password_only_host_is_not_supported_yet(serve, write_config, capsys):
    """Password sessions need the askpass channel (ticket 06); until then, a clear refusal."""
    synced(write_config, capsys)
    s = serve()
    err = s.call("session.prepare", {"host": "esx"})["error"]
    assert err["code"] == 12 and "password" in err["message"] and "esx" in err["message"]
    assert s.call("session.prepare", {"host": "nope"})["error"] == {"code": 2, "message": "unknown host 'nope'"}
    assert s.call("session.prepare", {})["error"]["code"] == -32602
    assert s.close()[0] == 0


def test_session_prepare_needs_this_boxs_ssh_config(serve, write_config, capsys, isolated):
    """No falling back to user@ip: without roster's ssh config there's no key, known_hosts or port for ssh."""
    write_config(INVENTORY)                                     # `roster setup` / `sync` never ran here
    err = serve().call("session.prepare", {"host": "box"})["error"]
    assert err["code"] == 11 and "roster sync" in err["message"] and "roster setup" in err["message"]

    synced(write_config, capsys)
    write_config(INVENTORY.replace("      esx:", "      box2: {ip: 10.0.0.7}\n      esx:"))   # added since sync
    s = serve()
    assert s.call("session.prepare", {"host": "box2"})["error"]["code"] == 11
    assert s.call("session.prepare", {"host": "box"})["result"]["argv"][-1] == "box"

    (isolated["home"] / ".ssh" / "config").write_text("Host *\n    ServerAliveInterval 5\n")  # Include removed
    assert serve().call("session.prepare", {"host": "box"})["error"]["code"] == 11


def test_session_prepare_without_an_ssh_client(serve, write_config, capsys, isolated, monkeypatch):
    synced(write_config, capsys)
    monkeypatch.setenv("PATH", str(isolated["work"]))           # serve itself starts from sys.executable
    err = serve().call("session.prepare", {"host": "box"})["error"]
    assert err == {"code": 11, "message": "no ssh client on this box's PATH - install OpenSSH (openssh-client)"}
