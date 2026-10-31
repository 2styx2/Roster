// Which terminal font is used (ticket 33): the first family in the Config's list that's
// installed (or bundled), and the stack xterm gets.
import { describe, expect, it } from "vitest";
import { fontInUse, lineHeightFor, roundedCellSpacing, terminalFontStack } from "./fonts";

const installed = (...names: string[]) => (family: string) => names.includes(family);

describe("fontInUse", () => {
  const list = ["Iosevka Nerd Font", "Iosevka Term", "Iosevka"];

  it("takes the first installed family, in the Config's order", () => {
    expect(fontInUse(list, installed("Iosevka Term", "Iosevka Nerd Font"))).toBe("Iosevka Nerd Font");
    expect(fontInUse(list, installed("Iosevka Term"))).toBe("Iosevka Term");
  });

  it("falls back to the bundled Iosevka, which is always there", () => {
    expect(fontInUse(list, installed())).toBe("Iosevka");
    // A probe that can't tell (no canvas) counts nothing as installed.
    expect(fontInUse(list, () => null)).toBe("Iosevka");
  });

  it("names the platform's monospace when nothing in the list is there", () => {
    expect(fontInUse(["Fira Code"], installed())).toBe("Cascadia Mono, Consolas or monospace");
  });
});

describe("terminalFontStack", () => {
  it("quotes the families in order, then the fallbacks, without repeats", () => {
    expect(terminalFontStack(["Iosevka Nerd Font", "Consolas"])).toBe(
      '"Iosevka Nerd Font", "Consolas", "Cascadia Mono", ui-monospace, monospace',
    );
  });
});

describe("lineHeightFor", () => {
  it("is the line height, unless a cell height (a multiple of the font size) is set", () => {
    expect(lineHeightFor({ lineHeight: 1.1, cellHeight: null }, 20, () => 25)).toBe(1.1);
    // Windows Terminal's cellHeight 1.5 at 20 px is a 30 px row; the font's own is 25 px.
    expect(lineHeightFor({ lineHeight: 1, cellHeight: 1.5 }, 20, () => 25)).toBeCloseTo(1.2);
    // Can't measure (no layout): the line height.
    expect(lineHeightFor({ lineHeight: 1, cellHeight: 1.5 }, 20, () => 0)).toBe(1);
  });
});

describe("roundedCellSpacing", () => {
  it("widens xterm's cell (it floors the advance) to Windows Terminal's (it rounds), in device px", () => {
    // Iosevka at 16 pt (21.33 px) advances 10.67 px: xterm draws 10, Windows Terminal 11.
    expect(roundedCellSpacing(10.67)).toBe(1);
    expect(roundedCellSpacing(10.4)).toBe(0);
    expect(roundedCellSpacing(16)).toBe(0);
    expect(roundedCellSpacing(0)).toBe(0);
  });
});
