// The open tabs, one Session each, outside React: a Session must outlive a component remount
// (StrictMode mounts twice; ticket 07 will move terminals around), so the store opens and closes
// Sessions and keeps each one's recent output to replay into whichever terminal attaches.
// React reads it through useSyncExternalStore (useTabs).
import {
  BackendCallError,
  SessionRefusal,
  type Backend,
  type SessionAuth,
  type SessionExit,
  type SessionHandle,
  type TermSize,
} from "../backend/types";

export type TabStatus =
  | { state: "connecting" }
  | { state: "open" }
  /** roster refused (`session.prepare`) or the PTY couldn't start; `code` is roster's. */
  | { state: "failed"; message: string; code: number | null }
  | { state: "ended"; exit: SessionExit };

export interface Tab {
  id: number;
  host: string;
  status: TabStatus;
  /** How its Session logs in, once one has opened (the tab's state dot: hollow for password). */
  auth: SessionAuth | null;
}

export interface TabsSnapshot {
  tabs: readonly Tab[];
  active: number | null;
}

/** Output kept per tab for a terminal that attaches later (or again). */
const REPLAY_LIMIT = 1024 * 1024;

type Sink = (data: Uint8Array) => void;

/** What a tab's terminal is wired to; the same object for the tab's whole life. */
export interface TerminalWiring {
  attach(sink: Sink): () => void;
  onData(data: string): void;
  onResize(size: TermSize): void;
}

interface Entry {
  tab: Tab;
  session: SessionHandle | null;
  /** Closed by the user before the Session finished opening. */
  closing: boolean;
  /** Counts the Session starts in this tab, so a late answer from an earlier one is ignored. */
  attempt: number;
  size: TermSize;
  /** The size the Session was last told about. */
  sentSize: TermSize;
  replay: Uint8Array[];
  replayBytes: number;
  sink: Sink | null;
  wiring: TerminalWiring;
  /** Keys typed before the Session finished opening. On Windows this includes xterm's answer
   * to ConPTY's cursor-position request, which ConPTY waits for before starting anything. */
  pending: string[];
}

export class Tabs {
  private readonly backend: Backend;
  private entries: Entry[] = [];
  private active: number | null = null;
  private nextId = 1;
  private lastSize: TermSize = { cols: 80, rows: 24 };
  private snap: TabsSnapshot = { tabs: [], active: null };
  private readonly listeners = new Set<() => void>();
  private onVaultLocked: () => void = () => {};

  constructor(backend: Backend) {
    this.backend = backend;
  }

  /** Called when a password Host's vault turns out to be locked (`session.prepare` code 14): the
   * app shows the lock screen, then calls `resumeAfterUnlock`. */
  setVaultLockedHandler(handler: () => void) {
    this.onVaultLocked = handler;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): TabsSnapshot => this.snap;

  private changed() {
    this.snap = { tabs: this.entries.map((e) => e.tab), active: this.active };
    for (const l of this.listeners) l();
  }

  private find(id: number): Entry | undefined {
    return this.entries.find((e) => e.tab.id === id);
  }

  private setStatus(entry: Entry, status: TabStatus) {
    entry.tab = { ...entry.tab, status };
    this.changed();
  }

  private output(entry: Entry, data: Uint8Array) {
    entry.replay.push(data);
    entry.replayBytes += data.length;
    while (entry.replayBytes > REPLAY_LIMIT && entry.replay.length > 1) {
      entry.replayBytes -= entry.replay.shift()?.length ?? 0;
    }
    entry.sink?.(data);
  }

  /** Opens a Session to `host` in a new tab, which becomes the active one. Returns the tab id. */
  open(host: string): number {
    const id = this.nextId++;
    const size = { ...this.lastSize };
    const entry: Entry = {
      tab: { id, host, status: { state: "connecting" }, auth: null },
      session: null,
      closing: false,
      attempt: 0,
      size,
      sentSize: size,
      replay: [],
      replayBytes: 0,
      sink: null,
      pending: [],
      wiring: {
        attach: (sink) => this.attach(id, sink),
        onData: (data) => this.write(id, data),
        onResize: (s) => this.resize(id, s),
      },
    };
    this.entries.push(entry);
    this.active = id;
    this.changed();
    this.start(entry);
    return id;
  }

