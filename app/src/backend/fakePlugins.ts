// The fake Backend's Plugin host (ticket 23): what roster-core's does, for UI tests and the plain
// browser. A fake Plugin is TypeScript shaped like its Lua: `load(roster)` gets a `roster` module
// with only the functions its grants give (as the core's), and functions it hands over come back
// as `{ handler: N }`. Errors name the Plugin and `init.lua`, a load error or a third error
// disables it, as in the core. The built-in `hosts` Plugin is here as the core's Lua is.
import PERMISSIONS from "../../../crates/roster-core/tests/fixtures/plugin-permissions.json";
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
  inventory?: { hosts(): Host[]; host(name: string): Host | undefined; groups(): Record<string, { title: string; description: string }> };
  sessions?: { open(host: string): void };
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

/** Why the core refuses `p` in a manifest (permission.rs's Permission::parse), or null. */
function permissionProblem(p: string): string | null {
  if (PERMISSIONS.permissions.includes(p)) return null;
  if (p === "network") return `"network" isn't available yet: this roster has no network functions for Plugins`;
  if (p.startsWith("serve:")) {
    const method = p.slice(6);
    if (serveMethodAllowed(method)) return null;
    return `"serve:${method}" can't be granted: a Plugin may call only ${PERMISSIONS.serve_methods.join(", ")} and the mesh.* and discover.* methods, never one that reaches a secret`;
  }
  return `${JSON.stringify(p)} isn't a permission (there's inventory.read, inventory.write, sessions.open, terminal.read, terminal.write and serve:<method>)`;
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
    permissions: m.permissions.map((name) => ({
      name,
      summary: SUMMARIES[name] ?? `Call roster's ${name.replace(/^serve:/, "")}`,
      risk:
        RISKS[name] ??
        (name.startsWith("serve:") && !PERMISSIONS.serve_reads.includes(name.slice(6))
          ? `Can run roster's ${name.slice(6)}, which can change things on your Hosts or in the Inventory.`
          : null),
    })),
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
} {
  const all: Record<string, FakePlugin> = { "builtin:hosts": fakeHostsPlugin, ...plugins };
  const running = new Map<string, Running>();
  let next = 0;
  let ops: unknown[] = [];
  /** Whether the run is a call the user started: only then may a Plugin copy. */
  let userCall = false;

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
        add: (name, spec) => push({ op: "command", name, desc: spec.desc ?? "", run: spec.run }),
        remove: (name) => push({ op: "remove", kind: "command", id: name }),
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
      defer: (ms, f) => timer(r, "roster.defer", ms, f, false),
      every: (ms, f) => timer(r, "roster.every", ms, f, true),
      cancel: (id) => {
        if (!r.timers.delete(id)) return;
        r.handlers.delete(id);
        ops.push({ op: "remove", kind: "timer", id: String(id) });
      },
      has: (p) => {
        if (permissionProblem(p) === null) return r.grants.has(p);
        if (p === "network" || p.startsWith("serve:")) return false;
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
    if (r.grants.has("sessions.open")) m.sessions = { open: (host) => push({ op: "open", host }) };
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
  };
}
