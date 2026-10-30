// "Save to vault" after a Quick Connect's own login (ticket 15, decision Q43): a side panel that asks
// for the Host's name (pre-filled from what the box's shell calls itself), its group and where in
// the vault, then runs roster's `quick.save`: the Vault item `<name> ssh`, then the Host as a Pending
// change, with the host key confirmed for the Session recorded for it. The password isn't here: roster
// holds it from the connect card and saves it only because that Session logged in with it.
//
// Like the add form, it pulls the infra repo first (unless Pending changes are already here). It
// opens from a click or `:save`, keyboard first: Name has focus, Enter saves, Esc closes (the offer
// stays). No motion of its own, like the other side panels.
import { useEffect, useId, useRef, useState } from "react";
import { type Backend, type HostList, type QuickSave } from "../backend/types";
import { problemFromCallError, type ErrorRow } from "../errors/catalog";
import type { Problem } from "../errors/classify";
import { ProblemBody, type ProblemActions } from "../errors/ErrorPanel";
import { SaveToField, useSaveTo } from "../edit/SaveTo";
import { CloseGlyph } from "../ui/CloseGlyph";
import { Keys } from "../ui/Keys";
import { suggestedName } from "./hostname";
import { formatQuickTarget, type QuickTarget } from "./target";

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

type Phase =
  | { at: "pulling" }
  | { at: "pull-failed"; problem: Problem }
  | { at: "ready" }
  | { at: "saving" }
  | { at: "failed"; problem: Problem };

export interface SavePanelProps {
  backend: Backend;
  hosts: HostList;
  /** The Quick Connect: serve's id for it, where it went, and what its shell calls the box. */
  quick: { id: string; to: QuickTarget; hostname: string | null };
  /** The group the form starts in. */
  group: string;
  pendingCount: number;
  rows: readonly ErrorRow[];
  actions: ProblemActions;
  /** roster can say where it saves (`vault.targets`): show "Save to". */
  chooseTarget?: boolean;
  targetsVersion?: number;
  onSaved(result: QuickSave): void;
  onPulled(): void;
  onClose(): void;
}

