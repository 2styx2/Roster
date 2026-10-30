import { describe, expect, it } from "vitest";
import { chordOf, resolveKeymap } from "./keymap";

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

describe("resolveKeymap", () => {
  it("tags every built-in binding as coming from the defaults", () => {
    const keymap = resolveKeymap();
    expect(keymap.leader["f"]).toEqual({ action: "find", source: "builtin" });
    expect(keymap.leader["d d"]).toEqual({ action: "close", source: "builtin" });
    expect(keymap.picker["Ctrl+n"]).toEqual({ action: "picker.down", source: "builtin" });
  });

  it("layers the Config's bindings over the defaults, and null unbinds a key", () => {
    const keymap = resolveKeymap({ leader: { t: "next", "]": null } });
    expect(keymap.leader["t"]).toEqual({ action: "next", source: "init.lua" });
    expect(keymap.leader["]"]).toBeUndefined();
    expect(keymap.leader["["]).toEqual({ action: "prev", source: "builtin" });
  });
});
