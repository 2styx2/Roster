// The frame every panel and view sits in (ticket 95, decision Q106): docked beside the terminal at
// the width the user picked, or full window. The panel inside is unchanged; the frame gives it
// its width, a draggable edge (a `role=separator` the keyboard moves too) and, through context,
// the header button that switches it to full window and back.
//
// The terminal fits its size once a drag ends, never on every pixel (ticket 73: a resized
// Session prints its screen again): while the edge moves, the panel is drawn wider or narrower
// over the terminal and the frame's own width, which the terminal sits beside, changes on release.
// Going full window keeps the docked width in place underneath, so the terminal doesn't change
// size either. Nothing animates (the animate skill: a key or a click is its own confirmation).
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { clamp, limitsPercent, limitsPx, percentOf, type PanelLayout, type PanelPlace, type Room } from "./layout";

export interface PanelControls {
  id: string;
  title: string;
  place: PanelPlace;
  toggle(): void;
  /** The keys that toggle it, as hints show them (null when unbound). */
  keys: string | null;
}

const PanelContext = createContext<PanelControls | null>(null);

/** The panel this is drawn in, if any. */
export const usePanel = () => useContext(PanelContext);

/** What the window gives a panel's frame now. */
export function roomOf(frame: HTMLElement): Room {
  const body = frame.parentElement;
  const width = body?.clientWidth || (typeof window === "undefined" ? 0 : window.innerWidth);
  const sidebar = body?.querySelector<HTMLElement>(":scope > .sidebar") ?? null;
  const floating = getComputedStyle(frame).position === "absolute";
  const others = sidebar && getComputedStyle(sidebar).position !== "absolute" ? sidebar.offsetWidth : 0;
  return { body: width, others, floating };
}

/** The width a docked panel is drawn at now, in percent of the window. */
export function currentPercent(frame: HTMLElement, layout: PanelLayout, id: string): number {
  const room = roomOf(frame);
  const chosen = layout.width(id);
  if (chosen !== null) return clamp(chosen, limitsPercent(room).min, limitsPercent(room).max);
  // Its own default width, as drawn (320 px, the narrowest default, when nothing is drawn).
  return percentOf(frame.offsetWidth || 320, room.body);
}

/** How far one arrow key moves the edge, in percent of the window. */
const ARROW_PERCENT = 2;

