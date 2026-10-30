"""Pending changes (ticket 10): roster.yml's uncommitted diff in the infra repo's git working tree.
inventory.pull fast-forwards the repo before an edit; changes.diff shows the diff and which Hosts it touches;
changes.discard puts roster.yml back as the last commit has it. Publish (commit and push) is ticket 12.
Every git run is non-interactive and time-limited. A backup of what an edit or a discard replaced goes in the
repo's git dir (never in the working tree, where Publish would pick it up)."""

import os
import subprocess
from pathlib import Path

from .edit import load_text, read_text, write_text
from .errors import DIRTY, DIVERGED, NOT_A_REPO, PULL_FAILED, ROSTER_ERROR, Problem

GIT_TIMEOUT = 60            # s: a fetch over a slow link; nothing here waits on a person
HOST_VIEW = ("group", "ip", "title", "description", "type", "product", "enroll", "reviewed", "mac", "web",
             "services")


def git(repo, *args, timeout=GIT_TIMEOUT):
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "LC_ALL": "C", "GIT_OPTIONAL_LOCKS": "0"}
    env.setdefault("GIT_SSH_COMMAND", "ssh -o BatchMode=yes")
    try:
        return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, timeout=timeout,
                              env=env, stdin=subprocess.DEVNULL)
    except FileNotFoundError:
        raise Problem(NOT_A_REPO, "git isn't installed on this box, so roster can't keep Pending changes",
                      fix="install git") from None
    except subprocess.TimeoutExpired:
        raise Problem(PULL_FAILED, f"git {args[0]} didn't finish within {timeout} s",
                      fix="check the network and your access to the infra repo, then try again") from None


def out(repo, *args):
    r = git(repo, *args)
    return r.stdout.strip() if r.returncode == 0 else None


class Repo:
    """The git working tree roster.yml is in, and roster.yml's path inside it."""

    def __init__(self, path):
        self.path = Path(path).resolve()
        top = out(self.path.parent, "rev-parse", "--show-toplevel")
        if top is None:
            raise Problem(NOT_A_REPO, f"{self.path} isn't in a git repo, so it can't have Pending changes",
                          {"path": str(self.path)},
                          fix="keep roster.yml in the infra repo (a git clone), or edit it by hand")
        self.top = Path(top).resolve()
        self.rel = self.path.relative_to(self.top).as_posix()
        self.git_dir = Path(out(self.top, "rev-parse", "--absolute-git-dir"))
        if git(self.top, "ls-files", "--error-unmatch", "--", self.rel).returncode != 0:
            raise Problem(NOT_A_REPO, f"{self.rel} isn't committed in {self.top} yet, so it can't have Pending "
                                      "changes", {"path": str(self.path)},
                          fix=f"commit it once in a terminal: git -C {self.top} add {self.rel} && git commit")

    def head_text(self):
        r = git(self.top, "show", f"HEAD:{self.rel}")
        return r.stdout if r.returncode == 0 else None

    def backup(self, text):
        """Keep TEXT (what's about to be replaced) as roster.yml.bak in the git dir; returns its path."""
        d = self.git_dir / "roster"
        d.mkdir(exist_ok=True)
        bak = d / (self.path.name + ".bak")
        write_text(bak, text)
        return bak

    def diff_text(self):
        r = git(self.top, "diff", "--no-color", "--no-ext-diff", "HEAD", "--", self.rel)
        return r.stdout if r.returncode == 0 else ""


# ---------------------------------------------------------------- inventory.pull

def dirty_files(repo):
    r = git(repo.top, "status", "--porcelain", "--untracked-files=no")
    return [ln[3:] for ln in r.stdout.splitlines() if ln.strip()]


