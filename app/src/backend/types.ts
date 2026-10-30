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

/** The first `api_version` with `inventory.pull`, `host.verify_login`, `host.update` and `changes.*` (ticket 10). */
export const EDIT_API_VERSION = 4;

/** The Host fields the edit form changes (`host.update`'s `changes`). */
export interface HostFields {
  title: string;
  description: string;
  type: string;
  ip: string;
  user: string;
  port: number;
  auth: string;
}

export type HostChanges = Partial<HostFields>;

/** Changing these needs a test login that just succeeded (`host.verify_login`, decision Q43). */
export const LOGIN_FIELDS = ["ip", "user", "port", "auth"] as const satisfies readonly (keyof HostFields)[];

/** `host.verify_login`'s steps, in order. */
export const VERIFY_STEPS = ["user", "provider", "vault-item", "dns", "tcp", "host-key", "auth"] as const;

/** `inventory.pull`: the infra repo fast-forwarded (or already up to date, or no upstream). */
export interface PullResult {
  updated: boolean;
  upstream: string | null;
  commits: number;
  ahead: number;
  message?: string;
}

/** `host.update`. */
export interface HostUpdate {
  changed: boolean;
  host: Host;
  /** Where roster kept the file as it was before (in the repo's git dir). */
  backup: string | null;
}

/** One Host the Pending changes touch. */
export interface HostChange {
  host: string;
  change: "changed" | "added" | "removed";
  fields: string[];
}

/** `changes.diff`: roster.yml's uncommitted diff in the infra repo. */
export interface PendingChanges {
  path: string;
  repo: string;
  /** git's unified diff of roster.yml against the last commit ("" when there are none). */
  diff: string;
  hosts: HostChange[];
  /** How many Pending changes: changed Hosts (1 for an edit that touches none, such as a comment). */
  count: number;
}

/** roster's codes for editing the Inventory (ticket 10; docs/app/errors.md rows 34-39). */
export const EditError = {
  notARepo: 60,
  dirty: 61,
  diverged: 62,
  pullFailed: 63,
  invalidEdit: 64,
  notVerified: 65,
} as const;

/** Where a vault provider stands (`vault.status`). */
export type VaultStatusWord = "locked" | "unlocked" | "not-logged-in" | "missing-cli" | "unsupported";

export interface ProviderStatus {
  provider: string;
  status: VaultStatusWord;
  /** For not-logged-in and missing-cli: what to run or install (backticks around commands). */
  message?: string;
  /** For not-logged-in, when the app can sign the CLI in (`vault.login`, api 3): the ways in,
   * and the server the CLI is set to (null: Bitwarden's US cloud). */
  sign_in?: SignInInfo;
}

/** How the vault CLI can be signed in from the app (roster README "Signing in: vault.login"). */
export type SignInWay = "password" | "apikey" | "sso";

export interface SignInInfo {
  methods: SignInWay[];
  server: string | null;
}

/** `vault.status`: the vault the lock screen unlocks (`provider` is null when none has a master password). */
export interface VaultStatus {
  provider: string | null;
  status: VaultStatusWord;
  message?: string;
  sign_in?: SignInInfo;
  providers: ProviderStatus[];
}

/** Where `vault.login` starts: email + master password, an API key, or SSO in a browser.
 * `server` is "cloud", "eu" or a self-hosted https:// URL. */
export type SignInStart =
  | { method: "password"; server: string; email: string; password: string }
  | { method: "apikey"; server: string; client_id: string; client_secret: string }
  | { method: "sso"; server: string; identifier?: string };

/** A two-step method bw offers, in its order (FIDO2 and Duo never appear: the CLI can't do them). */
export interface TwoFactorMethod {
  index: number;
  /** bw's number for it: 0 authenticator, 1 email, 3 YubiKey OTP. */
  id: number | null;
  kind: "authenticator" | "email" | "yubikey" | "other";
  name: string;
}

/** What `vault.login` asks for next. `login` is the sign-in's id, sent back with the answer. */
export type SignInStep = { login: string } & (
  | { step: "two_factor_method"; methods: TwoFactorMethod[] }
  /** `method` is null when the account has one method and bw picked it; `sent`: emailed just now. */
  | { step: "two_factor_code"; method: TwoFactorMethod | null; sent: boolean }
  | { step: "new_device_code"; email: string | null }
  /** Open `url` in a browser; answer `{}` to wait for it (roster waits up to 20 s per call). */
  | { step: "sso"; url: string; expires_in: number }
  /** After an API key or SSO, which only log in: the vault still needs the master password. */
  | { step: "master_password"; email: string | null }
  | { step: "done"; provider: string; status: "unlocked" }
);

export type SignInAnswer = { method: number } | { code: string } | { password: string } | Record<string, never>;

/** roster's `vault.login` error codes (10, 12 and 13 are VaultError's). A 50 (and a 10 at the
 * master-password step) carries `data.step`: the sign-in goes on there. */
export const SignInError = {
  codeRejected: 50,
  methodUnsupported: 51,
  rateLimited: 52,
  serverUnreachable: 53,
  alreadyLoggedIn: 54,
  noSignIn: 55,
  ssoFailed: 56,
  badServer: 57,
  apiKeyRejected: 58,
  failed: 59,
} as const;

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
 * Every code has its row in src/errors/catalog.ts (docs/app/errors.md). */
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
  /** Start signing the vault CLI in (`vault.login`). Rejects with BackendCallError (SignInError
   * and VaultError codes); `data.step` says where a sign-in carries on after a failure. */
  signIn(start: SignInStart): Promise<SignInStep>;
  /** Answer the sign-in's current step. */
  signInAnswer(login: string, answer: SignInAnswer): Promise<SignInStep>;
  /** Stop the sign-in in progress (and forget what roster held for it). Never rejects. */
  signInCancel(): Promise<void>;
  /** Open a Session to a Host in a PTY of `size`. Rejects with BackendCallError (a
   * `SessionRefusal` code) when roster won't open it; a failed login is ssh's own output.
   * Every call asks roster afresh (`session.prepare` right before the spawn), so a password
   * Session always gets a new one-time askpass token: call it again to reconnect. */
  openSession(host: string, size: TermSize, events: SessionEvents): Promise<SessionHandle>;
  /** `host.check`: roster's diagnostics for one Host (at most one connection and one login). */
  checkHost(host: string): Promise<HostCheck>;
  /** `inventory.pull`: fast-forward the infra repo before an edit. Rejects with an EditError code
   * (61 Pending or other uncommitted changes, 62 diverged, 63 fetch failed, 60 not a git repo). */
  pullInventory(): Promise<PullResult>;
  /** `host.verify_login`: one test login with the Host's new address, user or Login (same shape
   * as `host.check`, steps VERIFY_STEPS). Success lets `updateHost` make exactly that change. */
  verifyLogin(host: string, changes: HostChanges): Promise<HostCheck>;
  /** `host.update`: the edit, written into roster.yml as a Pending change (comments kept). */
  updateHost(host: string, changes: HostChanges): Promise<HostUpdate>;
  /** `changes.diff`: the Pending changes. */
  pendingChanges(): Promise<PendingChanges>;
  /** `changes.discard`: roster.yml back as the last commit has it. */
  discardChanges(): Promise<{ discarded: boolean; backup: string | null }>;
}
