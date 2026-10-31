"""A Release's notes start with its section of docs/news.md (ticket 47)."""
from __future__ import annotations

import importlib.util
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("news_section", ROOT / "scripts" / "news_section.py")
assert _spec and _spec.loader
news_section = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(news_section)

NEWS = """# What's new

## Unreleased

### New

- Something later.

## v0.2.0

### New

**App**

- [Getting started](app/start.md#new-to-roster) and the [Quick reference](quickref), see [x](https://example.com).

## v0.1.0

- The first.
"""


def test_a_versions_section_with_links_that_work_on_github():
    body = news_section.section(NEWS, "0.2.0")
    assert body is not None
    assert body.startswith("### New") and "Something later" not in body and "The first" not in body
    out = news_section.for_github(body, "0.2.0", "you/roster")
    assert "[Getting started](https://github.com/you/roster/blob/v0.2.0/docs/app/start.md#new-to-roster)" in out
    assert "the Quick reference," in out
    assert "[x](https://example.com)" in out


def test_no_section_for_the_version_fails(tmp_path, capsys):
    news = tmp_path / "news.md"
    news.write_text(NEWS)
    assert news_section.main(["0.3.0", "--news", str(news)]) == 1
    assert news_section.main(["0.1.0", "--news", str(news)]) == 0
    assert capsys.readouterr().out == "- The first.\n"


def test_every_release_in_the_real_news_has_its_section():
    news = (ROOT / "docs" / "news.md").read_text()
    assert news_section.section(news, "0.1.0") is not None
