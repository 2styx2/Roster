// Every bundled Theme is readable (tickets 30 and 29). WCAG 2 contrast ratios; the expected values
// for the reference pairs come from the WCAG definition (black on white is 21:1).
//
// Text tokens (decision Q53, M1 option B): `text`, `muted` and the status inks `warn`, `error` and
// `accentInk` are all drawn as text, so each must reach 4.5:1 (1.4.3) on every surface text sits
// on. `faint` is not a text token: it's for icons, chevrons and rules only (styles.test.ts keeps
// it out of text). The live Session's 2px jade bar (S11) must reach 3:1 (1.4.11).
import { describe, expect, it } from "vitest";
import { contrast } from "./contrast";
import { bundledThemes } from "./themes";

describe("contrast", () => {
  it("measures WCAG 2 ratios", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});

const SURFACES = ["bg", "chrome", "sidebar", "panel", "raised", "hover"] as const;
const TEXT_TOKENS = ["text", "muted", "warn", "error", "accentInk"] as const;

describe.each(bundledThemes.map((t) => [t.id, t] as const))("Theme %s", (_id, t) => {
  const c = t.colors;
  const pairs = TEXT_TOKENS.flatMap((token) => SURFACES.map((surface) => [token, surface] as const));
  it.each(pairs)("%s text is at least 4.5:1 on %s", (token, surface) => {
    expect(contrast(c[token], c[surface])).toBeGreaterThanOrEqual(4.5);
  });
  it.each(["sidebar", "raised"] as const)("the live Session's accent bar is at least 3:1 against %s", (surface) => {
    expect(contrast(c.accent, c[surface])).toBeGreaterThanOrEqual(3);
  });
  it("the accent's button text is at least 4.5:1", () => {
    expect(contrast(c.accentText, c.accent)).toBeGreaterThanOrEqual(4.5);
  });
  it("terminal text is at least 4.5:1 on the terminal background", () => {
    expect(contrast(t.terminal.foreground, t.terminal.background)).toBeGreaterThanOrEqual(4.5);
  });
});
