// `:help options`: the init.lua options, read from docs/app/config.md's tables (the one copy of
// what each does), with the value in effect and where it came from.
import { describe, expect, it } from "vitest";
import { configWith, defaultConfig } from "../config/fixture";
import { plain } from "./doc";
import { configMarkdown } from "./guides";
import { leafPaths, luaValue, optionDocs, optionSource, optionValue } from "./options";

const docs = optionDocs(configMarkdown);
const doc = (name: string) => docs.find((d) => d.name === name);

describe("the options, from config.md", () => {
  it("reads each table row as an option with its default and what it does", () => {
    expect(plain(doc("terminal.size")?.default ?? [])).toBe('"13pt"');
    expect(plain(doc("terminal.size")?.about ?? [])).toMatch(/^13 pt is 17\.33 px/);
    expect(doc("terminal.size")?.section).toBe("Fonts and the terminal");
  });

  it("splits a row naming two options, and their two defaults", () => {
    expect(plain(doc("dark_theme")?.default ?? [])).toBe('"roster-dark"');
    expect(plain(doc("light_theme")?.default ?? [])).toBe('"roster-light"');
  });

  it("reads a mode's pieces for each mode, with that mode's default", () => {
    expect(plain(doc("modes.standard.titlebar")?.default ?? [])).toBe("true");
    expect(plain(doc("modes.focus.titlebar")?.default ?? [])).toBe("false");
  });

  // The docs and the core's schema can't drift apart: every value the core sends is documented,
  // and every documented option is one the core has.
  it("documents every option in the core's schema, and nothing it doesn't have", () => {
    const names = docs.map((d) => d.name);
    const covered = (path: string) => names.some((n) => path === n || path.startsWith(`${n}.`));
    const undocumented = leafPaths(defaultConfig).filter((p) => !covered(p));
    expect(undocumented).toEqual([]);
    const unknown = names.filter((n) => optionValue(defaultConfig, n) === undefined);
    expect(unknown).toEqual([]);
  });
});

describe("an option's value and where it came from", () => {
  it("reads the value in effect, by its Lua name", () => {
    const c = configWith({ fonts: { ...defaultConfig.fonts, uiSize: 16 } });
    expect(optionValue(c, "fonts.ui_size")).toBe(16);
    expect(luaValue(optionValue(c, "terminal.font"))).toBe('{ "Iosevka Nerd Font", "Iosevka Term", "Iosevka" }');
    expect(luaValue(optionValue(defaultConfig, "ui.hints"))).toBe("unset");
    expect(luaValue(optionValue(defaultConfig, "terminal.size"))).toBe("17.33");
    expect(luaValue({ side: "left", shown: true })).toBe('{ side = "left", shown = true }');
  });

  it("says init.lua (and its line) for what the file set, even to the default value", () => {
    const c = configWith({ set: ["terminal.size", "vim"], lines: { vim: { file: "init.lua", line: 4 } } });
    expect(optionSource(c, "vim", {})).toEqual({ kind: "init.lua", at: { file: "init.lua", line: 4 } });
    expect(optionSource(c, "terminal.size", {})).toEqual({ kind: "init.lua" });
    expect(optionSource(c, "leader", {})).toEqual({ kind: "default" });
  });

  it("counts a table's values: modes.focus is set when modes.focus.sidebar is", () => {
    const c = configWith({ set: ["modes.focus.sidebar"] });
    expect(optionSource(c, "modes.focus").kind).toBe("init.lua");
    expect(optionSource(c, "modes.standard").kind).toBe("default");
  });

  it("says State for a choice the app keeps (:theme, :hints, :messages) when init.lua leaves it", () => {
    expect(optionSource(defaultConfig, "theme", { theme: "nord" })).toEqual({ kind: "State", value: "nord" });
    expect(optionSource(defaultConfig, "ui.hints", { hints: false })).toEqual({ kind: "State", value: false });
    expect(optionSource(defaultConfig, "ui.messages", { messages: "all" })).toEqual({ kind: "State", value: "all" });
    const set = configWith({ set: ["theme", "ui.hints", "ui.messages"], theme: "gruvbox", ui: { hints: true, messages: "quiet" } });
    expect(optionSource(set, "theme", { theme: null })).toEqual({ kind: "init.lua" });
    expect(optionSource(set, "ui.hints", { hints: false })).toEqual({ kind: "init.lua" });
    expect(optionSource(set, "ui.messages", { messages: "all" })).toEqual({ kind: "init.lua" });
  });

  it("says State for a :theme choice in effect over init.lua's theme, naming that line (decision Q69)", () => {
    const at = { file: "init.lua", line: 12 };
    const set = configWith({ set: ["theme"], theme: "gruvbox", lines: { theme: at } });
    expect(optionSource(set, "theme", { theme: "nord" })).toEqual({ kind: "State", value: "nord", over: at });
  });
});
