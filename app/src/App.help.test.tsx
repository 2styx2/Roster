// `:help` (ticket 37): Neovim-style docs inside the app, through the App with the fake Backend and
// a stub terminal. The pages come from the live registries and the guides from docs/app; this
// drives how you reach them: the topic finder (␣ ?), `:help TOPIC` with Tab completion, links,
// Ctrl+O back, search, and Esc back to where you were. user-event writes Ctrl+Space as
// {Control>} {/Control}.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { FAKE_PASSWORD, fakeBackend, makeHosts } from "./backend/fake";
import { configWith, defaultConfig } from "./config/fixture";
import type { Config, ConfigReport } from "./config/types";
import { memoryPlatform } from "./platform/memory";
import { builtinRegistries } from "./registries";
import { StubTerminal } from "./terminal/StubTerminal";

const hosts = makeHosts(12);
const LEADER = "{Control>} {/Control}";
const report = (config: Config): ConfigReport => ({ config, error: null, path: "/home/me/.config/roster/init.lua", version: 1 });

async function ready({ config, state }: { config?: Config; state?: Record<string, unknown> } = {}) {
  const user = userEvent.setup();
  const platform = memoryPlatform({ ...(config ? { config: report(config) } : {}), ...(state ? { state } : {}) });
  render(
    <App
      backend={fakeBackend({ hosts })}
      terminalView={StubTerminal}
      registries={builtinRegistries()}
      platform={platform}
      {...(config ? { config: report(config) } : {})}
    />,
  );
  await user.type(await screen.findByLabelText(/master password/i), `${FAKE_PASSWORD}{Enter}`);
  await screen.findByRole("main", { name: /workspace/i });
  return user;
}

const help = () => screen.getByRole("complementary", { name: "Help" });
const helpOrNull = () => screen.queryByRole("complementary", { name: "Help" });
const heading = () => within(help()).getAllByRole("heading", { level: 1 })[0];
const target = () => help().querySelector(".help-target");

