// What a view and a Host-details section hold (ticket 76), drawn the app's way: text in the app's
// voice (Inter), facts as Host details shows its own, then a table. Nothing here is markup from a
// Plugin: it's text, set where the app puts it.
import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { CloseGlyph } from "../ui/CloseGlyph";
import { DataTable } from "../ui/DataTable";
import { GraphView } from "../graph/GraphView";
import type { GraphMemory } from "../graph/memory";
import type { Content, ViewDef } from "./views";

export function ViewContent({
  content,
  label,
  leader,
  autoFocus = false,
  graph,
}: {
  content: Content;
  label: string;
  leader: string;
  autoFocus?: boolean;
  /** Where a graph keeps its places, and the view's key there (ticket 77). */
  graph?: { memory?: GraphMemory | undefined; key: string };
}) {
  const paragraphs = content.text ? content.text.split(/\n\s*\n/).filter((p) => p.trim() !== "") : [];
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i} className="view-text">
          {p}
        </p>
      ))}
      {content.facts.length > 0 && (
        <dl className="details-facts view-facts">
          {content.facts.map((f, i) => (
            <div key={`${f.label}:${i}`} className="details-fact">
              <dt>{f.label}</dt>
              <dd className={f.data ? "mono" : undefined} dir="auto">
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {content.table && <DataTable model={content.table} label={label} leader={leader} autoFocus={autoFocus} />}
      {content.graph && graph && <GraphView model={content.graph} label={label} leader={leader} memory={graph.memory} memoKey={graph.key} autoFocus={autoFocus} />}
    </>
  );
}

/** A view: beside the terminal (`panel`), or over the whole window (`full`). It opens from a key as
 * often as a click, so, like every side panel, it doesn't animate. Esc closes it; focus goes back
 * where it was. */
export function ViewPanel({ view, leader, onClose, graphs }: { view: ViewDef; leader: string; onClose(): void; graphs?: GraphMemory }) {
  const panel = useRef<HTMLElement>(null);
  const before = useRef<Element | null>(null);
  // Before the table takes focus (its own effect runs after this one).
  useLayoutEffect(() => {
    before.current = document.activeElement;
    // The table takes focus when there is one; otherwise the panel does, for Esc.
    const node = panel.current;
    if (!node?.contains(document.activeElement)) node?.focus();
    return () => {
      const el = before.current;
      const now = document.activeElement;
      // Only when focus is still ours (or lost with us): a click elsewhere keeps its focus.
      const inside = now === null || now === document.body || !now.isConnected || !!node?.contains(now);
      if (inside && el instanceof HTMLElement && el.isConnected) el.focus();
    };
    // Once per view: setting it again keeps focus where it is.
  }, [view.id]);
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };
  return (
    <section
      ref={panel}
      tabIndex={-1}
      className={view.place === "full" ? "view-full" : "side-panel view-panel"}
      aria-label={`${view.title} (from ${view.source})`}
      onKeyDown={onKeyDown}
    >
      <header>
        <h2>
          {view.title}
          <span className="view-source muted"> · {view.source}</span>
        </h2>
        <button type="button" className="icon-button close" aria-label={`Close ${view.title}`} onMouseDown={(e) => e.preventDefault()} onClick={onClose}>
          <CloseGlyph />
        </button>
      </header>
      <div className="view-body">
        <ViewContent key={view.id} content={view.content} label={view.title} leader={leader} autoFocus graph={{ ...(graphs ? { memory: graphs } : {}), key: `${view.source}/${view.id}` }} />
      </div>
    </section>
  );
}
