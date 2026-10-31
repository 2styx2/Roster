"""scripts/check-links.py, the weekly check of the docs' external links (ticket 53, decision Q85). Only its
parts that need no network run here: which links it finds, and what it reports. The fetching itself runs in
.github/workflows/links.yml, never on a pull request."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("check_links", ROOT / "scripts" / "check-links.py")
cl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cl)


def test_it_checks_the_docs_the_relative_link_check_does():
    from test_docs import DOCS
    assert sorted(cl.docs(ROOT)) == sorted(DOCS)


def test_it_finds_web_links_outside_code_and_skips_made_up_and_private_ones():
    text = """See [uv](https://docs.astral.sh/uv/) and <https://wezterm.org/ssh.html>, or https://remmina.org/faq/.
`https://in.code.example.org/x` and [esx](https://10.0.0.5) and http://localhost:8080 and
https://vault.example.com and [a](https://esx-02.lan/) and [rel](cli-reference.md)
```
https://fenced.example.net/
```
Twice: [uv again](https://docs.astral.sh/uv/).
"""
    assert cl.urls(text) == ["https://docs.astral.sh/uv/", "https://wezterm.org/ssh.html", "https://remmina.org/faq/"]


def test_a_link_is_dead_only_when_the_site_says_so_or_cant_be_reached():
    assert cl.verdict(404) == "HTTP 404"
    assert cl.verdict(410) == "HTTP 410"
    assert cl.verdict(503) == "HTTP 503"
    assert cl.verdict("timed out") == "timed out"
    for alive in (200, 204, 301, 403, 429, 999):     # 403/429/999: the site turns robots away, not a dead link
        assert cl.verdict(alive) is None


def test_the_report_names_each_dead_link_and_where_it_is(tmp_path):
    (tmp_path / "docs").mkdir()
    (tmp_path / "README.md").write_text("[a](https://a.org/gone) [b](https://b.org/ok)\n")
    (tmp_path / "docs" / "x.md").write_text("[a](https://a.org/gone)\n")
    statuses = {"https://a.org/gone": 404, "https://b.org/ok": 200}
    dead = cl.check(tmp_path, fetch=lambda url: statuses[url])
    assert dead == {"https://a.org/gone": ("HTTP 404", ["README.md", "docs/x.md"])}
    report = cl.report(dead, run_url="https://github.com/o/r/actions/runs/1")
    assert "| https://a.org/gone | HTTP 404 | `README.md`, `docs/x.md` |" in report
    assert "https://b.org/ok" not in report
    assert "actions/runs/1" in report


def test_a_flaky_link_gets_a_second_try():
    answers = iter(["timed out", 200])
    assert cl.status("https://a.org/", fetch=lambda url: next(answers)) is None
