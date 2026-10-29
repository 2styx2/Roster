// The ONE typed client between the UI and the Backend. Every component talks to the Backend
// through this interface; tests and the plain-browser dev page use the fake (fake.ts), the app
// uses the Tauri one (tauri.ts). Shapes follow roster's `roster serve` API, version 1.

/** A Host as `hosts.list` returns it (roster's own object; only the fields the UI reads). */
export interface Host {
  name: string;
  group: string;
  ip: string;
  type: string;
  product: string;
  title: string;
  description: string;
  reviewed: boolean;
  enroll: boolean;
  ssh: { user: string; port: number; auth: string };
  web: string | null;
}

export interface Group {
  title: string;
  description: string;
}

export interface HostList {
  hosts: Host[];
  groups: Record<string, Group>;
}

/** `inventory.info`. */
export interface InventoryInfo {
  path: string;
  box: string;
  host_count: number;
  providers: string[];
  roster_version: string;
  api_version: number;
}

export interface BackendInfo {
  /** "Local" or "WSL: <distro>". */
  backend: string;
  /** The command line that runs `roster serve`. */
  command: string[];
  inventory: InventoryInfo;
}

export type BackendProblemKind = "no-wsl" | "roster-missing" | "roster-too-old" | "inventory-not-found" | "failed";

/** Why the Backend couldn't start: shown as is on the error screen. */
export interface BackendProblem {
  kind: BackendProblemKind;
  message: string;
  hint: string;
  detail: string | null;
}

/** Thrown by `connect()`. */
export class BackendStartError extends Error {
  readonly problem: BackendProblem;
  constructor(problem: BackendProblem) {
    super(problem.message);
    this.name = "BackendStartError";
    this.problem = problem;
  }
}

/** Thrown by a call once the Backend is up: roster's error code and message (ready to show). */
export class BackendCallError extends Error {
  readonly code: number | null;
  constructor(message: string, code: number | null = null) {
    super(message);
    this.name = "BackendCallError";
    this.code = code;
  }
}

/** A terminal size in character cells. */
export interface TermSize {
  cols: number;
  rows: number;
}

/** How a Session ended. */
export interface SessionExit {
  /** The exit code (ssh's 255 when it couldn't connect); null when a signal ended it. */
  code: number | null;
  /** True when the app closed it; the code then means nothing. */
  closed: boolean;
}

/** Where a Session's output goes: bytes in order, then exactly one exit. */
export interface SessionEvents {
  output(data: Uint8Array): void;
  exit(exit: SessionExit): void;
}

/** A running Session (a PTY with ssh in it), as the core names it. */
export interface SessionHandle {
  readonly id: number;
  /** Keystrokes or pasted text, as xterm's onData gives them. */
  write(data: string): Promise<void>;
  resize(size: TermSize): Promise<void>;
  /** Ends it (kills ssh). The exit event still follows, with `closed: true`. */
  close(): Promise<void>;
}

/** `session.prepare`'s error codes (roster README): the message is roster's, ready to show. */
export const SessionRefusal = {
  unknownHost: 2,
  notReviewed: 20,
  notSetUp: 21,
  noAskpass: 22,
} as const;

export interface Backend {
  /** Find and start the Backend, or return the running one. Rejects with BackendStartError. */
  connect(options?: { restart?: boolean }): Promise<BackendInfo>;
  /** Every Host and group, in roster.yml order. */
  listHosts(): Promise<HostList>;
  /** One Host by exact name. */
  getHost(name: string): Promise<Host>;
  /** Open a Session to a Host in a PTY of `size`. Rejects with BackendCallError (a
   * `SessionRefusal` code) when roster won't open it; a failed login is ssh's own output. */
  openSession(host: string, size: TermSize, events: SessionEvents): Promise<SessionHandle>;
}
