// The Theme picker's model (ticket 30, decision Q51): which Theme the app shows, given the
// Config, the State and a live preview; and what `:theme NAME` and the `themes` finder do.
import { describe, expect, it } from "vitest";
import { memoryPlatform } from "../platform/memory";
import { CONFIG } from "../registry";
import { builtinRegistries } from "../registries";
import { StateStore } from "../state/store";
import { defaultAppearance, type Theme } from "./theme";
import { chosenAppearance, registerThemePicker, stateChoiceWins, ThemeChoice } from "./picker";
import { rosterLight } from "./themes";
import { finderResults, type FinderContext } from "../finder/sources";

async function setup(state: Record<string, unknown> = {}) {
  const platform = memoryPlatform({ state });
  const store = new StateStore(platform);
  await store.load();
  const registries = builtinRegistries();
  const choice = new ThemeChoice(store, registries.themes);
  registerThemePicker(registries, choice);
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { platform, store, registries, choice, flush };
}

describe("chosenAppearance", () => {
  it("is the Config's appearance when nothing is chosen", () => {
    expect(chosenAppearance(defaultAppearance, { configTheme: null, stored: null, preview: null })).toBe(defaultAppearance);
  });
  it("uses the State's choice over theme = auto, and a preview over both", () => {
    expect(chosenAppearance(defaultAppearance, { configTheme: null, stored: "nord", preview: null }).theme).toBe("nord");
    expect(chosenAppearance(defaultAppearance, { configTheme: null, stored: "nord", preview: "gruvbox" }).theme).toBe("gruvbox");
  });
  it("lets init.lua's theme win over a choice made before init.lua set it (decision Q69)", () => {
    const fromConfig = { ...defaultAppearance, theme: "tokyo-night" };
    expect(chosenAppearance(fromConfig, { configTheme: "tokyo-night", stored: "nord", preview: null }).theme).toBe("tokyo-night");
    expect(chosenAppearance(fromConfig, { configTheme: "tokyo-night", stored: "nord", storedOver: "gruvbox", preview: null }).theme).toBe(
      "tokyo-night",
    );
  });
  it("keeps a :theme choice made over init.lua's theme until that value changes (decision Q69)", () => {
    const fromConfig = { ...defaultAppearance, theme: "tokyo-night" };
    expect(chosenAppearance(fromConfig, { configTheme: "tokyo-night", stored: "nord", storedOver: "tokyo-night", preview: null }).theme).toBe("nord");
    expect(stateChoiceWins({ configTheme: "tokyo-night", stored: "nord", storedOver: "tokyo-night" })).toBe(true);
    expect(stateChoiceWins({ configTheme: "gruvbox", stored: "nord", storedOver: "tokyo-night" })).toBe(false);
    expect(stateChoiceWins({ configTheme: null, stored: "nord", storedOver: "tokyo-night" })).toBe(true);
    expect(stateChoiceWins({ configTheme: null, stored: null })).toBe(false);
  });
});

describe("ThemeChoice", () => {
  it("keeps a choice in the State, next to keys it doesn't know", async () => {
    const { choice, platform, flush } = await setup({ version: 1, newer: { x: 1 } });
    expect(choice.choose("nord")).toBe("");
    expect(choice.stored()).toBe("nord");
    await flush();
    expect(platform.saved()).toMatchObject({ theme: "nord", newer: { x: 1 } });
  });

  it("ignores a stored Theme that isn't registered any more", async () => {
    const { choice } = await setup({ theme: "gone" });
    expect(choice.stored()).toBeNull();
  });

  it("refuses an unknown name", async () => {
    const { choice, store } = await setup();
    expect(choice.choose("nope")).toMatch(/No Theme named nope/);
    expect(store.get("theme")).toBeUndefined();
  });

  it("keeps a choice while init.lua sets theme, says once which line pins it, and remembers that value", async () => {
    const { choice, store, platform, flush } = await setup();
    choice.setConfigTheme("gruvbox", { file: "init.lua", line: 12 });
    expect(choice.choose("nord")).toBe(
      'Theme Nord. init.lua:12 also sets theme = "gruvbox": this choice stays until that line changes. Delete the line to unpin it.',
    );
    expect(store.get("theme")).toBe("nord");
    expect(choice.inEffect()).toBe("nord");
    expect(choice.choose("tokyo-night")).toBe("");
    await flush();
    expect(platform.saved()).toMatchObject({ theme: "tokyo-night", themeOver: "gruvbox" });
  });

  it("gives way to init.lua once its theme changes, and says nothing when the choice is init.lua's own", async () => {
    const { choice } = await setup({ theme: "nord", themeOver: "gruvbox" });
    choice.setConfigTheme("gruvbox");
    expect(choice.inEffect()).toBe("nord");
    choice.setConfigTheme("tokyo-night");
    expect(choice.inEffect()).toBeNull();
    expect(choice.choose("tokyo-night")).toBe("");
  });

  it("keeps a Theme that isn't registered yet (an import's, before :source registers it)", async () => {
    const { choice, store } = await setup();
    expect(choice.keep("wt-import")).toBe("");
    expect(store.get("theme")).toBe("wt-import");
    expect(choice.stored()).toBeNull();
  });

  it("previews, and tells its subscribers", async () => {
    const { choice } = await setup();
    let calls = 0;
    choice.subscribe(() => calls++);
    choice.preview("nord");
    expect(choice.previewing()).toBe("nord");
    choice.preview(null);
    expect(choice.previewing()).toBeNull();
    expect(calls).toBe(2);
  });
});

describe("the themes finder and :theme", () => {
  const ctx = {} as FinderContext;

  it("lists every registered Theme, a Config one too, with the one on screen selected", async () => {
    const { registries, choice } = await setup();
    const mine: Theme = { ...rosterLight, id: "mine", source: CONFIG, label: "Mine" };
    registries.themes.register(mine);
    choice.setActive("nord");
    const source = registries.finders.get("themes")!;
    const r = finderResults(source, ctx, "");
    expect(r.items.map((i) => i.label)).toEqual([
      "Roster dark",
      "Roster light",
      "Gruvbox Dark",
      "Nord",
      "Catppuccin Mocha",
      "Tokyo Night",
      "Mine",
    ]);
    expect(r.items[r.selected]?.command).toBe("theme nord");
    expect(r.items[6]?.detail).toMatch(/init\.lua/);
  });

  it("previews the Theme under the cursor and reverts when it closes", async () => {
    const { registries, choice } = await setup();
    const source = registries.finders.get("themes")!;
    const items = finderResults(source, ctx, "").items;
    source.move?.(items[3]);
    expect(choice.previewing()).toBe("nord");
    source.close?.();
    expect(choice.previewing()).toBeNull();
  });

  it("notes when init.lua sets the theme: Enter still keeps the choice", async () => {
    const { registries, choice } = await setup();
    const source = registries.finders.get("themes")!;
    expect(source.note?.(undefined)).toBeUndefined();
    choice.setConfigTheme("gruvbox", { file: "init.lua", line: 3 });
    const note = source.note?.(undefined) ?? "";
    expect(note).toBe('init.lua:3 sets "gruvbox"; Enter overrides it until that line changes');
    expect(note).not.toMatch(/only previews/);
  });

  it("completes :theme with Theme ids", async () => {
    const { registries } = await setup();
    expect(registries.commands.get("theme")?.complete?.("to", [])).toEqual(["tokyo-night"]);
  });
});
