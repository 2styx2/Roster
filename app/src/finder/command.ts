// `finder SOURCE`: opens the Finder over a source from the finder source registry (`␣ b` is
// `finder sessions`). It reads the registry live, so a source the Config or a Plugin registers
// is a finder straight away.
import type { CommandDef } from "../commands/table";
import { BUILTIN } from "../registry";
import type { FinderRegistry } from "./sources";

export function finderCommand(finders: Pick<FinderRegistry, "get" | "list">): CommandDef {
  const ids = () => finders.list().map((s) => s.id);
  return {
    id: "finder",
    source: BUILTIN,
    area: "View",
    arg: "text",
    label: (id) => (id ? (finders.get(id)?.title ?? `Finder ${id}`) : "Open a finder"),
    run: (ctx, id = "") => {
      if (!finders.get(id)) return ctx.say(`No finder named ${id} (${ids().join(", ")})`);
      ctx.openFinder(id);
    },
    complete: (arg) => ids().filter((id) => id.startsWith(arg)),
  };
}
