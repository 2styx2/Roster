"""Ticket 10 through `roster serve`, as the app drives it: inventory.pull, host.verify_login, host.update,
changes.diff and changes.discard, against a scratch infra repo (a clone of a bare repo in the test's temp dir).
The Host for test logins is a local paramiko server; the vault is the stand-in bw. No network."""

import logging
import socket
import subprocess
import threading
from pathlib import Path

import paramiko
import pytest
from conftest import ALL_SECRETS, SECRET

logging.getLogger("paramiko").setLevel(logging.CRITICAL)

INVENTORY = """\
# The lab. NO PASSWORDS IN THIS FILE.
groups:
  lab:
    user: root
    enroll: false
    hosts:
      esx:                  # the ESXi box
        ip: 127.0.0.1
        port: {port}
        auth: bw:esx ssh
        title: ESX
      keyed: {{ip: 127.0.0.1, port: {port}, enroll: true}}
      other: 10.0.0.9       # never touched
"""


# ---------------------------------------------------------------- a Host that takes one login

class Sshd:
    """An SSH server on 127.0.0.1 that takes root with SECRET (or the given public key) and counts connections
    and login attempts."""

    def __init__(self, pubkey=None):
        self.key = paramiko.ECDSAKey.generate()
        self.pubkey = pubkey
        self.listener = socket.create_server(("127.0.0.1", 0))
        self.port = self.listener.getsockname()[1]
        self.accepts, self.attempts = 0, []
        self.listener.settimeout(0.2)
        self.running = True
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()

    def _loop(self):
        while self.running:
            try:
                conn, _ = self.listener.accept()
            except (TimeoutError, OSError):
                continue
            self.accepts += 1
            threading.Thread(target=self._serve, args=(conn,), daemon=True).start()

    def _serve(self, conn):
        sshd = self

        class Iface(paramiko.ServerInterface):
            def get_allowed_auths(self, username):
                return "password,publickey"

            def check_auth_password(self, username, password):
                sshd.attempts.append(("password", username))
                ok = username == "root" and password == SECRET
                return paramiko.AUTH_SUCCESSFUL if ok else paramiko.AUTH_FAILED

            def check_auth_publickey(self, username, key):
                sshd.attempts.append(("publickey", username))
                ok = sshd.pubkey is not None and key.asbytes() == sshd.pubkey.asbytes() and username == "root"
                return paramiko.AUTH_SUCCESSFUL if ok else paramiko.AUTH_FAILED

        t = paramiko.Transport(conn)
        t.add_server_key(self.key)
        try:
            t.start_server(server=Iface())
            t.join(5)
        except Exception:
            pass
        finally:
            t.close()

    def known_hosts_line(self, port=None):
        return f"[127.0.0.1]:{port or self.port} {self.key.get_name()} {self.key.get_base64()}\n"

    def close(self):
        self.running = False
        self.thread.join()          # an accept() still waiting would take one more connection after close()
        self.listener.close()


# ---------------------------------------------------------------- a scratch infra repo

class Infra(type(Path())):
    """The infra repo's path, with .yml (its roster.yml), .other (a second clone) and .commit(text)."""


def git(cwd, *args):
    r = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


@pytest.fixture
def infra(tmp_path, monkeypatch):
    """A bare 'origin' and this box's clone with roster.yml committed and pushed. .other is a second clone,
    where 'someone else' publishes."""
    for k, v in {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@x", "GIT_COMMITTER_NAME": "t",
                 "GIT_COMMITTER_EMAIL": "t@x", "GIT_CONFIG_NOSYSTEM": "1"}.items():
        monkeypatch.setenv(k, v)
    origin = tmp_path / "origin.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(origin)], check=True)
    repo = Infra(tmp_path / "infra")
    subprocess.run(["git", "clone", "-q", str(origin), str(repo)], check=True, capture_output=True)
    git(repo, "checkout", "-q", "-b", "main")
    (repo / "README.md").write_text("infra\n")
    repo.other = tmp_path / "other"

    def commit(text, where=repo, msg="inventory"):
        (where / "roster.yml").write_text(text)
        git(where, "add", "-A")
        git(where, "commit", "-q", "-m", msg)
        git(where, "push", "-q", "-u", "origin", "main")

    repo.commit = commit
    repo.yml = repo / "roster.yml"
    return repo


