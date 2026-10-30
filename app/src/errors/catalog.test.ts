// The catalog covers docs/app/errors.md and every code roster's README lists.
import { describe, expect, it } from "vitest";
import { BackendCallError } from "../backend/types";
import { builtinErrorRegistry, builtinErrorRows, problemFromCallError, rowFor } from "./catalog";
import type { Problem } from "./classify";

const rows = builtinErrorRegistry().list();
const ROSTER_CODES = [1, 2, 3, 11, 12, 14, 20, 21, 22, 30, 31, 32, 33, 34, 35, 36, 37, 38, 40, 41, 42, 43, 44, 45, 46, 47, 48];
const p = (code: Problem["code"]): Problem => ({ code, host: "esx", message: "m", details: "d" });

describe("the error catalog", () => {
  it("has a row for every one of docs/app/errors.md's 21 rows", () => {
    const covered = new Set(builtinErrorRows.map((r) => r.row));
    for (let n = 1; n <= 21; n++) expect(covered.has(n), `row ${n}`).toBe(true);
  });

  it("gives every roster code and the app's own a row with a place and a fix", () => {
    for (const code of [...ROSTER_CODES, "dropped", "closed-early", "backend-lost"] as const) {
      const row = rowFor(rows, code);
      expect(row.codes, String(code)).toContain(code);
      expect(row.where.length).toBeGreaterThan(0);
      expect(row.fix(p(code))).not.toBe("");
    }
  });

  it("gives every vault.login code its sign-in row (docs/app/errors.md rows 22-33)", () => {
    const covered = new Set(builtinErrorRows.map((r) => r.row));
    for (let n = 22; n <= 33; n++) expect(covered.has(n), `row ${n}`).toBe(true);
    for (const code of [10, 13, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59]) {
      const row = rowFor(rows, code);
      expect(row.codes, String(code)).toContain(code);
      expect(row.id).toMatch(/^sign-in-/);
      expect(row.fix(p(code))).not.toBe("");
    }
    expect(rowFor(rows, 51).fix(p(51))).toMatch(/API key/);
    expect(rowFor(rows, 53).where).toContain("the network");
  });

  it("gives every editing code its row (docs/app/errors.md rows 38-43, ticket 10)", () => {
    const covered = new Set(builtinErrorRows.map((r) => r.row));
    for (let n = 38; n <= 43; n++) expect(covered.has(n), `row ${n}`).toBe(true);
    for (const code of [70, 71, 72, 73, 74, 75]) {
      const row = rowFor(rows, code);
      expect(row.codes, String(code)).toContain(code);
      expect(row.id).toMatch(/^edit-/);
      expect(row.fix(p(code))).not.toBe("");
    }
    expect(rowFor(rows, 72).where).toContain("the infra repo");
  });

  it("gives every publishing code its row (docs/app/errors.md rows 46-52, ticket 12)", () => {
    const covered = new Set(builtinErrorRows.map((r) => r.row));
    for (let n = 46; n <= 52; n++) expect(covered.has(n), `row ${n}`).toBe(true);
    for (const code of [90, 91, 92, 93, 94, 95, 96]) {
      const row = rowFor(rows, code);
      expect(row.codes, String(code)).toContain(code);
      expect(row.id).toMatch(/^publish-/);
      expect(row.fix(p(code))).not.toMatch(/force/i);
    }
    expect(rowFor(rows, 92).where).toContain("the infra repo");
  });

  it("puts git's own words from roster's data.details under Details", () => {
    const e = new BackendCallError("couldn't push", 96, { fix: "publish again", details: "! [remote rejected] main" });
    const problem = problemFromCallError("", e);
    expect(problem.details).toBe("[96] couldn't push\n\n! [remote rejected] main");
    expect(problem.data).toBeUndefined();
  });

  it("gives saving to the vault and adding a Host their rows (rows 34-37, 44-45, ticket 11)", () => {
    const covered = new Set(builtinErrorRows.map((r) => r.row));
    for (const n of [34, 35, 36, 37, 44, 45]) expect(covered.has(n), `row ${n}`).toBe(true);
    for (const code of [60, 61, 62, 63, 80, 81]) {
      const row = rowFor(rows, code);
      expect(row.codes, String(code)).toContain(code);
      expect(row.fix(p(code))).not.toBe("");
    }
    expect(rowFor(rows, 60).fix(p(60))).toMatch(/existing item|another name/);
    expect(rowFor(rows, 81).where).toContain("roster.yml");
  });

  it("never offers to accept a host key", () => {
    for (const row of builtinErrorRows) {
      for (const a of row.actions) {
        expect(a.label).not.toMatch(/accept|trust/i);
        if (a.kind === "run") expect(a.line(p(43))).not.toMatch(/accept|trust|yes/i);
      }
    }
  });

  it("lets a later registration (the Config, a Plugin) reword a row", () => {
    const registry = builtinErrorRegistry();
    const own = { ...rowFor(registry.list(), 41), source: "init.lua", fix: () => "Ask the lab channel." };
    registry.register(own);
    expect(rowFor(registry.list(), 41).fix(p(41))).toBe("Ask the lab channel.");
  });

  it("splits roster's fix from the rest of an error's data", () => {
    const e = new BackendCallError("no vault item named 'x'", 32, { fix: "rename it", near: ["x ssh"] });
    expect(problemFromCallError("esx", e)).toEqual({
      code: 32,
      host: "esx",
      message: "no vault item named 'x'",
      fix: "rename it",
      details: "[32] no vault item named 'x'",
      data: { near: ["x ssh"] },
    });
  });

  it("reports a lost roster serve as its own row (21)", () => {
    const e = new BackendCallError("The backend exited (code 1).", null, null, true);
    expect(rowFor(rows, problemFromCallError("esx", e).code).row).toBe(21);
  });
});
