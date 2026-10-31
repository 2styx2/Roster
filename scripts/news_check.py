#!/usr/bin/env python3
"""The news reminder (ticket 47), like Neovim's news.yml: a pull request whose title or commits
say it's a user-visible change (`feat`, `perf`, or a breaking `!:`) should add a line to
docs/news.md (or a row to docs/deprecated.md). It's a reminder, not a rule: the `skip-news` label
silences it.

    news_check.py --title TITLE --labels "a,b" --commits FILE --files FILE

FILE holds one commit subject (or one changed path) per line. Exits 1, with the reminder, when a
news entry is missing; 0 otherwise.
"""
from __future__ import annotations

import argparse
import re
import sys

NEWS_FILES = ("docs/news.md", "docs/deprecated.md")
SKIP_LABEL = "skip-news"
# `feat: …`, `feat(picker): …`, `perf!: …`, and any `type!:` / `type(scope)!:` (breaking).
VISIBLE = re.compile(r"^\s*(?:(?:feat|perf)(?:\([^)]*\))?!?:|\w+(?:\([^)]*\))?!:)", re.IGNORECASE)


def needs_news(title: str, commits: list[str], files: list[str], labels: list[str]) -> str | None:
    """The line that makes it user-visible, or None when no news entry is needed."""
    if SKIP_LABEL in labels or any(f.strip() in NEWS_FILES for f in files):
        return None
    for line in [title, *commits]:
        if VISIBLE.match(line):
            return line.strip()
    return None


def reminder(why: str) -> str:
    return (
        f"Reminder, not a rule: \"{why}\" looks like a user-visible change, and docs/news.md is unchanged.\n"
        "Add a bullet under `## Unreleased` in docs/news.md (CONTRIBUTING.md, \"Docs\"), or a row in\n"
        f"docs/deprecated.md for a deprecation. If it needs no news, add the `{SKIP_LABEL}` label."
    )


def _lines(path: str | None) -> list[str]:
    if not path:
        return []
    with open(path, encoding="utf-8") as f:
        return [line.rstrip("\n") for line in f if line.strip()]


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--title", default="")
    p.add_argument("--labels", default="", help="comma-separated")
    p.add_argument("--commits", help="a file with one commit subject per line")
    p.add_argument("--files", help="a file with one changed path per line")
    a = p.parse_args(argv)
    why = needs_news(a.title, _lines(a.commits), _lines(a.files), [x.strip() for x in a.labels.split(",") if x.strip()])
    if why is None:
        print("news: nothing to remind")
        return 0
    print(reminder(why), file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