@pytest.fixture
def sshd():
    s = Sshd()
    yield s
    s.close()


@pytest.fixture
def box(infra, sshd, vault, isolated):
    """The infra repo with INVENTORY for the local Host, and its host key recorded."""
    infra.commit(INVENTORY.format(port=sshd.port))
    ssh = isolated["home"] / ".ssh"
    ssh.mkdir(exist_ok=True)
    (ssh / "roster_known_hosts").write_text(sshd.known_hosts_line())
    return infra


@pytest.fixture
def app(serve, box):
    """`roster serve -c infra/roster.yml` with the vault unlocked; checks at the end that no secret leaked."""
    s = serve("-c", str(box.yml))
    assert s.call("vault.unlock", {"password": "hunter2"})["result"]["status"] == "unlocked"
    yield s
    _, out, err = s.close()
    assert not [x for x in ALL_SECRETS if x in "".join(s.responses) + out + err]


def result(r):
    assert "error" not in r, r
    return r["result"]


# ---------------------------------------------------------------- host.update, changes.diff, changes.discard

def test_a_text_edit_needs_no_verify_and_keeps_every_other_byte(app, box):
    before = box.yml.read_text()
    r = result(app.call("host.update", {"host": "esx", "changes": {"title": "ESXi 8", "description": "rack 2"}}))
    assert r["changed"] and r["host"]["title"] == "ESXi 8" and r["host"]["description"] == "rack 2"
    after = box.yml.read_text()
    assert after == before.replace("        title: ESX\n", "        title: ESXi 8\n        description: rack 2\n")
    hosts = {h["name"]: h for h in result(app.call("hosts.list"))["hosts"]}      # serve reloaded it
    assert hosts["esx"]["title"] == "ESXi 8"
    assert (box / ".git" / "roster" / "roster.yml.bak").read_text() == before
    assert r["backup"] == str(box / ".git" / "roster" / "roster.yml.bak")
    assert git(box, "status", "--porcelain") == "M roster.yml"          # the backup isn't in the working tree


def test_the_diff_shows_exactly_the_change(app, box):
    assert result(app.call("changes.diff")) == {"path": str(box.yml), "repo": str(box), "diff": "", "hosts": [],
                                               "count": 0}
    result(app.call("host.update", {"host": "esx", "changes": {"title": "ESXi 8"}}))
    d = result(app.call("changes.diff"))
    body = [ln for ln in d["diff"].splitlines() if ln[:1] in "+-" and not ln.startswith(("+++", "---"))]
    assert body == ["-        title: ESX", "+        title: ESXi 8"]
    assert d["hosts"] == [{"host": "esx", "change": "changed", "fields": ["title"]}] and d["count"] == 1


def test_discard_puts_the_file_back_as_it_was(app, box):
    before = box.yml.read_bytes()
    result(app.call("host.update", {"host": "other", "changes": {"type": "switch"}}))
    edited = box.yml.read_text()
    r = result(app.call("changes.discard"))
    assert r["discarded"] and box.yml.read_bytes() == before
    assert (box / ".git" / "roster" / "roster.yml.bak").read_text() == edited       # what was discarded
    assert git(box, "status", "--porcelain") == ""
    assert {h["name"]: h for h in result(app.call("hosts.list"))["hosts"]}["other"]["type"] == ""
    assert result(app.call("changes.discard")) == {"discarded": False, "backup": None}


def test_nothing_to_change_writes_nothing(app, box):
    r = result(app.call("host.update", {"host": "esx", "changes": {"title": "ESX", "user": "root"}}))
    assert r["changed"] is False and git(box, "status", "--porcelain") == ""


def test_an_invalid_result_is_refused_and_nothing_is_written(app, box):
    box.commit(box.yml.read_text().replace("      other: 10.0.0.9", "      other: 10.0.0.9\n      dup: &d {ip: 10.0.0.8}"
                                           "\n      dup2: *d"))
    before = box.yml.read_text()
    err = app.call("host.update", {"host": "dup", "changes": {"title": "x"}})["error"]
    assert err["code"] == 64 and "nothing was written" in err["message"] and err["data"]["fix"]
    assert box.yml.read_text() == before


@pytest.mark.parametrize("changes,why", [({"title": 3}, "string"), ({"name": "x"}, "can't be edited"), ({}, "object"),
                                         ({"port": 70000}, "65535")])
