// The fake Backend's Plugin host (ticket 23): what roster-core's does, for UI tests and the plain
// browser. A fake Plugin is TypeScript shaped like its Lua: `load(roster)` gets a `roster` module
// with only the functions its grants give (as the core's), and functions it hands over come back
// as `{ handler: N }`. Errors name the Plugin and `init.lua`, a load error or a third error
// disables it, as in the core. The built-in `hosts` Plugin is here as the core's Lua is.
import PERMISSIONS from "../../../crates/roster-core/tests/fixtures/plugin-permissions.json";
import { PLUGIN_COMMANDS } from "../plugins/cmd";
import { BackendCallError, type Host, type PluginEventName, type PluginManifest, type PluginReply } from "./types";

type Fn = (arg: Record<string, unknown>) => unknown;
type Spec = Record<string, unknown>;

/** The `roster` module a fake Plugin's `load` gets. */
export interface FakeRoster {
  api_version: number;
  plugin: { name: string; version: string; permissions: string[]; config: Record<string, unknown> };
  commands: { add(name: string, spec: Spec): void; remove(name: string): void };
  keymap: { set(context: string, keys: string, action: string | false): void; del(context: string, keys: string): void };
  themes: { define(id: string, theme: Spec): void; remove(id: string): void };
  sidebar: { set(id: string, spec: Spec): void; remove(id: string): void };
  status: { set(id: string, spec: Spec): void; remove(id: string): void };
  finders: { set(id: string, spec: Spec): void; remove(id: string): void };
  help: { set(id: string, spec: Spec): void; remove(id: string): void };
  health: { set(id: string, spec: Spec): void; remove(id: string): void };
  tutor: { set(id: string, spec: Spec): void; remove(id: string): void };
  badges: { set(host: string, text: string | null): void };
  float: { open(spec: Spec): void; close(): void };
  views: { set(id: string, spec: Spec): void; update(id: string, changes: Spec): void; open(id: string): void; close(id: string): void; remove(id: string): void };
  details: { set(id: string, host: string, spec: Spec | null): void; remove(id: string): void };
  clipboard: { copy(text: string): void };
  notify(text: string, level?: "info" | "warn" | "error"): void;
  on(event: PluginEventName, f: Fn): void;
  /** Timers (ticket 79): the app keeps the clock and calls back, as the core does. */
  defer(ms: number, f: () => void): number;
  every(ms: number, f: () => void): number;
  cancel(timer: number): void;
  has(permission: string): boolean;
  /** Ticket 78: a question the app draws, a command line, progress and toolbar controls. */
  confirm(spec: Spec): void;
  cmd(line: string): void;
  progress: { set(id: string, spec: Spec): void; remove(id: string): void };
  toolbar: { set(id: string, spec: Spec): void; remove(id: string): void };
  inventory?: { hosts(): Host[]; host(name: string): Host | undefined; groups(): Record<string, { title: string; description: string }> };
  sessions: { show(session: number, line?: string): void; open?(host: string): void };
  terminal?: { send(session: number, text: string): void };
}

export interface FakePlugin {
  manifest: Omit<PluginManifest, "permissions"> & { permissions: string[] };
  /** Its init.lua. */
  load(roster: FakeRoster): void;
}

const RISKS: Record<string, string> = {
  "inventory.write": "Can change Hosts. The changes stay Pending until you review and Publish them.",
  "sessions.open": "Can open Sessions on your Hosts.",
  "terminal.read":
    "Sees everything your Sessions print, including anything a server echoes back. A password you type at a prompt that echoes it would be visible too.",
  "terminal.write": "Can type into your open Sessions, as if you typed it: it can run commands on your servers.",
};
const SUMMARIES: Record<string, string> = {
  "inventory.read": "Read your Hosts and their Login references (never a password)",
  "inventory.write": "Change Hosts, as Pending changes",
  "sessions.open": "Open Sessions",
  "terminal.read": "Read what your Sessions print",
  "terminal.write": "Type into your Sessions",
};

/** The serve methods whose summary and risk say more than "Call roster's …" (permission.rs). */
const SERVE: Record<string, { summary: string; risk: string | null } | undefined> = PERMISSIONS.serve;

