// The interface review's fixes (ticket 29, docs/design/interface-review.md), through the App with
// the fake Backend and a stub terminal: copy, accessible names and keys, item by item.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { FAKE_EMAIL, FAKE_PASSWORD, fakeBackend, fixtures, makeHosts, type FakeScenario } from "./backend/fake";
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

describe("S2: a key closes the side panels", () => {
  it("Esc in App mode closes the :check panel, then the Key bindings panel", async () => {
    const user = await ready({ hosts: makeHosts(12), apiVersion: 3 });
    await user.keyboard(`${LEADER}:check linux-1-000{Enter}`);
    expect(await screen.findByRole("region", { name: "Check linux-1-000" })).toBeInTheDocument();
    await user.keyboard(`${LEADER}{Escape}`);
    expect(screen.queryByRole("region", { name: "Check linux-1-000" })).toBeNull();
  });

  it(":hidepanel closes the topmost panel, so init.lua can bind it", async () => {
    const user = await ready();
    await user.keyboard(`${LEADER}?`);
    expect(screen.getByRole("complementary", { name: "Key bindings" })).toBeInTheDocument();
    await user.keyboard(`${LEADER}:hidepanel{Enter}`);
    expect(screen.queryByRole("complementary", { name: "Key bindings" })).toBeNull();
  });
});

describe("S3: the Leader keycap reads as Leader", () => {
  it('names a key hint "Leader f", never with the ␣ glyph', async () => {
    await ready();
    const find = within(screen.getByRole("navigation", { name: "Sidebar" })).getByRole("button", { name: /^Find a Host/ });
    expect(find).toHaveAccessibleName("Find a Host, Leader f");
  });
});

describe("S4: :check announces each step's result", () => {
  it("says passed, failed or skipped in words", async () => {
    const user = await ready({ hosts: makeHosts(12), apiVersion: 3 });
    await user.keyboard(`${LEADER}:check linux-1-000{Enter}`);
    const region = await screen.findByRole("region", { name: "Check linux-1-000" });
    const steps = await within(region).findAllByRole("listitem");
    expect(steps[0]).toHaveTextContent(/passed/);
    expect(steps[0]?.querySelector(".check-mark")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("S5: sign-in fields say when they were refused", () => {
  it("marks the master password invalid, described by the error, only while there is one", async () => {
    const user = start(fixtures["sign-in"] as FakeScenario);
    const dialog = await screen.findByRole("dialog", { name: /sign in/i });
    await user.keyboard("{Enter}");
    await user.type(within(dialog).getByLabelText(/email/i), `${FAKE_EMAIL}{Enter}`);
    const pw = within(dialog).getByLabelText(/master password/i);
    expect(pw).not.toHaveAttribute("aria-invalid");
    expect(pw).not.toHaveAttribute("aria-describedby");
    await user.type(pw, "wrong{Enter}");
    await within(dialog).findByRole("alert");
    expect(pw).toHaveAttribute("aria-invalid", "true");
    expect(pw).toHaveAccessibleDescription(/didn't accept that email and master password/i);
  });
});
