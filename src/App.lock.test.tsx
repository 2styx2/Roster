// The Lock (ticket 04): the app opens locked, unlocks with the master password, and locks again on
// <leader> L or after the idle timeout. All through the fake Backend.
import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { FAKE_PASSWORD, fakeBackend, fixtures, makeHosts, type FakeScenario } from "./backend/fake";
import { manualClock } from "./lock/manualClock";

const MIN = 60_000;

async function start(scenario: FakeScenario = { hosts: makeHosts(12) }) {
  const backend = fakeBackend(scenario);
  const clock = manualClock();
  const user = userEvent.setup();
  render(<App backend={backend} clock={clock} />);
  await screen.findByText(/12 hosts|0 hosts/i);
  return { user, backend, clock };
}

const lockScreen = () => screen.queryByRole("dialog", { name: /locked/i });
const sessions = () => screen.queryByRole("main", { name: /sessions/i });
const passwordField = () => screen.getByLabelText<HTMLInputElement>(/master password/i);

async function unlock(user: ReturnType<typeof userEvent.setup>, password = FAKE_PASSWORD) {
  await user.type(await screen.findByLabelText(/master password/i), `${password}{Enter}`);
}

describe("the Lock", () => {
  it("opens locked, with the Sessions hidden", async () => {
    await start();
    expect(await screen.findByRole("dialog", { name: /locked/i })).toBeInTheDocument();
    expect(await screen.findByText(/unlock bitwarden/i)).toBeInTheDocument();
    expect(sessions()).toBeNull();
    expect(passwordField()).toHaveFocus();
  });

  it("unlocks with the master password and clears the field", async () => {
    const { user, backend } = await start();
    const field = await screen.findByLabelText<HTMLInputElement>(/master password/i);
    await user.type(field, `${FAKE_PASSWORD}{Enter}`);
    expect(field.value).toBe("");
    await screen.findByRole("main", { name: /sessions/i });
    expect(lockScreen()).toBeNull();
    expect((await backend.vaultStatus()).status).toBe("unlocked");
  });

  it("says when the password is wrong, clears the field and stays locked", async () => {
    const { user, backend } = await start();
    await unlock(user, "hunter2");
    expect(await screen.findByRole("alert")).toHaveTextContent(/wrong master password/i);
    expect(passwordField().value).toBe("");
    expect(passwordField()).toHaveFocus();
    expect(lockScreen()).not.toBeNull();
    expect((await backend.vaultStatus()).status).toBe("locked");
    await unlock(user);
    await screen.findByRole("main", { name: /sessions/i });
  });

  it("ignores the Leader while locked", async () => {
    const { user } = await start();
    await screen.findByLabelText(/master password/i);
    await user.keyboard("{Control>} {/Control}f");
    expect(screen.queryByRole("dialog", { name: /find a host/i })).toBeNull();
  });

  it("explains a vault CLI that isn't logged in, with the command to run", async () => {
    const { user } = await start(fixtures["not-logged-in"]);
    expect(await screen.findByText("bw login", { selector: "code" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: /locked/i })).toHaveTextContent(/isn't logged in/i);
    expect(screen.queryByLabelText(/master password/i)).toBeNull();
    await user.click(screen.getByRole("button", { name: /check again/i }));
    expect(await screen.findByText("bw login", { selector: "code" })).toBeInTheDocument();
  });

  it("explains a missing vault CLI", async () => {
    await start(fixtures["missing-cli"]);
    expect(await screen.findByText(/not installed/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/master password/i)).toBeNull();
  });

  it("skips the lock screen when no Login uses a vault with a master password", async () => {
    const { user } = await start(fixtures["no-vault"]);
    await screen.findByRole("main", { name: /sessions/i });
    expect(lockScreen()).toBeNull();
    await user.keyboard("{Control>} {/Control}L");
    expect(lockScreen()).toBeNull();
    expect(screen.getByText(/nothing to lock/i)).toBeInTheDocument();
  });

  it("locks a vault that serve left unlocked, so the app always opens locked", async () => {
    const { backend } = await start({ ...fixtures["few-hosts"]!, vault: { status: "unlocked" } });
    expect(await screen.findByLabelText(/master password/i)).toBeInTheDocument();
    expect((await backend.vaultStatus()).status).toBe("locked");
  });

  it("locks on <leader> L, and the master password unlocks again", async () => {
    const { user, backend } = await start();
    await unlock(user);
    await screen.findByRole("main", { name: /sessions/i });
    await user.keyboard("{Control>} {/Control}L");
    expect(await screen.findByRole("dialog", { name: /locked/i })).toBeInTheDocument();
    expect(sessions()).toBeNull();
    expect((await backend.vaultStatus()).status).toBe("locked");
    await unlock(user);
    await screen.findByRole("main", { name: /sessions/i });
  });

  it("locks after 15 minutes without input, counting from the last input", async () => {
    const { user, clock, backend } = await start();
    await unlock(user);
    await screen.findByRole("main", { name: /sessions/i });
    act(() => clock.advance(10 * MIN));
    await user.pointer({ target: document.body, keys: "[MouseLeft]" });
    act(() => clock.advance(14 * MIN));
    expect(lockScreen()).toBeNull();
    await user.keyboard("x");
    act(() => clock.advance(14 * MIN));
    expect(lockScreen()).toBeNull();
    act(() => clock.advance(1 * MIN));
    expect(await screen.findByRole("dialog", { name: /locked/i })).toBeInTheDocument();
    expect((await backend.vaultStatus()).status).toBe("locked");
  });

  it("takes the idle timeout from the options", async () => {
    const backend = fakeBackend({ hosts: makeHosts(12) });
    const clock = manualClock();
    const user = userEvent.setup();
    render(<App backend={backend} clock={clock} options={{ leader: "Ctrl+Space", vim: true, idleLockMinutes: 2 }} />);
    await unlock(user);
    await screen.findByRole("main", { name: /sessions/i });
    act(() => clock.advance(2 * MIN));
    expect(await screen.findByRole("dialog", { name: /locked/i })).toBeInTheDocument();
  });
});