def test_bad_params(app, changes, why):
    err = app.call("host.update", {"host": "esx", "changes": changes})["error"]
    assert err["code"] == -32602 and why in err["message"]


def test_an_unknown_host(app):
    assert app.call("host.update", {"host": "nope", "changes": {"title": "x"}})["error"]["code"] == 2


def test_an_inventory_outside_git_has_no_pending_changes(serve, write_config):
    path = write_config(INVENTORY.format(port=22))
    s = serve("-c", str(path))
    for method, params in (("host.update", {"host": "esx", "changes": {"title": "x"}}), ("changes.diff", {}),
                           ("changes.discard", {}), ("inventory.pull", {})):
        err = s.call(method, params)["error"]
        assert err["code"] == 60 and "isn't in a git repo" in err["message"], method
    assert "title: ESX\n" in path.read_text()


# ---------------------------------------------------------------- verified changes (decision Q43)

def test_a_new_user_or_login_needs_a_test_login_first(app, box, sshd):
    err = app.call("host.update", {"host": "esx", "changes": {"auth": "bw:dup ssh"}})["error"]
    assert err["code"] == 65 and err["data"]["fix"]
    assert git(box, "status", "--porcelain") == ""


def test_a_verified_change_goes_through_once(app, box, sshd):
    # The vault item is renamed: the test login with the new reference succeeds, so the edit is allowed.
    changes = {"auth": "bw:esx ssh", "title": "x"}       # same Login: no verify needed
    assert result(app.call("host.update", {"host": "esx", "changes": changes}))["changed"]
    result(app.call("changes.discard"))

    changes = {"user": "root", "auth": "bw:aaaa-1111"}   # the same item by its id
    v = result(app.call("host.verify_login", {"host": "esx", "changes": changes}))
    assert v["ok"], v
    assert [s["step"] for s in v["steps"]] == ["user", "provider", "vault-item", "dns", "tcp", "host-key", "auth"]
    assert sshd.accepts == 1 and sshd.attempts == [("password", "root")]
    r = result(app.call("host.update", {"host": "esx", "changes": changes}))
    assert r["changed"] and r["host"]["ssh"]["auth"] == "bw:aaaa-1111"
    result(app.call("changes.discard"))
    assert app.call("host.update", {"host": "esx", "changes": changes})["error"]["code"] == 65   # used up


def test_a_refused_login_fails_the_auth_step_and_allows_nothing(app, box, sshd):
    changes = {"user": "admin"}
    v = result(app.call("host.verify_login", {"host": "esx", "changes": changes}))
    assert not v["ok"]
    auth = v["steps"][-1]
    assert auth["step"] == "auth" and auth["status"] == "fail" and auth["code"] == 45 and "admin" in auth["message"]
    assert sshd.accepts == 1 and sshd.attempts == [("password", "admin")]          # exactly one attempt
    assert app.call("host.update", {"host": "esx", "changes": changes})["error"]["code"] == 65


def test_a_host_that_moved_port_is_compared_with_the_key_recorded_for_it(app, box, sshd, isolated):
    # Recorded only for the old port: the Host moved, its key didn't.
    old = box.yml.read_text()
    box.commit(old.replace(f"port: {sshd.port}\n        auth", "port: 2222\n        auth"))
    (isolated["home"] / ".ssh" / "roster_known_hosts").write_text(sshd.known_hosts_line(port=2222))
    v = result(app.call("host.verify_login", {"host": "esx", "changes": {"port": sshd.port}}))
    assert v["ok"], v


def test_a_different_host_key_is_never_accepted(app, box, sshd, isolated):
    other = paramiko.ECDSAKey.generate()
    (isolated["home"] / ".ssh" / "roster_known_hosts").write_text(
        f"[127.0.0.1]:{sshd.port} {other.get_name()} {other.get_base64()}\n")
    v = result(app.call("host.verify_login", {"host": "esx", "changes": {"user": "root2"}}))
    key = next(s for s in v["steps"] if s["step"] == "host-key")
    assert key["status"] == "fail" and key["code"] == 43 and v["steps"][-1]["status"] == "skipped"
    assert sshd.attempts == []                                          # no login over an unknown key
    assert (isolated["home"] / ".ssh" / "roster_known_hosts").read_text().count("\n") == 1


