"""`roster serve` answers requests concurrently (ticket 101, decision Q112): a quick read answers while a slow
Publish runs, writes to roster.yml never interleave, the vault's lock waits for whoever holds a secret, and a lock
not free in time is code 4 with nothing done. The Publish pushes to a bare repo in the test's temp dir whose hook
takes a few seconds; nothing connects anywhere."""
import json
import subprocess
import threading
import time

import pytest
from conftest import posix_shell

from roster import serve as rpc

INVENTORY = """\
defaults:
  user: admin
groups:
  lab:
    hosts:
      esx-02: 10.0.0.12
      nas-1: 10.0.0.30
"""
SLOW_PUSH = 3               # s the upstream's hook takes to accept a push


def git(cwd, *args):
    r = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


@pytest.fixture
def infra(tmp_path, monkeypatch):
    """roster.yml committed in a clone of a bare 'origin' whose pre-receive hook sleeps SLOW_PUSH s, with a
    Pending change (new-1) waiting to be published."""
    for k, v in {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@x", "GIT_COMMITTER_NAME": "t",
                 "GIT_COMMITTER_EMAIL": "t@x", "GIT_CONFIG_NOSYSTEM": "1"}.items():
        monkeypatch.setenv(k, v)
    origin = tmp_path / "origin.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(origin)], check=True)
    repo = tmp_path / "infra"
    subprocess.run(["git", "clone", "-q", str(origin), str(repo)], check=True, capture_output=True)
    git(repo, "checkout", "-q", "-b", "main")
    (repo / "roster.yml").write_text(INVENTORY)
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "inventory")
    git(repo, "push", "-q", "-u", "origin", "main")
    hook = origin / "hooks" / "pre-receive"
    hook.write_text(f"#!/bin/sh\ncat >/dev/null\nsleep {SLOW_PUSH}\n")
    hook.chmod(0o755)
    (repo / "roster.yml").write_text(INVENTORY + "      new-1: 10.0.0.40\n")
    return repo


@posix_shell              # the upstream's hook is a sh script
def test_a_quick_read_answers_while_a_slow_publish_runs(serve, infra):
    s = serve("-c", str(infra / "roster.yml"))
    s.call("inventory.info")
    publish = s.request("changes.publish", {"message": "Add new-1"})
    time.sleep(0.5)                                                     # it's pushing now
    t = time.monotonic()
    hosts = s.call("hosts.list")["result"]["hosts"]
    took = time.monotonic() - t
    assert took < 1, f"hosts.list took {took:.2f} s behind a Publish"
    assert [h["name"] for h in hosts] == ["esx-02", "nas-1", "new-1"]
    assert s.call("mesh.status")["result"]["members"] is not None        # another quick read
    r = s.answer(publish)["result"]
    assert r["commit"] and r["sync"]["ok"] is True
    assert s.order.index(publish) > s.order.index(publish + 1)          # answered after the read it came before


@posix_shell              # the upstream's hook is a sh script
def test_a_write_waits_for_the_publish_so_the_commit_holds_exactly_what_was_written(serve, infra):
    s = serve("-c", str(infra / "roster.yml"))
    publish = s.request("changes.publish", {"message": "Add new-1"})
    time.sleep(0.5)
    rename = s.request("host.rename", {"host": "nas-1", "to": "nas-2"})
    assert s.answer(rename)["result"]["host"]["name"] == "nas-2"
    assert s.order.index(publish) < s.order.index(rename)               # it waited for roster.yml
    assert "commit" in s.answer(publish)["result"]
    pushed = git(infra, "show", "origin/main:roster.yml")
    assert "new-1" in pushed and "nas-1" in pushed and "nas-2" not in pushed
    diff = s.call("changes.diff")["result"]
    assert sorted((h["host"], h["change"]) for h in diff["hosts"]) == [("nas-1", "removed"), ("nas-2", "added")]


def test_two_writes_at_once_both_land_one_after_the_other(serve, infra):
    s = serve("-c", str(infra / "roster.yml"))
    a = s.request("host.rename", {"host": "nas-1", "to": "nas-2"})
    b = s.request("host.rename", {"host": "esx-02", "to": "esx-03"})
    assert "result" in s.answer(a) and "result" in s.answer(b)
    names = [h["name"] for h in s.call("hosts.list")["result"]["hosts"]]
    assert sorted(names) == ["esx-03", "nas-2", "new-1"]
    assert s.call("inventory.reload")["result"]["error"] is None


# ---------------------------------------------------------------- in process: the locks

