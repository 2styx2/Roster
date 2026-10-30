import { describe, expect, it } from "vitest";
import { fakeBackend, makeHosts, type FakeScenario } from "../backend/fake";
import type { SessionEvents } from "../backend/types";
import { Tabs, type TabStatus } from "./tabs";

const hosts = makeHosts(12);
const reviewed = hosts.hosts.filter((h) => h.reviewed).map((h) => h.name);
const unreviewed = hosts.hosts.find((h) => !h.reviewed)!.name;

const text = (chunks: Uint8Array[]) => chunks.map((c) => new TextDecoder().decode(c)).join("");
const settle = () => new Promise((r) => setTimeout(r, 10));
/** serve's vault unlocked, as behind an unlocked lock screen (password Hosts need it). */
const unlocked = { vault: { status: "unlocked" } } as const;

/** The fake Backend, noting which Hosts' Sessions were closed. */
function recordingCloses(scenario: FakeScenario) {
  const backend = fakeBackend({ ...unlocked, ...scenario });
  const closed: string[] = [];
  const open = backend.openSession.bind(backend);
  backend.openSession = async (host, size, events) => {
    const s = await open(host, size, events);
    return { ...s, close: () => (closed.push(host), s.close()) };
  };
  return { backend, closed };
}

/** The fake Backend, but each Session's output and exit are driven by the test (per Host). */
function scriptedSessions() {
  const backend = fakeBackend({ ...unlocked, hosts });
  const events = new Map<string, SessionEvents>();
  const typed = new Map<string, string>();
  backend.openSession = async (host, _size, ev) => {
    events.set(host, ev);
    const done = async () => {};
    const write = async (data: string) => void typed.set(host, (typed.get(host) ?? "") + data);
    return { id: events.size, auth: "key", write, resize: done, close: done };
  };
  const session = (host: string) => {
    const ev = events.get(host);
    if (!ev) throw new Error(`no Session to ${host}`);
    return {
      print: (s: string | Uint8Array) => ev.output(typeof s === "string" ? new TextEncoder().encode(s) : s),
      exit: (code: number) => ev.exit({ code, closed: false }),
    };
  };
  return { backend, session, typed };
}

const problemOf = (status: TabStatus | undefined) => (status?.state === "ended" ? status.problem : undefined);

