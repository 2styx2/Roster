// The fake Backend: same interface as the real one, answering from fixtures. Used by the UI tests
// and by `npm run dev` in a plain browser, where `?fixture=<name>` picks a scenario.
import {
  BackendCallError,
  BackendStartError,
  type Backend,
  type BackendInfo,
  type BackendProblem,
  type CallErrorData,
  CHECK_STEPS,
  type Host,
  type HostCheck,
  type HostList,
  type ProviderStatus,
  type VaultStatus,
  type VaultStatusWord,
  VaultError,
  type SessionAuth,
  type SessionEvents,
  type SessionHandle,
  type TermSize,
  SessionRefusal,
} from "./types";
import type { KeymapOverrides } from "../keymap";
import {
  HOST_KEY_CHANGED_OUTPUT,
  ITEM_NOT_FOUND,
  LONG_BOX,
  LONG_NAME_OPEN,
  LONG_PATH,
  WORST_BINDINGS,
  WORST_START_PROBLEM,
  WORST_VAULT_MESSAGE,
  hostKeyCheck,
  oneHost,
  worstCaseFolders,
  worstCaseHosts,
  worstCaseSessions,
} from "./worstCase";

export interface FakeScenario {
  hosts: HostList;
  /** connect() fails with this (every time, unless `failOnce`). */
  startProblem?: BackendProblem;
  failOnce?: boolean;
  /** Milliseconds every call waits, to see loading states. */
  delay?: number;
  /** Where the vault starts (default: locked, like a fresh `roster serve`). */
  vault?: { status: VaultStatusWord };
  /** Every openSession() is refused with this (like a box roster hasn't set up: code 21). */
  sessionRefusal?: Refusal;
  /** Sessions to password-only Hosts are refused with this (their vault: 11, 12 or 14). */
  passwordRefusal?: Refusal;
  /** Per Host: `session.prepare` refuses with this (a Login's codes 30-35, roster.yml's 1). */
  refusals?: Record<string, Refusal>;
  /** Per Host: ssh prints this into the PTY and exits 255 (a refused port, a changed key…). */
  sshFailures?: Record<string, string>;
  /** Per Host: what `host.check` answers (default: every step ok). */
  checks?: Record<string, HostCheck>;
  /** `inventory.info`'s api_version (default 2). */
  apiVersion?: number;
  /** The vault locks itself again this many ms after each unlock (bw's own timeout, another
   * roster command), so the next password Session meets code 14. */
  relockAfterMs?: number;
  /** `vault.unlock` with the right password takes `completesAfterMs`, but the call gives up
   * after `failAfterMs` (desk-core's timeout) while serve carries on and unlocks anyway. Like
   * serve, the fake then answers vault calls in order, so later ones wait for that unlock. */
  slowUnlock?: { failAfterMs: number; completesAfterMs: number };
  /** `connect()`'s answer, where it differs from the default (a long Box name, path, distro). */
  info?: { backend?: string; box?: string; path?: string; command?: string[] };
  /** The not-logged-in or missing-cli message, where it differs from roster's usual one. */
  vaultMessage?: string;
  /** What the app shows at start beyond the Backend (the dev page reads these; tests pass them
   * as props): the State file's contents, and Hosts to open Sessions to once connected. */
  app?: {
    state?: Record<string, unknown>;
    openAtStart?: readonly string[];
    /** Key bindings a Plugin or init.lua would add (the Key bindings panel's worst case). */
    bindings?: { source: string; tables: KeymapOverrides };
  };
}

export interface Refusal {
  code: number;
  message: string;
  data?: CallErrorData;
}

const refuse = (r: Refusal) => new BackendCallError(r.message, r.code, r.data ?? null);

/** A `host.check` answer with every step ok (a key Host's provider and vault-item skipped). */
export function passingCheck(host: Host): HostCheck {
  const password = authOf(host) === "password";
  return {
    host: host.name,
    ok: true,
    steps: CHECK_STEPS.map((step) =>
      !password && (step === "provider" || step === "vault-item")
        ? { step, status: "skipped" as const, message: "key login" }
        : { step, status: "ok" as const, message: `${step} is fine` },
    ),
  };
}

/** ssh failing: its message in the PTY, then exit 255 (as a refused port or a changed key do). */
function failingSession(id: number, auth: SessionAuth, output: string, events: SessionEvents): SessionHandle {
  setTimeout(() => {
    events.output(encode(output));
    events.exit({ code: 255, closed: false });
  }, 0);
  const done = async () => {};
  return { id, auth, write: done, resize: done, close: done };
}

/** The fake vault's master password (type it on the lock screen in a plain browser). */
export const FAKE_PASSWORD = "correct horse";

