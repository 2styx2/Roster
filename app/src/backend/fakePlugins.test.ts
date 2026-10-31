// The fake Backend's Plugin host refuses exactly what the core refuses in a manifest: both are
// tested on one table (crates/roster-core/tests/fixtures/plugin-permissions.json, which
// crates/roster-core/src/plugin/permission.rs checks its own tables and cases against).
import { describe, expect, it } from "vitest";
import table from "../../../crates/roster-core/tests/fixtures/plugin-permissions.json";
import { described, manifestProblem, type FakePlugin } from "./fakePlugins";

const manifest = (permissions: string[]): FakePlugin["manifest"] => ({
  name: "example",
  version: "1.0.0",
  description: "",
  author: null,
  api: 2,
  permissions,
});

describe("a fake Plugin's manifest", () => {
  it.each(table.grant)("grants %j, as the core does", (p) => {
    expect(manifestProblem(manifest([p]))).toBeNull();
  });

  it.each(table.refuse)("refuses %j, as the core does", (p) => {
    expect(manifestProblem(manifest([p]))).toMatch(/^roster-plugin\.lua: permissions: /);
  });

  it("flags every serve method that isn't a read, as the core does", () => {
    const methods = table.grant.filter((p) => p.startsWith("serve:"));
    const flagged = described(manifest(methods)).permissions.filter((p) => p.risk).map((p) => p.name.slice(6));
    expect(flagged).toEqual(methods.map((m) => m.slice(6)).filter((m) => !table.serve_reads.includes(m)));
  });

  it.each(Object.entries(table.network))("sums up and flags %j as the core does", (p, want) => {
    expect(described(manifest([p])).permissions[0]).toEqual({ name: p, ...want });
  });

  it("flags every network site", () => {
    const sites = table.grant.filter((p) => p.startsWith("network:"));
    expect(described(manifest(sites)).permissions.every((p) => p.risk?.startsWith("Can send data to "))).toBe(true);
  });
});