def test_no_recorded_key_at_all(app, box, sshd, isolated):
    (isolated["home"] / ".ssh" / "roster_known_hosts").write_text("")
    v = result(app.call("host.verify_login", {"host": "esx", "changes": {"user": "x"}}))
    assert [s.get("code") for s in v["steps"] if s["status"] == "fail"] == [44] and sshd.accepts == 1


def test_a_missing_vault_item_fails_before_the_network(app, box, sshd):
    v = result(app.call("host.verify_login", {"host": "esx", "changes": {"auth": "bw:esx shh"}}))
    fail = next(s for s in v["steps"] if s["status"] == "fail")
    assert fail["step"] == "vault-item" and fail["code"] == 32 and sshd.accepts == 0


def test_an_unreachable_address(app, box, sshd):
    port = socket.create_server(("127.0.0.1", 0))
    closed = port.getsockname()[1]
    port.close()
    v = result(app.call("host.verify_login", {"host": "esx", "changes": {"port": closed}}))
    assert next(s for s in v["steps"] if s["status"] == "fail")["code"] == 41


def test_a_key_host_logs_in_with_this_boxs_key(serve, box, sshd, isolated, monkeypatch):
    key = paramiko.ECDSAKey.generate()
    path = isolated["home"] / "roster_key"
    key.write_private_key_file(str(path))
    sshd.pubkey = key
    box.commit(box.yml.read_text().replace("# The lab.", f"key_path: {path}\n# The lab."))
    s = serve("-c", str(box.yml))
    v = result(s.call("host.verify_login", {"host": "keyed", "changes": {"title": "x", "user": "root"}}))
    assert v["ok"] and sshd.attempts == [("publickey", "root")], v
    v = result(s.call("host.verify_login", {"host": "keyed", "changes": {"user": "nobody"}}))
    assert v["steps"][-1]["code"] == 46


# ---------------------------------------------------------------- inventory.pull

def test_pull_fast_forwards_and_serve_reloads(app, box):
    subprocess.run(["git", "clone", "-q", str(box.parent / "origin.git"), str(box.other)], check=True)
    box.commit((box.other / "roster.yml").read_text().replace("title: ESX", "title: From elsewhere"), where=box.other)
    r = result(app.call("inventory.pull"))
    assert r["updated"] and r["commits"] == 1 and r["upstream"] == "origin/main" and r["ahead"] == 0
    assert {h["name"]: h for h in result(app.call("hosts.list"))["hosts"]}["esx"]["title"] == "From elsewhere"
    assert result(app.call("inventory.pull"))["updated"] is False


def test_pull_refuses_pending_changes(app, box):
    result(app.call("host.update", {"host": "esx", "changes": {"title": "mine"}}))
    err = app.call("inventory.pull")["error"]
    assert err["code"] == 61 and "Pending changes" in err["message"] and err["data"]["files"] == ["roster.yml"]


def test_pull_refuses_other_uncommitted_files(app, box):
    (box / "README.md").write_text("changed\n")
    err = app.call("inventory.pull")["error"]
    assert err["code"] == 61 and "README.md" in err["message"] and "git -C" in err["data"]["fix"]


def test_pull_refuses_a_diverged_branch(app, box):
    subprocess.run(["git", "clone", "-q", str(box.parent / "origin.git"), str(box.other)], check=True)
    box.commit((box.other / "roster.yml").read_text() + "# theirs\n", where=box.other)
    (box / "README.md").write_text("mine\n")
    git(box, "commit", "-qam", "local")
    err = app.call("inventory.pull")["error"]
    assert err["code"] == 62 and "diverged" in err["message"] and err["data"]["ahead"] == 1
    assert err["data"]["behind"] == 1 and "pull --rebase" in err["data"]["fix"]
    assert git(box, "log", "-1", "--format=%s") == "local"


def test_pull_without_an_upstream_has_nothing_to_do(app, box):
    git(box, "branch", "--unset-upstream")
    assert result(app.call("inventory.pull")) == {"updated": False, "upstream": None, "commits": 0, "ahead": 0,
                                                 "message": "this branch has no upstream, so there's nothing to pull"}


def test_pull_when_the_remote_is_gone(app, box):
    git(box, "remote", "set-url", "origin", str(box.parent / "missing.git"))
    err = app.call("inventory.pull")["error"]
    assert err["code"] == 63 and "couldn't fetch origin/main" in err["message"] and err["data"]["fix"]
