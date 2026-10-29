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
}
