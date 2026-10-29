"""`roster serve`: JSON-RPC 2.0 over stdin/stdout, driven as the desktop app drives it - a subprocess."""

import json
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
        self.responses = []             # every line serve wrote to stdout, as read

    def send(self, line):
        self.p.stdin.write(line + "\n")
        self.p.stdin.flush()
        self.responses.append(self.p.stdout.readline())
        return json.loads(self.responses[-1])

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


# ---- vault.status / vault.unlock / vault.lock (the lock screen)

def test_vault_status_names_the_inventorys_vault(serve, write_config, fakes):
    """bw is what the Host Logins use; env and prompt (the unreviewed group's default) can't be locked."""
    write_config(INVENTORY)
    assert serve().call("vault.status")["result"] == {
        "provider": "bw", "status": "locked",
        "providers": [{"provider": "bw", "status": "locked"}, {"provider": "env", "status": "unsupported"},
                      {"provider": "prompt", "status": "unsupported"}]}


def test_vault_unlock_wrong_then_right_password_never_echoes_either(serve, write_config, fakes):
    write_config(INVENTORY)
    s = serve()
    err = s.call("vault.unlock", {"password": "not-it-xyzzy"})["error"]
    assert err == {"code": 10, "message": "Bitwarden unlock failed (wrong master password?)"}
    assert s.call("vault.status")["result"]["status"] == "locked"
    assert s.call("vault.unlock", {"password": "hunter2"})["result"] == {"provider": "bw", "status": "unlocked"}
    assert s.call("vault.status")["result"]["status"] == "unlocked"
    assert s.call("vault.unlock", {})["error"]["code"] == -32602
    code, out, err = s.close()
    assert code == 0 and out == "" and err == ""
    transcript = json.dumps(s.responses) + out + err
    for secret in ("xyzzy", "hunter2", "fake-session-key"):
        assert secret not in transcript


def test_vault_not_logged_in_or_not_installed_says_what_to_do(serve, write_config, fakes, monkeypatch, tmp_path):
    write_config(INVENTORY)
    monkeypatch.setenv("FAKE_BW_LOGGED_OUT", "1")
    s = serve()
    logged_out = "Bitwarden CLI isn't logged in on this box - run `bw login` once"
    status = s.call("vault.status")["result"]
    assert (status["provider"], status["status"], status["message"]) == ("bw", "not-logged-in", logged_out)
    assert s.call("vault.unlock", {"password": "hunter2"})["error"] == {"code": 11, "message": logged_out}
    s.close()

    monkeypatch.setenv("PATH", str(tmp_path))                    # no bw anywhere
    s = serve()
    status = s.call("vault.status")["result"]
    assert status["status"] == "missing-cli" and status["message"].startswith("`bw` is not installed on this box")
    err = s.call("vault.unlock", {"password": "hunter2"})["error"]
    assert err["code"] == 12 and err["message"] == status["message"]
    assert s.call("vault.lock")["result"] == {"locked": ["bw"]}  # nothing to run, still forgets
    code, out, err = s.close()
    assert code == 0 and "hunter2" not in "".join(s.responses) + out + err


def test_vault_unlock_of_a_provider_without_master_password(serve, write_config, fakes):
    write_config(INVENTORY)
    s = serve()
    err = s.call("vault.unlock", {"password": "x", "provider": "env"})["error"]
    assert err == {"code": 13, "message": "provider 'env' can't be unlocked with a master password"}
    assert s.call("vault.unlock", {"password": "x", "provider": "keeper"})["error"]["code"] == -32602
    write_config("groups:\n  lab:\n    user: ops\n    auth: env:PW\n    hosts:\n      box: {ip: 10.0.0.5}\n")
    s = serve()
    assert s.call("vault.status")["result"] == {"provider": None, "status": "unsupported",
                                                "providers": [{"provider": "env", "status": "unsupported"}]}
    assert s.call("vault.unlock", {"password": "x"})["error"]["code"] == 13


def bw_session_file(isolated, key="fake-session-key"):
    f = isolated["home"] / ".config" / "roster" / "bw-session"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(key + "\n")
    f.chmod(0o600)


def test_only_vault_unlock_unlocks_and_vault_lock_locks(serve, write_config, fakes, isolated, monkeypatch, tmp_path):
    """BW_PASSWORD and a valid bw-session file would unlock the CLI by themselves; serve ignores both."""
    write_config(INVENTORY)
    bw_session_file(isolated)
    monkeypatch.setenv("BW_PASSWORD", "hunter2")
    log = tmp_path / "calls.log"
    monkeypatch.setenv("FAKE_LOG", str(log))
    s = serve()
    assert s.call("vault.status")["result"]["status"] == "locked"
    assert s.call("vault.unlock", {"password": "hunter2"})["result"]["status"] == "unlocked"
    assert s.call("vault.lock")["result"] == {"locked": ["bw"]}
    assert "bw lock" in log.read_text().splitlines()
    assert s.call("vault.status")["result"]["status"] == "locked"
    code, out, err = s.close()
    assert code == 0 and out == "" and err == ""
    for secret in ("hunter2", "fake-session-key"):
        assert secret not in "".join(s.responses)


def test_a_lookup_after_vault_lock_reports_locked(write_config, fakes, isolated, monkeypatch):
    """In-process, so a secret lookup (what session.prepare and askpass do) can follow the calls."""
    from roster import providers, serve
    write_config(INVENTORY)
    bw_session_file(isolated)
    monkeypatch.setenv("BW_PASSWORD", "hunter2")
    state = serve.State(None)

    def call(method, params=None):
        return serve.handle(state, json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}))

    with pytest.raises(providers.VaultLocked, match="locked"):
        providers.get_secret("bw:Network gear", "lab")              # neither BW_PASSWORD nor the file unlocked it
    assert call("vault.unlock", {"password": "hunter2"})["result"]["status"] == "unlocked"
    assert providers.get_secret("bw:Network gear", "lab") == "pw-netops"
    assert call("vault.lock")["result"] == {"locked": ["bw"]}
    with pytest.raises(providers.VaultLocked, match="locked"):
        providers.get_secret("bw:Network gear", "lab")              # the cached value went too
