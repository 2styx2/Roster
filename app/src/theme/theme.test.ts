import { describe, expect, it } from "vitest";
import { Registry } from "../registry";
import { standardAnsi } from "../terminal/options";
import { cssVar, defaultAppearance, resolveTheme, terminalTheme, themeVariables, type Theme } from "./theme";
import { builtinThemeRegistry, bundledThemes, gruvbox, rosterDark, rosterLight } from "./themes";
import { applyTheme } from "./useTheme";

describe("Themes", () => {
  it("every bundled Theme sets the same, complete set of tokens", () => {
    const keys = Object.keys(rosterDark.colors).sort();
    for (const t of bundledThemes) {
      expect(Object.keys(t.colors).sort(), t.id).toEqual(keys);
      expect(Object.values(t.colors).every((v) => typeof v === "string" && v.length > 0), t.id).toBe(true);
      expect(Object.keys(t.terminal).sort(), t.id).toEqual(Object.keys(rosterDark.terminal).sort());
    }
  });

  it("names CSS variables in kebab case", () => {
    expect(cssVar("raisedLine")).toBe("--raised-line");
    expect(themeVariables(rosterDark)["--accent"]).toBe("#ff9a70");
    expect(themeVariables(rosterDark)["--tone"]).toBe("#82ccd5");
  });

  it("follows the OS light/dark setting with theme = auto", () => {
    const reg = builtinThemeRegistry();
    expect(resolveTheme(reg, defaultAppearance, true, rosterDark).id).toBe("roster-dark");
    expect(resolveTheme(reg, defaultAppearance, false, rosterDark).id).toBe("roster-light");
  });

  it("uses a named Theme whatever the OS says, and the default for an unknown name", () => {
    const reg = builtinThemeRegistry();
    expect(resolveTheme(reg, { ...defaultAppearance, theme: "nord" }, false, rosterDark).id).toBe("nord");
    expect(resolveTheme(reg, { ...defaultAppearance, theme: "nope" }, false, rosterDark).id).toBe("roster-dark");
  });

  it("picks up a Theme registered later (the Config or a Plugin), and its override of a bundled one", () => {
    const reg: Registry<Theme> = builtinThemeRegistry();
    const mine: Theme = { ...rosterLight, id: "mine", source: "init.lua", label: "Mine" };
    reg.register(mine);
    expect(resolveTheme(reg, { ...defaultAppearance, theme: "mine" }, true, rosterDark)).toBe(mine);
    const accent = { ...rosterDark, source: "init.lua", colors: { ...rosterDark.colors, accent: "#ff00ff" } };
    reg.register(accent);
    expect(resolveTheme(reg, defaultAppearance, true, rosterDark).colors.accent).toBe("#ff00ff");
  });

  it("keeps the standard ANSI palette unless the Theme brings its own (decision Q37)", () => {
    expect(terminalTheme(rosterDark).red).toBe(standardAnsi.red);
    expect(terminalTheme(rosterLight).brightBlue).toBe(standardAnsi.brightBlue);
    expect(terminalTheme(gruvbox).red).toBe("#cc241d");
    expect(terminalTheme(rosterDark).background).toBe(rosterDark.terminal.background);
    expect(terminalTheme(rosterDark, { red: "#123456" }).red).toBe("#123456");
  });

  it("puts the tokens and fonts on the document", () => {
    const el = document.createElement("div");
    applyTheme(el, rosterLight, defaultAppearance.fonts);
    expect(el.style.getPropertyValue("--bg")).toBe("#f2f2f4");
    expect(el.style.getPropertyValue("--font-mono")).toContain("Iosevka");
    expect(el.style.getPropertyValue("--ui-size")).toBe("14px");
    expect(el.dataset.theme).toBe("roster-light");
    expect(el.style.colorScheme).toBe("light");
  });
});
