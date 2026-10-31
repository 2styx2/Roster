// This Box's health (ticket 49, decision Q79): Neovim's `:checkhealth` for roster. `:check` with no
// Host runs every section and shows the result as a generated help page (`:help health`). Sections
// are a Registry (ADR 0006), so a Plugin adds its own the same way the built-ins do. roster's own
// sections (roster.yml, ssh, the vault CLIs, askpass, the infra repo) come from `box.check`; the
// app adds what only it knows: how it reaches roster, init.lua, the terminal font. Every check is
// local. Nothing here connects to a Host; `:check HOST` is the one that does.
import { BOX_CHECK_API_VERSION, type BoxCheck, type HealthCheck, type HealthLevel } from "../backend/types";
import type { ConfigError } from "../config/types";
import type { ConfigWarning } from "../config/apply";
import { BUILTIN, Registry, type Entry, type Source } from "../registry";

/** What the sections check, read when `:check` runs. */
export interface HealthContext {
  /** `box.check`'s answer; null when roster is too old for it or the call failed (`boxProblem`). */
  box: BoxCheck | null;
  boxProblem: string | null;
  /** How the app reaches roster: "Local" or "WSL: <distro>", and what `inventory.info` said. */
  backend: { name: string; rosterVersion: string; apiVersion: number } | null;
  config: { path: string | null; error: ConfigError | null; warnings: readonly ConfigWarning[] };
  /** terminal.font's families, and the one the terminal draws with (null: none of them is there). */
  font: { families: readonly string[]; inUse: string | null };
}

export interface HealthSection extends Entry {
  title: string;
  /** Lower comes first. The built-ins use 0–100. */
  order: number;
  checks(ctx: HealthContext): HealthCheck[];
}

export type HealthRegistry = Registry<HealthSection>;

/** One section of a run: its checks as they came out. */
export interface HealthResult {
  id: string;
  title: string;
  source: Source;
  checks: HealthCheck[];
}

/** What `:help health` shows: the last run, or the one in progress. */
export type HealthReport = { state: "running" } | { state: "done"; at: Date; sections: HealthResult[] };

const ok = (section: string, message: string): HealthCheck => ({ section, level: "ok", message });
const warn = (section: string, message: string, fix?: string, topic?: string): HealthCheck => ({
  section,
  level: "warn",
  message,
  ...(fix ? { fix } : {}),
  ...(topic ? { topic } : {}),
});

/** One of roster's sections: `box.check`'s checks for it. */
function rosterSection(id: string, title: string, order: number): HealthSection {
  return { id, source: BUILTIN, title, order, checks: (ctx) => ctx.box?.checks.filter((c) => c.section === id) ?? [] };
}

const appSection: HealthSection = {
  id: "app",
  source: BUILTIN,
  title: "The app and roster serve",
  order: 10,
  checks: (ctx) => {
    if (!ctx.backend) return [{ section: "app", level: "error", message: "roster serve isn't running", fix: "restart the app; its start screen says why serve didn't start", topic: "E21" }];
    const { name, rosterVersion, apiVersion } = ctx.backend;
    const out = [ok("app", `roster serve answers through ${name}: roster ${rosterVersion}, API ${apiVersion}`)];
    if (name.startsWith("WSL")) out.push(ok("app", `the WSL distro answers (${name.slice(4).trim() || "the default one"})`));
    if (apiVersion < BOX_CHECK_API_VERSION) {
      out.push(
        warn(
          "app",
          `this roster speaks API ${apiVersion}; the app has features up to API ${BOX_CHECK_API_VERSION}, so some are off (roster's own checks below among them)`,
          "install a newer roster on this Box, then restart the app",
        ),
      );
    } else if (ctx.boxProblem) {
      out.push({ section: "app", level: "error", message: `roster's checks didn't run: ${ctx.boxProblem}`, fix: "see the message; `roster check --box` in a terminal runs the same checks" });
    }
    return out;
  },
};

