// The stylesheets keep `--faint` out of text (decision Q53, ticket 29 M1 option B): `faint` fails
// 4.5:1 in every Theme, so it's only for decorative icons and rules. A rule that sets `color`
// (or a placeholder's colour) to `--faint` must be one that draws only an icon; those are listed
// here by selector, so a new text rule can't slip in.
import { describe, expect, it } from "vitest";
import signinCss from "./lock/signin.css?raw";
import stylesCss from "./styles.css?raw";

const SHEETS: [string, string][] = [
  ["src/styles.css", stylesCss],
  ["src/lock/signin.css", signinCss],
];

/** Selectors whose element holds only an icon (an SVG drawn in `currentColor`), never text. */
const ICON_ONLY = new Set([".sb-icon", ".picker-search-icon"]);

/** Every innermost rule of a stylesheet as [selector, declarations, the at-rules around it],
 * nesting flattened. */
function rules(css: string): [string, string, string[]][] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: [string, string, string[]][] = [];
  const stack: { selector: string; body: string }[] = [];
  let buf = "";
  for (const ch of text) {
    if (ch === "{") {
      stack.push({ selector: buf.trim(), body: "" });
      buf = "";
    } else if (ch === "}") {
      const top = stack.pop();
      if (!top) continue;
      const body = top.body + buf;
      const at = stack.map((s) => s.selector).filter((s) => s.startsWith("@"));
      if (!top.selector.startsWith("@")) out.push([top.selector, body, at]);
      buf = "";
    } else if (ch === ";" && stack.length) {
      const top = stack.at(-1);
      if (top) top.body += buf + ";";
      buf = "";
    } else {
      buf += ch;
    }
  }
  return out;
}

/** The selectors (each of a list) whose rule colours text with `--faint`. */
function faintText(css: string): string[] {
  return rules(css)
    .filter(([, body]) => /(^|;)\s*color\s*:\s*var\(--faint\)/.test(body))
    .flatMap(([selector]) => selector.split(",").map((s) => s.trim().replace(/\s+/g, " ")))
    .filter((s) => !ICON_ONLY.has(s));
}

describe("the stylesheets", () => {
  it("finds rules inside @media and nested blocks", () => {
    const css = "a { color: red; } @media (x) { .b { color: var(--faint); } } .c { x: 1; @starting-style { y: 2; } }";
    expect(rules(css).map(([s, , at]) => [s, at])).toEqual([
      ["a", []],
      [".b", ["@media (x)"]],
      [".c", []],
    ]);
  });

  it("catches a text rule that uses --faint, and lets an icon rule through", () => {
    expect(faintText(".hint { color: var(--faint); } .sb-icon { color: var(--faint); }")).toEqual([".hint"]);
    expect(faintText(".line { border-top: 1px solid var(--faint); }")).toEqual([]);
  });

  it.each(SHEETS)("%s never colours text with --faint", (_name, css) => {
    // vite.config.ts must let Vitest load the sheet, or `?raw` is empty and this passes by itself.
    expect(css).toContain("var(--");
    expect(faintText(css)).toEqual([]);
  });
});

describe("the second tone (decision Q57)", () => {
  it.each(SHEETS)("%s draws only shapes with --tone, never text", (_name, css) => {
    const text = rules(css)
      .filter(([, body]) => /(^|;)\s*(color|caret-color|-webkit-text-fill-color)\s*:[^;]*var\(--tone\)/.test(body))
      .map(([selector]) => selector);
    expect(text).toEqual([]);
  });
});

describe("native controls (S6)", () => {
  it("take the Theme's accent, not the browser's blue", () => {
    const root = rules(stylesCss).find(([selector]) => selector === ":root");
    expect(root?.[1]).toMatch(/accent-color\s*:\s*var\(--accent\)/);
  });
});

describe("type sizes (N6)", () => {
  /** Every font size in px a rule sets, through `font-size` or the `font` shorthand. */
  const sizes = (css: string) =>
    rules(css).flatMap(([selector, body]) =>
      [...body.matchAll(/(?:^|;)\s*font(?:-size)?\s*:[^;]*?(\d+(?:\.\d+)?)px/g)].map((m) => [selector, Number(m[1])] as const),
    );

  it("finds sizes in font-size and in the font shorthand", () => {
    expect(sizes(".a { font-size: 10px; } .b { font: 500 10.5px/1 var(--mono); } .c { width: 7px; }")).toEqual([
      [".a", 10],
      [".b", 10.5],
    ]);
  });

  it.each(SHEETS)("%s sets no text below the scale's 11 px step", (_name, css) => {
    expect(sizes(css).filter(([, px]) => px < 11)).toEqual([]);
  });
});

describe("hover (N8)", () => {
  it.each(SHEETS)("%s keeps every :hover rule for a real pointer", (_name, css) => {
    const loose = rules(css)
      .filter(([selector, , at]) => selector.includes(":hover") && !at.some((a) => /hover:\s*hover/.test(a)))
      .map(([selector]) => selector);
    expect(loose).toEqual([]);
  });
});

describe("what sits over a terminal (issue #78, item 6)", () => {
  // xterm.js gives its own layers z-indexes up to 11 (the link layer, the helpers). Unless the
  // terminal's box is a stacking context of its own, those layers paint over the error panel and
  // the "ended" note that follow it in the Session's pane, and swallow their clicks: the error's
  // Details couldn't be opened, nor Reconnect pressed. `isolation: isolate` keeps them inside.
  it("keeps xterm's layers inside the terminal's own stacking context", () => {
    const wrap = rules(stylesCss).find(([selector]) => selector === ".term-wrap");
    expect(wrap?.[1]).toMatch(/(^|;)\s*isolation\s*:\s*isolate/);
  });
});
