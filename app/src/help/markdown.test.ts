import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./markdown";

describe("parseMarkdown (the guides' Markdown, as help blocks)", () => {
  it("reads headings, paragraphs and inline code, bold and links", () => {
    const blocks = parseMarkdown("# The Config\n\nOne **Lua** file,\n`init.lua`. See [keys](keyboard.md#two-modes).\n\n## How it works\n");
    expect(blocks).toEqual([
      { t: "h", level: 1, anchor: "the-config", text: [{ t: "text", text: "The Config" }] },
      {
        t: "p",
        text: [
          { t: "text", text: "One " },
          { t: "strong", children: [{ t: "text", text: "Lua" }] },
          { t: "text", text: " file, " },
          { t: "code", text: "init.lua" },
          { t: "text", text: ". See " },
          { t: "link", href: "keyboard.md#two-modes", children: [{ t: "text", text: "keys" }] },
          { t: "text", text: "." },
        ],
      },
      { t: "h", level: 2, anchor: "how-it-works", text: [{ t: "text", text: "How it works" }] },
    ]);
  });

  it("reads tables, with escaped pipes inside cells", () => {
    const [table] = parseMarkdown("| Option | Default |\n|---|---|\n| `theme` | `\"a\"\\|\"b\"` |\n");
    expect(table).toEqual({
      t: "table",
      head: [[{ t: "text", text: "Option" }], [{ t: "text", text: "Default" }]],
      rows: [[[{ t: "code", text: "theme" }], [{ t: "code", text: '"a"|"b"' }]]],
    });
  });

  it("reads lists (items may run on to the next line), fenced code and quotes", () => {
    const blocks = parseMarkdown("- one\n  more\n- **two**\n\n1. first\n2. second\n\n```lua\nreturn {}\n```\n\n> A note.\n");
    expect(blocks).toEqual([
      {
        t: "list",
        ordered: false,
        items: [[{ t: "text", text: "one more" }], [{ t: "strong", children: [{ t: "text", text: "two" }] }]],
      },
      { t: "list", ordered: true, items: [[{ t: "text", text: "first" }], [{ t: "text", text: "second" }]] },
      { t: "pre", lang: "lua", text: "return {}" },
      { t: "quote", text: [{ t: "text", text: "A note." }] },
    ]);
  });

  it("keeps an asterisk that isn't emphasis, and reads *em*", () => {
    expect(parseMarkdown("a * b and *this*")).toEqual([
      { t: "p", text: [{ t: "text", text: "a * b and " }, { t: "em", children: [{ t: "text", text: "this" }] }] },
    ]);
  });

  it("gives repeated headings their own anchors", () => {
    const anchors = parseMarkdown("## Keys\n\n### Keys\n").map((b) => (b.t === "h" ? b.anchor : null));
    expect(anchors).toEqual(["keys", "keys-2"]);
  });
  it("reads a line that starts with a pipe but isn't a table as text, and moves on", () => {
    expect(parseMarkdown("| not a table\nnext line\n")).toEqual([
      { t: "p", text: [{ t: "text", text: "| not a table next line" }] },
    ]);
    expect(parseMarkdown("Some words\n  | wrapped on\n\n|\n")).toEqual([
      { t: "p", text: [{ t: "text", text: "Some words | wrapped on" }] },
      { t: "p", text: [{ t: "text", text: "|" }] },
    ]);
  });

  it("ends a table at a row that isn't one, and reads a table that follows a paragraph", () => {
    const blocks = parseMarkdown("Intro\n| A |\n|---|\n| 1 |\nafter\n");
    expect(blocks).toEqual([
      { t: "p", text: [{ t: "text", text: "Intro" }] },
      { t: "table", head: [[{ t: "text", text: "A" }]], rows: [[[{ t: "text", text: "1" }]]] },
      { t: "p", text: [{ t: "text", text: "after" }] },
    ]);
  });
});
