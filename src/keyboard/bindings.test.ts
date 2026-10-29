import { describe, expect, it } from "vitest";
import { defaultOptions, resolveKeymap } from "../keymap";
import { builtinCommandRegistry } from "../commands/table";
import { bindingRows as rowsIn, filterRows } from "./bindings";

const commands = builtinCommandRegistry();
const bindingRows = (k: Parameters<typeof rowsIn>[0], o: Parameters<typeof rowsIn>[1]) => rowsIn(k, o, commands);

describe("bindingRows", () => {
  const rows = bindingRows(resolveKeymap({ leader: { t: "next" } }), defaultOptions);
  const find = (label: string) => rows.filter((r) => r.label === label);

  it("starts with the Leader itself", () => {
    expect(rows[0]).toMatchObject({ area: "Leader", keys: ["Ctrl+Space"], source: "builtin" });
  });

  it("lists each action's keys, split by where they came from", () => {
    expect(find("Next Session")).toEqual([
      { area: "Sessions", label: "Next Session", keys: ["␣ ]"], source: "builtin" },
      { area: "Sessions", label: "Next Session", keys: ["␣ t"], source: "init.lua" },
    ]);
    expect(find("Close the Session")[0]?.keys).toEqual(["␣ d d"]);
    expect(find("Back to the terminal")[0]?.keys).toEqual(["Esc"]);
  });

  it("lists vim keys only while vim is on", () => {
    const keysOf = (vim: boolean) =>
      bindingRows(resolveKeymap(), { ...defaultOptions, vim })
        .filter((r) => r.label === "Move down" && r.area === "Sidebar")
        .flatMap((r) => r.keys);
    expect(keysOf(true)).toEqual(["↓", "j"]);
    expect(keysOf(false)).toEqual(["↓"]);
  });

  it("says a changed Leader comes from the Config", () => {
    const r = bindingRows(resolveKeymap(), { ...defaultOptions, leader: "Ctrl+b" });
    expect(r[0]).toMatchObject({ keys: ["Ctrl+b"], source: "init.lua" });
  });
});

describe("filterRows", () => {
  const rows = bindingRows(resolveKeymap(), defaultOptions);
  it("matches the action, its area, its keys or its source", () => {
    expect(filterRows(rows, "close the s").map((r) => r.label)).toEqual(["Close the Session"]);
    expect(filterRows(rows, "picker").every((r) => r.area === "Picker")).toBe(true);
    expect(filterRows(rows, "␣ d d").map((r) => r.label)).toEqual(["Close the Session"]);
    expect(filterRows(rows, "")).toHaveLength(rows.length);
  });
});
