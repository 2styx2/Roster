import { describe, expect, it, vi } from "vitest";
import { Registry } from "./registry";

type Item = { id: string; source: string; value: number };

describe("Registry", () => {
  it("lists entries by id in the order they were first registered", () => {
    const r = new Registry<Item>();
    r.register({ id: "a", source: "builtin", value: 1 });
    r.register({ id: "b", source: "builtin", value: 2 });
    expect(r.list().map((e) => e.id)).toEqual(["a", "b"]);
    expect(r.get("b")?.value).toBe(2);
  });

  it("lets a later registration of the same id win, and unregistering it brings the earlier one back", () => {
    const r = new Registry<Item>();
    r.register({ id: "a", source: "builtin", value: 1 });
    r.register({ id: "b", source: "builtin", value: 2 });
    const dispose = r.register({ id: "a", source: "init.lua", value: 10 });
    expect(r.get("a")).toEqual({ id: "a", source: "init.lua", value: 10 });
    expect(r.list().map((e) => e.id)).toEqual(["a", "b"]);
    dispose();
    expect(r.get("a")?.source).toBe("builtin");
  });

  it("unregisters by id, or only what one source registered", () => {
    const r = new Registry<Item>();
    r.register({ id: "a", source: "builtin", value: 1 });
    r.register({ id: "a", source: "my-plugin", value: 2 });
    r.register({ id: "b", source: "my-plugin", value: 3 });
    r.unregisterSource("my-plugin");
    expect(r.list()).toEqual([{ id: "a", source: "builtin", value: 1 }]);
    r.unregister("a");
    expect(r.list()).toEqual([]);
  });

  it("tells subscribers about changes, with a new snapshot each time", () => {
    const r = new Registry<Item>();
    const seen = vi.fn();
    r.subscribe(seen);
    const before = r.list();
    r.register({ id: "a", source: "builtin", value: 1 });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(r.list()).not.toBe(before);
    expect(r.list()).toBe(r.list());
  });
});
