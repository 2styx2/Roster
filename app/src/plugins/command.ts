// `:plugins` (ticket 23, decision Q81): the panel, and its subcommands.
//
//   plugins                      the panel: every Plugin, its grants (toggles), problems, recent use
//   plugins install PATH         asks (the permission prompt), then installs a local Plugin folder
//   plugins remove NAME          unloads it and forgets it
//   plugins reload NAME          loads it again (after an edit, or once it was disabled)
//   plugins revoke NAME PERM     takes a permission away, at once
//   plugins grant NAME PERM      gives one back
//   plugins call NAME N          what a Plugin's row, action or finder item runs (not for typing)
import type { CommandDef } from "../commands/table";
import { matching } from "../commands/table";
import { BUILTIN } from "../registry";
import type { PluginManager } from "./manager";

const SUBCOMMANDS = ["install", "remove", "reload", "revoke", "grant"] as const;

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
      if (words.length === 2 && sub !== "install" && sub !== "call") return matching(manager.names(), name).map((n) => `${sub} ${n}`);
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
        case "call": {
          const [name, n] = rest;
          const handler = Number(n);
          if (!name || !Number.isInteger(handler)) return ctx.say(":plugins call NAME N runs what a Plugin handed over");
          return void manager.call(name, handler);
        }
        default:
          return ctx.say(`:plugins ${sub}? There's install, remove, reload, revoke and grant`);
      }
    },
  };
}
