// The health sections (ticket 49): order, a section a newer roster sends, a section that throws.
import { describe, expect, it } from "vitest";
import { builtinHealthSections, healthSummary, runHealth, type HealthContext, type HealthSection } from "./health";

const ctx = (more: Partial<HealthContext> = {}): HealthContext => ({
  box: {
    checks: [
      { section: "vault", level: "ok", message: "bw: unlocked" },
      { section: "mesh", level: "warn", message: "a section this app doesn't know" },
    ],
    ok: true,
    roster_version: "0.1.0",
    api_version: 16,
  },
  boxProblem: null,
  backend: { name: "WSL: FedoraLinux-44", rosterVersion: "0.1.0", apiVersion: 16 },
  config: { path: null, error: null, warnings: [] },
  font: { families: ["Iosevka"], inUse: "Iosevka" },
  ...more,
});

describe("runHealth", () => {
  it("runs the sections in order, and puts one roster sends that nothing claims after roster's own", () => {
    const ids = runHealth(builtinHealthSections, ctx()).map((r) => r.id);
    expect(ids).toEqual(["app", "roster", "inventory", "ssh", "vault", "askpass", "repo", "mesh", "config", "font"]);
  });

  it("says the WSL distro answers when serve runs in one", () => {
    const app = runHealth(builtinHealthSections, ctx())[0]!;
    expect(app.checks.map((c) => c.message)).toContain("the WSL distro answers (FedoraLinux-44)");
  });

  it("a section that throws is an error in that section only", () => {
    const broken: HealthSection = { id: "x", source: "plug", title: "X", order: 1, checks: () => { throw new Error("boom"); } };
    const out = runHealth([broken, ...builtinHealthSections], ctx());
    expect(out[0]!.checks).toEqual([{ section: "x", level: "error", message: "this section failed: boom" }]);
    expect(out.length).toBe(builtinHealthSections.length + 2);
  });

  it("warns when no terminal.font family is installed", () => {
    const font = runHealth(builtinHealthSections, ctx({ font: { families: ["Nope Mono"], inUse: null } })).at(-1)!;
    expect(font.checks[0]).toMatchObject({ level: "warn", topic: "terminal.font" });
  });

  it("sums up like Neovim's report", () => {
    const results = runHealth(builtinHealthSections, ctx());
    expect(healthSummary(results)).toBe("1 warning, no errors");
  });
});