describe(":help", () => {
  it("␣ ? finds a topic; Enter opens it at its entry, and Esc goes back where you were", async () => {
    const user = await ready();
    const before = document.activeElement;
    await user.keyboard(`${LEADER}?`);
    const finder = await screen.findByRole("dialog", { name: /find a help topic/i });
    await user.keyboard("terminal.size");
    expect(within(finder).getAllByRole("option")[0]).toHaveTextContent("terminal.size");
    await user.keyboard("{Enter}");
    expect(heading()).toHaveTextContent("Options");
    expect(target()).toHaveTextContent(/terminal\.size/);
    expect(help()).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard("{Escape}");
    expect(helpOrNull()).toBeNull();
    expect(document.activeElement).toBe(before);
  });

  it(":help TOPIC opens it; Tab completes topics; an unknown one is said", async () => {
    const user = await ready();
    await user.keyboard(`${LEADER}:help E1{Tab}`);
    expect(screen.getByRole("combobox", { name: "Command" })).toHaveValue("help E1");
    expect(within(screen.getByRole("listbox", { name: "Completions" })).getAllByRole("option")[0]).toHaveTextContent("help E1");
    await user.keyboard("3{Enter}");
    expect(heading()).toHaveTextContent("Connection errors");
    expect(target()).toHaveTextContent(/E13/);
    await user.keyboard("{Escape}");
    await user.keyboard(`${LEADER}:help zzqxj{Enter}`);
    expect(helpOrNull()).toBeNull();
    expect(document.querySelector(".message-line")).toHaveTextContent("No help for zzqxj");
  });

  it("follows links, and Ctrl+O goes back", async () => {
    const user = await ready();
    await user.keyboard(`${LEADER}:help index{Enter}`);
    expect(heading()).toHaveTextContent("roster help");
    await user.click(within(help()).getByRole("link", { name: "options" }));
    expect(heading()).toHaveTextContent("Options");
    await user.keyboard("{Control>}o{/Control}");
    expect(heading()).toHaveTextContent("roster help");
    await user.keyboard("{Control>}i{/Control}");
    expect(heading()).toHaveTextContent("Options");
  });

  it("shows each option's value and where it came from", async () => {
    const config = configWith({
      terminal: { ...defaultConfig.terminal, cursorStyle: "bar" },
      set: ["terminal.cursor_style"],
      lines: { "terminal.cursor_style": { file: "init.lua", line: 9 } },
    });
    const user = await ready({ config, state: { theme: "nord" } });
    await user.keyboard(`${LEADER}:help terminal.cursor_style{Enter}`);
    expect(target()).toHaveTextContent(/"bar".*init\.lua:9/);
    await user.keyboard(`${LEADER}:help theme{Enter}`);
    expect(target()).toHaveTextContent(/"nord".*State/);
  });

  it("/ searches the page; n moves to the next match", async () => {
    const user = await ready();
    await user.keyboard(`${LEADER}:help config{Enter}`);
    await user.keyboard("/");
    const search = within(help()).getByRole("searchbox", { name: /search this page/i });
    expect(search).toHaveFocus();
    await user.keyboard("require");
    const marks = help().querySelectorAll("mark");
    expect(marks.length).toBeGreaterThan(1);
    expect(within(help()).getByText(new RegExp(`^1 of ${marks.length}$`))).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(within(help()).getByText(new RegExp(`^2 of ${marks.length}$`))).toBeInTheDocument();
    expect(marks[1]).toHaveClass("current");
    // Esc leaves the search, then closes help.
    await user.keyboard("{Escape}");
    expect(helpOrNull()).not.toBeNull();
    await user.keyboard("n");
    expect(within(help()).getByText(new RegExp(`^3 of ${marks.length}$`))).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(helpOrNull()).toBeNull();
  });

  it("keeps its key tables when the key hints are hidden", async () => {
    const user = await ready({ config: configWith({ ui: { hints: false } }) });
    await user.keyboard(`${LEADER}:help keys{Enter}`);
    const caps = help().querySelectorAll("table .keys");
    expect(caps.length).toBeGreaterThan(10);
    for (const c of caps) expect(c).toHaveClass("binding-keys");
  });

  it("the Key bindings panel moved to ␣ K", async () => {
    const user = await ready();
    await user.keyboard(`${LEADER}K`);
    expect(screen.getByRole("complementary", { name: "Key bindings" })).toBeInTheDocument();
  });

  it("the index says where to start, and the try-it link teaches the way back", async () => {
    const user = await ready();
    await user.keyboard(`${LEADER}:help index{Enter}`);
    await user.click(within(help()).getByRole("link", { name: "links" }));
    expect(target()).toHaveTextContent("Links");
    await user.keyboard("{Control>}o{/Control}");
    expect(heading()).toHaveTextContent("roster help");
    await user.click(within(help()).getAllByRole("link", { name: "Getting started" })[0] as HTMLElement);
    expect(heading()).toHaveTextContent("Getting started with roster");
  });

  it("Ctrl+] follows the link you're on, as in Neovim", async () => {
    const user = await ready();
    await user.keyboard(`${LEADER}:help index{Enter}`);
    within(help()).getByRole("link", { name: "options" }).focus();
    await user.keyboard("{Control>}]{/Control}");
    expect(heading()).toHaveTextContent("Options");
  });

  it("g O lists the page's headings; Enter goes to one", async () => {
    const user = await ready();
    await user.keyboard(`${LEADER}:help config{Enter}`);
    await user.keyboard("gO");
    const outline = await screen.findByRole("dialog", { name: /outline/i });
    await user.keyboard("sandbox");
    expect(within(outline).getAllByRole("option")[0]).toHaveTextContent("The sandbox");
    await user.keyboard("{Enter}");
    expect(heading()).toHaveTextContent("The Config");
    expect(target()).toHaveTextContent("The sandbox");
  });

  it(":helpgrep searches every page's text; Enter opens it there with the word found", async () => {
    const user = await ready();
    await user.keyboard(`${LEADER}:helpgrep bytecode{Enter}`);
    const grep = await screen.findByRole("dialog", { name: /search every help page/i });
    const first = within(grep).getAllByRole("option")[0] as HTMLElement;
    expect(first).toHaveTextContent(/bytecode/);
    expect(first).toHaveTextContent(/The sandbox/);
    await user.keyboard("{Enter}");
    expect(heading()).toHaveTextContent("The Config");
    expect(within(help()).getByRole("searchbox", { name: /search this page/i })).toHaveValue("bytecode");
    expect(help().querySelector("mark.current")).toHaveTextContent(/bytecode/i);
  });

  it("opens the CLI's docs too: :help roster.yml", async () => {
    const user = await ready();
    await user.keyboard(`${LEADER}:help roster.yml{Enter}`);
    expect(heading()).toHaveTextContent("roster CLI reference");
    expect(target()).toHaveTextContent("roster.yml");
  });
});