// roster's own wording (roster/src/roster/providers).
const NOT_LOGGED_IN = "Bitwarden CLI isn't logged in on this box - run `bw login` once";
const MISSING_CLI = "`bw` is not installed on this box (install the Bitwarden CLI, e.g. `npm install -g @bitwarden/cli`)";
const WRONG_PASSWORD = "Bitwarden unlock failed (wrong master password?)";
const VAULT_LOCKED = "Bitwarden vault is locked - unlock it first";

/** Like roster: a Host that doesn't enroll a key and whose ssh Login is a vault reference. */
export function authOf(h: Host): SessionAuth {
  return !h.enroll && !["agent", "key", "none"].includes(h.ssh.auth) ? "password" : "key";
}

const TYPES = ["linux", "esxi", "proxmox", "switch", "router", "windows", "printer", "nas"];
const PRODUCTS = ["", "", "ALPHA", "HUB", "BRAVO", "UniFi"];

/** `n` made-up Hosts across a few subnets; every seventh one unreviewed (like a discover scan). */
export function makeHosts(n: number): HostList {
  const hosts: Host[] = Array.from({ length: n }, (_, i) => {
    const subnet = (i % 4) + 1;
    const type = TYPES[i % TYPES.length] ?? "linux";
    return {
      name: `${type}-${subnet}-${String(i).padStart(3, "0")}`,
      group: `subnet-${subnet}`,
      ip: `10.19.${subnet}.${(i % 250) + 2}`,
      type,
      product: PRODUCTS[i % PRODUCTS.length] ?? "",
      title: i % 5 === 0 ? `${type} box ${i} in rack ${subnet}` : "",
      description: "",
      reviewed: i % 7 !== 3,
      enroll: i % 3 !== 0,
      ssh: { user: "admin", port: 22, auth: i % 3 === 0 ? `bw:${type}-${i} ssh` : "key" },
      web: null,
    };
  });
  const groups = Object.fromEntries(
    [1, 2, 3, 4].map((s) => [`subnet-${s}`, { title: `10.19.${s}.0/24`, description: "" }]),
  );
  return { hosts, groups };
}

const problem = (kind: BackendProblem["kind"], message: string, hint: string, detail: string | null = null) => ({
  kind,
  message,
  hint,
  detail,
});

export const fixtures: Record<string, FakeScenario> = {
  "many-hosts": { hosts: makeHosts(300) },
  "few-hosts": { hosts: makeHosts(12) },
  /** As many Hosts as the real Inventory (ticket 17's tree check). */
  "91-hosts": { hosts: makeHosts(91) },
  slow: { hosts: makeHosts(300), delay: 1500 },
  "roster-too-old": {
    hosts: makeHosts(0),
    startProblem: problem(
      "roster-too-old",
      "This roster has no `serve` command (it predates roster-desk).",
      "Upgrade roster (`uv tool install --force --reinstall .` in the roster repo), or point ROSTER_DESK_ROSTER at a newer one, e.g. `uv run --project /home/you/work/roster roster`.",
      "roster: error: argument cmd: invalid choice: 'serve' (choose from init, setup, sync, ...)",
    ),
  },
  "roster-missing": {
    hosts: makeHosts(0),
    startProblem: problem(
      "roster-missing",
      "`roster` wasn't found in any WSL distro (searched: FedoraLinux-44, OracleLinux_9).",
      "Install roster so it's on PATH, or set ROSTER_DESK_ROSTER to the command that runs it.",
    ),
  },
  "inventory-missing": {
    hosts: makeHosts(0),
    startProblem: problem(
      "inventory-not-found",
      "roster couldn't load the Inventory: no roster.yml found here or in ~/.config/roster/",
      "Clone the infra repo to ~/infra (or set ROSTER_CONFIG in ~/.profile), then retry.",
    ),
  },
  locked: { hosts: makeHosts(12) },
  "not-logged-in": { hosts: makeHosts(12), vault: { status: "not-logged-in" } },
  "missing-cli": { hosts: makeHosts(12), vault: { status: "missing-cli" } },
  "no-vault": { hosts: makeHosts(12), vault: { status: "unsupported" } },
  "not-set-up": {
    hosts: makeHosts(12),
    sessionRefusal: {
      code: SessionRefusal.notSetUp,
      message:
        "linux-1-000 isn't in this box's ssh config (~/.ssh/config.d/roster) - run `roster sync`, or `roster setup` if this box isn't set up yet",
    },
  },
  "vault-relocks": { hosts: makeHosts(12), relockAfterMs: 5000 },
  "worst-case": worstCase(),
  /** No Hosts at all: every empty state. */
  "worst-case-empty": { hosts: { hosts: [], groups: {} }, info: { box: LONG_BOX, path: LONG_PATH } },
  /** One Host, one Session, one Folder: every count at 1. */
  "worst-case-one": {
    hosts: oneHost(),
    app: { state: { folders: [{ name: "x", hosts: [LONG_NAME_OPEN] }] }, openAtStart: [LONG_NAME_OPEN] },
  },
  /** The Backend couldn't start, with a long message, hint and detail. */
  "worst-case-start": { hosts: makeHosts(0), startProblem: WORST_START_PROBLEM },
  /** The lock screen's longest message: the vault CLI isn't logged in. */
  "worst-case-vault": { ...worstCase(), vault: { status: "not-logged-in" }, vaultMessage: WORST_VAULT_MESSAGE },
  "no-wsl": {
    hosts: makeHosts(0),
    startProblem: problem("no-wsl", "No WSL distro was found.", "Install WSL and a Linux distro with roster in it."),
  },
};