def pull(path):
    """Fast-forward the infra repo to its upstream. Refuses a working tree with uncommitted changes and a branch
    that has diverged; never merges, rebases or stashes."""
    repo = Repo(path)
    files = dirty_files(repo)
    if files:
        if files == [repo.rel]:
            raise Problem(DIRTY, f"{repo.rel} has Pending changes, so roster won't pull over them",
                          {"files": files}, fix="Publish or discard the Pending changes first")
        raise Problem(DIRTY, f"the infra repo has uncommitted changes ({', '.join(files)}), so roster won't pull",
                      {"files": files}, fix=f"commit, stash or undo them in a terminal (git -C {repo.top} status)")
    upstream = out(repo.top, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
    if upstream is None:
        return {"updated": False, "upstream": None, "commits": 0, "ahead": 0,
                "message": "this branch has no upstream, so there's nothing to pull"}
    remote = upstream.split("/", 1)[0]
    r = git(repo.top, "fetch", "--quiet", remote)
    if r.returncode != 0:
        raise Problem(PULL_FAILED, f"couldn't fetch {upstream} for the infra repo", {"upstream": upstream},
                      fix=f"check the network and your access to the repo; `git -C {repo.top} fetch` shows the same",
                      details=r.stderr.strip() or None)
    behind = int(out(repo.top, "rev-list", "--count", "HEAD..@{u}") or 0)
    ahead = int(out(repo.top, "rev-list", "--count", "@{u}..HEAD") or 0)
    if behind and ahead:
        raise Problem(DIVERGED, f"this box's infra repo and {upstream} have diverged ({ahead} local and {behind} "
                                f"new commits there), so roster won't pull", {"upstream": upstream, "ahead": ahead,
                                                                                "behind": behind},
                      fix=f"merge or rebase in a terminal: git -C {repo.top} pull --rebase")
    before = out(repo.top, "rev-parse", "HEAD")
    if behind:
        r = git(repo.top, "merge", "--ff-only", "--quiet", "@{u}")
        if r.returncode != 0:
            raise Problem(PULL_FAILED, f"couldn't fast-forward the infra repo to {upstream}", {"upstream": upstream},
                          fix=f"see the details; `git -C {repo.top} pull --ff-only` shows the same",
                          details=r.stderr.strip() or None)
    return {"updated": bool(behind), "upstream": upstream, "commits": behind, "ahead": ahead,
            "from": before, "to": out(repo.top, "rev-parse", "HEAD")}


# ---------------------------------------------------------------- changes.diff / changes.discard

def host_view(h):
    return {**{k: h.get(k) for k in HOST_VIEW}, "user": h["ssh"]["user"], "port": h["ssh"]["port"],
            "auth": h["ssh"]["auth"]}


def loaded(path, text):
    """load_config of TEXT as if it were PATH, or None if it doesn't load."""
    try:
        return load_text(path, text)
    except Problem:
        return None


def host_changes(path, old_text, new_text):
    """[{host, change: added|removed|changed, fields}] between two versions of roster.yml (empty if either
    doesn't load)."""
    old, new = loaded(path, old_text), loaded(path, new_text)
    if old is None or new is None:
        return []
    out_ = []
    for name, h in new["hosts"].items():
        if name not in old["hosts"]:
            out_.append({"host": name, "change": "added", "fields": []})
            continue
        a, b = host_view(old["hosts"][name]), host_view(h)
        fields = [k for k in b if a[k] != b[k]]
        if fields:
            out_.append({"host": name, "change": "changed", "fields": fields})
    out_ += [{"host": n, "change": "removed", "fields": []} for n in old["hosts"] if n not in new["hosts"]]
    return out_


def group_changes(path, old_text, new_text):
    """[{group, change: added|removed}] between two versions of roster.yml (empty if either doesn't load)."""
    old, new = loaded(path, old_text), loaded(path, new_text)
    if old is None or new is None:
        return []
    return [{"group": g, "change": "added"} for g in new["groups"] if g not in old["groups"]] + \
        [{"group": g, "change": "removed"} for g in old["groups"] if g not in new["groups"]]


def diff(path):
    """roster.yml's Pending changes: the unified diff against the last commit, and the Hosts and groups it changes.
    count is the number of changed Hosts and groups (1 for a change that touches neither, such as a comment)."""
    repo = Repo(path)
    text = repo.diff_text()
    if not text:
        return {"path": str(repo.path), "repo": str(repo.top), "diff": "", "hosts": [], "groups": [], "count": 0}
    head, now = repo.head_text() or "", read_text(repo.path)
    hosts = host_changes(repo.path, head, now)
    groups = group_changes(repo.path, head, now)
    return {"path": str(repo.path), "repo": str(repo.top), "diff": text, "hosts": hosts, "groups": groups,
            "count": len(hosts) + len(groups) or 1}


def discard(path):
    """Put roster.yml back as the last commit has it (index and working tree). What it held is kept as the backup."""
    repo = Repo(path)
    if not repo.diff_text():
        return {"discarded": False, "backup": None}
    bak = repo.backup(read_text(repo.path))
    r = git(repo.top, "checkout", "HEAD", "--", repo.rel)
    if r.returncode != 0:
        raise Problem(ROSTER_ERROR, f"couldn't put {repo.rel} back as committed", fix="see the details",
                      details=r.stderr.strip() or None)
    return {"discarded": True, "backup": str(bak)}
