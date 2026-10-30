// `:check HOST`: roster's `host.check` steps as a list, each ok, failed or skipped, with the
// failing one expanded into the same clean error a Session shows (where, fix, extras, Details).
// roster runs the steps; this only shows them. A check makes at most one connection and one login.
import type { HostCheck } from "../backend/types";
import { problemFromStep, type ErrorRow } from "./catalog";
import { ProblemBody, type ProblemActions } from "./ErrorPanel";

export type CheckState =
  | { state: "running"; host: string }
  | { state: "done"; host: string; result: HostCheck }
  | { state: "error"; host: string; message: string };

const STEP_LABEL: Record<string, string> = {
  inventory: "Inventory entry",
  "ssh-config": "ssh config",
  provider: "Provider ready",
  "vault-item": "Vault item",
  dns: "DNS",
  tcp: "TCP port",
  "host-key": "Host key",
  auth: "Login",
};

const MARK = { ok: "✓", fail: "✗", skipped: "–" } as const;

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
        <button type="button" className="close" aria-label="Close the check" onClick={onClose}>
          ×
        </button>
      </header>
      {check.state === "running" && <p className="muted">Checking {host}…</p>}
      {check.state === "error" && <p className="problem-message">{check.message}</p>}
      {check.state === "done" && (
        <>
          <p className={check.result.ok ? "check-ok" : "muted"}>
            {check.result.ok ? "All checks passed." : "Stopped at the first failure; later steps were skipped."}
          </p>
          <ol className="check-steps">
            {check.result.steps.map((s) => (
              <li key={s.step} data-step={s.step} data-status={s.status} className={`check-step ${s.status}`}>
                <div className="check-line">
                  <span className="check-mark" aria-label={s.status}>
                    {MARK[s.status]}
                  </span>
                  <span className="check-name">{STEP_LABEL[s.step] ?? s.step}</span>
                  {s.status !== "fail" && <span className="check-msg muted">{s.message}</span>}
                </div>
                {s.status === "fail" && (
                  <div className="check-problem">
                    <ProblemBody problem={problemFromStep(host, s)} rows={rows} actions={actions} />
                  </div>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
