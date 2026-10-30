// `:edit HOST` (ticket 10): a side panel with the Host's fields. Before the first edit it pulls the
// infra repo (fast-forward only) and reads the Host afresh; a pull that can't happen says why
// and the form stays shut. Saving writes roster.yml through roster as a Pending change. A change
// to the address, port, user or Login first runs one test login (`host.verify_login`, decision
// Q43) and only saves if it passed; its steps show like `:check`'s.
//
// Keyboard first: the first field has focus, Tab moves, Enter saves, Esc closes. It opens from a
// key, so it doesn't animate (emil-design-eng: never animate keyboard-initiated actions).
import { useEffect, useRef, useState } from "react";
import type { Backend, Host, HostCheck, HostUpdate, PullResult } from "../backend/types";
import { problemFromCallError, type ErrorRow } from "../errors/catalog";
import type { Problem } from "../errors/classify";
import { CheckSteps } from "../errors/CheckPanel";
import { ProblemBody, type ProblemActions } from "../errors/ErrorPanel";
import { CloseGlyph } from "../ui/CloseGlyph";
import { Keys } from "../ui/Keys";
import { changesOf, draftOf, FIELDS, fieldProblem, needsVerify, touchesLogin, type Draft } from "./form";

type Phase =
  | { at: "pulling" }
  | { at: "pull-failed"; problem: Problem }
  | { at: "ready" }
  | { at: "verifying" }
  | { at: "verify-failed"; result: HostCheck }
  | { at: "saving" }
  | { at: "save-failed"; problem: Problem };

export interface EditPanelProps {
  backend: Backend;
  host: Host;
  /** Pending changes already on this Box: the repo was pulled before the first one (and a pull
   * now would refuse them), so the form opens without pulling. */
  pendingCount: number;
  rows: readonly ErrorRow[];
  actions: ProblemActions;
  /** The edit is a Pending change now. */
  onSaved(update: HostUpdate): void;
  /** The pull brought new commits: the app reads the Inventory again. */
  onPulled(result: PullResult): void;
  onClose(): void;
  /** Marks the Host reviewed (`:review`, ticket 11): offered while it's unreviewed. */
  onReview?(host: string): void;
}

function pulledLine(p: PullResult | null): string | null {
  if (p === null) return "Pending changes are already here, so roster didn't pull.";
  if (!p.upstream) return "No upstream to pull from; editing this Box's copy.";
  if (p.updated) return `Pulled ${p.commits} new commit${p.commits === 1 ? "" : "s"} from ${p.upstream}.`;
  return `Up to date with ${p.upstream}.`;
}

