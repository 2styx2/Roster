import { describe, expect, it } from "vitest";
import { chordOf } from "./keymap";

const key = (k: string, mods: Partial<Record<"ctrlKey" | "altKey" | "metaKey" | "shiftKey", boolean>> = {}) =>
  ({ key: k, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...mods });

describe("chordOf", () => {
  it("names chords the way the keymap writes them", () => {
    expect(chordOf(key(" ", { ctrlKey: true }))).toBe("Ctrl+Space");
    expect(chordOf(key("N", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+n");
    expect(chordOf(key("n", { ctrlKey: true }))).toBe("Ctrl+n");
    expect(chordOf(key("j"))).toBe("j");
    expect(chordOf(key("G", { shiftKey: true }))).toBe("G");
    expect(chordOf(key("ArrowDown"))).toBe("ArrowDown");
    expect(chordOf(key("Escape"))).toBe("Escape");
  });
});
