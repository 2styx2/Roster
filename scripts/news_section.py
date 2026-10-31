#!/usr/bin/env python3
"""One version's section of docs/news.md, as a Release's notes (ticket 47).

    news_section.py 0.2.0 [--repo OWNER/NAME]

Prints the `## v0.2.0` section's body as Markdown for GitHub: a link to another doc becomes a link
to that file at the tag (`app/start.md` → https://github.com/OWNER/NAME/blob/v0.2.0/docs/app/start.md),
and a link to a help topic (`[Quick reference](quickref)`) keeps only its text. Exits 1 when
news.md has no section for that version.
"""
from __future__ import annotations

import argparse
import pathlib
import posixpath
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
LINK = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")


def section(news: str, version: str) -> str | None:
    """The body under `## vVERSION` (or `## VERSION`), up to the next `## `; None if there's none."""
    lines = news.splitlines()
    heads = [i for i, line in enumerate(lines) if line.startswith("## ")]
    for n, i in enumerate(heads):
        if lines[i][3:].strip().lstrip("v") == version:
            end = heads[n + 1] if n + 1 < len(heads) else len(lines)
            return "\n".join(lines[i + 1 : end]).strip() + "\n"
    return None


def for_github(body: str, version: str, repo: str) -> str:
    """Links made to work outside help and the repo: files at the tag, topics as their text."""

    def fix(m: re.Match[str]) -> str:
        text, href = m.group(1), m.group(2)
        if re.match(r"^[a-z]+://", href):
            return m.group(0)
        path, _, anchor = href.partition("#")
        if path.endswith(".md") or "/" in path:
            url = f"https://github.com/{repo}/blob/v{version}/{posixpath.normpath(posixpath.join('docs', path))}"
            return f"[{text}]({url}{'#' + anchor if anchor else ''})"
        return text

    return LINK.sub(fix, body)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("version", help="MAJOR.MINOR.PATCH, no v")
    p.add_argument("--repo", default="2styx2/roster")
    p.add_argument("--news", default=str(ROOT / "docs" / "news.md"))
    a = p.parse_args(argv)
    body = section(pathlib.Path(a.news).read_text(encoding="utf-8"), a.version)
    if body is None:
        print(f"news_section: docs/news.md has no '## v{a.version}' section", file=sys.stderr)
        return 1
    sys.stdout.write(for_github(body, a.version, a.repo))
    return 0


if __name__ == "__main__":
    sys.exit(main())