/** Store plus a way to see a tab's terminal output. */
function setup() {
  const tabs = new Tabs(fakeBackend({ ...unlocked, hosts }));
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

  it("keeps keys typed before the Session finished opening (ConPTY's ESC[6n answer)", async () => {
    const { tabs, attach, screen } = setup();
    const id = tabs.open(reviewed[0]!);
    attach(id);
    tabs.write(id, "\x1b[1;1R");
    await settle();
    expect(screen(id)).toContain("^[[1;1R");
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
    expect(tabs.snapshot().tabs[0]!.status).toMatchObject({
      state: "failed",
      code: 20,
      message: `${unreviewed} is not reviewed yet (reviewed: false in roster.yml) - not logging in`,
    });
  });

  it("keeps a refusal's code, fix and data as the tab's Problem", async () => {
    const host = reviewed[0]!;
    const message = `no vault item named '${host} shh' (ssh Login of ${host}) - did you mean: '${host} ssh'`;
    const fix = `fix the name in ${host}'s auth: in roster.yml, or rename the item in the vault`;
    const tabs = new Tabs(
      fakeBackend({ ...unlocked, hosts, refusals: { [host]: { code: 32, message, data: { fix, near: [`${host} ssh`] } } } }),
    );
    tabs.open(host);
    await settle();
    const status = tabs.snapshot().tabs[0]!.status;
    expect(status.state === "failed" && status.problem).toEqual({
      code: 32,
      host,
      message,
      fix,
      details: `[32] ${message}`,
      data: { near: [`${host} ssh`] },
    });
  });

  it("classifies ssh's failure from the tab's last output when it exits 255", async () => {
    const host = reviewed[0]!;
    const tabs = new Tabs(
      fakeBackend({
        ...unlocked,
        hosts,
        sshFailures: { [host]: "\x1b[0mssh: connect to host 10.0.0.6 port 2222: Connection refused\r\n" },
      }),
    );
    tabs.open(host);
    await settle();
    const status = tabs.snapshot().tabs[0]!.status;
    expect(status).toMatchObject({ state: "ended", exit: { code: 255 } });
    expect(status.state === "ended" && status.problem).toMatchObject({
      code: 41,
      host,
      message: `${host} (10.0.0.6:2222) refused the connection`,
      details: "ssh: connect to host 10.0.0.6 port 2222: Connection refused",
    });
  });

  it("looks only at the latest attempt's output when classifying", async () => {
    const host = hosts.hosts.find((h) => h.reviewed && h.enroll)!.name;
    const scenario: FakeScenario = {
      ...unlocked,
      hosts,
      sshFailures: { [host]: "ssh: Could not resolve hostname x.lab: Name or service not known\r\n" },
    };
    const tabs = new Tabs(fakeBackend(scenario));
    const id = tabs.open(host);
    await settle();
    scenario.sshFailures = { [host]: "admin@x: Permission denied (publickey).\r\n" };
    tabs.reconnect(id);
    await settle();
    const status = tabs.snapshot().tabs[0]!.status;
    expect(status.state === "ended" && status.problem?.code).toBe(46);
  });

  it("decodes each tab's output on its own, even with a character split across chunks", async () => {
    const { backend, session } = scriptedSessions();
    const tabs = new Tabs(backend);
    const [a, b] = [reviewed[0]!, reviewed[1]!];
    tabs.open(a);
    tabs.open(b);
    await settle();
    const arrow = new TextEncoder().encode("→"); // 3 bytes
    session(a).print("ssh: connect to host 10.0.0.6 port 22: Connection refused ");
    session(a).print(arrow.slice(0, 2));
    session(b).print("ssh: connect to host 10.0.0.7 port 22: Connection refused\r\n");
    session(a).print(arrow.slice(2));
    session(a).print("\r\n");
    session(a).exit(255);
    session(b).exit(255);
    await settle();
    const [ta, tb] = tabs.snapshot().tabs;
    expect(problemOf(ta?.status)?.details).toBe("ssh: connect to host 10.0.0.6 port 22: Connection refused →");
    expect(problemOf(tb?.status)?.details).toBe("ssh: connect to host 10.0.0.7 port 22: Connection refused");
  });

  describe("classifies only what ssh printed before the login (the pre-auth window)", () => {
    /** A clock the test moves. */
    function clock() {
      let t = 1_000_000;
      return { now: () => t, advance: (ms: number) => void (t += ms) };
    }
    const CHANGED_KEY = [
      "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@",
      "@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @",
      "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@",
      "Host key verification failed.",
      "",
    ].join("\r\n");

    it("still classifies ssh's own failure inside the window", async () => {
      const { backend, session } = scriptedSessions();
      const c = clock();
      const tabs = new Tabs(backend, { now: c.now });
      const host = reviewed[0]!;
      tabs.open(host);
      await settle();
      c.advance(9_000); // ConnectTimeout is 10 s
      session(host).print(CHANGED_KEY);
      session(host).exit(255);
      await settle();
      expect(problemOf(tabs.snapshot().tabs[0]?.status)?.code).toBe(43);
    });

    it("a nested ssh failing on the Host, then the Session ending 255, is a dropped Session (row 20)", async () => {
      const { backend, session } = scriptedSessions();
      const c = clock();
      const tabs = new Tabs(backend, { now: c.now });
      const host = reviewed[0]!;
      tabs.open(host);
      await settle();
      session(host).print("Last login: Tue Oct 28 09:12:01 2026\r\nadmin@web-1:~$ ");
      c.advance(60_000);
      session(host).print("ssh other\r\n");
      session(host).print(CHANGED_KEY);
      session(host).print("admin@other: Permission denied (publickey,password).\r\nadmin@web-1:~$ exit\r\n");
      session(host).exit(255);
      await settle();
      const problem = problemOf(tabs.snapshot().tabs[0]?.status);
      expect(problem?.code).toBe("dropped");
      expect(problem?.message).toContain(host);
    });

    it("ignores a `roster askpass:` line the Host prints after the window", async () => {
      const { backend, session } = scriptedSessions();
      const c = clock();
      const tabs = new Tabs(backend, { now: c.now });
      const host = reviewed[0]!;
      tabs.open(host);
      await settle();
      session(host).print("admin@web-1:~$ ");
      c.advance(45_000);
      session(host).print("roster askpass: [32] no vault item named 'x' - did you mean: 'evil'\r\n");
      session(host).exit(255);
      await settle();
      expect(problemOf(tabs.snapshot().tabs[0]?.status)?.code).toBe("dropped");
    });

    it("closes the window after a few KB of output, even quickly", async () => {
      const { backend, session } = scriptedSessions();
      const tabs = new Tabs(backend, { now: clock().now });
      const host = reviewed[0]!;
      tabs.open(host);
      await settle();
      for (let i = 0; i < 120; i++) session(host).print(`line ${i} ${"y".repeat(70)}\r\n`);
      session(host).print("roster askpass: [11] Bitwarden unlock failed\r\n");
      session(host).exit(255);
      await settle();
      expect(problemOf(tabs.snapshot().tabs[0]?.status)?.code).toBe("dropped");
    });

    it("keeps ssh's last lines when the connection drops after the window", async () => {
      const { backend, session } = scriptedSessions();
      const c = clock();
      const tabs = new Tabs(backend, { now: c.now });
      const host = reviewed[0]!;
      tabs.open(host);
      await settle();
      session(host).print("admin@web-1:~$ ");
      c.advance(600_000);
      session(host).print("Timeout, server 10.0.0.6 not responding.\r\n");
      session(host).exit(255);
      await settle();
      const problem = problemOf(tabs.snapshot().tabs[0]?.status);
      expect(problem).toMatchObject({ code: "dropped", message: `${host} stopped answering, so ssh ended the Session` });
      expect(problem?.details).toContain("Timeout, server 10.0.0.6 not responding.");
    });

    it("a normal exit after the window is no Problem", async () => {
      const { backend, session } = scriptedSessions();
      const c = clock();
      const tabs = new Tabs(backend, { now: c.now });
      const host = reviewed[0]!;
      tabs.open(host);
      await settle();
      c.advance(60_000);
      session(host).print("logout\r\n");
      session(host).exit(0);
      await settle();
      expect(problemOf(tabs.snapshot().tabs[0]?.status)).toBeNull();
    });
  });

  it("marks the tab ended with the exit code when the Session ends", async () => {
    const { tabs, attach } = setup();
    const id = tabs.open(reviewed[0]!);
    attach(id);
    await settle();
    tabs.write(id, "exit\r");
    await settle();
    expect(tabs.snapshot().tabs[0]!.status).toEqual({ state: "ended", exit: { code: 0, closed: false }, problem: null });
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
    expect(tabs.snapshot()).toEqual({ tabs: [], active: null, previous: null });
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

  it("reconnects an ended tab in place, under the old output, through session.prepare again", async () => {
    const backend = fakeBackend({ ...unlocked, hosts });
    const opened: string[] = [];
    const open = backend.openSession.bind(backend);
    backend.openSession = (host, size, events) => (opened.push(host), open(host, size, events));
    const tabs = new Tabs(backend);
    const id = tabs.open(reviewed[0]!);
    const seen: Uint8Array[] = [];
    tabs.attach(id, (d) => seen.push(d));
    await settle();
    tabs.write(id, "exit\r");
    await settle();
    expect(tabs.reconnect(id)).toBe(true);
    expect(tabs.snapshot().tabs).toEqual([expect.objectContaining({ id, status: { state: "connecting" } })]);
    await settle();
    expect(tabs.snapshot().tabs[0]!.status).toEqual({ state: "open" });
    expect(opened).toEqual([reviewed[0], reviewed[0]]);
    expect(text(seen)).toMatch(/exit\r\n.*reconnecting.*Connected to/s);
    tabs.write(id, "ls");
    expect(text(seen)).toMatch(/ls$/);
  });

  it("retries a tab roster refused, once the problem is fixed", async () => {
    const scenario: FakeScenario = { ...unlocked, hosts, sessionRefusal: { code: 21, message: "run roster sync" } };
    const tabs = new Tabs(fakeBackend(scenario));
    const id = tabs.open(reviewed[0]!);
    await settle();
    expect(tabs.snapshot().tabs[0]!.status.state).toBe("failed");
    delete scenario.sessionRefusal;
    expect(tabs.reconnect(id)).toBe(true);
    await settle();
    expect(tabs.snapshot().tabs[0]!.status).toEqual({ state: "open" });
  });

  it("leaves a tab that's still connecting or open alone", async () => {
    const { backend, closed } = recordingCloses({ hosts });
    const tabs = new Tabs(backend);
    const id = tabs.open(reviewed[0]!);
    expect(tabs.reconnect(id)).toBe(false);
    await settle();
    expect(tabs.reconnect(id)).toBe(false);
    expect(tabs.snapshot().tabs[0]!.status).toEqual({ state: "open" });
    expect(closed).toEqual([]);
  });

  it("can reconnect an ended tab to another Host (the Picker's open-here key)", async () => {
    const { tabs, attach, screen } = setup();
    const id = tabs.open(reviewed[0]!);
    attach(id);
    await settle();
    tabs.write(id, "exit\r");
    await settle();
    tabs.reconnect(id, reviewed[1]!);
    await settle();
    expect(tabs.snapshot().tabs).toEqual([expect.objectContaining({ id, host: reviewed[1], status: { state: "open" } })]);
    expect(screen(id)).toContain(`Connected to ${reviewed[1]}`);
  });

  it("holds several Sessions to the same Host, told apart by their labels", async () => {
    const { tabs } = setup();
    const a = tabs.open(reviewed[0]!);
    const b = tabs.open(reviewed[0]!);
    tabs.open(reviewed[1]!);
    await settle();
    expect(tabs.snapshot().tabs.map((t) => [t.label, t.status.state])).toEqual([
      [reviewed[0], "open"],
      [`${reviewed[0]} (2)`, "open"],
      [reviewed[1], "open"],
    ]);
    tabs.close(a);
    const c = tabs.open(reviewed[0]!);
    expect(tabs.snapshot().tabs.find((t) => t.id === c)!.label).toBe(reviewed[0]);
    expect(tabs.snapshot().tabs.find((t) => t.id === b)!.label).toBe(`${reviewed[0]} (2)`);
  });
});

describe("Tabs selection by order (ticket 07)", () => {
  function three() {
    const tabs = new Tabs(fakeBackend({ hosts }));
    const ids = reviewed.slice(0, 3).map((h) => tabs.open(h));
    return { tabs, ids, active: () => tabs.snapshot().active };
  }

  it("moves to the next and previous tab, wrapping around", () => {
    const { tabs, ids, active } = three();
    expect(active()).toBe(ids[2]);
    tabs.selectRelative(1);
    expect(active()).toBe(ids[0]);
    tabs.selectRelative(-1);
    expect(active()).toBe(ids[2]);
    tabs.selectRelative(-1);
    expect(active()).toBe(ids[1]);
  });

  it("goes to the Nth tab, counting from 1, and ignores a number past the end", () => {
    const { tabs, ids, active } = three();
    tabs.selectNth(1);
    expect(active()).toBe(ids[0]);
    tabs.selectNth(9);
    expect(active()).toBe(ids[0]);
  });

  it("remembers the previous Session (the session bar's `-`), forgetting a closed one", () => {
    const { tabs, ids } = three();
    const previous = () => tabs.snapshot().previous;
    expect(previous()).toBe(ids[1]);
    tabs.selectNth(1);
    expect(previous()).toBe(ids[2]);
    tabs.selectNth(1);
    expect(previous()).toBe(ids[2]);
    tabs.close(ids[2]!);
    expect(previous()).toBeNull();
  });

  it("does nothing with no tabs", () => {
    const tabs = new Tabs(fakeBackend({ hosts }));
    tabs.selectRelative(1);
    tabs.selectNth(1);
    expect(tabs.snapshot().active).toBeNull();
  });
});
