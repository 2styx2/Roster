"""Cancelling a request (ticket 108, decision Q112 (p)): `$/cancel {id}` stops a request that hasn't done anything
yet (queued behind busy workers, or waiting for a lock) and a running check or waiting Mesh run (their job stops at its
next step); it never stops what writes roster.yml or the vault once it has started, nor vault.lock or vault.logout.
And an unlock is never overtaken by the vault.status asked after it (Q112 (r)). Every interleaving here is forced with
events; nothing sleeps to make it happen."""
import json
import threading
import time

import pytest

from roster import serve as rpc

INVENTORY = """\
defaults:
  user: admin
groups:
  lab:
    hosts:
      esx-02: 10.0.0.12
"""


@pytest.fixture
def state(write_config):
    return rpc.State(str(write_config(INVENTORY)))


class Out(list):
    """What the Server sent, with a way to wait for an answer."""

    def __init__(self):
        super().__init__()
        self.cond = threading.Condition()

    def __call__(self, message):
        with self.cond:
            self.append(message)
            self.cond.notify_all()

    def answer(self, rid, seconds=5):
        with self.cond:
            assert self.cond.wait_for(lambda: any(m.get("id") == rid for m in self), seconds), f"no answer to {rid}"
            return next(m for m in self if m.get("id") == rid)

    def answered(self, rid):
        with self.cond:
            return any(m.get("id") == rid for m in self)


def req(rid, method, params=None):
    return json.dumps({"jsonrpc": "2.0", "id": rid, "method": method, "params": params or {}})


def cancel(server, rid, cid=None):
    """$/cancel as a request (with an id) so the test sees what it did; the core sends it as a notification."""
    server.submit(json.dumps({"jsonrpc": "2.0", "id": cid or f"c{rid}", "method": "$/cancel", "params": {"id": rid}}))


def blocker(monkeypatch, name="test.slow"):
    """A method that runs until the returned Event is set, and says when it has started."""
    started, go = threading.Event(), threading.Event()

    def slow(state, params):
        started.set()
        go.wait(10)
        return {"slow": True}
    monkeypatch.setitem(rpc.METHODS, name, slow)
    return started, go


def test_a_queued_request_cancelled_never_runs(state, monkeypatch):
    started, go = blocker(monkeypatch)
    ran = []
    monkeypatch.setitem(rpc.METHODS, "test.write", lambda st, params: ran.append(1) or {})
    out = Out()
    server = rpc.Server(state, out, workers=1, quick_workers=1)
    server.submit(req(1, "test.slow"))
    started.wait(5)
    server.submit(req(2, "test.write"))                             # queued behind the busy worker
    cancel(server, 2)
    assert out.answer("c2")["result"] == {"id": 2, "cancelled": True, "was": "queued"}   # answered at once
    go.set()
    err = out.answer(2)["error"]
    assert err["code"] == 5 and err["message"] == "test.write was cancelled before it did anything"
    assert server.drain(5)
    assert ran == []


def test_cancel_is_answered_while_every_worker_and_quick_lane_is_busy(state, monkeypatch):
    started, go = blocker(monkeypatch)
    out = Out()
    server = rpc.Server(state, out, workers=1, quick_workers=1)
    server.submit(req(1, "test.slow"))
    started.wait(5)
    cancel(server, 1)
    assert out.answer("c1")["result"] == {"id": 1, "cancelled": False, "was": "running"}
    go.set()
    assert out.answer(1)["result"] == {"slow": True}               # a write that started runs to its end


def test_a_request_waiting_for_a_lock_gives_up_at_once_when_cancelled(state, monkeypatch):
    held = threading.Event()
    release = threading.Event()

    def hold():
        state.lock.acquire(False, None, "changes.publish")
        held.set()
        release.wait(10)
        state.lock.release()
    threading.Thread(target=hold, daemon=True).start()
    held.wait(5)
    before = state.path.read_text()
    out = Out()
    server = rpc.Server(state, out)
    server.submit(req(1, "host.remove", {"host": "esx-02"}))
    end = time.monotonic() + 5
    while state.lock.writers_waiting == 0:                          # it's waiting for roster.yml
        assert time.monotonic() < end
        time.sleep(0.005)
    cancel(server, 1)
    assert out.answer("c1")["result"] == {"id": 1, "cancelled": True, "was": "waiting"}
    assert out.answer(1)["error"]["code"] == 5                      # not at LOCK_WAIT's 50 s
    release.set()
    assert server.drain(5)
    assert state.path.read_text() == before                         # nothing was done


