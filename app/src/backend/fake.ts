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
  type SignInAnswer,
  SignInError,
  type SignInStart,
  type SignInStep,
  type TwoFactorMethod,
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
   * after `failAfterMs` (roster-core's timeout) while serve carries on and unlocks anyway. Like
   * serve, the fake then answers vault calls in order, so later ones wait for that unlock. */
  slowUnlock?: { failAfterMs: number; completesAfterMs: number };
  /** The account `vault.login` signs in to, when the vault is `not-logged-in` (ticket 31). Without
   * it, `vault.status` has no `sign_in` (a roster older than api 3). */
  signIn?: FakeAccount;
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

/** Two-step methods an account can have; bw's CLI can't do webauthn (FIDO2) or duo. */
export type FakeMethodKind = "authenticator" | "email" | "yubikey" | "webauthn" | "duo";

export interface FakeAccount {
  methods?: FakeMethodKind[];
  /** Bitwarden asks for the new-device email code (accounts without two-step login). */
  newDevice?: boolean;
  /** How SSO ends in the browser, after `ssoMs` (default ok, 300 ms). */
  sso?: "ok" | "fail";
  ssoMs?: number;
  /** Every start is refused with this (52 rate limited, 53 unreachable…). */
  refuse?: Refusal;
  /** What `bw config server` says (null: bitwarden.com). */
  server?: string | null;
}

/** The fake account's email, two-step / new-device code and API key (type them in a plain browser). */
export const FAKE_EMAIL = "you@example.com";
export const FAKE_CODE = "123456";
export const FAKE_API_KEY = { id: "user.fake-client", secret: "fake-client-secret" };

export interface Refusal {
  code: number;
  message: string;
  data?: CallErrorData;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

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

const signingIn = (signIn: FakeAccount): FakeScenario => ({
  hosts: makeHosts(12),
  vault: { status: "not-logged-in" },
  signIn,
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
  /** Sign-in (ticket 31): a new Box, so Bitwarden asks for the new-device code. */
  "sign-in": signingIn({ newDevice: true }),
  "sign-in-2fa": signingIn({ methods: ["authenticator", "email", "yubikey", "webauthn"] }),
  "sign-in-totp": signingIn({ methods: ["authenticator"] }),
  "sign-in-fido2": signingIn({ methods: ["webauthn"] }),
  "sign-in-sso": signingIn({ sso: "ok", ssoMs: 2500 }),
  "sign-in-eu": signingIn({ server: "https://vault.bitwarden.eu" }),
  "sign-in-rate-limited": signingIn({
    refuse: {
      code: SignInError.rateLimited,
      message: "bitwarden.com refused: too many sign-in attempts - wait a few minutes, then try again",
    },
  }),
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
    const signIn = vault === "not-logged-in" && scenario.signIn
      ? { sign_in: { methods: ["password", "apikey", "sso"] as SignInStart["method"][], server: scenario.signIn.server ?? null } }
      : {};
    const main = { provider, status: vault, ...(message ? { message } : {}), ...signIn };
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
  // ---- vault.login, as roster answers it (README "Signing in: vault.login")
  let login: { id: string; step: SignInStep } | null = null;
  let logins = 0;
  const stepOf = (id: string, step: DistributiveOmit<SignInStep, "login">): SignInStep => {
    const s = { ...step, login: id } as SignInStep;
    if (s.step === "done") {
      vault = "unlocked";
      login = null;
    } else {
      login = { id, step: s };
    }
    return s;
  };
  /** A failure; with `again`, the sign-in carries on at that step (data.step), else it's over. */
  const signInFailure = (code: number, message: string, again?: SignInStep) => {
    if (!again) login = null;
    return new BackendCallError(message, code, again ? { step: again, login: again.login } : null);
  };
  const ORDER: FakeMethodKind[] = ["authenticator", "yubikey", "email"];
  const NAMES: Record<string, [number, string]> = {
    authenticator: [0, "Authenticator App"],
    yubikey: [3, "Yubico OTP Security Key"],
    email: [1, "Email"],
  };
  const afterPassword = (id: string, account: FakeAccount): SignInStep => {
    const usable = ORDER.filter((m) => account.methods?.includes(m));
    if (account.methods?.length && usable.length === 0) {
      throw signInFailure(
        SignInError.methodUnsupported,
        "the Bitwarden CLI can't do this account's two-step login: FIDO2 security keys and Duo aren't supported by the CLI - sign in with an API key instead, or add an authenticator app, email or YubiKey OTP as a second method in the web vault",
      );
    }
    if (usable.length > 1) {
      const methods: TwoFactorMethod[] = usable.map((m, index) => {
        const [mid, name] = NAMES[m] ?? [null, m];
        return { index, id: mid, kind: m as TwoFactorMethod["kind"], name };
      });
      return stepOf(id, { step: "two_factor_method", methods });
    }
    if (usable.length === 1) return stepOf(id, { step: "two_factor_code", method: null, sent: usable[0] === "email" });
    if (account.newDevice) return stepOf(id, { step: "new_device_code", email: FAKE_EMAIL });
    return stepOf(id, { step: "done", provider: "bw", status: "unlocked" });
  };
  const signIn = async (start: SignInStart): Promise<SignInStep> => {
    await wait();
    login = null;
    if (vault !== "not-logged-in") {
      throw signInFailure(
        SignInError.alreadyLoggedIn,
        "the Bitwarden CLI is already logged in on this box - unlock it instead (to sign in as someone else, run `bw logout` first)",
      );
    }
    const account = scenario.signIn ?? {};
    if (!["cloud", "eu"].includes(start.server) && !/^https?:\/\/[^\s/]+\S*$/.test(start.server)) {
      throw signInFailure(
        SignInError.badServer,
        `'${start.server}' isn't a server address - use cloud, eu, or your server's https:// URL, e.g. https://vault.example.com`,
      );
    }
    if (account.refuse) throw signInFailure(account.refuse.code, account.refuse.message);
    const id = `fake-login-${++logins}`;
    if (start.method === "password") {
      if (start.email !== FAKE_EMAIL || start.password !== FAKE_PASSWORD) {
        throw signInFailure(
          VaultError.wrongPassword,
          "Bitwarden didn't accept that email and master password (on bitwarden.com)",
        );
      }
      return afterPassword(id, account);
    }
    if (start.method === "apikey") {
      if (start.client_id !== FAKE_API_KEY.id || start.client_secret !== FAKE_API_KEY.secret) {
        throw signInFailure(SignInError.apiKeyRejected, "Bitwarden didn't accept that API key (client_id or client_secret)");
      }
      return stepOf(id, { step: "master_password", email: null });
    }
    return stepOf(id, {
      step: "sso",
      url: "https://vault.bitwarden.com/#/sso?clientId=cli&redirectUri=http%3A%2F%2Flocalhost%3A8065&state=fake",
      expires_in: 300,
    });
  };
  const signInAnswer = async (id: string, answer: SignInAnswer): Promise<SignInStep> => {
    await wait();
    const cur = login;
    if (!cur || cur.id !== id) {
      throw signInFailure(SignInError.noSignIn, "no sign-in in progress (it finished, was cancelled or timed out) - start again");
    }
    const step = cur.step;
    switch (step.step) {
      case "two_factor_method": {
        const m = "method" in answer ? step.methods[answer.method] : undefined;
        if (!m) throw new BackendCallError("vault.login: params.method must be one of the listed methods' index", -32602);
        return stepOf(id, { step: "two_factor_code", method: m, sent: m.kind === "email" });
      }
      case "two_factor_code":
      case "new_device_code": {
        if ("code" in answer && answer.code === FAKE_CODE) return stepOf(id, { step: "done", provider: "bw", status: "unlocked" });
        const emailed = step.step === "new_device_code" || step.sent;
        throw signInFailure(
          SignInError.codeRejected,
          `Bitwarden didn't accept that code (wrong or expired)${emailed ? " - a new code is on its way to your email" : ""}`,
          step,
        );
      }
      case "sso": {
        await sleep(scenario.signIn?.ssoMs ?? 300);
        if (login?.id !== id) throw signInFailure(SignInError.noSignIn, "no sign-in in progress - start again");
        if (scenario.signIn?.sso === "fail") throw signInFailure(SignInError.ssoFailed, "the SSO sign-in failed in the browser - try again");
        return stepOf(id, { step: "master_password", email: null });
      }
      case "master_password": {
        if ("password" in answer && answer.password === FAKE_PASSWORD) {
          return stepOf(id, { step: "done", provider: "bw", status: "unlocked" });
        }
        throw signInFailure(VaultError.wrongPassword, WRONG_PASSWORD, step);
      }
      default:
        throw signInFailure(SignInError.noSignIn, "no sign-in in progress - start again");
    }
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
    signIn: (start) => inOrder(() => signIn(start)),
    signInAnswer: (id, answer) => inOrder(() => signInAnswer(id, answer)),
    signInCancel: () =>
      inOrder(async () => {
        login = null;
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
