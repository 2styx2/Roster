// The fake Backend: same interface as the real one, answering from fixtures. Used by the UI tests
// and by `npm run dev` in a plain browser, where `?fixture=<name>` picks a scenario.
import {
  BackendCallError,
  BackendStartError,
  type Backend,
  type BackendInfo,
  type BackendProblem,
  type Host,
  type HostList,
  type VaultStatus,
  type VaultStatusWord,
  VaultError,
  type SessionEvents,
  type SessionHandle,
  type TermSize,
  SessionRefusal,
} from "./types";

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
  sessionRefusal?: { code: number; message: string };
}

/** The fake vault's master password (type it on the lock screen in a plain browser). */
export const FAKE_PASSWORD = "correct horse";

// roster's own wording (roster/src/roster/providers).
const NOT_LOGGED_IN = "Bitwarden CLI isn't logged in on this box - run `bw login` once";
const MISSING_CLI = "`bw` is not installed on this box (install the Bitwarden CLI, e.g. `npm install -g @bitwarden/cli`)";
const WRONG_PASSWORD = "Bitwarden unlock failed (wrong master password?)";

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
  slow: { hosts: makeHosts(300), delay: 1500 },
  "roster-too-old": {
    hosts: makeHosts(0),
    startProblem: problem(
      "roster-too-old",
      "This roster has no `serve` command (it predates roster-desk).",
      "Upgrade roster (`uv tool install --force --reinstall .` in the roster repo), or point ROSTER_DESK_ROSTER at a newer one, e.g. `uv run --project ~/work/roster roster`.",
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
  "no-wsl": {
    hosts: makeHosts(0),
    startProblem: problem("no-wsl", "No WSL distro was found.", "Install WSL and a Linux distro with roster in it."),
  },
};

export function fixtureFromUrl(search: string = globalThis.location?.search ?? ""): FakeScenario {
  const name = new URLSearchParams(search).get("fixture") ?? "many-hosts";
  return fixtures[name] ?? { hosts: makeHosts(300) };
}

const encode = (s: string) => new TextEncoder().encode(s);

/** A pretend shell: a banner and a prompt, echoes what you type (Esc as `^[`), `exit` ends it. */
function fakeSession(id: number, host: string, size: TermSize, events: SessionEvents): SessionHandle {
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
    vault === "not-logged-in" ? NOT_LOGGED_IN : vault === "missing-cli" ? MISSING_CLI : undefined;
  const vaultStatus = (): VaultStatus => {
    const provider = vault === "unsupported" ? null : "bw";
    const message = vaultMessage();
    const main = { provider, status: vault, ...(message ? { message } : {}) };
    return { ...main, providers: provider ? [{ ...main, provider }] : [] };
  };
  let sessions = 0;
  const wait = () => new Promise((r) => setTimeout(r, scenario.delay ?? 0));
  return {
    async connect(): Promise<BackendInfo> {
      await wait();
      if (scenario.startProblem && !(scenario.failOnce && failures > 0)) {
        failures++;
        throw new BackendStartError(scenario.startProblem);
      }
      return {
        backend: "Fake",
        command: ["roster", "serve"],
        inventory: {
          path: "~/infra/roster.yml",
          box: "browser",
          host_count: scenario.hosts.hosts.length,
          providers: ["bw"],
          roster_version: "0.1.0",
          api_version: 1,
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
    async vaultStatus() {
      await wait();
      return vaultStatus();
    },
    async unlockVault(password: string) {
      await wait();
      if (vault === "not-logged-in") throw new BackendCallError(NOT_LOGGED_IN, VaultError.notLoggedIn);
      if (vault === "missing-cli") throw new BackendCallError(MISSING_CLI, VaultError.cliMissing);
      if (vault === "unsupported")
        throw new BackendCallError("no Host Login uses a vault with a master password", VaultError.unsupported);
      if (password !== FAKE_PASSWORD) throw new BackendCallError(WRONG_PASSWORD, VaultError.wrongPassword);
      vault = "unlocked";
      return { provider: "bw", status: vault };
    },
    async lockVault() {
      await wait();
      if (vault !== "locked" && vault !== "unlocked") return { locked: [] };
      vault = "locked";
      return { locked: ["bw"] };
    },
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
      if (scenario.sessionRefusal) {
        throw new BackendCallError(scenario.sessionRefusal.message, scenario.sessionRefusal.code);
      }
      return fakeSession(++sessions, host, size, events);
    },
  };
}
