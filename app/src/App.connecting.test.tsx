// Connecting (issue #78, item 1): while a Session connects or logs in, its Sidebar row and its pane
// say so in words (a node and an edge being drawn, never a spinner), and both end in live, ended
// or an error.
import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { FAKE_PASSWORD, fakeBackend, makeHosts } from "./backend/fake";
import type { SessionEvents } from "./backend/types";
import { StubTerminal } from "./terminal/StubTerminal";

const hosts = makeHosts(12);
const HOST = hosts.hosts.find((h) => h.reviewed && h.enroll)!;

/** The fake Backend, with each Session's output and exit driven by the test. */
function scripted() {
  const backend = fakeBackend({ hosts });
  let events: SessionEvents | null = null;
  backend.openSession = async (_host, _size, ev) => {
    events = ev;
    const done = async () => {};
    return { id: 1, auth: "key", write: done, resize: done, close: done };
  };
  const session = () => {
    if (!events) throw new Error("no Session yet");
    const ev = events;
    return {
      print: (s: string) => ev.output(new TextEncoder().encode(s)),
      exit: (code: number) => ev.exit({ code, closed: false }),
    };
  };
  return { backend, session };
}

async function ready(backend: ReturnType<typeof fakeBackend>) {
  const user = userEvent.setup();
  render(<App backend={backend} terminalView={StubTerminal} />);
  await user.type(await screen.findByLabelText(/master password/i), `${FAKE_PASSWORD}{Enter}`);
  await screen.findByRole("main", { name: /workspace/i });
  return user;
}

const sessionRow = () => within(screen.getByRole("group", { name: "Sessions" })).getByRole("treeitem", { current: true });
const pane = () => screen.getByRole("group", { name: `Session ${HOST.name}` });

describe("connecting", () => {
  it("shows the Session connecting in its row and its pane until the shell answers", async () => {
    const { backend, session } = scripted();
    const user = await ready(backend);
    await user.keyboard(`{Control>} {/Control}:connect ${HOST.name}{Enter}`);
    const card = await within(pane()).findByRole("status", { name: `Connecting to ${HOST.name}` });
    expect(card).toHaveTextContent(HOST.ip);
    expect(sessionRow()).toHaveAccessibleName(new RegExp(`^${HOST.name}, connecting`));
    // ssh has started and is logging in: still connecting, in words that say so.
    expect(await within(card).findByText("Logging in…")).toBeInTheDocument();
    session().print("Last login: today\r\n$ ");
    await waitFor(() => expect(within(pane()).queryByRole("status", { name: /^Connecting/ })).toBeNull());
    expect(sessionRow()).toHaveAccessibleName(new RegExp(`^${HOST.name}, key login`));
    expect(sessionRow().closest("li")).toHaveClass("live");
  });

  it("ends in ended, and connects again on reconnect", async () => {
    const { backend, session } = scripted();
    const user = await ready(backend);
    await user.keyboard(`{Control>} {/Control}:connect ${HOST.name}{Enter}`);
    await within(pane()).findByText("Logging in…");
    session().print("$ ");
    session().exit(0);
    await waitFor(() => expect(sessionRow()).toHaveAccessibleName(new RegExp(`^${HOST.name}, ended`)));
    expect(within(pane()).queryByRole("status", { name: /^Connecting/ })).toBeNull();
    await user.keyboard("{Control>} {/Control}r");
    expect(await within(pane()).findByRole("status", { name: `Reconnecting to ${HOST.name}` })).toBeInTheDocument();
    expect(sessionRow()).toHaveAccessibleName(new RegExp(`^${HOST.name}, connecting`));
  });
});
