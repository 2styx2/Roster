import { describe, expect, it } from "vitest";
import { complete, runLine, type CommandContext } from "../commands/table";
import { builtinRegistries } from "../registries";

describe("the finder command", () => {
  const { commands } = builtinRegistries();
  function run(line: string) {
    const calls: string[] = [];
    const ctx = { openFinder: (id: string) => calls.push(`finder ${id}`), say: (m: string) => calls.push(`say ${m}`) };
    runLine(commands, ctx as unknown as CommandContext, line);
    return calls;
  }

  it("opens the finder over a registered source, named by the source's title", () => {
    expect(run("finder sessions")).toEqual(["finder sessions"]);
    expect(run("finder nope")).toEqual(["say No finder named nope (sessions, hosts, tree, inventory)"]);
    expect(commands.get("finder")?.label("sessions")).toBe("Find a Session");
    expect(complete(commands, "finder t", [])).toEqual(["finder tree"]);
  });
});