const configSection: HealthSection = {
  id: "config",
  source: BUILTIN,
  title: "init.lua",
  order: 80,
  checks: ({ config }) => {
    const out: HealthCheck[] = [];
    const at = (file: string, line: number | null) => (line === null ? file : `${file}:${line}`);
    if (config.error) {
      out.push({
        section: "config",
        level: "error",
        message: `${at(config.error.file, config.error.line)}: ${config.error.message}`,
        fix: "fix it (`:config` opens it); the last good Config stays in effect until then",
        topic: "config",
      });
    } else {
      out.push(ok("config", config.path ? `init.lua loads: ${config.path}` : "no init.lua: the defaults are in effect"));
    }
    for (const w of config.warnings) out.push(warn("config", `${at(w.file, w.line)}: ${w.message}`, "fix that line; the rest of init.lua applies", "config"));
    return out;
  },
};

const fontSection: HealthSection = {
  id: "font",
  source: BUILTIN,
  title: "Terminal font",
  order: 90,
  checks: ({ font }) =>
    font.inUse
      ? [ok("font", `the terminal draws with ${font.inUse}`)]
      : [
          warn(
            "font",
            `none of terminal.font's families is installed (${font.families.join(", ") || "none listed"}), so the terminal falls back to Cascadia Mono, Consolas or monospace`,
            "install one of them, or list an installed font in terminal.font",
            "terminal.font",
          ),
        ],
};

export const builtinHealthSections: readonly HealthSection[] = [
  appSection,
  rosterSection("roster", "roster", 20),
  rosterSection("inventory", "Inventory", 30),
  rosterSection("ssh", "ssh", 40),
  rosterSection("vault", "Vault", 50),
  rosterSection("askpass", "askpass", 60),
  rosterSection("repo", "Infra repo", 70),
  configSection,
  fontSection,
];

export function builtinHealthRegistry(): HealthRegistry {
  const registry = new Registry<HealthSection>();
  for (const s of builtinHealthSections) registry.register(s);
  return registry;
}

/** Runs every section, in order. A section a newer roster sends that no entry claims comes after
 * roster's own, under its id; a section that throws is an error of its own, never the whole run's. */
export function runHealth(sections: readonly HealthSection[], ctx: HealthContext): HealthResult[] {
  const sorted = [...sections].sort((a, b) => a.order - b.order);
  const out: HealthResult[] = sorted.map((s) => {
    try {
      return { id: s.id, title: s.title, source: s.source, checks: s.checks(ctx) };
    } catch (e) {
      const message = `this section failed: ${e instanceof Error ? e.message : String(e)}`;
      return { id: s.id, title: s.title, source: s.source, checks: [{ section: s.id, level: "error" as const, message }] };
    }
  });
  const known = new Set(sections.map((s) => s.id));
  const extra = [...new Set((ctx.box?.checks ?? []).map((c) => c.section).filter((id) => !known.has(id)))];
  const at = out.findIndex((r) => r.id === "repo") + 1 || out.length;
  out.splice(at, 0, ...extra.map((id) => ({ id, title: id, source: "roster", checks: ctx.box?.checks.filter((c) => c.section === id) ?? [] })));
  return out;
}

/** How many checks came out at `level`. */
export function countLevel(results: readonly HealthResult[], level: HealthLevel): number {
  return results.reduce((n, r) => n + r.checks.filter((c) => c.level === level).length, 0);
}

/** "1 error, 2 warnings", "2 warnings, no errors", "no errors or warnings". */
export function healthSummary(results: readonly HealthResult[]): string {
  const errors = countLevel(results, "error");
  const warnings = countLevel(results, "warn");
  const n = (k: number, word: string) => `${k} ${word}${k === 1 ? "" : "s"}`;
  if (!errors && !warnings) return "no errors or warnings";
  if (!errors) return `${n(warnings, "warning")}, no errors`;
  return warnings ? `${n(errors, "error")}, ${n(warnings, "warning")}` : n(errors, "error");
}