@pytest.mark.parametrize("method", ["vault.lock", "vault.logout"])
def test_locking_is_never_cancelled(state, monkeypatch, method):
    started, go = blocker(monkeypatch)
    ran = []
    monkeypatch.setitem(rpc.METHODS, method, lambda st, params: ran.append(1) or {"locked": []})
    out = Out()
    server = rpc.Server(state, out, workers=1, quick_workers=1)
    server.submit(req(1, "test.slow"))
    started.wait(5)
    server.submit(req(2, method))
    cancel(server, 2)
    assert out.answer("c2")["result"] == {"id": 2, "cancelled": False, "was": "queued"}
    go.set()
    assert "result" in out.answer(2) and ran == [1]                 # Lock always succeeds (Q112 (k))


def test_cancelling_what_isnt_there_says_so(state):
    out = Out()
    server = rpc.Server(state, out)
    cancel(server, 77)
    assert out.answer("c77")["result"] == {"id": 77, "cancelled": False, "was": None}
    server.submit(json.dumps({"jsonrpc": "2.0", "id": "c", "method": "$/cancel", "params": {}}))
    assert out.answer("c")["error"]["code"] == -32602


def test_cancel_as_a_notification_gets_no_answer(state, monkeypatch):
    started, go = blocker(monkeypatch)
    out = Out()
    server = rpc.Server(state, out, workers=1, quick_workers=1)
    server.submit(req(1, "test.slow"))
    started.wait(5)
    server.submit(req(2, "inventory.reload"))
    server.submit(json.dumps({"jsonrpc": "2.0", "method": "$/cancel", "params": {"id": 2}}))
    go.set()
    assert out.answer(2)["error"]["code"] == 5
    assert server.drain(5)
    assert [m["id"] for m in out] == [1, 2]                          # nothing for the notification


def test_a_running_waiting_mesh_run_stops_its_job_when_cancelled(state, monkeypatch):
    stopped = []
    monkeypatch.setitem(rpc.METHODS, "test.waits", lambda st, params: waits(st))
    started, go = threading.Event(), threading.Event()

    def waits(st):
        rpc.on_cancel(lambda: stopped.append(1) or go.set())
        started.set()
        go.wait(10)
        return {"stopped": bool(stopped)}
    monkeypatch.setattr(rpc, "CANCEL_RUNNING", rpc.CANCEL_RUNNING | {"test.waits"})
    out = Out()
    server = rpc.Server(state, out)
    server.submit(req(1, "test.waits"))
    started.wait(5)
    cancel(server, 1)
    assert out.answer("c1")["result"] == {"id": 1, "cancelled": True, "was": "running"}
    assert out.answer(1)["result"] == {"stopped": True}


def test_the_running_cancellable_methods_are_the_waiting_forms_of_jobs():
    assert rpc.CANCEL_RUNNING == {"host.check", "mesh.plan", "mesh.apply", "mesh.cut"}
    assert not rpc.CANCEL_RUNNING & {m for m, claims in rpc.LOCKS.items() if claims}


# ---------------------------------------------------------------- the unlock and vault.status (Q112 (r))

def test_an_unlock_is_never_queued_behind_busy_workers(state, monkeypatch):
    started, go = blocker(monkeypatch)
    unlocked = threading.Event()
    monkeypatch.setitem(rpc.METHODS, "vault.unlock", lambda st, params: unlocked.set() or {"status": "unlocked"})
    out = Out()
    server = rpc.Server(state, out, workers=1, quick_workers=1)
    server.submit(req(1, "test.slow"))
    started.wait(5)
    server.submit(req(2, "vault.unlock", {"password": "hunter2"}))
    assert out.answer(2)["result"] == {"status": "unlocked"}       # its own lane: not after test.slow
    go.set()
    assert server.drain(5)


def test_vault_status_waits_for_an_unlock_asked_before_it(state, monkeypatch):
    entered, go = threading.Event(), threading.Event()
    seen = []

    def unlock(st, params):
        entered.set()
        go.wait(10)
        st.unlocked.add("bw")
        return {"status": "unlocked"}
    monkeypatch.setitem(rpc.METHODS, "vault.unlock", unlock)
    monkeypatch.setitem(rpc.METHODS, "vault.status", lambda st, params: seen.append(set(st.unlocked)) or {})
    # the unlock's lane hasn't picked it up yet: the status check must still see it coming
    lane_go = threading.Event()
    real_run = rpc.Server.run

    def run(self, record):
        if record.method == "vault.unlock":
            lane_go.wait(10)
        return real_run(self, record)
    monkeypatch.setattr(rpc.Server, "run", run)
    out = Out()
    server = rpc.Server(state, out)
    server.submit(req(1, "vault.unlock", {"password": "hunter2"}))
    server.submit(req(2, "vault.status"))
    lane_go.set()
    entered.wait(5)
    assert not out.answered(2)                                      # waiting for the unlock, not before it
    go.set()
    out.answer(1)
    out.answer(2)
    assert seen == [{"bw"}]


