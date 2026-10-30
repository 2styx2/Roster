// The Config (ticket 21) on the frontend: the typed object from the core is turned into the
// app's options and pushed through the registries (ADR 0006). The defaults come from the core's
// own fixture (crates/roster-core/tests/fixtures/config-defaults.json), so the Rust and TypeScript
// defaults can't drift apart.
import { describe, expect, it } from "vitest";
import { defaultOptions, keymapOf } from "../keymap";
import { builtinRegistries } from "../registries";
import { BUILTIN, CONFIG } from "../registry";
import { defaultTerminalOptions } from "../terminal/options";
import { defaultAppearance } from "../theme/theme";
import { rosterDark } from "../theme/themes";
import { defaultLayouts } from "../view/layout";
import { deriveConfig, normalizeChord, registerConfig } from "./apply";
import { configFixture, configWith, defaultConfig } from "./fixture";


const fixture = configFixture;

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

describe("the Config's defaults", () => {
  it("are the app's own defaults", () => {
    const d = deriveConfig(defaultConfig);
    expect(d.options).toEqual(defaultOptions);
    expect(d.appearance).toEqual(defaultAppearance);
    expect(d.terminalOptions).toEqual(defaultTerminalOptions);
    expect(d.layouts).toEqual(defaultLayouts(defaultOptions));
  });

  it("name the same colour tokens as the Themes", () => {
    expect(fixture.themeColors.map(camel)).toEqual(Object.keys(rosterDark.colors));
    expect(fixture.themeTerminal.map(camel)).toEqual(Object.keys(rosterDark.terminal));
  });

  it("make the terminal medium weight, bold at 700", () => {
    expect(defaultTerminalOptions.fontWeight).toBe(500);
    expect(defaultTerminalOptions.fontWeightBold).toBe(700);
  });
});

describe("registering the Config", () => {
  it("binds its keys with source init.lua, and a reload brings the built-ins back", () => {
    const r = builtinRegistries();
    const config = configWith({
      keys: [
        { context: "leader", keys: "x", action: "close" },
        { context: "leader", keys: "f", action: "keys" },
        { context: "leader", keys: "d d", action: null },
      ],
      lines: {},
    });
    const { dispose, warnings } = registerConfig(r, config);
    expect(warnings).toEqual([]);
    const km = keymapOf(r.keymap.list());
    expect(km.leader.x).toEqual({ action: "close", source: CONFIG });
    expect(km.leader.f).toEqual({ action: "keys", source: CONFIG });
    expect(km.leader["d d"]).toBeUndefined();
    dispose();
    const back = keymapOf(r.keymap.list());
    expect(back.leader.f).toEqual({ action: "find", source: BUILTIN });
    expect(back.leader["d d"]).toEqual({ action: "close", source: BUILTIN });
    expect(back.leader.x).toBeUndefined();
  });

  it("skips a key bound to an unknown action, with a warning that has the line", () => {
    const r = builtinRegistries();
    const { warnings } = registerConfig(
      r,
      configWith({
        keys: [{ context: "leader", keys: "x", action: "explode" }],
        lines: { "keys.leader.x": { file: "init.lua", line: 7 } },
      }),
    );
    expect(warnings).toEqual([{ file: "init.lua", line: 7, message: 'key x (leader): no action named "explode"' }]);
    expect(keymapOf(r.keymap.list()).leader.x).toBeUndefined();
  });

  it("registers a Theme built on a bundled one, changing only the tokens it sets", () => {
    const r = builtinRegistries();
    registerConfig(
      r,
      configWith({
        theme: "mine",
        themes: { mine: { base: "nord", colors: { accent: "#ff8800" }, terminal: {}, ansi: "standard" } },
      }),
    );
    const mine = r.themes.get("mine");
    const nord = r.themes.get("nord");
    expect(mine?.source).toBe(CONFIG);
    expect(mine?.colors.accent).toBe("#ff8800");
    expect(mine?.colors.bg).toBe(nord?.colors.bg);
    expect(mine?.appearance).toBe(nord?.appearance);
    expect(mine?.ansi).toBeUndefined();
  });

  it("warns about a Theme option naming no Theme", () => {
    const { warnings } = registerConfig(builtinRegistries(), configWith({ theme: "solarized" }));
    expect(warnings[0]?.message).toMatch(/theme = "solarized": no such Theme/);
  });

  it("adds its Folders to the folders registry, read-only", () => {
    const r = builtinRegistries();
    const { dispose } = registerConfig(r, configWith({ folders: [{ name: "Lab ESXi", hosts: ["esxi-02"] }] }));
    expect(r.folders.list()).toEqual([{ id: "lab esxi", source: CONFIG, name: "Lab ESXi", hosts: ["esxi-02"] }]);
    dispose();
    expect(r.folders.list()).toEqual([]);
  });
});

describe("chords as people write them", () => {
  it.each([
    ["Ctrl+Space", "Ctrl+Space"],
    ["ctrl+space", "Ctrl+Space"],
    ["C-b", "Ctrl+b"],
    ["<C-a>", "Ctrl+a"],
    ["ctrl+B", "Ctrl+b"],
    ["alt+shift+x", "Alt+Shift+x"],
    ["F11", "F11"],
    ["x", "x"],
    ["G", "G"],
    ["esc", "Escape"],
  ])("%s → %s", (written, chord) => {
    expect(normalizeChord(written)).toBe(chord);
  });
});
