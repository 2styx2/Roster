// The terminal looks like the user's Windows Terminal (ticket 33, decision Q55): `:info` names the
// installed font in use, and `:config import-terminal` shows what it would write into init.lua as
// a diff, writes it only on Enter, then sources it. The memory Platform stands in for the core
// (roster-core wt.rs has the settings.json parser and the diff's own tests). Fake Backend, stub
// terminal; Ctrl+Space is {Control>} {/Control}.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { FAKE_PASSWORD, fakeBackend, makeHosts } from "./backend/fake";
import { configWith, defaultConfig } from "./config/fixture";
import type { Config, ConfigReport, ImportPreview } from "./config/types";
import { memoryPlatform } from "./platform/memory";
import type { Platform } from "./platform/types";
import { builtinRegistries } from "./registries";
import { StubTerminal } from "./terminal/StubTerminal";

const hosts = makeHosts(6);
const LEADER = "{Control>} {/Control}";
type User = ReturnType<typeof userEvent.setup>;

let reloads = 0;
const report = (config: Config): ConfigReport => ({ config, error: null, path: "C:\\Users\\me\\AppData\\Roaming\\roster\\init.lua", version: ++reloads });

const PREVIEW: ImportPreview = {
  settingsPath: "C:\\Users\\me\\AppData\\Local\\Packages\\Microsoft.WindowsTerminal_8wekyb3d8bbwe\\LocalState\\settings.json",
  summary: ["Profile: Windows PowerShell", "Font: Iosevka Nerd Font, 16 pt (21.3 px)", "Colours: Campbell → Theme wt-campbell", "Cursor: block"],
  diff: [
    { kind: "same", text: "-- mine" },
    { kind: "add", text: "-- >>> Windows Terminal >>> made by :config import-terminal" },
    { kind: "add", text: 'roster.set("terminal.size", "16pt")' },
    { kind: "add", text: "-- <<< Windows Terminal <<<" },
    { kind: "same", text: "return {" },
    { kind: "same", text: "  terminal = { size = 14 }," },
    { kind: "same", text: "}" },
  ],
  overridden: ["terminal.size"],
  created: false,
  base: "abc",
  error: null,
};

async function ready(opts: { config?: Config; platform?: Partial<Platform> } = {}) {
  const user = userEvent.setup();
  const r = report(opts.config ?? defaultConfig);
  const memory = memoryPlatform({ config: r, importPreview: PREVIEW });
  const platform = Object.assign(memory, opts.platform ?? {});
  render(<App backend={fakeBackend({ hosts })} terminalView={StubTerminal} registries={builtinRegistries()} platform={platform} config={r} />);
  await user.type(await screen.findByLabelText(/master password/i), `${FAKE_PASSWORD}{Enter}`);
  await screen.findByRole("main", { name: /workspace/i });
  return { user, platform: memory };
}

const command = async (user: User, line: string) => {
  await user.keyboard(`${LEADER}:`);
  await user.keyboard(`${line}{Enter}`);
};
const messageLine = () => document.querySelector(".message-line") as HTMLElement;

describe(":info and the terminal font", () => {
  it("names the first installed font of terminal.font, the size in px and the renderer", async () => {
    const { user } = await ready({
      config: configWith({ terminal: { ...defaultConfig.terminal, size: 64 / 3, renderer: "dom" } }),
      platform: { fontInstalled: (f) => f === "Iosevka Term" },
    });
    await command(user, "info");
    expect(messageLine()).toHaveTextContent("Terminal Iosevka Term 21.33 px, DOM");
  });

  it("is the bundled Iosevka when none of the installed ones is there", async () => {
    const { user } = await ready({ platform: { fontInstalled: () => false } });
    await command(user, "info");
    expect(messageLine()).toHaveTextContent("Terminal Iosevka 16 px, WebGL");
  });
});

describe(":config import-terminal", () => {
  it("shows the diff and what init.lua overrides, and writes nothing until Enter", async () => {
    const { user, platform } = await ready();
    await command(user, "config import-terminal");
    const dialog = await screen.findByRole("dialog", { name: "Import from Windows Terminal" });
    expect(dialog).toHaveTextContent("Font: Iosevka Nerd Font, 16 pt (21.3 px)");
    expect(within(dialog).getByText('roster.set("terminal.size", "16pt")').closest("[data-kind]")).toHaveAttribute("data-kind", "add");
    expect(dialog).toHaveTextContent("init.lua's own terminal.size wins over the import");
    expect(platform.imported()).toEqual([]);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Import from Windows Terminal" })).toBeNull();
    expect(platform.imported()).toEqual([]);
  });

  it("writes on Enter, against the file the preview read, then sources it", async () => {
    const { user, platform } = await ready();
    platform.writeConfig(report(configWith({ theme: "nord" })));
    await command(user, "config import-terminal");
    await screen.findByRole("dialog", { name: "Import from Windows Terminal" });
    await user.keyboard("{Enter}");
    expect(platform.imported()).toEqual(["abc"]);
    await screen.findByText(/Wrote Windows Terminal's profile into init\.lua/);
    expect(document.documentElement.dataset.theme).toBe("nord");
    expect(screen.queryByRole("dialog", { name: "Import from Windows Terminal" })).toBeNull();
  });

  it("says why when there's nothing to import", async () => {
    const { user, platform } = await ready();
    platform.failImport("import-terminal reads Windows Terminal's settings, so it works on Windows only");
    await command(user, "config import-terminal");
    await screen.findByText(/Can't import: import-terminal reads Windows Terminal's settings/);
  });
});
