// Every bundled Theme is readable (tickets 30 and 29). WCAG 2 contrast ratios; the expected values
// for the reference pairs come from the WCAG definition (black on white is 21:1).
//
// Text tokens (decision Q53, M1 option B): `text`, `muted` and the status inks `warn`, `error` and
// `accentInk` are all drawn as text, so each must reach 4.5:1 (1.4.3) on every surface text sits
// on. `faint` is not a text token: it's for icons, chevrons and rules only (styles.test.ts keeps
// it out of text). The live Session's 2px accent bar (S11) and the second tone (decision Q57:
// this Box's marker, unreviewed nodes; shapes only) must reach 3:1 (1.4.11).
import { describe, expect, it } from "vitest";
import { contrast, deltaE } from "./contrast";
import { bundledThemes, rosterDark, rosterLight } from "./themes";

describe("contrast", () => {
  it("measures WCAG 2 ratios", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
  it("measures how far apart two colours look (OKLab)", () => {
    expect(deltaE("#ffffff", "#ffffff")).toBe(0);
    expect(deltaE("#000000", "#ffffff")).toBeCloseTo(100, 0);
  });
});

const SURFACES = ["bg", "chrome", "sidebar", "panel", "raised", "hover"] as const;
const TEXT_TOKENS = ["text", "muted", "warn", "error", "accentInk"] as const;
const SYNTAX_TOKENS = [
  "syntaxKeyword",
  "syntaxString",
  "syntaxNumber",
  "syntaxComment",
  "syntaxFunction",
  "syntaxPunctuation",
  "syntaxKey",
  "syntaxCommand",
] as const;
/** The syntax colours that carry a hue; comments, punctuation and commands are the Theme's greys. */
const SYNTAX_HUES = ["syntaxKeyword", "syntaxString", "syntaxNumber", "syntaxFunction", "syntaxKey"] as const;

describe.each(bundledThemes.map((t) => [t.id, t] as const))("Theme %s", (_id, t) => {
  const c = t.colors;
  const pairs = TEXT_TOKENS.flatMap((token) => SURFACES.map((surface) => [token, surface] as const));
  it.each(pairs)("%s text is at least 4.5:1 on %s", (token, surface) => {
    expect(contrast(c[token], c[surface])).toBeGreaterThanOrEqual(4.5);
  });
  it.each(["sidebar", "raised"] as const)("the live Session's accent bar is at least 3:1 against %s", (surface) => {
    expect(contrast(c.accent, c[surface])).toBeGreaterThanOrEqual(3);
  });
  it.each(SURFACES)("the second tone's shapes are at least 3:1 against %s", (surface) => {
    expect(contrast(c.tone, c[surface])).toBeGreaterThanOrEqual(3);
  });
  it("the second tone is not the accent (an unreviewed node never reads as a live one)", () => {
    expect(deltaE(c.tone, c.accent)).toBeGreaterThanOrEqual(12);
  });
  it("the accent's button text is at least 4.5:1", () => {
    expect(contrast(c.accentText, c.accent)).toBeGreaterThanOrEqual(4.5);
  });
  it("the close button's glyph is at least 3:1 on danger", () => {
    expect(contrast(c.dangerText, c.danger)).toBeGreaterThanOrEqual(3);
  });
  // Code (ticket 71, decision Q90): every syntax colour is code text, so 4.5:1 on every surface
  // code sits on, and the coloured ones never read as the accent (taste.md: the accent means live).
  const syntaxPairs = SYNTAX_TOKENS.flatMap((token) => SURFACES.map((surface) => [token, surface] as const));
  it.each(syntaxPairs)("code's %s colour is at least 4.5:1 on %s", (token, surface) => {
    expect(contrast(c[token], c[surface])).toBeGreaterThanOrEqual(4.5);
  });
  it.each(SYNTAX_HUES)("code's %s colour isn't the accent", (token) => {
    expect(deltaE(c[token], c.accent)).toBeGreaterThanOrEqual(8);
  });
  it("terminal text is at least 4.5:1 on the terminal background", () => {
    expect(contrast(t.terminal.foreground, t.terminal.background)).toBeGreaterThanOrEqual(4.5);
  });
});

// Decision Q57: next to the apricot, an amber warn and a red error read as the accent. Roster's
// warn is yellow and its error raspberry, each well clear of the accent and of each other, and the
// close button's danger takes white text at 4.5:1.
describe.each([rosterDark, rosterLight].map((t) => [t.id, t] as const))("Theme %s semantics", (_id, t) => {
  const c = t.colors;
  it.each(["warn", "error", "danger"] as const)("%s is at least 12 apart from the accent", (token) => {
    expect(deltaE(c[token], c.accent)).toBeGreaterThanOrEqual(12);
  });
  it.each(SYNTAX_TOKENS)("code's %s colour is at least 12 apart from the accent (nothing apricot in code)", (token) => {
    expect(deltaE(c[token], c.accent)).toBeGreaterThanOrEqual(12);
  });
  it("warn and error are well apart", () => {
    expect(deltaE(c.warn, c.error)).toBeGreaterThanOrEqual(20);
  });
  it("the close button's white glyph is at least 4.5:1 on danger", () => {
    expect(contrast(c.dangerText, c.danger)).toBeGreaterThanOrEqual(4.5);
  });
});
