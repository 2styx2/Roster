// The help pages (ticket 37): generated from the live registries, plus the guides from docs/app,
// all reachable by topic.
import { describe, expect, it } from "vitest";
import { configWith, defaultConfig } from "../config/fixture";
import { defaultOptions, keymapOf, registerBindings } from "../keymap";
import { builtinRegistries, type Registries } from "../registries";
import { CONFIG } from "../registry";
import { plain, type Block, type Def } from "./doc";
import { findTopic, helpContext, pageBody, topics, type HelpContext } from "./pages";

function ctxOf(r: Registries = builtinRegistries(), more: Partial<HelpContext> = {}): HelpContext {
  return helpContext(r, {
    keymap: keymapOf(r.keymap.list()),
    options: defaultOptions,
    config: defaultConfig,
    configPath: "/home/me/.config/roster/init.lua",
    state: {},
    activeTheme: "roster-dark",
    ...more,
  });
}

const defs = (blocks: Block[]): Def[] => blocks.flatMap((b) => (b.t === "defs" ? b.items : []));
const entry = (ctx: HelpContext, page: string, anchor: string) => defs(pageBody(ctx, page)).find((d) => d.anchor === anchor);

describe("topics", () => {
  it("are the pages, each command, option, error row and guide heading", () => {
    const tags = topics(ctxOf()).map((t) => t.tag);
    for (const tag of ["index", "commands", "keys", "options", "themes", "finders", "errors", "config", "keyboard"]) {
      expect(tags).toContain(tag);
    }
    expect(tags).toContain(":connect");
    expect(tags).toContain("terminal.size");
    expect(tags).toContain("E13");
    expect(tags).toContain("config#the-sandbox");
    expect(new Set(tags).size).toBe(tags.length);
  });

  it(":help TOPIC finds a tag exactly, an alias, or the best fuzzy match", () => {
    const ctx = ctxOf();
    expect(findTopic(ctx, "terminal.size")).toMatchObject({ page: "options", anchor: "terminal.size" });
    expect(findTopic(ctx, "Options")).toMatchObject({ page: "options" });
    expect(findTopic(ctx, "connect")).toMatchObject({ page: "commands", anchor: ":connect" });
    expect(findTopic(ctx, "init.lua")).toMatchObject({ page: "config" });
    expect(findTopic(ctx, "folders.yml")).toMatchObject({ page: "config", anchor: "config#foldersyml" });
    expect(findTopic(ctx, "sandbox")).toMatchObject({ page: "config", anchor: "config#the-sandbox" });
    expect(findTopic(ctx, "zzqxj")).toBeUndefined();
  });
});

describe("generated pages follow the registries", () => {
  it("commands: a command the Config adds shows, with its keys and source", () => {
    const r = builtinRegistries();
    r.commands.register({ id: "home", source: CONFIG, area: "Hosts", label: () => "Home box", run: () => {} });
    registerBindings(r.keymap, { leader: { h: "home" } }, CONFIG);
    const home = entry(ctxOf(r), "commands", ":home");
    expect(plain(home?.term ?? [])).toBe(":home");
    expect(home?.meta).toEqual(expect.arrayContaining([{ t: "keys", keys: "␣ h" }, { t: "text", text: "init.lua" }]));
    expect(plain(home?.body ?? [])).toBe("Home box");
  });

  it("options: the value in effect and where it was set", () => {
    const config = configWith({
      terminal: { ...defaultConfig.terminal, size: 18.666666 },
      set: ["terminal.size"],
      lines: { "terminal.size": { file: "init.lua", line: 6 } },
    });
    const size = entry(ctxOf(builtinRegistries(), { config }), "options", "terminal.size");
    expect(plain(size?.meta ?? [])).toMatch(/18\.67.*init\.lua:6/);
    expect(plain(size?.body ?? [])).toMatch(/Default: "13pt"/);
    const leader = entry(ctxOf(), "options", "leader");
    expect(plain(leader?.meta ?? [])).toMatch(/"Ctrl\+Space".*default/);
    const theme = entry(ctxOf(builtinRegistries(), { state: { theme: "nord" } }), "options", "theme");
    expect(plain(theme?.meta ?? [])).toMatch(/"nord".*State/);
  });

  it("themes: every registered Theme, the one in use marked", () => {
    const ctx = ctxOf(builtinRegistries(), { activeTheme: "nord" });
    expect(plain(entry(ctx, "themes", "themes#nord")?.meta ?? [])).toMatch(/in use/);
    expect(plain(entry(ctx, "themes", "themes#gruvbox")?.meta ?? [])).not.toMatch(/in use/);
  });

  it("keys: the resolved keymap as a table of keycaps, even a Config's", () => {
    const r = builtinRegistries();
    registerBindings(r.keymap, { leader: { t: "next" } }, CONFIG);
    const tables = pageBody(ctxOf(r), "keys").filter((b) => b.t === "table");
    const rows = tables.flatMap((t) => (t.t === "table" ? t.rows : []));
    const next = rows.find((row) => plain(row[1] ?? []) === "Next Session" && plain(row[3] ?? []) === "init.lua");
    expect(next?.[0]).toEqual([{ t: "keys", keys: "␣ t" }]);
  });

  it("a Plugin's page is a topic, and the index lists it", () => {
    const r = builtinRegistries();
    r.help.register({
      id: "ping",
      source: "ping-plugin",
      title: "Ping",
      summary: "Ping a Host",
      order: 500,
      body: () => [{ t: "p", text: [{ t: "text", text: "Pings." }] }],
    });
    const ctx = ctxOf(r);
    expect(findTopic(ctx, "ping")).toMatchObject({ page: "ping" });
    const index = JSON.stringify(pageBody(ctx, "index"));
    expect(index).toContain('"href":"ping"');
    expect(index).toContain("ping-plugin");
  });
});

describe("the guides from docs/app", () => {
  it("render config.md, with its links to other guides as help links", () => {
    const body = JSON.stringify(pageBody(ctxOf(), "config"));
    expect(body).toContain("The sandbox");
    // config.md links to themes.md: in help, that's the themes guide.
    expect(body).toContain('"href":"themes-guide"');
    // A link to a file that isn't a guide is just its text.
    expect(body).not.toContain("terminal-vs-wt/README.md");
  });
});
