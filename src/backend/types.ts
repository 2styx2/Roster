// The ONE typed client between the UI and the Backend. Every component talks to the Backend
// through this interface; tests and the plain-browser dev page use the fake (fake.ts), the app
// uses the Tauri one (tauri.ts). Shapes follow roster's `roster serve` API, version 1 or newer
// (2 adds `host.check` and the Login/askpass/network codes 30-48: `:check` needs it).

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

/** A JSON-RPC error's `data` (roster README): `fix` in a sentence, plus what the code's row needs
 * (`near`, `matches`, `path`/`line`, `provider`, `field`). Names, dates and URIs; never a secret. */
export type CallErrorData = Record<string, unknown> & { fix?: string };

/** Thrown by a call once the Backend is up: roster's error code and message (ready to show). */
export class BackendCallError extends Error {
  readonly code: number | null;
  readonly data: CallErrorData | null;
  /** True when `roster serve` itself went away (exited, or stopped answering). */
  readonly lost: boolean;
  constructor(message: string, code: number | null = null, data: CallErrorData | null = null, lost = false) {
    super(message);
    this.name = "BackendCallError";
    this.code = code;
    this.data = data;
    this.lost = lost;
  }
}

/** The first `api_version` with `host.check`. */
export const CHECK_API_VERSION = 2;

/** `host.check`'s steps, in the order roster runs them. */
export const CHECK_STEPS = ["inventory", "ssh-config", "provider", "vault-item", "dns", "tcp", "host-key", "auth"] as const;
export type CheckStepName = (typeof CHECK_STEPS)[number];

export interface CheckStep {
  step: CheckStepName | string;
  status: "ok" | "fail" | "skipped";
  message: string;
  code?: number;
  fix?: string;
  /** Raw text: ssh's stderr, the resolver's error. */
  details?: string;
  data?: Record<string, unknown>;
}

/** `host.check {host}`: every step, stopping (the rest `skipped`) at the first failure. */
export interface HostCheck {
  host: string;
  ok: boolean;
  steps: CheckStep[];
}

/** Where a vault provider stands (`vault.status`). */
export type VaultStatusWord = "locked" | "unlocked" | "not-logged-in" | "missing-cli" | "unsupported";

export interface ProviderStatus {
  provider: string;
  status: VaultStatusWord;
  /** For not-logged-in and missing-cli: what to run or install (backticks around commands). */
  message?: string;
}

/** `vault.status`: the vault the lock screen unlocks (`provider` is null when none has a master password). */
export interface VaultStatus {
  provider: string | null;
  status: VaultStatusWord;
  message?: string;
  providers: ProviderStatus[];
}

/** roster's `vault.*` error codes (BackendCallError.code). */
export const VaultError = {
  wrongPassword: 10,
  notLoggedIn: 11,
  cliMissing: 12,
  unsupported: 13,
  locked: 14,
} as const;

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

/** How a Session logs in (`session.prepare`'s `auth`). A password Session's password goes from
 * roster to ssh over roster's askpass channel; the app never sees it. */
export type SessionAuth = "key" | "password";

/** A running Session (a PTY with ssh in it), as the core names it. */
export interface SessionHandle {
  readonly id: number;
  readonly auth: SessionAuth;
  /** Keystrokes or pasted text, as xterm's onData gives them. */
  write(data: string): Promise<void>;
  resize(size: TermSize): Promise<void>;
  /** Ends it (kills ssh). The exit event still follows, with `closed: true`. */
  close(): Promise<void>;
}

/** `session.prepare`'s error codes (roster README): the message is roster's, ready to show.
 * Every code has its row in src/errors/catalog.ts (docs/errors.md). */
export const SessionRefusal = {
  inventory: 1,
  unknownHost: 2,
  notReviewed: 20,
  notSetUp: 21,
  noAskpass: 22,
  noUser: 30,
  noProvider: 31,
  itemNotFound: 32,
  severalItems: 33,
  noField: 34,
  lookupFailed: 35,
  /** A password Host's vault: CLI not logged in, not installed, or locked (the VaultError codes). */
  vaultNotLoggedIn: VaultError.notLoggedIn,
  vaultCliMissing: VaultError.cliMissing,
  vaultLocked: VaultError.locked,
} as const;

export interface Backend {
  /** Find and start the Backend, or return the running one. Rejects with BackendStartError. */
  connect(options?: { restart?: boolean }): Promise<BackendInfo>;
  /** Every Host and group, in roster.yml order. */
  listHosts(): Promise<HostList>;
  /** One Host by exact name. */
  getHost(name: string): Promise<Host>;
  /** Where the vault stands. */
  vaultStatus(): Promise<VaultStatus>;
  /** Unlock the vault with its master password. Rejects with BackendCallError (VaultError codes). */
  unlockVault(password: string): Promise<ProviderStatus>;
  /** Forget every secret and lock the vault. Never rejects for a vault reason. */
  lockVault(): Promise<{ locked: string[] }>;
  /** Open a Session to a Host in a PTY of `size`. Rejects with BackendCallError (a
   * `SessionRefusal` code) when roster won't open it; a failed login is ssh's own output.
   * Every call asks roster afresh (`session.prepare` right before the spawn), so a password
   * Session always gets a new one-time askpass token: call it again to reconnect. */
  openSession(host: string, size: TermSize, events: SessionEvents): Promise<SessionHandle>;
  /** `host.check`: roster's diagnostics for one Host (at most one connection and one login). */
  checkHost(host: string): Promise<HostCheck>;
}
