// The fake Backend's Plugin host (ticket 23): what roster-core's does, for UI tests and the plain
// browser. A fake Plugin is TypeScript shaped like its Lua: `load(roster)` gets a `roster` module
// with only the functions its grants give (as the core's), and functions it hands over come back
// as `{ handler: N }`. Errors name the Plugin and `init.lua`, a load error or a third error
// disables it, as in the core. The built-in `hosts` Plugin is here as the core's Lua is.
import { BackendCallError, type Host, type PluginEventName, type PluginManifest, type PluginReply } from "./types";

type Fn = (arg: Record<string, unknown>) => unknown;
type Spec = Record<string, unknown>;

/** The `roster` module a fake Plugin's `load` gets. */
export interface FakeRoster {
  api_version: number;
  plugin: { name: string; version: string; permissions: string[]; config: Record<string, unknown> };
  commands: { add(name: string, spec: Spec): void; remove(name: string): void };
  keymap: { set(context: string, keys: string, action: string | false): void };
  themes: { define(id: string, theme: Spec): void };
  sidebar: { set(id: string, spec: Spec): void; remove(id: string): void };
  status: { set(id: string, spec: Spec): void; remove(id: string): void };
  finders: { set(id: string, spec: Spec): void; remove(id: string): void };
  help: { set(id: string, spec: Spec): void; remove(id: string): void };
  health: { set(id: string, spec: Spec): void; remove(id: string): void };
  tutor: { set(id: string, spec: Spec): void; remove(id: string): void };
  badges: { set(host: string, text: string | null): void };
  float: { open(spec: Spec): void; close(): void };
  clipboard: { copy(text: string): void };
  notify(text: string, level?: "info" | "warn" | "error"): void;
  on(event: PluginEventName, f: Fn): void;
  inventory?: { hosts(): Host[]; host(name: string): Host | undefined };
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

/** What the core refuses in a manifest (permission.rs): `network` (not yet) and any serve method
 * that isn't on the list, every secret one above all. */
export function manifestProblem(m: FakePlugin["manifest"]): string | null {
  for (const p of m.permissions) {
    if (p === "network") return `roster-plugin.lua: permissions: "network" isn't available yet: this roster has no network functions for Plugins`;
    if (p.startsWith("serve:") && /^(vault|session|quick|changes\.publish|host\.add|host\.save_login)/.test(p.slice(6)))
      return `roster-plugin.lua: permissions: "${p}" can't be granted: a Plugin may call only inventory.info, hosts.list, host.get, host.check, changes.diff and the mesh.* and discover.* methods, never one that reaches a secret`;
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
        (name.startsWith("serve:") && !["serve:inventory.info", "serve:hosts.list", "serve:host.get", "serve:changes.diff", "serve:mesh.status", "serve:mesh.plan"].includes(name)
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
      api_version: 2,
      plugin: { name: r.manifest.name, version: r.manifest.version, permissions: [...r.grants], config },
      commands: {
        add: (name, spec) => push({ op: "command", name, desc: spec.desc ?? "", run: spec.run }),
        remove: (name) => push({ op: "remove", kind: "command", id: name }),
      },
      keymap: { set: (context, keys, action) => push({ op: "key", context, keys, action }) },
      themes: { define: (id, theme) => push({ op: "theme", id, theme }) },
      sidebar: piece("section"),
      status: piece("status"),
      finders: piece("finder"),
      help: piece("help"),
      health: piece("health"),
      tutor: piece("tutor"),
      badges: { set: (host, text) => push({ op: "badge", host, text }) },
      float: { open: (spec) => push({ op: "float", spec }), close: () => push({ op: "float", spec: null }) },
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
    };
    if (r.grants.has("inventory.read")) m.inventory = { hosts: () => hosts(), host: (name) => hosts().find((h) => h.name === name) };
    if (r.grants.has("sessions.open")) m.sessions = { open: (host) => push({ op: "open", host }) };
    if (r.grants.has("terminal.write")) m.terminal = { send: (session, text) => push({ op: "send", session, text }) };
    return m;
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
      userCall = true;
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
