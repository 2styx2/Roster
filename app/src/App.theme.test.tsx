// The `:theme` picker through the App (ticket 30, decision Q51): a finder over every registered
// Theme that previews live (the UI's tokens and the terminal's colours), reverts on Esc, keeps
// the choice in the State on Enter, and gives way to init.lua's `theme`. `:theme NAME` too, in
// Standard and Focus. Fake Backend, stub terminal; user-event writes Ctrl+Space as {Control>} {/Control}.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { FAKE_PASSWORD, fakeBackend, makeHosts } from "./backend/fake";
import { configWith } from "./config/fixture";
import type { ConfigReport } from "./config/types";
import { memoryPlatform } from "./platform/memory";
import { builtinRegistries } from "./registries";
import { StubTerminal } from "./terminal/StubTerminal";

const hosts = makeHosts(6);
const host = hosts.hosts.find((h) => h.reviewed)!.name;
const LEADER = "{Control>} {/Control}";
type User = ReturnType<typeof userEvent.setup>;

async function ready(opts: { state?: Record<string, unknown>; config?: ConfigReport } = {}) {
  const user = userEvent.setup();
  const platform = memoryPlatform({ state: opts.state ?? { version: 1, recentHosts: [], folded: [], keepMe: 7 } });
  render(
    <App
      backend={fakeBackend({ hosts })}
      terminalView={StubTerminal}
      registries={builtinRegistries()}
      platform={platform}
      config={opts.config ?? null}
    />,
  );
  await user.type(await screen.findByLabelText(/master password/i), `${FAKE_PASSWORD}{Enter}`);
  await screen.findByRole("main", { name: /workspace/i });
  await user.keyboard(`${LEADER}f`);
  await user.keyboard(`${host}{Enter}`);
  await within(output()).findByText(new RegExp(`Connected to ${host}`));
  return { user, platform };
}

const output = () => screen.getByLabelText("terminal output", { selector: ":not([hidden]) > pre" });
const termBackground = () => output().parentElement?.getAttribute("data-background");
const themeOnScreen = () => document.documentElement.dataset.theme;
const picker = () => screen.getByRole("dialog", { name: "Choose a Theme" });
const selected = () => within(picker()).getByRole("option", { selected: true });
const flush = () => new Promise((r) => setTimeout(r, 0));

async function command(user: User, line: string) {
  await user.keyboard(`${LEADER}:`);
  await user.keyboard(`${line}{Enter}`);
}

describe("The :theme picker", () => {
  it("previews the Theme under the cursor, terminal included, and Esc puts the old one back", async () => {
    const { user, platform } = await ready();
    expect(themeOnScreen()).toBe("roster-dark");
    await command(user, "theme");
    expect(selected()).toHaveAttribute("data-label", "Roster dark");
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(selected()).toHaveAttribute("data-label", "Gruvbox Dark");
    expect(themeOnScreen()).toBe("gruvbox");
    expect(termBackground()).toBe("#282828");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Choose a Theme" })).toBeNull();
    expect(themeOnScreen()).toBe("roster-dark");
    expect(termBackground()).toBe("#08090a");
    await flush();
    expect((platform.saved() as Record<string, unknown> | undefined)?.theme).toBeUndefined();
  });

  it("Enter keeps the choice in the State, next to keys it doesn't know", async () => {
    const { user, platform } = await ready();
    await command(user, "theme");
    await user.keyboard("catppuccin{Enter}");
    expect(themeOnScreen()).toBe("catppuccin-mocha");
    await flush();
    expect(platform.saved()).toMatchObject({ theme: "catppuccin-mocha", keepMe: 7 });
  });

  it("starts with the State's choice selected", async () => {
    const { user } = await ready({ state: { theme: "nord" } });
    expect(themeOnScreen()).toBe("nord");
    await command(user, "theme");
    expect(selected()).toHaveAttribute("data-label", "Nord");
  });

  it("lets init.lua's theme win: the picker says so, previews, and keeps nothing", async () => {
    const config: ConfigReport = { config: configWith({ theme: "tokyo-night" }), error: null, path: "/x/init.lua", version: 1 };
    const { user, platform } = await ready({ state: { theme: "nord" }, config });
    expect(themeOnScreen()).toBe("tokyo-night");
    await command(user, "theme");
    expect(within(picker()).getByText(/set in init\.lua/)).toBeInTheDocument();
    expect(selected()).toHaveAttribute("data-label", "Tokyo Night");
    await user.keyboard("{ArrowUp}");
    expect(themeOnScreen()).toBe("catppuccin-mocha");
    await user.keyboard("{Enter}");
    expect(themeOnScreen()).toBe("tokyo-night");
    expect(await screen.findByText(/set in init\.lua \(theme = "tokyo-night"\)/)).toBeInTheDocument();
    await flush();
    expect((platform.saved() as Record<string, unknown> | undefined)?.theme ?? "nord").toBe("nord");
  });

  for (const mode of ["standard", "focus"] as const) {
    it(`:theme NAME switches straight away in ${mode}, and an unknown name says so`, async () => {
      const { user, platform } = await ready();
      if (mode === "focus") await command(user, "mode focus");
      expect(document.querySelector(".screen.app")?.getAttribute("data-view")).toBe(mode);
      await command(user, "theme tokyo-night");
      expect(themeOnScreen()).toBe("tokyo-night");
      expect(termBackground()).toBe("#1a1b26");
      await flush();
      expect(platform.saved()).toMatchObject({ theme: "tokyo-night" });
      await command(user, "theme nope");
      expect(await screen.findByText(/No Theme named nope/)).toBeInTheDocument();
      expect(themeOnScreen()).toBe("tokyo-night");
    });
  }
});
