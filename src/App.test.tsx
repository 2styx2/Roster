import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { FAKE_PASSWORD, fakeBackend, fixtures, makeHosts } from "./backend/fake";
import { StubTerminal } from "./terminal/StubTerminal";

async function ready(scenario = { hosts: makeHosts(12) }) {
  const backend = fakeBackend(scenario);
  const user = userEvent.setup();
  render(<App backend={backend} terminalView={StubTerminal} />);
  await screen.findByText(/12 hosts/i);
  // The app opens locked (ticket 04).
  await user.type(await screen.findByLabelText(/master password/i), `${FAKE_PASSWORD}{Enter}`);
  await screen.findByRole("main", { name: /workspace/i });
  return { user, backend };
}

const pickerOpen = () => screen.queryByRole("dialog", { name: /find a host/i }) !== null;

describe("App", () => {
  it("connects to the Backend and says which one, with the Host count", async () => {
    await ready();
    expect(screen.getByText(/Fake/)).toBeInTheDocument();
    expect(pickerOpen()).toBe(false);
  });

  it("opens the Picker with the Leader then f", async () => {
    const { user } = await ready();
    await user.keyboard("f");
    expect(pickerOpen()).toBe(false);
    await user.keyboard("{Control>} {/Control}f");
    expect(pickerOpen()).toBe(true);
    expect(screen.getAllByRole("option")).toHaveLength(12);
  });

  it("ignores an unbound key after the Leader, and Esc leaves App mode", async () => {
    const { user } = await ready();
    await user.keyboard("{Control>} {/Control}x");
    expect(pickerOpen()).toBe(false);
    await user.keyboard("{Escape}f");
    expect(pickerOpen()).toBe(false);
  });

  it("opens the Picker with a click", async () => {
    const { user } = await ready();
    await user.click(within(screen.getByRole("main")).getByRole("button", { name: /find a host/i }));
    expect(pickerOpen()).toBe(true);
  });

  it("opens the Picker from the Sidebar's button too", async () => {
    const { user } = await ready();
    await user.click(within(screen.getByRole("navigation", { name: "Sidebar" })).getByRole("button", { name: /find a host/i }));
    expect(pickerOpen()).toBe(true);
  });

  it("closes the Picker with Esc and gives focus back", async () => {
    const { user } = await ready();
    const before = document.activeElement;
    await user.keyboard("{Control>} {/Control}f");
    await user.keyboard("{Escape}");
    expect(pickerOpen()).toBe(false);
    expect(document.activeElement).toBe(before);
  });

  it("remembers the Host you picked and lists it first next time", async () => {
    const { user } = await ready();
    await user.keyboard("{Control>} {/Control}f");
    const target = screen.getAllByRole("option")[5]!.dataset.host!;
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");
    expect(pickerOpen()).toBe(false);
    const sessions = screen.getByRole("region", { name: "Sessions" });
    expect(within(sessions).getByRole("button", { current: true })).toHaveAccessibleName(new RegExp(`^${target}`));
    await user.keyboard("{Control>} {/Control}f");
    expect(screen.getAllByRole("option")[0]!.dataset.host).toBe(target);
  });

  it("explains a roster that's too old and how to fix it", async () => {
    render(<App backend={fakeBackend(fixtures["roster-too-old"]!)} />);
    expect(await screen.findByRole("heading", { name: /roster is too old/i })).toBeInTheDocument();
    expect(screen.getByText(/has no `serve` command/)).toBeInTheDocument();
    expect(screen.getByText(/ROSTER_DESK_ROSTER/)).toBeInTheDocument();
    expect(screen.getByText(/invalid choice: 'serve'/)).toBeInTheDocument();
  });

  it.each([
    ["roster-missing", /roster wasn't found/i],
    ["inventory-missing", /no inventory/i],
    ["no-wsl", /no wsl/i],
  ])("explains %s", async (name, heading) => {
    render(<App backend={fakeBackend(fixtures[name]!)} />);
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
  });

  it("retries with a fresh Backend from the error screen", async () => {
    const backend = fakeBackend({ ...fixtures["roster-too-old"]!, hosts: makeHosts(3), failOnce: true });
    const connect = vi.spyOn(backend, "connect");
    const user = userEvent.setup();
    render(<App backend={backend} />);
    await user.click(await screen.findByRole("button", { name: /retry/i }));
    expect(await screen.findByText(/3 hosts/i)).toBeInTheDocument();
    expect(connect).toHaveBeenLastCalledWith({ restart: true });
  });

  it("shows a failed hosts.list as an error too", async () => {
    const backend = fakeBackend({ hosts: makeHosts(3) });
    vi.spyOn(backend, "listHosts").mockRejectedValue(new Error("the backend exited (code Some(1))"));
    render(<App backend={backend} />);
    expect(await screen.findByText(/the backend exited/)).toBeInTheDocument();
  });
});
