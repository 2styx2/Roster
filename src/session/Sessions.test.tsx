// Sessions in tabs, through the App with the fake Backend and a stub terminal (xterm itself
// isn't run in jsdom; its key filter is tested in terminal/keys.test.ts).
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";
import { fakeBackend, fixtures, makeHosts } from "../backend/fake";
import { StubTerminal } from "../terminal/StubTerminal";

const hosts = makeHosts(12);
const reviewed = hosts.hosts.filter((h) => h.reviewed);

async function ready(scenario = { hosts }) {
  const user = userEvent.setup();
  render(<App backend={fakeBackend(scenario)} terminalView={StubTerminal} />);
  await screen.findByText(/12 hosts/i);
  return user;
}

async function openFromPicker(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.keyboard("{Control>} {/Control}f");
  await user.keyboard(name);
  await user.keyboard("{Enter}");
}

const output = () => screen.getByLabelText("terminal output", { selector: ":not([hidden]) > pre" });

describe("Sessions", () => {
  it("Enter in the Picker opens the Host in a new tab with its terminal focused", async () => {
    const user = await ready();
    await openFromPicker(user, reviewed[0]!.name);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("tab", { name: new RegExp(reviewed[0]!.name) })).toHaveAttribute("aria-selected", "true");
    expect(await within(output()).findByText(/Connected to/)).toBeInTheDocument();
    expect(document.activeElement).toHaveAccessibleName("terminal input");
  });

  it("sends every key to the shell, Esc included, but not the Leader", async () => {
    const user = await ready();
    await openFromPicker(user, reviewed[0]!.name);
    await within(output()).findByText(/Connected to/);
    await user.keyboard("vi{Escape}");
    expect(output()).toHaveTextContent(/vi\^\[$/);
    await user.keyboard("{Control>} {/Control}f");
    expect(screen.getByRole("dialog", { name: /find a host/i })).toBeInTheDocument();
    expect(output().textContent).not.toMatch(/\0|f$/);
  });

  it("goes back to the terminal when the Picker is closed with Esc", async () => {
    const user = await ready();
    await openFromPicker(user, reviewed[0]!.name);
    await user.keyboard("{Control>} {/Control}f{Escape}");
    expect(document.activeElement).toHaveAccessibleName("terminal input");
  });

  it("switches and closes tabs, ending the Session", async () => {
    const user = await ready();
    await openFromPicker(user, reviewed[0]!.name);
    await openFromPicker(user, reviewed[1]!.name);
    const [first, second] = screen.getAllByRole("tab");
    expect(second).toHaveAttribute("aria-selected", "true");
    await user.click(first!);
    expect(first).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("button", { name: `Close ${reviewed[0]!.name}` }));
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(screen.getByRole("tab")).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("button", { name: `Close ${reviewed[1]!.name}` }));
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByText(/No Sessions open/)).toBeInTheDocument();
  });

  it("shows roster's refusal inline in the tab", async () => {
    const user = await ready(fixtures["not-set-up"]!);
    await openFromPicker(user, reviewed[0]!.name);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/isn't in this box's ssh config/);
    expect(alert).toHaveTextContent(/roster sync/);
  });

  it("shows that a Session ended, with its exit code", async () => {
    const user = await ready();
    await openFromPicker(user, reviewed[0]!.name);
    await within(output()).findByText(/Connected to/);
    await user.keyboard("exit{Enter}");
    expect(await screen.findByRole("tab", { name: /ended \(code 0\)/ })).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("ended (code 0)");
  });
});
