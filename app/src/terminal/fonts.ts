// The terminal's font (ticket 33, decision Q55): the Config lists families, most wanted first
// (by default the installed Iosevka Nerd Font, then Iosevka Term, then the Iosevka bundled with
// the app). xterm gets them all as one CSS stack, so the browser uses the first one installed;
// fontInUse says which that is (`:info`, and the screenshots in docs/app/design/terminal-vs-wt).
// Installed fonts are matched by family name, which the CSP's font-src doesn't restrict.

/** Families the app bundles (src/main.tsx): always there. */
export const BUNDLED = ["Iosevka", "Inter"];

const FALLBACK = ["Cascadia Mono", "ui-monospace", "monospace"];
const GENERIC = new Set(["ui-monospace", "monospace"]);

/** Whether a family is installed; null when it can't tell. */
export type FontProbe = (family: string) => boolean | null;

/** The CSS stack for xterm: the Config's families in order, then the fallbacks. */
export function terminalFontStack(families: readonly string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of [...families, ...FALLBACK]) {
    const name = f.replace(/"/g, "").trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(GENERIC.has(name) ? name : `"${name}"`);
  }
  return out.join(", ");
}

/** The first bundled or installed family in the list, or null when there's none (`:check`). */
export function fontFound(families: readonly string[], probe: FontProbe): string | null {
  return families.find((f) => BUNDLED.includes(f) || probe(f) === true) ?? null;
}

/** The family the terminal draws with: the first bundled or installed one in the list. */
export function fontInUse(families: readonly string[], probe: FontProbe): string {
  return fontFound(families, probe) ?? "Cascadia Mono, Consolas or monospace";
}

/** A probe that draws a test string in `"family", monospace` and in `"family", serif`: an installed
 * family gives the same width both times, a missing one falls back to two different fonts. */
export function canvasProbe(): FontProbe {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  } catch {
    ctx = null;
  }
  const cache = new Map<string, boolean>();
  return (family) => {
    if (!ctx) return null;
    const known = cache.get(family);
    if (known !== undefined) return known;
    const text = "mmmmmmmmmmlliWW@#0O";
    const width = (fallback: string) => {
      ctx.font = `32px "${family.replace(/"/g, "")}", ${fallback}`;
      return ctx.measureText(text).width;
    };
    const plain = (fallback: string) => {
      ctx.font = `32px ${fallback}`;
      return ctx.measureText(text).width;
    };
    const mono = width("monospace");
    const serif = width("serif");
    const there = mono === serif && (mono !== plain("monospace") || serif !== plain("serif"));
    cache.set(family, there);
    return there;
  };
}

/** xterm's lineHeight (a multiple of the font's own height): the Config's line_height, or, with
 * a cell_height (a multiple of the font size, as Windows Terminal's), the multiple that makes a
 * row that tall. `naturalHeight` measures the font's own line at `fontSize` (0 if it can't). */
export function lineHeightFor(
  o: { lineHeight: number; cellHeight: number | null },
  fontSize: number,
  naturalHeight: () => number,
): number {
  if (o.cellHeight === null) return o.lineHeight;
  const natural = naturalHeight();
  return natural > 0 ? (o.cellHeight * fontSize) / natural : o.lineHeight;
}

/** xterm sizes a cell to the font's advance rounded down to a device pixel; Windows Terminal
 * rounds it to the nearest one, so 16 pt Iosevka (10.67 px wide) is 10 px there and 11 px in
 * Windows Terminal. The difference, as xterm's letterSpacing (device px, measured in
 * docs/app/design/terminal-vs-wt). */
export function roundedCellSpacing(deviceAdvance: number): number {
  if (!(deviceAdvance > 0)) return 0;
  return Math.round(deviceAdvance) - Math.floor(deviceAdvance);
}

/** The font's advance width in device px, the way xterm gets it: measured in CSS px, times the
 * pixel ratio (16 pt Iosevka at 150% is 15.999, not 16, and xterm floors it to 15). 0 where
 * there's no canvas. */
export function deviceAdvance(fontFamily: string, weight: number, size: number, dpr: number): number {
  try {
    const ctx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    if (!ctx) return 0;
    ctx.font = `${weight} ${size}px ${fontFamily}`;
    return (ctx.measureText("WWWWWWWWWW").width / 10) * dpr;
  } catch {
    return 0;
  }
}
