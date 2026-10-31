"""docs/serve-api.md's method tables are generated from serve's handlers' docstrings (ticket 51, decision
Q85), like Neovim's gen_vimdoc: scripts/gen-serve-api.py rewrites the regions between the
`<!-- BEGIN generated:methods ... -->` markers, and this test fails when the committed doc isn't what it
writes."""
import importlib.util
from pathlib import Path

import pytest

from roster import serve

ROOT = Path(__file__).resolve().parent.parent
DOC = ROOT / "docs" / "serve-api.md"
_spec = importlib.util.spec_from_file_location("gen_serve_api", ROOT / "scripts" / "gen-serve-api.py")
gen = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gen)


def handler(doc):
    def fn(state, params):
        return {}
    fn.__doc__ = doc
    return fn


PING = handler("""Answer at once.

    Params: none
    Result: `{pong: true}`, then a long
        sentence run on
    Errors: 2, 40-42
    Since: API 3
    """)


def test_committed_doc_is_what_the_generator_writes():
    assert DOC.read_text(encoding="utf-8") == gen.render(DOC.read_text(encoding="utf-8"), serve.METHODS), \
        "docs/serve-api.md's method tables are out of date: run  uv run python scripts/gen-serve-api.py"


def test_a_region_becomes_the_table_of_its_methods_and_prose_stays():
    doc = ("Intro.\n\n<!-- BEGIN generated:methods test.ping -->\nstale\n<!-- END generated:methods -->\n\n"
           "After, by hand.\n")
    assert gen.render(doc, {"test.ping": PING}) == (
        "Intro.\n\n<!-- BEGIN generated:methods test.ping -->\n\n"
        "| Method | Params | Result | Errors | Since API |\n"
        "|---|---|---|---|---|\n"
        "| `test.ping` | none | `{pong: true}`, then a long sentence run on | `2`, `40`-`42` | 3 |\n\n"
        "<!-- END generated:methods -->\n\nAfter, by hand.\n")


def test_each_params_line_is_a_row_of_its_own_and_pipes_are_escaped():
    two = handler("""Two forms.

    Params: `{host}`
    Result: `{recorded: none|match}`
    Since: API 11
    Params: `{address}`
    Result: the same
    Errors: 40
    Since: API 6
    """)
    out = gen.render("<!-- BEGIN generated:methods a.b -->\n<!-- END generated:methods -->\n", {"a.b": two})
    assert "| `a.b` | `{host}` | `{recorded: none\\|match}` |  | 11 |\n| `a.b` | `{address}` | the same | `40` | 6 |\n" in out


def test_a_method_in_no_table_says_how_to_fix_it():
    with pytest.raises(gen.DocError) as e:
        gen.render("no tables\n", {"mesh.list": PING})
    assert "mesh.list" in str(e.value) and "<!-- BEGIN generated:methods" in str(e.value)


def test_a_table_naming_an_unknown_method_is_refused():
    with pytest.raises(gen.DocError, match="gone.away"):
        gen.render("<!-- BEGIN generated:methods gone.away -->\n<!-- END generated:methods -->\n", {})


@pytest.mark.parametrize("doc, says", [
    (None, "no docstring"),
    ("Words only.", "Params:"),
    ("x\n\nParams: none\nResult: r\n", "Since:"),
    ("x\n\nParams: none\nResult: r\nSince: API 999\n", "999"),
    ("x\n\nParams: none\nResult: r\nErrors: 9999\nSince: API 1\n", "9999"),
])
def test_a_docstring_without_its_fields_is_refused(doc, says):
    with pytest.raises(gen.DocError, match=says):
        gen.render("<!-- BEGIN generated:methods a.b -->\n<!-- END generated:methods -->\n", {"a.b": handler(doc)})
