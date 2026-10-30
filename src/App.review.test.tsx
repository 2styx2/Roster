// The interface review's fixes (ticket 29, docs/design/interface-review.md), through the App with
// the fake Backend and a stub terminal: copy, accessible names and keys, item by item.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { FAKE_PASSWORD, fakeBackend, fixtures, makeHosts, type FakeScenario } from "./backend/fake";
import { memoryPlatform } from "./platform/memory";
import { StubTerminal } from "./terminal/StubTerminal";

const LEADER = "{Control>} {/Control}";

/** The App over a fixture, unlocked when it has a lock screen. */
async function ready(scenario: FakeScenario = { hosts: makeHosts(12) }, platform = memoryPlatform()) {
  const user = userEvent.setup();
  render(<App backend={fakeBackend(scenario)} terminalView={StubTerminal} platform={platform} />);
  await user.type(await screen.findByLabelText(/master password/i), `${FAKE_PASSWORD}{Enter}`);
  await screen.findByRole("main", { name: /workspace/i });
  return user;
}

/** The App over a fixture that stops before the workspace (a start error, a lock problem). */
function start(scenario: FakeScenario, platform = memoryPlatform()) {
  const user = userEvent.setup();
  render(<App backend={fakeBackend(scenario)} terminalView={StubTerminal} platform={platform} />);
  return user;
}

describe("S1: errors show commands as code, not Markdown", () => {
  it("a Session error's message and fix have no backticks", async () => {
    const user = await ready(fixtures["not-set-up"]);
    await user.keyboard(`${LEADER}f`);
    await user.keyboard("linux-1-000{Enter}");
    const panel = await screen.findByRole("alert");
    // Details keeps roster's raw text; the message and the fix are what people read.
    const read = [...panel.querySelectorAll(".problem-message, .problem-facts dd")].map((e) => e.textContent).join(" ");
    expect(read).toContain("roster sync");
    expect(read).not.toContain("`");
    expect(within(panel).getAllByText("roster sync", { selector: "code" }).length).toBeGreaterThan(0);
  });
});

describe("S9: the start-error screen is a clean error", () => {
  it("has the message, Where, the Fix with Copy, Retry, and the raw output closed under Details", async () => {
    const platform = memoryPlatform();
    const user = start(fixtures["roster-too-old"] as FakeScenario, platform);
    const screenEl = await screen.findByRole("region", { name: "roster is too old" });
    expect(screenEl.textContent).not.toContain("`");
    expect(within(screenEl).getByText("serve", { selector: "code" })).toBeInTheDocument();
    expect(within(screenEl).getByText("Where")).toBeInTheDocument();
    expect(within(screenEl).getByText("Fix")).toBeInTheDocument();
    const details = within(screenEl).getByText("Details").closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(within(screenEl).getByRole("button", { name: "Retry" })).toHaveFocus();
    const copy = within(screenEl).getAllByRole("button", { name: "Copy" })[0] as HTMLElement;
    await user.click(copy);
    expect(await platform.clipboard.readText()).toBe("uv tool install --force --reinstall .");
  });
});