  /** Opens again every tab that was waiting for the vault (code 14). Each asks roster afresh, so
   * a password Session gets a new one-time token. */
  resumeAfterUnlock() {
    for (const entry of this.entries) {
      const s = entry.tab.status;
      if (s.state === "failed" && s.code === SessionRefusal.vaultLocked) {
        entry.tab = { ...entry.tab, status: { state: "connecting" } };
        this.changed();
        this.start(entry);
      }
    }
  }

  /** Asks the Backend for a Session for the tab (it's in the "connecting" state). `openSession`
   * runs `session.prepare` right before the spawn, so an askpass token is never stale. */
  private start(entry: Entry) {
    const attempt = ++entry.attempt;
    const current = () => entry.attempt === attempt && !entry.closing;
    const { id, host } = entry.tab;
    entry.sentSize = { ...entry.size };
    this.backend
      .openSession(host, entry.size, {
        output: (data) => {
          if (current()) this.output(entry, data);
        },
        exit: (exit) => {
          if (!current()) return;
          entry.session = null;
          if (this.find(id)) this.setStatus(entry, { state: "ended", exit });
        },
      })
      .then(
        (session) => {
          if (!current()) {
            void session.close().catch(() => {});
            return;
          }
          // It may already have ended (ssh failing at once): then there's nothing to talk to.
          if (entry.tab.status.state !== "connecting") return;
          entry.session = session;
          for (const data of entry.pending.splice(0)) void session.write(data).catch(() => {});
          entry.tab = { ...entry.tab, auth: session.auth };
          this.setStatus(entry, { state: "open" });
          this.sendSize(entry);
        },
        (e: unknown) => {
          if (!current()) return;
          const code = e instanceof BackendCallError ? e.code : null;
          if (code === SessionRefusal.vaultLocked) {
            const message = "The vault is locked. Unlock it and this Session opens.";
            this.setStatus(entry, { state: "failed", message, code });
            this.onVaultLocked();
            return;
          }
          const message = e instanceof Error ? e.message : String(e);
          this.setStatus(entry, { state: "failed", message, code });
        },
      );
  }

  /** Closes the tab and ends its Session (kills ssh). */
  close(id: number) {
    const i = this.entries.findIndex((e) => e.tab.id === id);
    const entry = this.entries[i];
    if (!entry) return;
    entry.closing = true;
    entry.sink = null;
    void entry.session?.close().catch(() => {});
    entry.session = null;
    this.entries.splice(i, 1);
    if (this.active === id) {
      const next = this.entries[Math.min(i, this.entries.length - 1)];
      this.active = next ? next.tab.id : null;
    }
    this.changed();
  }

  closeAll() {
    for (const e of [...this.entries]) this.close(e.tab.id);
  }

  select(id: number) {
    if (!this.find(id) || this.active === id) return;
    this.active = id;
    this.changed();
  }

  /** Stable callbacks for the tab's terminal (so it never re-attaches on a re-render). */
  wiring(id: number): TerminalWiring | undefined {
    return this.find(id)?.wiring;
  }

  /** Routes the tab's output to `sink`, starting with what it printed so far. Returns detach. */
  attach(id: number, sink: Sink): () => void {
    const entry = this.find(id);
    if (!entry) return () => {};
    for (const chunk of entry.replay) sink(chunk);
    entry.sink = sink;
    return () => {
      if (entry.sink === sink) entry.sink = null;
    };
  }

  /** Keystrokes for the tab's Session; held until it's open, dropped once it has ended. */
  write(id: number, data: string) {
    const entry = this.find(id);
    if (!entry) return;
    if (entry.session) void entry.session.write(data).catch(() => {});
    else if (entry.tab.status.state === "connecting") entry.pending.push(data);
  }

  /** The tab's terminal has this size now; the Session hears about it once it's open. */
  resize(id: number, size: TermSize) {
    this.lastSize = { ...size };
    const entry = this.find(id);
    if (!entry) return;
    entry.size = { ...size };
    this.sendSize(entry);
  }

  private sendSize(entry: Entry) {
    const { size, sentSize, session } = entry;
    if (!session || (size.cols === sentSize.cols && size.rows === sentSize.rows)) return;
    entry.sentSize = { ...size };
    void session.resize(size).catch(() => {});
  }
}
