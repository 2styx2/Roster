// `:plugins` (ticket 23, decision Q81): the panel, and its subcommands.
//
//   plugins                      the panel: every Plugin, its grants (toggles), problems, recent use
//   plugins install PATH         asks (the permission prompt), then installs a local Plugin folder
//   plugins remove NAME          unloads it and forgets it
//   plugins reload NAME          loads it again (after an edit, or once it was disabled)
//   plugins revoke NAME PERM     takes a permission away, at once
//   plugins grant NAME PERM      gives one back
//   plugins types PATH           writes the API's stubs (types/roster.lua) into a Plugin's folder
//   plugins call NAME N CONTEXT  what a Plugin's row, action or finder item runs, and what it was (not for typing)
import type { CommandDef } from "../commands/table";
import { matching } from "../commands/table";
import { BUILTIN } from "../registry";
import type { HandlerContext, PluginManager } from "./manager";

const SUBCOMMANDS = ["install", "remove", "reload", "revoke", "grant", "types"] as const;

/** What ran a `plugins call NAME N CONTEXT` (a row, an item, a segment): the JSON after the
 * handler, URI-encoded so the command line's spaces can't change it. Only text and number
 * fields; anything else is left out. */
function callContext(text: string): HandlerContext {
  const encoded = text.split(/\s+/)[3];
  if (!encoded) return {};
  try {
    const v: unknown = JSON.parse(decodeURIComponent(encoded));
    if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === "string" || typeof x === "number")) as HandlerContext;
  } catch {
    return {};
  }
}

export function pluginsCommand(manager: PluginManager, openPanel: () => void): CommandDef {
  return {
    id: "plugins",
    source: BUILTIN,
    area: "Plugins",
    arg: "text",
    optionalArg: true,
    seldom: true,
    label: (a) => (a ? `Plugins: ${a}` : "Show the Plugins, what each may do, and revoke it"),
    complete: (arg) => {
      const words = arg.split(" ");
      if (words.length <= 1) return matching(SUBCOMMANDS, arg);
      const [sub, name = ""] = words;
      if (words.length === 2 && sub !== "install" && sub !== "call" && sub !== "types") return matching(manager.names(), name).map((n) => `${sub} ${n}`);
      if (words.length === 3 && (sub === "revoke" || sub === "grant")) {
        const p = manager.snapshot().plugins.find((x) => x.name === name);
        const perms = sub === "revoke" ? [...(p?.granted ?? [])] : (p?.manifest?.permissions.map((x) => x.name) ?? []).filter((x) => !p?.granted.includes(x));
        return matching(perms, words[2] ?? "").map((x) => `${sub} ${name} ${x}`);
      }
      return [];
    },
    run: (ctx, arg) => {
      const text = (arg ?? "").trim();
      const [sub = "", ...rest] = text.split(/\s+/);
      const say = (m: string | null) => m && ctx.say(m);
      switch (sub) {
        case "":
          return openPanel();
        case "install":
          if (!rest.length) return ctx.say("Which folder? :plugins install PATH");
          return void manager.install(text.slice("install".length).trim()).then(say);
        case "remove":
          return void manager.remove(rest[0] ?? "").then((m) => say(m ?? `Removed ${rest[0] ?? ""}`));
        case "reload":
          return void manager.reload(rest[0] ?? "").then(say);
        case "revoke":
        case "grant": {
          const [name, perm] = rest;
          if (!name || !perm) return ctx.say(`:plugins ${sub} NAME PERMISSION`);
          return void manager.setGrant(name, perm, sub === "grant");
        }
        case "types":
          if (!rest.length) return ctx.say("Which Plugin folder? :plugins types PATH writes its types/roster.lua");
          return void manager.writeTypes(text.slice("types".length).trim()).then(say);
        case "call": {
          const [name, n] = rest;
          const handler = Number(n);
          if (!name || !Number.isInteger(handler)) return ctx.say(":plugins call NAME N runs what a Plugin handed over");
          return void manager.callWith(name, handler, callContext(text));
        }
        default:
          return ctx.say(`:plugins ${sub}? There's install, remove, reload, revoke, grant and types`);
      }
    },
  };
}

// `:packages` (ticket 24): Plugins from git repos that init.lua names.
//
//   packages          the panel: each Package, the commit it's at, and whether it runs
//   packages update   fetches, then shows each new commit with its diff before applying it
//   packages clean    removes the Packages init.lua no longer names
const PACKAGE_SUBCOMMANDS = ["update", "clean"] as const;

export function packagesCommand(manager: PluginManager, openPanel: () => void): CommandDef {
  return {
    id: "packages",
    source: BUILTIN,
    area: "Plugins",
    arg: "text",
    optionalArg: true,
    seldom: true,
    label: (a) => (a ? `Packages: ${a}` : "Show the Packages init.lua names, and the commit each is at"),
    complete: (arg) => matching(PACKAGE_SUBCOMMANDS, arg),
    run: (ctx, arg) => {
      const sub = (arg ?? "").trim();
      switch (sub) {
        case "":
          return openPanel();
        case "update":
          ctx.say("Checking the Packages for updates…");
          return void manager.checkPackages().then((m) => ctx.say(m));
        case "clean":
          return void manager.cleanPackages().then((m) => ctx.say(m));
        default:
          return ctx.say(`:packages ${sub}? There's update and clean`);
      }
    },
  };
}
