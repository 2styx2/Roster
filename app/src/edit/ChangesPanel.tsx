// `:changes` (ticket 10): the Pending changes, as the Hosts they touch and roster.yml's diff
// against the last commit (`changes.diff`). `:discard` asks first, then puts roster.yml back
// (`changes.discard`; roster keeps what it held as a backup). Publish is ticket 12.
//
// It opens from a key, so it doesn't animate. Esc closes it (or backs out of the question).
import { useEffect, useRef, useState } from "react";
import type { PendingChanges } from "../backend/types";
import { countOf } from "../ui/format";
import { CloseGlyph } from "../ui/CloseGlyph";
import { Keys } from "../ui/Keys";

export type ChangesState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "done"; changes: PendingChanges };

export interface ChangesPanelProps {
  changes: ChangesState;
  /** Opened by `:discard`: the question is asked straight away. */
  confirm: boolean;
  /** The key that opens the edit form, for the empty state ("␣ E"). */
  editKeys: string | null;
  leader: string;
  onDiscard(): Promise<void>;
  onClose(): void;
}

const FIELD_LABEL: Record<string, string> = { ip: "address", auth: "Login" };

/** One diff line's kind, for its colour and its sign in words. */
function kindOf(line: string): "add" | "del" | "hunk" | "meta" | "same" {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "same";
}

const SIGN_WORD = { add: "added: ", del: "removed: " } as const;

export function ChangesPanel({ changes, confirm: confirmAtStart, editKeys, leader, onDiscard, onClose }: ChangesPanelProps) {
  const [confirm, setConfirm] = useState(confirmAtStart);
  const [discarding, setDiscarding] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const yes = useRef<HTMLButtonElement>(null);
  const count = changes.state === "done" ? changes.changes.count : 0;
  const asking = confirm && count > 0;

  useEffect(() => {
    if (asking) yes.current?.focus();
    else panel.current?.focus({ preventScroll: true });
  }, [asking]);

  // The file is named above, so git's header lines (diff, index, ---, +++) are left out.
  const lines =
    changes.state === "done"
      ? changes.changes.diff.split("\n").filter((l, i, all) => kindOf(l) !== "meta" && (l !== "" || i < all.length - 1))
      : [];
  return (
    <section
      ref={panel}
      tabIndex={-1}
      className="side-panel changes-panel"
      role="region"
      aria-label="Pending changes"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        if (asking) setConfirm(false);
        else onClose();
      }}
    >
      <header>
        <h2>
          Pending changes
          {changes.state === "done" && <span className="muted"> · {count}</span>}
        </h2>
        <button type="button" className="icon-button close" aria-label="Close Pending changes" onClick={onClose}>
          <CloseGlyph />
        </button>
      </header>
      {changes.state === "loading" && <p className="muted">Reading the infra repo…</p>}
      {changes.state === "error" && <p className="problem-message">{changes.message}</p>}
      {changes.state === "done" && count === 0 && (
        <p className="muted panel-empty-line">
          No Pending changes: roster.yml is as the last commit has it.
          {editKeys && (
            <>
              {" "}
              <Keys keys={editKeys} leader={leader} /> edits a Host.
            </>
          )}
        </p>
      )}
      {changes.state === "done" && count > 0 && (
        <>
          <p className="muted changes-where">
            Edits on this Box that aren't Published yet, in <code>{changes.changes.path}</code>.
          </p>
          <ul className="changes-hosts">
            {changes.changes.hosts.map((h) => (
              <li key={h.host}>
                <span className="mono">{h.host}</span>
                <span className="muted">
                  {" "}
                  {h.change === "changed" ? h.fields.map((f) => FIELD_LABEL[f] ?? f).join(", ") : h.change}
                </span>
              </li>
            ))}
          </ul>
          <pre className="diff" aria-label="The diff of roster.yml">
            {lines.map((line, i) => {
              const kind = kindOf(line);
              return (
                <span key={i} className={`diff-line ${kind}`}>
                  {(kind === "add" || kind === "del") && <span className="visually-hidden">{SIGN_WORD[kind]}</span>}
                  {line || " "}
                  {"\n"}
                </span>
              );
            })}
          </pre>
          {asking ? (
            <div className="changes-confirm" role="alertdialog" aria-label="Discard the Pending changes?">
              <p>
                Discard {countOf(count, "Pending change")}? roster.yml goes back to the last commit. roster keeps a copy of
                it as it is now in the repo's <code>.git/roster/</code>.
              </p>
              <div className="edit-actions">
                <button
                  ref={yes}
                  type="button"
                  className="danger"
                  disabled={discarding}
                  onClick={() => {
                    setDiscarding(true);
                    void onDiscard().finally(() => {
                      setDiscarding(false);
                      setConfirm(false);
                    });
                  }}
                >
                  Discard
                </button>
                <button type="button" onClick={() => setConfirm(false)}>
                  Keep them
                </button>
                <span className="edit-keys muted">
                  <Keys keys="Enter" /> discard <Keys keys="Escape" /> keep
                </span>
              </div>
            </div>
          ) : (
            <div className="edit-actions">
              <button type="button" onClick={() => setConfirm(true)}>
                Discard…
              </button>
              <span className="edit-keys muted">Publish comes later; until then they stay on this Box.</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