/** The worst case (ticket 27): every long, short, odd, missing and huge value at once. */
function worstCase(): FakeScenario {
  const hosts = worstCaseHosts();
  return {
    hosts,
    info: {
      backend: "WSL: FedoraLinux-44",
      box: LONG_BOX,
      path: LONG_PATH,
      command: ["wsl.exe", "-d", "FedoraLinux-44", "--exec", "/home/aleksandra.wisniewska-kowalczyk/.local/bin/roster", "-c", LONG_PATH, "serve"],
    },
    refusals: { "vault-item-missing": ITEM_NOT_FOUND },
    sshFailures: { "host-key-changed-esxi-rack-b-u42-management-interface": HOST_KEY_CHANGED_OUTPUT },
    checks: Object.fromEntries(
      [LONG_NAME_OPEN, "host-key-changed-esxi-rack-b-u42-management-interface"].map((h) => [h, hostKeyCheck(h)]),
    ),
    app: {
      state: {
        folders: worstCaseFolders(hosts),
        recentHosts: [LONG_NAME_OPEN, "x", "🦊-fox-lab", "خادم-الإنتاج-٠١"],
      },
      openAtStart: worstCaseSessions(hosts),
      bindings: WORST_BINDINGS,
    },
  };
}

export function fixtureFromUrl(search: string = globalThis.location?.search ?? ""): FakeScenario {
  const name = new URLSearchParams(search).get("fixture") ?? "many-hosts";
  return fixtures[name] ?? { hosts: makeHosts(300) };
}

const encode = (s: string) => new TextEncoder().encode(s);

/** A pretend shell: a banner and a prompt, echoes what you type (Esc as `^[`), `exit` ends it. */
function fakeSession(id: number, host: string, auth: SessionAuth, size: TermSize, events: SessionEvents): SessionHandle {
  let line = "";
  let ended = false;
  const end = (code: number | null, closed: boolean) => {
    if (ended) return;
    ended = true;
    setTimeout(() => events.exit({ code, closed }), 0);
  };
  const prompt = `${host}$ `;
  setTimeout(() => events.output(encode(`Connected to ${host} (fake, ${size.cols}x${size.rows})\r\n${prompt}`)), 0);
  return {
    id,
    auth,
    async write(data) {
      if (ended) throw new BackendCallError(`session ${id} isn't open`);
      for (const ch of data) {
        if (ch === "\r") {
          events.output(encode("\r\n"));
          if (line.trim() === "exit") return end(0, false);
          line = "";
          events.output(encode(prompt));
        } else {
          line += ch;
          events.output(encode(ch === "\x1b" ? "^[" : ch));
        }
      }
    },
    async resize(s) {
      if (!ended) events.output(encode(`[resized to ${s.cols}x${s.rows}]`));
    },
    async close() {
      end(null, true);
    },
  };
}