const EVENT_NEEDS: Record<PluginEventName, string[]> = {
  lock: [],
  unlock: [],
  host_selected: ["inventory.read", "terminal.read"],
  session_open: ["inventory.read", "terminal.read"],
  session_exit: ["inventory.read", "terminal.read"],
  inventory_changed: ["inventory.read"],
  terminal_output: ["terminal.read"],
};

const isName = (s: string) => /^[a-z0-9_.]*$/.test(s);

/** Whether a Plugin may ever call `method`, as permission.rs's serve_method_allowed. */
function serveMethodAllowed(method: string): boolean {
  return (
    PERMISSIONS.serve_methods.includes(method) ||
    PERMISSIONS.serve_prefixes.some((p) => method.length > p.length && method.startsWith(p) && isName(method.slice(p.length)))
  );
}

// ------------------------------------------------------------------ network:<site> (Q97)
// As roster-core's plugin/network.rs Site::parse, on the same table of cases.

const isLabel = (l: string) => /^[a-z0-9-]{1,63}$/.test(l) && !l.startsWith("-") && !l.endsWith("-");
const isDomain = (s: string) => {
  const labels = s.split(".");
  return s.length <= 253 && labels.length >= 2 && labels.every(isLabel) && !/^[0-9]+$/.test(labels.at(-1) ?? "");
};
const isIpv4 = (s: string) => /^(0|[1-9][0-9]{0,2})(\.(0|[1-9][0-9]{0,2})){3}$/.test(s) && s.split(".").every((n) => Number(n) <= 255);

