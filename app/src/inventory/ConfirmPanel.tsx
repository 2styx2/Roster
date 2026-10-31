// The question the Live Inventory asks before removing a Host (ticket 28): it names the Host and
// says what happens to its vault item (nothing). Enter (the focused button) confirms, Esc keeps it.
// It opens from a key or a row button, so it doesn't animate, like the other side panels.
import { useEffect, useRef, useState } from "react";
import { CloseGlyph } from "../ui/CloseGlyph";
import { Keys } from "../ui/Keys";

export interface ConfirmPanelProps {
  title: string;
  /** What will happen, in a sentence or two. */
  body: React.ReactNode;
  /** The confirming button's label ("Remove"). */
  action: string;
  onConfirm(): Promise<void>;
  onClose(): void;
}

export function ConfirmPanel({ title, body, action, onConfirm, onClose }: ConfirmPanelProps) {
  const yes = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => yes.current?.focus(), []);
  return (
    <section
      tabIndex={-1}
      className="side-panel confirm-panel"
      role="alertdialog"
      aria-label={title}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || busy) return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button type="button" className="icon-button close" aria-label="Cancel" onClick={onClose}>
          <CloseGlyph />
        </button>
      </header>
      <div className="changes-confirm">
        <p>{body}</p>
        <div className="edit-actions">
          <button
            ref={yes}
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onConfirm().finally(() => setBusy(false));
            }}
          >
            {action}
          </button>
          <button type="button" onClick={onClose} disabled={busy}>
            Keep it
          </button>
          <span className="edit-keys muted key-hint">
            <Keys keys="Enter" /> {action.toLowerCase()} <Keys keys="Escape" /> keep
          </span>
        </div>
      </div>
    </section>
  );
}
