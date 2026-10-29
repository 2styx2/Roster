import { describe, expect, it } from "vitest";
import { fakeBackend, makeHosts, type FakeScenario } from "../backend/fake";
import { Tabs } from "./tabs";

const hosts = makeHosts(12);
const reviewed = hosts.hosts.filter((h) => h.reviewed).map((h) => h.name);
const unreviewed = hosts.hosts.find((h) => !h.reviewed)!.name;

const text = (chunks: Uint8Array[]) => chunks.map((c) => new TextDecoder().decode(c)).join("");
const settle = () => new Promise((r) => setTimeout(r, 10));

/** The fake Backend, noting which Hosts' Sessions were closed. */
function recordingCloses(scenario: FakeScenario) {
  const backend = fakeBackend(scenario);
  const closed: string[] = [];
  const open = backend.openSession.bind(backend);
  backend.openSession = async (host, size, events) => {
    const s = await open(host, size, events);
    return { ...s, close: () => (closed.push(host), s.close()) };
  };
  return { backend, closed };
}

/** Store plus a way to see a tab's terminal output. */
function setup() {
  const tabs = new Tabs(fakeBackend({ hosts }));
  const screens = new Map<number, Uint8Array[]>();
  const attach = (id: number) => {
    const seen: Uint8Array[] = [];
    screens.set(id, seen);
    return tabs.attach(id, (d) => seen.push(d));
  };
  const screen = (id: number) => text(screens.get(id) ?? []);
  return { tabs, attach, screen };
}

describe("Tabs", () => {
  it("opens a Session in a new active tab and shows its output", async () => {
    const { tabs, attach, screen } = setup();
    const id = tabs.open(reviewed[0]!);
    expect(tabs.snapshot().active).toBe(id);
    expect(tabs.snapshot().tabs[0]).toMatchObject({ id, host: reviewed[0], status: { state: "connecting" } });
    attach(id);
    await settle();
    expect(tabs.snapshot().tabs[0]!.status).toEqual({ state: "open" });
    expect(screen(id)).toContain(`Connected to ${reviewed[0]}`);
  });

  it("sends keystrokes, Esc included, to the Session", async () => {
    const { tabs, attach, screen } = setup();
    const id = tabs.open(reviewed[0]!);
    attach(id);
    await settle();
    tabs.write(id, "vim\x1b");
    expect(screen(id)).toContain("vim^[");
  });

  it("replays earlier output to a terminal that attaches again", async () => {
    const { tabs, attach, screen } = setup();
    const id = tabs.open(reviewed[0]!);
    attach(id)();
    await settle();
    tabs.write(id, "ls");
    attach(id);
    expect(screen(id)).toMatch(/Connected to .*ls$/s);
  });

  it("shows roster's refusal in the tab, with its code", async () => {
    const { tabs } = setup();
    tabs.open(unreviewed);
    await settle();
    expect(tabs.snapshot().tabs[0]!.status).toEqual({
      state: "failed",
      code: 20,
      message: `${unreviewed} is not reviewed yet (reviewed: false in roster.yml) - not logging in`,
    });
  });

  it("marks the tab ended with the exit code when the Session ends", async () => {
    const { tabs, attach } = setup();
    const id = tabs.open(reviewed[0]!);
    attach(id);
    await settle();
    tabs.write(id, "exit\r");
    await settle();
    expect(tabs.snapshot().tabs[0]!.status).toEqual({ state: "ended", exit: { code: 0, closed: false } });
  });

  it("closing a tab ends its Session and activates a neighbour", async () => {
    const { backend, closed } = recordingCloses({ hosts });
    const tabs = new Tabs(backend);
    const a = tabs.open(reviewed[0]!);
    const b = tabs.open(reviewed[1]!);
    const c = tabs.open(reviewed[2]!);
    await settle();
    tabs.select(b);
    tabs.close(b);
    expect(closed).toEqual([reviewed[1]]);
    expect(tabs.snapshot().tabs.map((t) => t.id)).toEqual([a, c]);
    expect(tabs.snapshot().active).toBe(c);
    tabs.close(c);
    tabs.close(a);
    expect(tabs.snapshot()).toEqual({ tabs: [], active: null });
  });

  it("closes a Session that finishes opening after its tab was closed", async () => {
    const { backend, closed } = recordingCloses({ hosts, delay: 5 });
    const tabs = new Tabs(backend);
    tabs.close(tabs.open(reviewed[0]!));
    expect(closed).toEqual([]);
    await settle();
    expect(closed).toEqual([reviewed[0]]);
  });

  it("tells the Session the terminal's size once it's open", async () => {
    const { tabs, attach, screen } = setup();
    const id = tabs.open(reviewed[0]!);
    attach(id);
    tabs.resize(id, { cols: 132, rows: 43 });
    await settle();
    expect(screen(id)).toContain("[resized to 132x43]");
    // and the next tab starts at that size
    const next = tabs.open(reviewed[1]!);
    attach(next);
    await settle();
    expect(screen(next)).toContain("(fake, 132x43)");
  });
});
