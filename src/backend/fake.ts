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
} from "./types";

export interface FakeScenario {
  hosts: HostList;
  /** connect() fails with this (every time, unless `failOnce`). */
  startProblem?: BackendProblem;
  failOnce?: boolean;
  /** Milliseconds every call waits, to see loading states. */
  delay?: number;
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
  "no-wsl": {
    hosts: makeHosts(0),
    startProblem: problem("no-wsl", "No WSL distro was found.", "Install WSL and a Linux distro with roster in it."),
  },
};

export function fixtureFromUrl(search: string = globalThis.location?.search ?? ""): FakeScenario {
  const name = new URLSearchParams(search).get("fixture") ?? "many-hosts";
  return fixtures[name] ?? { hosts: makeHosts(300) };
}

export function fakeBackend(scenario: FakeScenario): Backend {
  let failures = 0;
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
  };
}