export function SavePanel({
  backend,
  hosts,
  quick,
  group: startGroup,
  pendingCount,
  rows,
  actions,
  chooseTarget = false,
  targetsVersion = 0,
  onSaved,
  onPulled,
  onClose,
}: SavePanelProps) {
  const ids = useId();
  const [phase, setPhase] = useState<Phase>(() => (pendingCount > 0 ? { at: "ready" } : { at: "pulling" }));
  // The name follows what the box's shell says until the user types one.
  const [typedName, setTypedName] = useState<string | null>(null);
  const name = typedName ?? suggestedName(quick.hostname, quick.to.address);
  const [group, setGroup] = useState(startGroup);
  const [tried, setTried] = useState(false);
  const [pickMissing, setPickMissing] = useState(false);
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
    backend.pullInventory().then(
      (pulled) => {
        if (!live.current) return;
        if (pulled.updated) onPulled();
        setPhase({ at: "ready" });
      },
      (e: unknown) => live.current && setPhase({ at: "pull-failed", problem: problemFromCallError(quick.to.address, e) }),
    );
    // Once per opening, like the add form's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulling]);

  const open = phase.at !== "pulling" && phase.at !== "pull-failed";
  useEffect(() => {
    if (open) document.getElementById(`${ids}-name`)?.focus();
  }, [open, ids]);

  const saveTo = useSaveTo(backend, chooseTarget && open, targetsVersion);
  const busy = phase.at === "saving";
  const label = formatQuickTarget(quick.to);
  const trimmed = name.trim();
  const taken = hosts.hosts.find((h) => h.name === trimmed);
  const nameProblem = !trimmed
    ? "Name the Host"
    : !NAME.test(trimmed)
      ? "Use letters, digits, . _ - (starting with a letter or digit)"
      : taken
        ? `${trimmed} is already a Host (group ${taken.group})`
        : null;
  const groupProblem = !group.trim() ? "Pick a group" : !NAME.test(group.trim()) ? "Use letters, digits, . _ -" : null;
  const item = `${trimmed || "<name>"} ssh`;

  const save = async () => {
    if (!open || busy) return;
    setTried(true);
    if (nameProblem || groupProblem) {
      document.getElementById(`${ids}-${nameProblem ? "name" : "group"}`)?.focus();
      return;
    }
    if (saveTo.found && !saveTo.target) {
      setPickMissing(true);
      return;
    }
    setPhase({ at: "saving" });
    try {
      const result = await backend.saveQuick({
        quick: quick.id,
        name: trimmed,
        group: group.trim(),
        item: `${trimmed} ssh`,
        ...(saveTo.target ? { save_to: saveTo.target.save_to } : {}),
      });
      if (live.current) onSaved(result);
    } catch (e) {
      if (!live.current) return;
      setPhase({ at: "failed", problem: problemFromCallError(trimmed, e) });
    }
  };

  return (
    <section
      className="side-panel edit-panel add-panel save-panel"
      role="region"
      aria-label="Save to vault"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header>
        <h2>Save to vault</h2>
        <button type="button" className="icon-button close" aria-label="Close the save form" onClick={onClose}>
          <CloseGlyph />
        </button>
      </header>
      <p className="edit-note">
        <span className="mono">{label}</span> logged in with the password you typed. roster saves it as a Vault item, then adds the
        Host as a Pending change.
      </p>
      {phase.at === "pulling" && <p className="muted edit-status">Pulling the infra repo…</p>}
      {phase.at === "pull-failed" && (
        <div className="edit-problem" role="alert">
          <p className="muted edit-status">Couldn't pull the infra repo, so nothing can be saved yet.</p>
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
          <div className="edit-fields">
            <div className="edit-field">
              <label htmlFor={`${ids}-name`}>Host name</label>
              <input
                id={`${ids}-name`}
                className="mono"
                value={name}
                placeholder="e.g. nas-01"
                spellCheck={false}
                autoComplete="off"
                disabled={busy}
                aria-invalid={tried && nameProblem ? true : undefined}
                aria-describedby={`${ids}-name-hint`}
                onChange={(e) => {
                  setTypedName(e.target.value);
                  if (phase.at === "failed") setPhase({ at: "ready" });
                }}
              />
              <span id={`${ids}-name-hint`} className={tried && nameProblem ? "edit-field-problem" : "edit-hint"}>
                {tried && nameProblem ? (
                  nameProblem
                ) : (
                  <>
                    Vault item <span className="mono">{item}</span>
                  </>
                )}
              </span>
            </div>
            <div className="edit-field">
              <label htmlFor={`${ids}-group`}>Group</label>
              <input
                id={`${ids}-group`}
                className="mono"
                value={group}
                list={`${ids}-groups`}
                spellCheck={false}
                autoComplete="off"
                disabled={busy}
                aria-invalid={tried && groupProblem ? true : undefined}
                aria-describedby={tried && groupProblem ? `${ids}-group-problem` : undefined}
                onChange={(e) => {
                  setGroup(e.target.value);
                  if (phase.at === "failed") setPhase({ at: "ready" });
                }}
              />
              {tried && groupProblem && (
                <span id={`${ids}-group-problem`} className="edit-field-problem">
                  {groupProblem}
                </span>
              )}
              <datalist id={`${ids}-groups`}>
                {Object.keys(hosts.groups).map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>
            {chooseTarget && (
              <SaveToField id={`${ids}-saveto`} choice={saveTo} pickMissing={pickMissing} onChoose={() => setPickMissing(false)} />
            )}
          </div>
          {phase.at === "saving" && <p className="muted edit-status">Saving {item} to the vault…</p>}
          {phase.at === "failed" && (
            <div className="edit-problem" role="alert">
              <ProblemBody problem={phase.problem} rows={rows} actions={actions} notInTab />
            </div>
          )}
          <div className="edit-actions">
            <button type="submit" className="primary" disabled={busy}>
              Save
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <span className="edit-keys muted key-hint">
              <Keys keys="Enter" /> save <Keys keys="Escape" /> close
            </span>
          </div>
        </form>
      )}
    </section>
  );
}
