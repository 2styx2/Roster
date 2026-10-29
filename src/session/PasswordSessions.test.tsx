// Sessions to password-only Hosts (ticket 06), through the App with the fake Backend. The password
// itself never reaches the app (roster's askpass channel hands it to ssh); what the app sees is the
// Session's auth, and the vault's refusals from `session.prepare`.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { FAKE_PASSWORD, fakeBackend, makeHosts, type FakeScenario } from "../backend/fake";
import { StubTerminal } from "../terminal/StubTerminal";

const hosts = makeHosts(12);
const isPassword = (h: (typeof hosts.hosts)[number]) => !h.enroll && h.ssh.auth.startsWith("bw:");
const passwordHost = hosts.hosts.find((h) => h.reviewed && isPassword(h))!;
const keyHost = hosts.hosts.find((h) => h.reviewed && !isPassword(h))!;

async function ready(scenario: FakeScenario = { hosts }) {
  const user = userEvent.setup();
  const backend = fakeBackend(scenario);
  render(<App backend={backend} terminalView={StubTerminal} />);
  await screen.findByText(/12 hosts/i);
  await unlock(user);
  return { user, backend };
}

async function unlock(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/master password/i), `${FAKE_PASSWORD}{Enter}`);
  await screen.findByRole("main", { name: /workspace/i });
}

async function open(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.keyboard("{Control>} {/Control}f");
  await user.keyboard(name);
  await user.keyboard("{Enter}");
}

const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(name) });
const output = () => screen.getByLabelText("terminal output", { selector: ":not([hidden]) > pre" });

describe("password Sessions", () => {
  it("open with no typing and show a hollow (password) dot on the tab", async () => {
    const { user } = await ready();
    await open(user, passwordHost.name);
    expect(await within(output()).findByText(/Connected to/)).toBeInTheDocument();
    expect(within(tab(passwordHost.name)).getByRole("img", { name: "password login" })).toHaveClass("st", "pw");
  });

  it("show a filled (key) dot for a key-enrolled Host", async () => {
    const { user } = await ready();
    await open(user, keyHost.name);
    await within(output()).findByText(/Connected to/);
    expect(within(tab(keyHost.name)).getByRole("img", { name: "key login" })).not.toHaveClass("pw");
  });

  it("bring up the lock screen when serve's vault is locked (14), and open once unlocked", async () => {
    const { user, backend } = await ready();
    // The vault locked behind the app's back (another roster command, bw's own timeout).
    await backend.lockVault();
    await open(user, passwordHost.name);
    expect(await screen.findByRole("dialog", { name: /locked/i })).toBeInTheDocument();
    await unlock(user);
    expect(await within(output()).findByText(/Connected to/)).toBeInTheDocument();
    expect(tab(passwordHost.name)).not.toHaveAccessibleName(/failed/);
  });

  it("show roster's message for a vault CLI that isn't logged in (11), without locking", async () => {
    const { user } = await ready({
      hosts,
      passwordRefusal: { code: 11, message: "Bitwarden CLI isn't logged in on this box - run `bw login` once" },
    });
    await open(user, passwordHost.name);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/bw login/);
    expect(screen.queryByRole("dialog", { name: /locked/i })).toBeNull();
  });
});
