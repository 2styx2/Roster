"""The news reminder (ticket 47): fires on a user-visible PR without a news entry, not otherwise."""
from __future__ import annotations

import importlib.util
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("news_check", ROOT / "scripts" / "news_check.py")
assert _spec and _spec.loader
news_check = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(news_check)


def test_a_feat_pr_without_news_is_reminded():
    assert news_check.needs_news("feat(picker): fuzzy match on address", [], ["app/src/picker/match.ts"], []) is not None
    assert news_check.needs_news("Picker: fuzzy match", ["perf: hidden terminals stop redrawing"], [], []) is not None
    assert news_check.needs_news("refactor!: drop the old flag", [], [], []) is not None
    assert news_check.needs_news("fix(cli)!: rename --only", [], [], []) is not None


def test_news_or_deprecated_or_the_label_silences_it():
    title = "feat: :help news"
    assert news_check.needs_news(title, [], ["docs/news.md"], []) is None
    assert news_check.needs_news(title, [], ["docs/deprecated.md"], []) is None
    assert news_check.needs_news(title, [], [], ["skip-news"]) is None


def test_other_changes_need_no_news():
    assert news_check.needs_news("fix: a typo", ["docs: one line", "chore: bump"], [], []) is None
    assert news_check.needs_news("featured docs", ["feature flags explained"], [], []) is None


def test_main_exits_1_with_the_reminder(tmp_path, capsys):
    commits = tmp_path / "commits"
    commits.write_text("feat: :lookup\n")
    files = tmp_path / "files"
    files.write_text("app/src/App.tsx\n")
    assert news_check.main(["--title", "T52", "--commits", str(commits), "--files", str(files)]) == 1
    assert "skip-news" in capsys.readouterr().err
    assert news_check.main(["--title", "T52", "--labels", "skip-news,docs", "--commits", str(commits), "--files", str(files)]) == 0