/** An IPv6 address's eight groups, or null. */
function ipv6Groups(s: string): number[] | null {
  if (!/^[0-9a-f:]+$/.test(s)) return null;
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const part = (h: string) => (h === "" ? [] : h.split(":"));
  const head = part(halves[0] ?? "");
  const tail = halves.length === 2 ? part(halves[1] ?? "") : [];
  if ([...head, ...tail].some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  return [...head, ...Array<string>(missing).fill("0"), ...tail].map((g) => parseInt(g, 16));
}

/** RFC 5952's form, as Rust writes an Ipv6Addr. */
function ipv6Text(g: number[]): string {
  let best = -1;
  let len = 0;
  for (let i = 0; i < 8; ) {
    if (g[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && g[j] === 0) j++;
    if (j - i > len && j - i > 1) [best, len] = [i, j - i];
    i = j;
  }
  const hex = (xs: number[]) => xs.map((x) => x.toString(16)).join(":");
  return best < 0 ? hex(g) : `${hex(g.slice(0, best))}::${hex(g.slice(best + len))}`;
}

function v4Public(s: string): boolean {
  const [a = 0, b = 0, c = 0] = s.split(".").map(Number);
  return !(
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) || a >= 224
  );
}

interface Site {
  http: boolean;
  shown: string;
  /** An address that isn't public (the core's is_public; IPv6 simplified to global unicast). */
  inside: boolean;
}

const SITE_HELP =
  "a site is a domain such as api.example.com, *.example.com for the names under it, or an address such as 10.0.0.5; http:// before it allows plain http, :PORT after it another port";

/** A `network:` site, or why the core refuses it. */
function parseSite(text: string): Site | string {
  const bad = (why: string) => `"network:${text}": ${why} (${SITE_HELP})`;
  let rest = text;
  const http = text.startsWith("http://");
  if (http) rest = text.slice(7);
  else if (text.includes("://")) return bad("only http:// may come before a site; https is the default");
  if (rest === "") return bad("which site?");
  if (/[A-Z]/.test(rest)) return bad("write it in lower case");
  if (/[/?#@ ]/.test(rest)) return bad("only a site, with no path, user or spaces");
  let host: string;
  let port: string | null = null;
  let inside = false;
  let shown = text;
  if (rest.startsWith("[")) {
    const close = rest.indexOf("]");
    if (close < 0) return bad("an IPv6 address goes in [ ]");
    const addr = rest.slice(1, close);
    const tail = rest.slice(close + 1);
    if (tail !== "" && !tail.startsWith(":")) return bad("only :PORT may follow ]");
    if (tail !== "") port = tail.slice(1);
    const g = ipv6Groups(addr);
    if (!g) return bad("that isn't an IPv6 address");
    if (ipv6Text(g) !== addr) return bad(`write the address as [${ipv6Text(g)}]`);
    const [g0 = 0, g1 = 0] = g;
    inside = (g0 & 0xe000) !== 0x2000 || (g0 === 0x2001 && (g1 === 0x0db8 || g1 < 0x0200));
  } else {
    const colon = rest.indexOf(":");
    host = colon < 0 ? rest : rest.slice(0, colon);
    if (colon >= 0) port = rest.slice(colon + 1);
    if (isIpv4(host)) inside = !v4Public(host);
    else if (host.startsWith("*.")) {
      if (!isDomain(host.slice(2))) return bad("*. goes before a domain of two names or more, such as *.example.com");
      shown = `any site under ${host.slice(2)}${http ? " over plain http" : ""}${port !== null ? ` on port ${port}` : ""}`;
    } else if (host.includes("*")) return bad("a wildcard is only *. at the start");
    else if (!isDomain(host)) {
      return bad(/^[0-9.]+$/.test(host) ? "that isn't an IPv4 address" : "that isn't a domain with a dot in it, such as api.example.com");
    }
  }
  if (port !== null && !(/^[1-9][0-9]{0,4}$/.test(port) && Number(port) <= 65535)) return bad("the port is a number from 1 to 65535");
  return { http, shown, inside };
}

function networkRisk(site: Site): string {
  let text = `Can send data to ${site.shown} and fetch from it: anything the Plugin can read (your Hosts, what your Sessions print) could leave this computer.`;
  if (site.http) text += " Plain http: anyone on the way can read and change it.";
  if (site.inside) text += " That address is on this computer or a private network.";
  return text;
}

/** Why the core refuses `p` in a manifest (permission.rs's Permission::parse), or null. */
function permissionProblem(p: string): string | null {
  if (PERMISSIONS.permissions.includes(p)) return null;
  if (p === "network") return `"network" names the site it may reach: "network:api.example.com", one for each site`;
  if (p.startsWith("network:")) {
    const site = parseSite(p.slice(8));
    return typeof site === "string" ? site : null;
  }
  if (p.startsWith("serve:")) {
    const method = p.slice(6);
    if (serveMethodAllowed(method)) return null;
    return `"serve:${method}" can't be granted: a Plugin may call only ${PERMISSIONS.serve_methods.join(", ")} and the mesh.* and discover.* methods, never one that reaches a secret`;
  }
  return `${JSON.stringify(p)} isn't a permission (there's inventory.read, inventory.write, sessions.open, terminal.read, terminal.write, serve:<method> and network:<site>)`;
}

/** What the core refuses in a manifest: the first permission it can't grant. From the table the
 * core is tested on too (crates/roster-core/tests/fixtures/plugin-permissions.json). */
export function manifestProblem(m: FakePlugin["manifest"]): string | null {
  for (const p of m.permissions) {
    const problem = permissionProblem(p);
    if (problem) return `roster-plugin.lua: permissions: ${problem}`;
  }
  return null;
}

export function described(m: FakePlugin["manifest"]): PluginManifest {
  const problem = manifestProblem(m);
  if (problem) throw new BackendCallError(`${m.name}: ${problem}`);
  return {
    ...m,
    permissions: m.permissions.map((name) => {
      const site = name.startsWith("network:") ? parseSite(name.slice(8)) : null;
      if (site && typeof site !== "string") {
        return { name, summary: `Send and fetch over the network: ${site.shown}`, risk: networkRisk(site) };
      }
      return {
      name,
      summary: SUMMARIES[name] ?? SERVE[name]?.summary ?? `Call roster's ${name.replace(/^serve:/, "")}`,
      risk:
        RISKS[name] ??
        SERVE[name]?.risk ??
        (name.startsWith("serve:") && !PERMISSIONS.serve_reads.includes(name.slice(6))
          ? `Can run roster's ${name.slice(6)}, which can change things on your Hosts or in the Inventory.`
          : null),
      };
    }),
  };
}

/** The status bar's Host count, as crates/roster-core/plugins/hosts/init.lua writes it. */
export const fakeHostsPlugin: FakePlugin = {
  manifest: { name: "hosts", version: "1.0.0", description: "The status bar's Host count", author: "roster", api: 2, permissions: ["inventory.read"] },
  load(roster) {
    const inventory = roster.inventory;
    if (!inventory) return;
    const show = () => {
      const n = inventory.hosts().length;
      roster.status.set("hosts", { text: `${n.toLocaleString("en-US")} ${n === 1 ? "Host" : "Hosts"}` });
    };
    show();
    roster.on("inventory_changed", show);
  },
};

interface Running {
  manifest: PluginManifest;
  grants: Set<string>;
  handlers: Map<number, Fn>;
  /** The timers waiting, by handler: whether each repeats. */
  timers: Map<number, boolean>;
  /** The commands it added: `roster.cmd` may run them (ticket 78). */
  commands: Set<string>;
  listeners: Map<string, Fn[]>;
  errors: number;
  disabled: string | null;
}

export function fakePluginHost(
  plugins: Record<string, FakePlugin>,
  hosts: () => Host[],
  /** Paths found elsewhere (a Package's `package:NAME`), with the settings they're handed. */
  extra: (path: string) => { plugin: FakePlugin; config: Record<string, unknown> } | undefined = () => undefined,
): {
  pluginManifest(path: string): Promise<{ manifest: PluginManifest; dir: string }>;
  pluginTypes(path: string): Promise<string>;
  pluginLoad(path: string, grants: readonly string[]): Promise<{ manifest: PluginManifest; dir: string; reply: PluginReply }>;
  pluginCall(plugin: string, handler: number, args: unknown): Promise<PluginReply>;
  pluginEvent(name: PluginEventName, payload: Record<string, unknown>): Promise<PluginReply[]>;
  pluginUnload(plugin: string): Promise<boolean>;
  onPluginReply(onReply: (reply: PluginReply) => void): () => void;
  /** As the core does when a request answers: hands `reply` to whoever listens. */
  pluginReplied(reply: PluginReply): void;
} {
  const all: Record<string, FakePlugin> = { "builtin:hosts": fakeHostsPlugin, ...plugins };
  const running = new Map<string, Running>();
  let next = 0;
  let ops: unknown[] = [];
  /** Whether the run is a call the user started: only then may a Plugin copy. */
  let userCall = false;
  const replyWatchers = new Set<(reply: PluginReply) => void>();

  const configs = new Map<string, Record<string, unknown>>();
  const find = (path: string) => {
    const found = extra(path);
    const p = found?.plugin ?? all[path];
    if (found) configs.set(path, found.config);
    if (!p) throw new BackendCallError(`${path} has no roster-plugin.lua: is it a roster Plugin?`);
    return p;
  };

  const data = (r: Running, v: unknown): unknown => {
    if (typeof v === "function") {
      const id = ++next;
      r.handlers.set(id, v as Fn);
      return { handler: id };
    }
    if (Array.isArray(v)) return v.map((x) => data(r, x));
    if (typeof v === "object" && v !== null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, data(r, x)]));
    return v;
  };

  const userOnly = (what: string) => {
    if (!userCall) throw new Error(`${what}: only while the user runs one of your actions, commands or finder items`);
  };

  const module = (r: Running, config: Record<string, unknown> = {}): FakeRoster => {
    const push = (op: Record<string, unknown>) => ops.push(data(r, op));
    const piece = (kind: string) => ({
      set: (id: string, spec: Spec) => push({ op: kind, id, spec }),
      remove: (id: string) => push({ op: "remove", kind, id }),
    });
    const m: FakeRoster = {
      api_version: 3,
      plugin: { name: r.manifest.name, version: r.manifest.version, permissions: [...r.grants], config },
      commands: {
        add: (name, spec) => {
          r.commands.add(name);
          push({ op: "command", name, desc: spec.desc ?? "", run: spec.run });
        },
        remove: (name) => {
          r.commands.delete(name);
          push({ op: "remove", kind: "command", id: name });
        },
      },
      keymap: {
        set: (context, keys, action) => push({ op: "key", context, keys, action }),
        del: (context, keys) => push({ op: "key", context, keys, action: false }),
      },
      themes: { define: (id, theme) => push({ op: "theme", id, theme }), remove: (id) => push({ op: "remove", kind: "theme", id }) },
      sidebar: piece("section"),
      status: piece("status"),
      finders: piece("finder"),
      help: piece("help"),
      health: piece("health"),
      tutor: piece("tutor"),
      badges: { set: (host, text) => push({ op: "badge", host, text }) },
      float: { open: (spec) => push({ op: "float", spec }), close: () => push({ op: "float", spec: null }) },
      views: {
        set: (id, spec) => push({ op: "view", id, spec }),
        update: (id, changes) => push({ op: "view_update", id, changes }),
        open: (id) => {
          if (!userCall) throw new Error("roster.views.open: only while the user runs one of your actions, commands or finder items");
          push({ op: "view_open", id });
        },
        close: (id) => push({ op: "view_close", id }),
        remove: (id) => push({ op: "remove", kind: "view", id }),
      },
      details: {
        set: (id, host, spec) => push({ op: "details", id, host, spec }),
        remove: (id) => push({ op: "remove", kind: "details", id }),
      },
      clipboard: {
        copy: (text) => {
          if (!userCall) throw new Error("roster.clipboard.copy: only while the user runs one of your actions, commands or finder items");
          push({ op: "copy", text });
        },
      },
      notify: (text, level = "info") => push({ op: "notify", text, level }),
      on: (event, f) => {
        const needs = EVENT_NEEDS[event];
        if (needs.length && !needs.some((p) => r.grants.has(p))) throw new Error(`roster.on: the ${event} event needs the ${needs.join(" or ")} permission`);
        r.listeners.set(event, [...(r.listeners.get(event) ?? []), f]);
      },
      confirm: (spec) => {
        userOnly("roster.confirm");
        if (typeof spec.run !== "function") throw new Error("roster.confirm: `run` must be a function: what happens when the user confirms");
        push({ op: "confirm", spec });
      },
      cmd: (line) => {
        userOnly("roster.cmd");
        const word = line.trim().split(/\s+/)[0] ?? "";
        if (!word) throw new Error('roster.cmd: which command? (a line such as "finder alerts")');
        if (!r.commands.has(word)) {
          const rule = PLUGIN_COMMANDS.find((c) => c.name === word);
          if (!rule) throw new Error(`roster.cmd: :${word} isn't one a Plugin may run (its own commands, and ${PLUGIN_COMMANDS.map((c) => c.name).join(", ")})`);
          if (rule.permission && !r.grants.has(rule.permission)) throw new Error(`roster.cmd: :${word} needs the ${rule.permission} permission`);
        }
        push({ op: "cmd", line: line.trim() });
      },
      progress: piece("progress"),
      toolbar: piece("toolbar"),
      sessions: {
        show: (session, line) => {
          userOnly("roster.sessions.show");
          push({ op: "session_show", session, line: line ?? null });
        },
      },
      defer: (ms, f) => timer(r, "roster.defer", ms, f, false),
      every: (ms, f) => timer(r, "roster.every", ms, f, true),
      cancel: (id) => {
        if (!r.timers.delete(id)) return;
        r.handlers.delete(id);
        ops.push({ op: "remove", kind: "timer", id: String(id) });
      },
      has: (p) => {
        if (permissionProblem(p) === null) return r.grants.has(p);
        if (p === "network") return [...r.grants].some((g) => g.startsWith("network:"));
        if (p.startsWith("serve:") || p.startsWith("network:")) return false;
        throw new Error(`roster.has: ${JSON.stringify(p)} isn't a permission`);
      },
    };
    if (r.grants.has("inventory.read")) {
      m.inventory = {
        hosts: () => hosts(),
        host: (name) => hosts().find((h) => h.name === name),
        groups: () => Object.fromEntries([...new Set(hosts().map((h) => h.group))].map((g) => [g, { title: "", description: "" }])),
      };
    }
    if (r.grants.has("sessions.open")) m.sessions.open = (host) => push({ op: "open", host });
    if (r.grants.has("terminal.write")) m.terminal = { send: (session, text) => push({ op: "send", session, text }) };
    return m;
  };

  /** As runtime.rs's add_timer: the same floors, ceiling and op. */
  const timer = (r: Running, what: string, ms: number, f: () => void, every: boolean): number => {
    if (!Number.isFinite(ms) || ms < 0 || ms > 2_147_483_647) throw new Error(`${what}: ms must be a number of milliseconds from 0 to 2147483647`);
    if (every && ms < 1000) throw new Error(`${what}: at least 1000 ms between runs (use roster.defer for once, soon)`);
    if (r.timers.size >= 100) throw new Error(`${what}: more than 100 timers waiting at once (roster.cancel the ones you don't need)`);
    const id = ++next;
    r.handlers.set(id, () => f());
    r.timers.set(id, every);
    ops.push({ op: "timer", id: String(id), ms: Math.max(50, Math.ceil(ms)), every, run: { handler: id } });
    return id;
  };

  /** Runs `body` as a call into the Plugin: its ops, or its error (and a strike). */
  const run = (name: string, r: Running, body: () => unknown, loading = false): PluginReply => {
    ops = [];
    try {
      const result = body();
      return { plugin: name, result: data(r, result) ?? null, ops, error: null, disabled: null };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      r.errors += loading ? 3 : 1;
      if (r.errors >= 3) r.disabled = loading ? `it failed to load: ${name}: init.lua: ${message}` : `it failed ${r.errors} times`;
      return { plugin: name, result: null, ops: [], error: { plugin: name, file: "init.lua", line: null, message }, disabled: r.disabled };
    }
  };

  return {
    async pluginTypes(path) {
      // No disk here: the stubs would go to the folder's types/roster.lua.
      if (!path.trim()) throw new BackendCallError("which folder? :plugins types PATH");
      return `${path.replace(/[\\/]+$/, "")}/types/roster.lua`;
    },
    async pluginManifest(path) {
      return { manifest: described(find(path).manifest), dir: path };
    },
    async pluginLoad(path, grants) {
      const p = find(path);
      const manifest = described(p.manifest);
      const r: Running = {
        manifest,
        grants: new Set(p.manifest.permissions.filter((x) => grants.includes(x))),
        handlers: new Map(),
        timers: new Map(),
        commands: new Set(),
        listeners: new Map(),
        errors: 0,
        disabled: null,
      };
      running.set(manifest.name, r);
      const reply = run(manifest.name, r, () => p.load(module(r, configs.get(path))), true);
      return { manifest, dir: path, reply };
    },
    async pluginCall(plugin, handler, args) {
      const r = running.get(plugin);
      if (!r || r.disabled) {
        const message = r?.disabled ? `it's disabled: ${r.disabled}` : "it isn't loaded";
        return { plugin, result: null, ops: [], error: { plugin, file: null, line: null, message }, disabled: null };
      }
      const f = r.handlers.get(handler);
      if (!f) return { plugin, result: null, ops: [], error: { plugin, file: null, line: null, message: "that action is gone: the Plugin replaced it" }, disabled: null };
      // A timer firing isn't something the user started; a deferred one is gone once it runs.
      const timer = r.timers.get(handler);
      if (timer === false) {
        r.timers.delete(handler);
        r.handlers.delete(handler);
      }
      userCall = timer === undefined;
      try {
        return run(plugin, r, () => f((args ?? {}) as Record<string, unknown>));
      } finally {
        userCall = false;
      }
    },
    async pluginEvent(name, payload) {
      const replies: PluginReply[] = [];
      for (const [plugin, r] of running) {
        const fs = r.listeners.get(name);
        const needs = EVENT_NEEDS[name];
        if (!fs || r.disabled || (needs.length && !needs.some((p) => r.grants.has(p)))) continue;
        const reply = run(plugin, r, () => fs.forEach((f) => f(payload)));
        if (reply.ops.length || reply.error) replies.push(reply);
      }
      return replies;
    },
    async pluginUnload(plugin) {
      return running.delete(plugin);
    },
    onPluginReply(onReply) {
      replyWatchers.add(onReply);
      return () => replyWatchers.delete(onReply);
    },
    pluginReplied(reply) {
      for (const w of replyWatchers) w(reply);
    },
  };
}