def test_vault_status_doesnt_wait_for_a_cancelled_unlock(state, monkeypatch):
    lane_go = threading.Event()
    real_run = rpc.Server.run

    def run(self, record):
        if record.method == "vault.unlock":
            lane_go.wait(10)
        return real_run(self, record)
    monkeypatch.setattr(rpc.Server, "run", run)
    ran = []
    monkeypatch.setitem(rpc.METHODS, "vault.unlock", lambda st, params: ran.append(1) or {})
    monkeypatch.setitem(rpc.METHODS, "vault.status", lambda st, params: {"status": "locked"})
    out = Out()
    server = rpc.Server(state, out)
    server.submit(req(1, "vault.unlock", {"password": "hunter2"}))
    cancel(server, 1)                                               # the app gave up on it
    server.submit(req(2, "vault.status"))
    assert out.answer(2)["result"] == {"status": "locked"}
    lane_go.set()
    assert out.answer(1)["error"]["code"] == 5
    assert ran == []


# ---------------------------------------------------------------- host.check as a job (Q112 (q))

@pytest.fixture
def held_check(monkeypatch):
    """diagnose.check_host stands in: it takes its first step, then waits for `go` (or its stop) before the rest."""
    from roster import diagnose
    calls, stepped, go = [], threading.Event(), threading.Event()

    def check_host(name, inventory, channel=None, progress=None, halted=None):
        calls.append(name)
        progress and progress(1, len(diagnose.STEPS), "inventory")
        stepped.set()
        while not go.is_set() and not (halted and halted.is_set()):
            go.wait(0.01)
        stopped = bool(halted and halted.is_set())
        return {"host": name, "ok": not stopped, "steps": []}
    monkeypatch.setattr(diagnose, "check_host", check_host)
    return type("Held", (), {"calls": calls, "stepped": stepped, "go": go})


def test_a_background_check_frees_its_worker_and_holds_the_vault_for_its_job(state, held_check):
    out = Out()
    server = rpc.Server(state, out, workers=1, quick_workers=1)
    server.submit(req(1, "host.check", {"host": "esx-02", "background": True}))
    started = out.answer(1)["result"]
    assert started["kind"] == "check" and started["state"] == "running" and started["host"] == "esx-02"
    held_check.stepped.wait(5)
    assert state.vault.readers == 1                                 # the job shares the vault, the worker doesn't
    server.submit(req(2, "inventory.reload"))                       # the one worker is free for it
    assert "result" in out.answer(2)
    held_check.go.set()
    job = state.jobs.get("check", started["job"])
    assert job.wait(5) and state.vault.readers == 0
    r = rpc.respond(state, {"jsonrpc": "2.0", "id": 3, "method": "host.check_job", "params": {"job": job.job}})
    assert r["result"]["state"] == "done" and r["result"]["result"] == {"host": "esx-02", "ok": True, "steps": []}


def test_one_check_per_host_at_a_time(state, held_check):
    call = lambda rid, params: rpc.respond(state, {"jsonrpc": "2.0", "id": rid, "method": "host.check",  # noqa: E731
                                                   "params": params})
    first = call(1, {"host": "esx-02", "background": True})["result"]
    held_check.stepped.wait(5)
    again = call(2, {"host": "esx-02", "background": True})["result"]
    assert again["job"] == first["job"]                             # the same job, not a second check
    other = call(3, {"host": "nas-1", "background": True})["result"]
    assert other["job"] != first["job"]                             # another Host checks at once
    held_check.go.set()
    for j in (first, other):
        assert state.jobs.get("check", j["job"]).wait(5)
    assert sorted(held_check.calls) == ["esx-02", "nas-1"]


def test_the_waiting_form_cancelled_stops_its_check(state, held_check):
    out = Out()
    server = rpc.Server(state, out)
    server.submit(req(1, "host.check", {"host": "esx-02"}))
    held_check.stepped.wait(5)
    cancel(server, 1)
    assert out.answer("c1")["result"] == {"id": 1, "cancelled": True, "was": "running"}
    assert out.answer(1)["result"]["ok"] is False                   # stopped at its next step


def test_vault_lock_stops_a_running_check_rather_than_wait_for_it(state, held_check):
    rpc.respond(state, {"jsonrpc": "2.0", "id": 1, "method": "host.check", "params": {"host": "esx-02",
                                                                                     "background": True}})
    held_check.stepped.wait(5)
    locked = []
    t = threading.Thread(target=lambda: locked.append(rpc.respond(state, {"jsonrpc": "2.0", "id": 2,
                                                                          "method": "vault.lock"})), daemon=True)
    t.start()
    t.join(5)                                                       # never go.set(): the lock ended it
    assert locked and "result" in locked[0]
    assert state.jobs.latest("check", "esx-02").view()["state"] == "stopped"