export function PanelFrame({
  id,
  title,
  side = "right",
  layout,
  fallback = "panel",
  kind,
  keys = null,
  children,
}: {
  id: string;
  title: string;
  /** Which side it docks on: Host details goes opposite the Sidebar. */
  side?: "left" | "right";
  layout: PanelLayout;
  /** Its own default place (a Plugin view's `place`). */
  fallback?: PanelPlace;
  /** What styles.css knows it as, for its default width (`help`, `view`, …). */
  kind: string;
  keys?: string | null;
  children: ReactNode;
}) {
  useSyncExternalStore(layout.subscribe, layout.snapshot);
  const place = layout.place(id, fallback);
  const width = layout.width(id);
  const isTop = place === "full" && layout.topFull() === id;
  const frame = useRef<HTMLDivElement>(null);
  // Full window after being docked in this opening: the docked width stays underneath (so the
  // terminal keeps its size), and Esc docks it again.
  const [held, setHeld] = useState(false);
  const [was, setWas] = useState(place);
  if (was !== place) {
    setWas(place);
    setHeld(place === "full");
  }
  // While the edge is dragged: the width drawn, in px, and what the drag started from.
  const [live, setLive] = useState<number | null>(null);
  const drag = useRef<{ x: number; w: number; room: Room; min: number; max: number } | null>(null);
  // The separator's values, measured after layout (and again when the window resizes).
  const [aria, setAria] = useState<{ now: number; min: number; max: number } | null>(null);

  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    layout.mount(id, title, el, fallback);
    return () => layout.unmount(id, el);
  }, [layout, id, title, fallback]);

  useLayoutEffect(() => {
    const el = frame.current;
    if (!el || place === "full") return;
    const measure = () => {
      const lim = limitsPercent(roomOf(el));
      const now = Math.round(currentPercent(el, layout, id));
      setAria((a) => (a && a.now === now && a.min === Math.round(lim.min) && a.max === Math.round(lim.max) ? a : { now, min: Math.round(lim.min), max: Math.round(lim.max) }));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [layout, id, place, width]);

  const toggle = () => layout.setPlace(id, place === "full" ? "panel" : "full");

  // A resize in progress shows as one cursor everywhere, and nothing gets selected.
  useEffect(() => {
    if (live === null) return;
    document.documentElement.dataset.resizing = "true";
    return () => {
      delete document.documentElement.dataset.resizing;
    };
  }, [live === null]); // eslint-disable-line react-hooks/exhaustive-deps -- once per drag, not per pixel

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const el = frame.current;
    if (!el || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const room = roomOf(el);
    const { min, max } = limitsPx(room);
    const w = clamp(el.getBoundingClientRect().width || el.offsetWidth || 320, min, max);
    drag.current = { x: e.clientX, w, room, min, max };
    layout.use(id);
    setLive(w);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    setLive(clamp(side === "right" ? d.w - dx : d.w + dx, d.min, d.max));
  };
  const endDrag = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    // Only now does the frame's width change, and the terminal beside it fit once.
    if (live !== null && Math.round(live) !== Math.round(d.w)) layout.setWidth(id, percentOf(live, d.room.body));
    setLive(null);
  };

  const onSeparatorKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = frame.current;
    if (!el) return;
    const lim = limitsPercent(roomOf(el));
    const now = currentPercent(el, layout, id);
    // An arrow moves the edge that way: for a panel on the right, ← widens it.
    const grow = side === "right" ? { ArrowLeft: 1, ArrowRight: -1 } : { ArrowLeft: -1, ArrowRight: 1 };
    let next: number | null = null;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") next = now + grow[e.key] * ARROW_PERCENT;
    else if (e.key === "Home") next = lim.min;
    else if (e.key === "End") next = lim.max;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    layout.setWidth(id, clamp(next, lim.min, lim.max));
  };

  // Esc in a panel made full window here puts it back beside the terminal first; a field's own
  // Esc (a filter, a form) stays the field's.
  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || place !== "full" || !held) return;
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select, [contenteditable='true']")) return;
    e.preventDefault();
    e.stopPropagation();
    layout.setPlace(id, "panel");
  };

  const style = {
    ...(width !== null ? { "--pane-w": `${width}%` } : {}),
    ...(live !== null ? { "--pane-live": `${Math.round(live)}px` } : {}),
  } as CSSProperties;

  return (
    <div
      ref={frame}
      className="panel-frame"
      data-panel={id}
      data-kind={kind}
      data-place={place}
      data-side={side}
      {...(held ? { "data-held": "" } : {})}
      {...(isTop ? { "data-top": "" } : {})}
      {...(live !== null ? { "data-dragging": "" } : {})}
      style={style}
      onFocusCapture={() => layout.use(id)}
      onPointerDownCapture={() => layout.use(id)}
      onKeyDownCapture={onKeyDownCapture}
    >
      <PanelContext.Provider value={{ id, title, place, toggle, keys }}>{children}</PanelContext.Provider>
      {place === "panel" && (
        <div
          className="panel-edge"
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${title}`}
          tabIndex={0}
          {...(aria ? { "aria-valuenow": aria.now, "aria-valuemin": aria.min, "aria-valuemax": aria.max, "aria-valuetext": `${aria.now}% of the window` } : {})}
          title="Drag to resize; double-click for its default width"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onDoubleClick={() => layout.reset(id)}
          onKeyDown={onSeparatorKey}
        />
      )}
    </div>
  );
}

/** The header button that switches the panel it's in between docked and full window. Nothing
 * outside a PanelFrame. */
export function PanelButton() {
  const panel = usePanel();
  if (!panel) return null;
  const full = panel.place === "full";
  const hint = panel.keys ? ` (${panel.keys})` : "";
  return (
    <button
      type="button"
      className="icon-button panel-toggle"
      aria-label="Full window"
      aria-pressed={full}
      title={(full ? "Dock beside the terminal" : "Full window") + hint}
      onMouseDown={(e) => e.preventDefault()}
      onClick={panel.toggle}
    >
      <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
        {full ? (
          // Docked: the window with a panel at its side.
          <>
            <rect x="1.5" y="2" width="9" height="8" rx="1" />
            <path d="M7.5 2v8" />
          </>
        ) : (
          // Full window: corners pushed out.
          <path d="M1.5 4.5v-3h3M7.5 1.5h3v3M10.5 7.5v3h-3M4.5 10.5h-3v-3" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </button>
  );
}