@pytest.fixture
def state(write_config):
    return rpc.State(str(write_config(INVENTORY)))


def call(state, method, params=None):
    return rpc.respond(state, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}})


def holding(lock, method, seconds, shared=False):
    """Hold LOCK as METHOD would, on a thread of its own, for SECONDS. Returns once it holds it."""
    held = threading.Event()

    def run():
        lock.acquire(shared, None, method)
        held.set()
        time.sleep(seconds)
        lock.release()
    threading.Thread(target=run, daemon=True).start()
    held.wait(5)


def test_a_write_that_cant_get_roster_yml_in_time_is_busy_and_does_nothing(state, monkeypatch, write_config):
    monkeypatch.setattr(rpc, "LOCK_WAIT", 0.3)
    before = state.path.read_text()
    holding(state.lock, "changes.publish", 2)
    err = call(state, "host.remove", {"host": "nas-1"})["error"]
    assert err["code"] == 4 and err["message"] == "roster.yml is busy: changes.publish is still running - nothing was done"
    assert err["data"] == {"busy": "roster.yml", "method": "changes.publish", "fix": "try again once it has finished"}
    assert state.path.read_text() == before


def test_vault_lock_waits_for_whoever_holds_a_secret(state, monkeypatch):
    monkeypatch.setattr(rpc, "LOCK_WAIT", 0.3)
    holding(state.vault, "session.prepare", 1, shared=True)
    err = call(state, "vault.lock")["error"]
    assert err["code"] == 4 and "the vault is busy: session.prepare is still running" in err["message"]
    monkeypatch.setattr(rpc, "LOCK_WAIT", 5)
    holding(state.vault, "session.prepare", 0.5, shared=True)
    t = time.monotonic()
    assert "result" in call(state, "vault.lock")
    assert time.monotonic() - t >= 0.3                                  # it waited until the lookup was done


def test_secret_lookups_share_the_vault(state, monkeypatch):
    monkeypatch.setattr(rpc, "LOCK_WAIT", 0.3)
    holding(state.vault, "host.check", 2, shared=True)
    assert state.vault.acquire(True, 0.1, "session.prepare")              # another reader goes ahead
    state.vault.release()


def test_host_get_settled_waits_for_a_write_under_way(state):
    holding(state.lock, "host.add", 0.6)
    t = time.monotonic()
    assert call(state, "host.get", {"name": "nas-1"})["result"]["name"] == "nas-1"
    assert time.monotonic() - t < 0.3                                   # a plain read doesn't wait
    assert call(state, "host.get", {"name": "nas-1", "settled": True})["result"]["name"] == "nas-1"
    assert time.monotonic() - t >= 0.5
    assert call(state, "host.get", {"name": "nas-1", "settled": "yes"})["error"]["code"] == -32602


def test_the_quick_reads_are_the_ones_that_take_no_lock():
    assert not set(rpc.QUICK) & set(rpc.LOCKS)
    assert set(rpc.QUICK) <= set(rpc.METHODS)
    assert set(rpc.LOCKS) <= set(rpc.METHODS)
    assert rpc.quick({"method": "host.get", "params": {"name": "x"}})
    assert not rpc.quick({"method": "host.get", "params": {"name": "x", "settled": True}})


def test_the_server_answers_a_quick_read_while_every_worker_is_busy(state, monkeypatch):
    gate = threading.Event()
    monkeypatch.setitem(rpc.METHODS, "test.slow", lambda state, params: gate.wait(5) and {"slow": True})
    out = []
    server = rpc.Server(state, out.append, workers=2, quick_workers=1)
    for i in range(3):
        server.submit(json.dumps({"jsonrpc": "2.0", "id": i, "method": "test.slow"}))
    server.submit(json.dumps({"jsonrpc": "2.0", "id": 9, "method": "hosts.list"}))
    end = time.monotonic() + 5
    while not out and time.monotonic() < end:
        time.sleep(0.01)
    assert [r["id"] for r in out] == [9]
    gate.set()
    assert server.drain(5)
    assert sorted(r["id"] for r in out) == [0, 1, 2, 9]


@posix_shell              # the upstream's hook is a sh script
def test_serve_exits_well_within_the_apps_grace_with_a_slow_request_under_way(serve, infra):
    s = serve("-c", str(infra / "roster.yml"))
    s.request("changes.publish", {"message": "Add new-1"})
    time.sleep(0.5)                                                     # pushing, for 3 s
    t = time.monotonic()
    code, _, _ = s.close()
    assert code == 0 and time.monotonic() - t < 2.5                     # the app kills it after 3 s (rpc.rs)
