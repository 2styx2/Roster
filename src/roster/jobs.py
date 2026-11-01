"""serve's job manager (ticket 101, decision Q112): the one place that owns background work, a Mesh run or a Discover
scan. Each job has a kind (`mesh`, `discover`) and an id within it, an action, a state, progress (`done` of `total`,
`at`), a result or an error, and a stop. One job of a kind runs at a time. Every change of state, and its progress a
few times a second, goes out as the `job.progress` notification (NOTIFY). Closing stops every running job at once and
waits a moment for them all to wind down, so serve's exit records what they did (a Mesh job writes mesh.json).

    m = Jobs(notify)
    job = m.start("mesh", "apply", work, total=12)      # work(job) runs on a thread of its own; Busy if one runs
    job.progress(3, 12, "orion-2")                      # from work
    job.halted.is_set()                                 # work's cue to stop (stop() or close())
    m.stop("mesh", job.job); m.close(0.8)
"""

import threading
import time

PUSH_EVERY = 0.2            # s: progress goes out at most this often per job (a state change always does)
INTERNAL_ERROR = -32603


class Busy(Exception):
    """A job of that kind is running: JOB."""

    def __init__(self, job):
        super().__init__(f"{job.kind} {job.job} is running")
        self.job = job


class Closed(Exception):
    """serve is closing: nothing new starts."""


class Failed(Exception):
    """Raised by a job's work: it failed with CODE and MESSAGE (and DATA), as an error response would say."""

    def __init__(self, code, message, data=None):
        super().__init__(message)
        self.code, self.message, self.data = code, message, data


def error_of(e):
    """An exception as an error response's `{code, message, data?}`: a roster Problem or Failed keeps its code."""
    if isinstance(e, SystemExit):
        return {"code": 3, "message": (str(e.code) if e.code is not None else "exited").removeprefix("error: ")}
    code, message = getattr(e, "code", None), getattr(e, "message", None)
    if isinstance(code, int) and isinstance(message, str):
        data = getattr(e, "data", None)
        return {"code": code, "message": message, **({"data": data} if data is not None else {})}
    return {"code": INTERNAL_ERROR, "message": f"{type(e).__name__}: {e}"}


class Job:
    """One piece of background work. Its work reports progress() and watches `halted`."""

    def __init__(self, owner, kind, job, action, total, host, on_stop, on_close=None):
        self.owner, self.kind, self.job, self.action, self.host = owner, kind, job, action, host
        self.done, self.total, self.at = 0, total, None
        self.state = "running"
        self.result, self.error = None, None
        self.halted = threading.Event()
        self.on_stop, self.on_close = on_stop, on_close   # on_close: also run when serve closes (end it now)
        self.lock = threading.Lock()
        self.thread = None
        self.pushed = 0.0
        self.push_lock = threading.Lock()
        self.later = None                       # the Timer that sends progress held back by PUSH_EVERY

    def progress(self, done, total=None, at=None):
        """WORK says how far it has got: DONE of TOTAL, at AT (a Host's name, or None)."""
        with self.lock:
            self.done, self.at = done, at
            if total is not None:
                self.total = total
            now = time.monotonic()
            push = now - self.pushed >= PUSH_EVERY
            if push:
                self.pushed = now
            elif self.later is None:            # too soon: the latest goes out once PUSH_EVERY is up
                self.later = threading.Timer(PUSH_EVERY - (now - self.pushed), self.catch_up)
                self.later.daemon = True
                self.later.start()
        if push:
            self.owner.push(self)

    def catch_up(self):
        with self.lock:
            self.later = None
            if not self.running():
                return                          # its end went out already
            self.pushed = time.monotonic()
        self.owner.push(self)

    def running(self):
        return self.state in ("running", "stopping")

    def view(self):
        """What `job.progress` and `jobs.list` say about it: never the result (a Mesh plan can be megabytes)."""
        with self.lock:
            out = {"kind": self.kind, "job": self.job, "action": self.action, "state": self.state,
                   "done": self.done, "total": self.total, "at": self.at}
            if self.host is not None:
                out["host"] = self.host
            if self.error is not None:
                out["error"] = self.error
            return out

    def wait(self, timeout=None):
        """Wait for it to end: True if it has."""
        if self.thread is not None:
            self.thread.join(timeout)
        return not self.running()

    def stop(self):
        """Ask it to stop: True if it was running."""
        with self.lock:
            if self.state != "running":
                return False
            self.state = "stopping"
        self.owner.push(self)                   # before its work can see the stop and end
        self.halted.set()
        if self.on_stop is not None:
            try:
                self.on_stop()
            except Exception as e:              # a stop that fails doesn't stop the others
                self.owner.log(f"stopping {self.kind} {self.job} failed: {type(e).__name__}: {e}")
        return True

    def run(self, work):
        try:
            result = work(self)
        except BaseException as e:              # noqa: BLE001 - a job's failure is its state, never serve's
            with self.lock:
                self.error, self.state, self.at = error_of(e), "failed", None
        else:
            with self.lock:
                self.result, self.at = result, None
                if not self.halted.is_set():
                    self.done = self.total
                self.state = "stopped" if self.halted.is_set() else "done"
        self.owner.push(self)


class Jobs:
    """Every job serve runs, the latest of each kind kept once it's over."""

    def __init__(self, notify=None, log=None):
        self.notify, self.log = notify, log or (lambda line: None)
        self.lock = threading.Lock()
        self.latest_of = {}                     # kind -> its latest Job
        self.counts = {}                        # kind -> how many started
        self.closing = False

    def push(self, job):
        if self.notify is not None:
            with job.push_lock:                 # what it says and when it's sent in one go: never a stale view last
                self.notify("job.progress", job.view())

    def start(self, kind, action, work, total=0, job=None, host=None, on_stop=None, on_close=None):
        """Start WORK(job) on a thread of its own and return the Job at once. Busy if a job of KIND runs; Closed
        once serve is closing. JOB is its id (the next number of its kind if left out)."""
        with self.lock:
            if self.closing:
                raise Closed("roster serve is closing")
            running = self.latest_of.get(kind)
            if running is not None and running.running():
                raise Busy(running)
            self.counts[kind] = self.counts.get(kind, 0) + 1
            new = Job(self, kind, job if job is not None else self.counts[kind], action, total, host, on_stop, on_close)
            new.thread = threading.Thread(target=new.run, args=(work,), name=f"job-{kind}-{new.job}", daemon=True)
            self.latest_of[kind] = new
        self.push(new)
        new.thread.start()
        return new

    def latest(self, kind):
        return self.latest_of.get(kind)

    def get(self, kind, job):
        j = self.latest_of.get(kind)
        return j if j is not None and j.job == job else None

    def list(self):
        with self.lock:
            return [j.view() for _, j in sorted(self.latest_of.items())]

    def stop(self, kind, job):
        j = self.get(kind, job)
        return j is not None and j.stop()

    def close(self, wait):
        """serve is closing: stop every running job at once, wait up to WAIT s for them all, and log each."""
        with self.lock:
            self.closing = True
            running = [j for j in self.latest_of.values() if j.running()]
        for j in running:
            j.stop()
            if j.on_close is not None:
                try:
                    j.on_close()
                except Exception as e:
                    self.log(f"closing {j.kind} {j.job} failed: {type(e).__name__}: {e}")
        end = time.monotonic() + wait
        for j in running:
            j.wait(max(0.0, end - time.monotonic()))
            v = j.view()
            self.log(f"closing: {j.kind} {j.job} ({j.action}) {v['state']} at {v['done']} of {v['total']}")
