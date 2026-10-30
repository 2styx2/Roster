// Every bundled Theme is readable (ticket 30): body text on every surface it sits on, secondary
// text, and the accent's button text. WCAG 2 contrast ratios; the expected values for the
// reference pairs come from the WCAG definition (black on white is 21:1).
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

describe.each(bundledThemes.map((t) => [t.id, t] as const))("Theme %s", (_id, t) => {
  const c = t.colors;
  it.each(["bg", "sidebar", "raised", "panel"] as const)("body text is at least 4.5:1 on %s", (surface) => {
    expect(contrast(c.text, c[surface])).toBeGreaterThanOrEqual(4.5);
  });
  it.each(["bg", "sidebar", "raised", "panel"] as const)("secondary text is at least 3:1 on %s", (surface) => {
    expect(contrast(c.muted, c[surface])).toBeGreaterThanOrEqual(3);
  });
  it("the accent's button text is at least 4.5:1", () => {
    expect(contrast(c.accentText, c.accent)).toBeGreaterThanOrEqual(4.5);
  });
  it("terminal text is at least 4.5:1 on the terminal background", () => {
    expect(contrast(t.terminal.foreground, t.terminal.background)).toBeGreaterThanOrEqual(4.5);
  });
});