export function fakeBackend(scenario: FakeScenario): Backend {
  let failures = 0;
  let vault: VaultStatusWord = scenario.vault?.status ?? "locked";
  const vaultMessage = () =>
    vault === "not-logged-in"
      ? (scenario.vaultMessage ?? NOT_LOGGED_IN)
      : vault === "missing-cli"
        ? (scenario.vaultMessage ?? MISSING_CLI)
        : undefined;
  const vaultStatus = (): VaultStatus => {
    const provider = vault === "unsupported" ? null : "bw";
    const message = vaultMessage();
    const main = { provider, status: vault, ...(message ? { message } : {}) };
    return { ...main, providers: provider ? [{ ...main, provider }] : [] };
  };
  let sessions = 0;
  const wait = () => new Promise((r) => setTimeout(r, scenario.delay ?? 0));
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** serve answers one request at a time: vault calls queue behind a slow unlock. */
  let serveBusy: Promise<unknown> = Promise.resolve();
  const inOrder = <T>(job: () => Promise<T>): Promise<T> => {
    const run = serveBusy.then(job, job);
    serveBusy = run.catch(() => {});
    return run;
  };
  const unlock = async (password: string): Promise<ProviderStatus> => {
    await wait();
    if (vault === "not-logged-in") throw new BackendCallError(vaultMessage() ?? NOT_LOGGED_IN, VaultError.notLoggedIn);
    if (vault === "missing-cli") throw new BackendCallError(MISSING_CLI, VaultError.cliMissing);
    if (vault === "unsupported")
      throw new BackendCallError("no Host Login uses a vault with a master password", VaultError.unsupported);
    if (password !== FAKE_PASSWORD) throw new BackendCallError(WRONG_PASSWORD, VaultError.wrongPassword);
    vault = "unlocked";
    if (scenario.relockAfterMs !== undefined) {
      setTimeout(() => {
        if (vault === "unlocked") vault = "locked";
      }, scenario.relockAfterMs);
    }
    return { provider: "bw", status: vault };
  };
  return {
    async connect(): Promise<BackendInfo> {
      await wait();
      if (scenario.startProblem && !(scenario.failOnce && failures > 0)) {
        failures++;
        throw new BackendStartError(scenario.startProblem);
      }
      const info = scenario.info ?? {};
      return {
        backend: info.backend ?? "Fake",
        command: info.command ?? ["roster", "serve"],
        inventory: {
          path: info.path ?? "~/infra/roster.yml",
          box: info.box ?? "browser",
          host_count: scenario.hosts.hosts.length,
          providers: ["bw"],
          roster_version: "0.1.0",
          api_version: scenario.apiVersion ?? 2,
        },
      };
    },
    async listHosts() {
      await wait();
      return scenario.hosts;
    },
    async getHost(name: string) {
      await wait();
      const h = scenario.hosts.hosts.find((x) => x.name === name);
      if (!h) throw new BackendCallError(`unknown host '${name}'`, 2);
      return h;
    },
    vaultStatus: () =>
      inOrder(async () => {
        await wait();
        return vaultStatus();
      }),
    unlockVault(password: string) {
      const slow = scenario.slowUnlock;
      const unlocking = inOrder(async () => {
        if (slow && password === FAKE_PASSWORD) await sleep(slow.completesAfterMs);
        return unlock(password);
      });
      if (!slow) return unlocking;
      return Promise.race([
        unlocking,
        sleep(slow.failAfterMs).then(() => {
          throw new BackendCallError("The backend didn't answer in time.", null, null, true);
        }),
      ]);
    },
    lockVault: () =>
      inOrder(async () => {
        await wait();
        if (vault !== "locked" && vault !== "unlocked") return { locked: [] };
        vault = "locked";
        return { locked: ["bw"] };
      }),
    async openSession(host, size, events) {
      await wait();
      const h = scenario.hosts.hosts.find((x) => x.name === host);
      if (!h) throw new BackendCallError(`unknown host '${host}'`, SessionRefusal.unknownHost);
      if (!h.reviewed) {
        throw new BackendCallError(
          `${host} is not reviewed yet (reviewed: false in roster.yml) - not logging in`,
          SessionRefusal.notReviewed,
        );
      }
      if (scenario.sessionRefusal) throw refuse(scenario.sessionRefusal);
      const refusal = scenario.refusals?.[host];
      if (refusal) throw refuse(refusal);
      const auth = authOf(h);
      if (auth === "password") {
        if (scenario.passwordRefusal) throw refuse(scenario.passwordRefusal);
        if (vault === "locked") throw new BackendCallError(VAULT_LOCKED, SessionRefusal.vaultLocked);
      }
      const failure = scenario.sshFailures?.[host];
      if (failure !== undefined) return failingSession(++sessions, auth, failure, events);
      return fakeSession(++sessions, host, auth, size, events);
    },
    async checkHost(host) {
      await wait();
      const given = scenario.checks?.[host];
      if (given) return given;
      const h = scenario.hosts.hosts.find((x) => x.name === host);
      if (!h) {
        const steps = CHECK_STEPS.map((step, i) =>
          i === 0
            ? { step, status: "fail" as const, code: 2, message: `unknown host '${host}'`, fix: "check the name" }
            : { step, status: "skipped" as const, message: "an earlier step failed" },
        );
        return { host, ok: false, steps };
      }
      return passingCheck(h);
    },
  };
}
