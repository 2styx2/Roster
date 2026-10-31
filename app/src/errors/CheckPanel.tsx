// `:check HOST`: roster's `host.check` steps as a list, each ok, failed or skipped, with the
// failing one expanded into the same clean error a Session shows (where, fix, extras, Details).
// roster runs the steps; this only shows them. A check makes at most one connection and one login.
import type { CheckStep, HostCheck } from "../backend/types";
import { problemFromStep, type ErrorRow } from "./catalog";
import { ProblemBody, type ProblemActions } from "./ErrorPanel";
import { CloseGlyph } from "../ui/CloseGlyph";

export type CheckState =
  | { state: "running"; host: string }
  | { state: "done"; host: string; result: HostCheck }
  | { state: "error"; host: string; message: string };

const STEP_LABEL: Record<string, string> = {
  inventory: "Inventory entry",
  user: "User",
  "ssh-config": "ssh config",
  provider: "Provider ready",
  "vault-item": "Vault item",
  dns: "DNS",
  tcp: "TCP port",
  "host-key": "Host key",
  auth: "Login",
};

const MARK = { ok: "✓", fail: "✗", skipped: "–" } as const;
/** The mark in words: an aria-label on a plain span is ignored, so it's hidden text. */
const RESULT = { ok: "passed", fail: "failed", skipped: "skipped" } as const;

export interface CheckPanelProps {
  check: CheckState;
  rows: readonly ErrorRow[];
  actions: ProblemActions;
  onClose(): void;
}

export function CheckPanel({ check, rows, actions, onClose }: CheckPanelProps) {
  const { host } = check;
  return (
    <section className="check-panel" role="region" aria-label={`Check ${host}`}>
      <header>
        <h2>
          <span className="muted">Check · </span>
          {host}
        </h2>
        <button type="button" className="icon-button close" aria-label="Close the check" onClick={onClose}>
          <CloseGlyph />
        </button>
      </header>
      {check.state === "running" && <p className="muted">Checking {host}…</p>}
      {check.state === "error" && <p className="problem-message">{check.message}</p>}
      {check.state === "done" && (
        <>
          <p className={check.result.ok ? "check-ok" : "muted"}>
            {check.result.ok ? "All checks passed." : "Stopped at the first failure; later steps were skipped."}
          </p>
          <CheckSteps host={host} steps={check.result.steps} rows={rows} actions={actions} />
        </>
      )}
    </section>
  );
}

export interface CheckStepsProps {
  host: string;
  steps: readonly CheckStep[];
  rows: readonly ErrorRow[];
  actions: ProblemActions;
}

/** Steps as a list, ok, failed or skipped, the failing one as a clean error (`host.check`, and the
 * edit form's test login, `host.verify_login`). */
export function CheckSteps({ host, steps, rows, actions }: CheckStepsProps) {
  return (
    <ol className="check-steps">
      {steps.map((s) => (
        <li key={s.step} data-step={s.step} data-status={s.status} className={`check-step ${s.status}`}>
          <div className="check-line">
            <span className="check-mark" aria-hidden="true">
              {MARK[s.status]}
            </span>
            <span className="visually-hidden">{RESULT[s.status]}: </span>
            <span className="check-name">{STEP_LABEL[s.step] ?? s.step}</span>
            {s.status !== "fail" && (
              <span className="check-msg muted" title={s.message}>
                {s.message}
              </span>
            )}
          </div>
          {s.status === "fail" && (
            <div className="check-problem">
              <ProblemBody problem={problemFromStep(host, s)} rows={rows} actions={actions} notInTab />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