export function EditPanel({ backend, host, pendingCount, rows, actions, onSaved, onPulled, onClose, onReview }: EditPanelProps) {
  const [current, setCurrent] = useState(host);
  const [draft, setDraft] = useState<Draft>(() => draftOf(host));
  const [phase, setPhase] = useState<Phase>(() => (pendingCount > 0 ? { at: "ready" } : { at: "pulling" }));
  /** What the pull did (null: it didn't pull, as Pending changes were already here). */
  const [pulled, setPulled] = useState<PullResult | null>(null);
  const first = useRef<HTMLInputElement>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const pulling = phase.at === "pulling";
  useEffect(() => {
    if (!pulling) return;
    backend
      .pullInventory()
      .then(async (pulled) => {
        if (pulled.updated) onPulled(pulled);
        const fresh = await backend.getHost(host.name);
        if (!live.current) return;
        setCurrent(fresh);
        setDraft(draftOf(fresh));
        setPulled(pulled);
        setPhase({ at: "ready" });
      })
      .catch((e: unknown) => live.current && setPhase({ at: "pull-failed", problem: problemFromCallError(host.name, e) }));
    // Once per opening: the pull is what opening the form means.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulling]);

  const open = phase.at !== "pulling" && phase.at !== "pull-failed";
  useEffect(() => {
    if (open) first.current?.focus();
  }, [open]);

  const busy = phase.at === "verifying" || phase.at === "saving";
  const changes = changesOf(current, draft);
  const verify = changes !== null ? needsVerify(changes) : touchesLogin(current, draft);
  const nothing = changes !== null && Object.keys(changes).length === 0;

  const save = async () => {
    if (!open || busy || changes === null || nothing) return;
    try {
      if (verify) {
        setPhase({ at: "verifying" });
        const result = await backend.verifyLogin(current.name, changes);
        if (!live.current) return;
        if (!result.ok) return setPhase({ at: "verify-failed", result });
      }
      setPhase({ at: "saving" });
      const update = await backend.updateHost(current.name, changes);
      if (live.current) onSaved(update);
    } catch (e) {
      if (live.current) setPhase({ at: "save-failed", problem: problemFromCallError(current.name, e) });
    }
  };

  const original = draftOf(current);
  return (
    <section
      className="side-panel edit-panel"
      role="region"
      aria-label={`Edit ${host.name}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header>
        <h2>
          <span className="muted">Edit · </span>
          <span className="mono">{host.name}</span>
        </h2>
        <button type="button" className="icon-button close" aria-label="Close the edit" onClick={onClose}>
          <CloseGlyph />
        </button>
      </header>
      {phase.at === "pulling" && <p className="muted edit-status">Pulling the infra repo…</p>}
      {phase.at === "pull-failed" && (
        <div className="edit-problem" role="alert">
          <p className="muted edit-status">Couldn't pull the infra repo, so the form stays closed.</p>
          <ProblemBody problem={phase.problem} rows={rows} actions={actions} notInTab />
          <div className="edit-actions">
            <button type="button" onClick={() => setPhase({ at: "pulling" })}>
              Try again
            </button>
          </div>
        </div>
      )}
      {open && (
        <form
          className="edit-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <p className="muted edit-status">{pulledLine(pulled)}</p>
          <div className="edit-fields">
            {FIELDS.map((f, i) => {
              const problem = fieldProblem(f.name, draft[f.name]);
              const changed = draft[f.name].trim() !== original[f.name];
              const id = `edit-${f.name}`;
              return (
                <div key={f.name} className="edit-field" data-changed={changed || undefined}>
                  <label htmlFor={id}>
                    {f.label}
                    {changed && <span className="edit-changed"> · changed</span>}
                  </label>
                  <input
                    id={id}
                    ref={i === 0 ? first : undefined}
                    className={f.mono ? "mono" : undefined}
                    value={draft[f.name]}
                    placeholder={f.placeholder}
                    spellCheck={false}
                    autoComplete="off"
                    inputMode={f.name === "port" ? "numeric" : undefined}
                    disabled={busy}
                    aria-invalid={problem ? true : undefined}
                    aria-describedby={problem ? `${id}-problem` : undefined}
                    onChange={(e) => {
                      const value = e.target.value;
                      setDraft((d) => ({ ...d, [f.name]: value }));
                      if (phase.at === "verify-failed" || phase.at === "save-failed") setPhase({ at: "ready" });
                    }}
                  />
                  {problem && (
                    <span id={`${id}-problem`} className="edit-field-problem">
                      {problem}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {verify && (
            <p className="edit-note">
              The address, user or Login changed, so roster tests the login first: one attempt, and the host key must
              match the recorded one.
            </p>
          )}
          {phase.at === "verifying" && <p className="muted edit-status">Testing the login to {draft.ip.trim()}…</p>}
          {phase.at === "saving" && <p className="muted edit-status">Saving…</p>}
          {phase.at === "verify-failed" && (
            <div className="edit-problem" role="alert">
              <p className="edit-status">The test login failed, so nothing was saved.</p>
              <CheckSteps host={current.name} steps={phase.result.steps} rows={rows} actions={actions} />
            </div>
          )}
          {phase.at === "save-failed" && (
            <div className="edit-problem" role="alert">
              <ProblemBody problem={phase.problem} rows={rows} actions={actions} notInTab />
            </div>
          )}
          <div className="edit-actions">
            <button type="submit" className="primary" disabled={busy || changes === null || nothing}>
              {verify ? "Test login and save" : "Save"}
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            {!current.reviewed && onReview && (
              <button type="button" onClick={() => onReview(current.name)} disabled={busy}>
                Mark reviewed
              </button>
            )}
            <span className="edit-keys muted">
              <Keys keys="Enter" /> save <Keys keys="Escape" /> close
            </span>
          </div>
        </form>
      )}
    </section>
  );
}
