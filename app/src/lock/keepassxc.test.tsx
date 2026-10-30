// Ticket 25: the lock screen with KeePassXC (`kp`) as the vault, through the App and the fake Backend.
// It works exactly as with Bitwarden; only the name changes, and "not logged in" means no database here.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { FAKE_PASSWORD, fakeBackend, fixtures, type FakeScenario } from "../backend/fake";
import { memoryPlatform } from "../platform/memory";
import { StubTerminal } from "../terminal/StubTerminal";

function start(scenario: FakeScenario) {
  const user = userEvent.setup();
  render(<App backend={fakeBackend(scenario)} terminalView={StubTerminal} platform={memoryPlatform()} />);
  return user;
}

describe("the lock screen names KeePassXC", () => {
  it("asks for KeePassXC's master password, says when it's wrong, and unlocks", async () => {
    const user = start(fixtures["keepassxc"] as FakeScenario);
    const dialog = await screen.findByRole("dialog", { name: "Locked" });
    expect(await within(dialog).findByText("Unlock KeePassXC to continue.")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/master password/i), "nope{Enter}");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Wrong master password");
    await user.type(within(dialog).getByLabelText(/master password/i), `${FAKE_PASSWORD}{Enter}`);
    expect(await screen.findByRole("main", { name: /workspace/i })).toBeInTheDocument();
  });

  it("says this Box has no database, with roster's fix, instead of asking for a password", async () => {
    start(fixtures["keepassxc-no-database"] as FakeScenario);
    const dialog = await screen.findByRole("dialog", { name: "KeePassXC has no database on this Box" });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("roster.kdbx isn't there");
    expect(within(dialog).queryByLabelText(/master password/i)).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Check again" })).toBeInTheDocument();
  });

  it("says the KeePassXC CLI isn't installed", async () => {
    start({ ...(fixtures["keepassxc"] as FakeScenario), vault: { status: "missing-cli", provider: "kp" } });
    expect(await screen.findByRole("dialog", { name: "The KeePassXC CLI isn't installed" })).toBeInTheDocument();
  });
});
