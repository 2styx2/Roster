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
  /** roster.yml as it is now doesn't load (an outside edit): these are the last good Hosts, and
   * this says why (API 8; catalog row 1). Null or absent when it loads. */
  error?: InventoryFileError | null;
}

/** Why roster.yml doesn't load right now, with the line when roster knows it. */
export interface InventoryFileError {
  message: string;
  path: string | null;
  line?: number;
  fix?: string | null;
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
export const EDIT_API_VERSION = 5;

/** The first `api_version` with `changes.publish` and `changes.diff`'s `message` (ticket 12). */
export const PUBLISH_API_VERSION = 7;

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
  /** Groups added, removed, or retitled (API 7). */
  groups?: GroupChange[];
  /** How many Pending changes: changed Hosts (1 for an edit that touches none, such as a comment). */
  count: number;
  /** The commit message `changes.publish` would write, naming what changed (API 7; "" when none). */
  message?: string;
}

/** One group the Pending changes touch. */
export interface GroupChange {
  group: string;
  change: "changed" | "added" | "removed";
}

/** `changes.publish`: the commit made and pushed, and whether `roster sync` followed. */
export interface PublishResult {
  /** The full hash of the commit, now on the upstream. */
  commit: string;
  upstream: string;
  message: string;
  hosts: HostChange[];
  groups: GroupChange[];
  /** Upstream commits that left roster.yml alone, fast-forwarded over first. */
  pulled: number;
  /** `roster sync` after the push: this Box's ssh config. A failure doesn't undo the Publish. */
  sync: { ok: boolean; error?: string; fix?: string };
}

/** The first `api_version` with the Live Inventory (ticket 28): `host.remove`, `host.rename`,
 * `host.move`, `group.new|rename|delete`, `inventory.reload` (`:source`), `inventory.watch` and the
 * `inventory.changed` notification, and `hosts.list`'s `error`. */
export const LIVE_API_VERSION = 8;

/** roster's codes for the Live Inventory (ticket 28). A bad name is 80, an unknown Host 2. */
export const LiveError = {
  nameTaken: 100,
  unknownGroup: 101,
  groupNotEmpty: 102,
  wouldChange: 103,
} as const;

/** `inventory.reload` (`:source`): roster.yml read again now; `error` while it doesn't load (the
 * last good Inventory stays). */
export interface InventoryReload {
  changed: boolean;
  host_count: number;
  error: InventoryFileError | null;
}

/** serve's `inventory.changed` notification: an outside edit of roster.yml. `applied`: it was
 * loaded (auto_reload on), with `error` if it doesn't load; else only noticed, for `:source`. */
export interface InventoryChanged {
  applied: boolean;
  error: InventoryFileError | null;
}

/** roster's codes for publishing (ticket 12; docs/app/errors.md rows 46-52). A failed fetch is 73. */
export const PublishError = {
  nothingPending: 90,
  otherChanges: 91,
  remoteMoved: 92,
  unpushed: 93,
  noUpstream: 94,
  commitFailed: 95,
  pushFailed: 96,
} as const;

/** roster's codes for editing the Inventory (ticket 10; docs/app/errors.md rows 38-43). */
export const EditError = {
  notARepo: 70,
  dirty: 71,
  diverged: 72,
  pullFailed: 73,
  invalidEdit: 74,
  notVerified: 75,
} as const;

/** The first `api_version` with `host.add`, `host.scan_key` and `host.review` (ticket 11). */
export const ADD_API_VERSION = 6;

/** `host.add`'s params. A Login is either `auth` (an existing vault item, `bw:<host> ssh`) or
 * `password` (typed into the form, saved as `item` after the test login). Without one the Host
 * goes in unreviewed. `host_key` is the fingerprint the user confirmed for a new address. */
export interface AddHostParams {
  name: string;
  group: string;
  address: string;
  user?: string;
  port?: number;
  type?: string;
  title?: string;
  enroll?: boolean;
  auth?: string;
  password?: string;
  item?: string;
  host_key?: string;
  /** Where a typed password is saved (ticket 35 adds the choice; roster's default vault until then). */
  provider?: string;
}

/** `host.add`: the Host as roster.yml has it now, the test login (null without a Login) and the
 * Vault item it made (null unless a password was typed). */
export interface HostAdd {
  added: true;
  host: Host;
  backup: string;
  verify: HostCheck | null;
  item: { provider: string; id: string; name: string } | null;
}

/** `host.scan_key`: the key the address offers, and how it compares with the recorded one. */
export interface ScannedKey {
  address: string;
  port: number;
  key_type: string;
  fingerprint: string;
  recorded: "none" | "match" | "changed";
}

/** roster's codes for adding a Host (ticket 11). A failed test login answers with its step's own
 * code (40-48, 30-35) and `data.steps`. */
export const AddError = {
  invalidHost: 80,
  hostExists: 81,
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
   * (71 Pending or other uncommitted changes, 72 diverged, 73 fetch failed, 70 not a git repo). */
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
  /** `changes.publish`: commit roster.yml with `message` and push it (never forced), then
   * `roster sync`. Rejects with a PublishError code (or 73 fetch failed, 1 roster.yml broken). */
  publishChanges(message: string): Promise<PublishResult>;
  /** `host.remove`: take the Host out of roster.yml as a Pending change. Never touches the vault. */
  removeHost(host: string): Promise<{ removed: string; group: string; backup: string }>;
  /** `host.rename`: the Host's name in roster.yml, nothing else. Rejects with 100 (taken) or 80. */
  renameHost(host: string, to: string): Promise<HostUpdate>;
  /** `host.move`: to the end of another group; what it inherited and wouldn't there is written on
   * it (`pinned`). Rejects with 101 (no such group) or 103 (it would come out different). */
  moveHost(host: string, group: string): Promise<HostUpdate & { pinned: string[] }>;
  /** `group.new`: an empty group after the last one. */
  newGroup(name: string, title?: string): Promise<{ group: string; backup: string }>;
  /** `group.rename`: its Hosts go with it. */
  renameGroup(group: string, to: string): Promise<{ changed: boolean; group: string; backup: string | null }>;
  /** `group.delete`: refuses (102, `data.hosts`) a group that still has Hosts unless `to` says
   * where they go. */
  deleteGroup(group: string, to?: string): Promise<{ deleted: string; moved: string[]; to: string | null; backup: string }>;
  /** `inventory.reload`: `:source` for roster.yml. */
  reloadInventory(): Promise<InventoryReload>;
  /** `inventory.watch`: notice outside edits of roster.yml; `auto` applies them (auto_reload). */
  watchInventory(auto: boolean): Promise<{ watching: boolean; auto: boolean }>;
  /** Calls `onChange` for each `inventory.changed`; returns stop. */
  onInventoryChanged(onChange: (change: InventoryChanged) => void): () => void;
  /** `host.scan_key`: the host key an address offers, for the user to confirm before a first login. */
  scanKey(address: string, port: number): Promise<ScannedKey>;
  /** `host.add`: test the Login, save a typed password to the vault, add the Host as a Pending
   * change (decision Q43). Rejects with the failed step's code and `data.steps`, or AddError. */
  addHost(params: AddHostParams): Promise<HostAdd>;
  /** `host.review`: mark a Host reviewed (only that flag), as a Pending change. */
  reviewHost(host: string): Promise<HostUpdate>;
}
