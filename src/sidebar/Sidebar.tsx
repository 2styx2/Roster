// The Sidebar (GLOSSARY): a pane of sections, each a tree of rows, from the Sidebar section
// registry (sections.ts). The row on screen uses the raised style, and the same Host further down
// is only brighter ("also"); in App mode a cursor row shows where j/k (or the arrows) are, h/l fold
// and unfold, and Enter chooses. Rows, buttons, chevrons and drops only run command lines from the
// command table, so nothing here is a Sidebar-only action (decision Q36). The mouse works on every
// row without taking focus from the terminal.
//
// 91 Hosts is a few hundred elements: rows are memoized on their object (sections are rebuilt only
// when what they show changes), so moving the cursor re-renders two rows, not the tree.
import { memo, useCallback, useLayoutEffect, useRef, useState, type DragEvent } from "react";
import type { CommandLine } from "../keymap";

/** A row's state dot: key or password login, a Session that has ended, or a Host that can't be
 * opened (unreviewed). */
export type Dot = "key" | "password" | "ended" | "off";

/** A small button on a row or heading (close, rename, delete, new). */
export interface RowAction {
  /** The accessible name, e.g. "Close esxi-02". */
  label: string;
  icon: "close" | "edit" | "add";
  command: CommandLine;
}

export interface SidebarRow {
  /** Unique across all sections; also the fold key in State for a foldable row. */
  id: string;
  label: string;
  /** The Host the row stands for, if any: the on-screen Host's rows are raised or brighter, and
   * commands such as `folder add` act on the Host under the cursor. */
  host?: string;
  dot?: Dot;
  /** A short status after the label ("connecting…", "ended (code 0)"). */
  note?: string;
  /** Right-aligned and faint: an address, a count. */
  detail?: string;
  /** A small badge ("unreviewed"). */
  badge?: string;
  /** A tooltip (and accessible description), e.g. "password login". */
  title?: string;
  /** The item on screen (decision Q31: the raised style). Set by the section, or by
   * buildSections for the on-screen Host's first row. */
  raised?: boolean;
  /** The on-screen Host where it appears again: brighter, not raised (set by buildSections). */
  also?: boolean;
  /** Tree depth within its section; rows after a row with a lower level are its children. */
  level?: number;
  /** It has children that h/l (or its chevron) fold and unfold. */
  foldable?: boolean;
  /** Folded now (set by buildSections from State). */
  folded?: boolean;
  /** The row h goes to: its parent row, or the section heading (set by buildSections). */
  parent?: string;
  /** Whatever a section wants its commands to find on the cursor row (Folders: the Folder). */
  data?: Readonly<Record<string, string>>;
  /** What Enter or a click runs. */
  command: CommandLine;
  /** Buttons shown on hover and when raised. */
  actions?: readonly RowAction[];
  /** Dragging the row carries this (a Host name). */
  drag?: string;
  /** Run when the dragged row is dropped somewhere in the Sidebar that doesn't take it (out of a
   * Folder: remove it). */
  dragOut?: CommandLine;
  /** This row takes a drop: the command line for the dragged payload, or null to ignore it. */
  drop?(payload: string): CommandLine | null;
}

export interface SidebarSection {
  id: string;
  title: string;
  count?: number;
  rows: readonly SidebarRow[];
  /** Shown when there are no rows. */
  empty?: string;
  /** Buttons on the heading ("+" for a new Folder). */
  actions?: readonly RowAction[];
  /** The section (heading or empty space) takes a drop. */
  drop?(payload: string): CommandLine | null;
  /** Folded now: the heading shows, the rows don't (set by buildSections from State). */
  folded?: boolean;
}

export interface SidebarProps {
  sections: readonly SidebarSection[];
  side: "left" | "right";
  /** The cursor row, shown in App mode; null hides it. */
  cursor: string | null;
  /** The Leader as written in the keymap, for the hints. */
  leaderHint: string;
  /** Runs a command line: for rows, and the buttons at the top and bottom. */
  run(line: CommandLine): void;
}

/** The id of a section's heading, as a cursor stop and a fold key. */
export const headingId = (section: string) => `section:${section}`;

/** Keeps focus where it is (the terminal) when a row or button is clicked. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();



type Run = (line: CommandLine) => void;
type DropTarget = (payload: string) => CommandLine | null;

interface Drag {
  /** A mousedown on a row: keeps focus where it is, except on a draggable row, whose mousedown
   * must go ahead for the drag; that one gives focus back on the click (`refocus`). */
  press(row: SidebarRow, e: React.MouseEvent): void;
  refocus(): void;
  start(row: SidebarRow, e: DragEvent): void;
  /** Lets a drop happen here (a target, or the open Sidebar for a row that can be dragged out). */
  over(e: DragEvent, target: DropTarget | undefined): void;
  drop(e: DragEvent, target: DropTarget | undefined): void;
}

function Actions({ actions, run }: { actions: readonly RowAction[]; run: Run }) {
  return actions.map((a) => (
    <button
      key={a.label}
      type="button"
      className="sb-action"
      aria-label={a.label}
      title={a.label}
      tabIndex={-1}
      onMouseDown={keepFocus}
      onClick={(e) => {
        e.stopPropagation();
        run(a.command);
      }}
    >
      <Icon name={a.icon} />
    </button>
  ));
}

const ICONS: Record<RowAction["icon"], string> = {
  close: "M4 4l8 8M12 4l-8 8",
  edit: "M3 13l1-3.5L10.5 3 13 5.5 6.5 12z",
  add: "M8 3v10M3 8h10",
};

const Icon = ({ name }: { name: RowAction["icon"] }) => (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <path d={ICONS[name]} />
  </svg>
);

const Chevron = ({ folded }: { folded: boolean }) => (
  <span className="sb-chev" aria-hidden="true">
    {folded ? "▸" : "▾"}
  </span>
);

const Row = memo(function Row({ row, cursor, run, drag }: { row: SidebarRow; cursor: boolean; run: Run; drag: Drag }) {
  const cls = `sb-row${row.raised ? " raised" : ""}${row.also ? " also" : ""}${cursor ? " cursor" : ""}${row.actions ? " has-actions" : ""}`;
  return (
    <li
      className={cls}
      data-row={row.id}
      style={row.level ? { paddingLeft: `${row.level * 18}px` } : undefined}
      // Chromium won't start a drag from a <button>, so the row is a div with the button role,
      // not focusable, and the <li> is what's dragged.
      draggable={row.drag !== undefined}
      onDragStart={row.drag !== undefined ? (e) => drag.start(row, e) : undefined}
      onDragOver={row.drop ? (e) => drag.over(e, row.drop) : undefined}
      onDrop={row.drop ? (e) => drag.drop(e, row.drop) : undefined}
    >
      <div
        role="button"
        className="sb-item"
        aria-current={row.raised ? "true" : undefined}
        aria-expanded={row.foldable ? !row.folded : undefined}
        title={row.title}
        onMouseDown={(e) => drag.press(row, e)}
        onClick={() => {
          run(row.command);
          drag.refocus();
        }}
      >
        {row.foldable && <Chevron folded={row.folded ?? false} />}
        {row.dot && <span className={`dot ${row.dot}`} aria-hidden="true" />}
        <span className="sb-label">{row.label}</span>
        {row.note && <span className="sb-note"> {row.note}</span>}
        {row.badge && <span className="sb-badge"> {row.badge}</span>}
        {row.detail && <span className="sb-detail"> {row.detail}</span>}
      </div>
      {row.actions && <Actions actions={row.actions} run={run} />}
    </li>
  );
});

const Section = memo(function Section({
  section,
  cursor,
  run,
  drag,
}: {
  section: SidebarSection;
  /** The cursor if it's in this section, else null (so the other sections don't re-render). */
  cursor: string | null;
  run: Run;
  drag: Drag;
}) {
  const id = headingId(section.id);
  const folded = section.folded ?? false;
  return (
    <section
      className="sb-section"
      aria-label={section.title}
      onDragOver={section.drop ? (e) => drag.over(e, section.drop) : undefined}
      onDrop={section.drop ? (e) => drag.drop(e, section.drop) : undefined}
    >
      <div className={`sb-heading${cursor === id ? " cursor" : ""}`} data-row={id}>
        <button
          type="button"
          className="sb-heading-button"
          aria-expanded={!folded}
          aria-label={section.title}
          tabIndex={-1}
          onMouseDown={keepFocus}
          onClick={() => run(`togglefold ${id}`)}
        >
          <Chevron folded={folded} />
          <h2>{section.title}</h2>
          {section.count !== undefined && <span className="sb-count">{section.count}</span>}
        </button>
        {section.actions && <Actions actions={section.actions} run={run} />}
      </div>
      {!folded && section.rows.length === 0 && section.empty && <p className="sb-empty">{section.empty}</p>}
      {!folded && (
        <ul className="sb-rows">
          {section.rows.map((row) => (
            <Row key={row.id} row={row} cursor={row.id === cursor} run={run} drag={drag} />
          ))}
        </ul>
      )}
    </section>
  );
});

export function Sidebar({ sections, side, cursor, leaderHint, run }: SidebarProps) {
  // A stable `run` for the memoized rows; it always calls the latest one.
  const runRef = useRef(run);
  useLayoutEffect(() => {
    runRef.current = run;
  });
  const stableRun = useCallback((line: CommandLine) => runRef.current(line), []);

  // Keep the cursor row in view as j/k walk a long tree.
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (cursor === null) return;
    const el = scrollRef.current?.querySelector(`[data-row="${CSS.escape(cursor)}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [cursor]);

  // The dragged row lives here; its Host also goes on the dataTransfer as text (WebView2 needs
  // some data for a drag to start).
  const dragged = useRef<SidebarRow | null>(null);
  const focusBefore = useRef<Element | null>(null);
  const [drag] = useState<Drag>(() => ({
    press(row, e) {
      if (row.drag === undefined) return e.preventDefault();
      focusBefore.current = document.activeElement;
    },
    refocus() {
      const el = focusBefore.current;
      focusBefore.current = null;
      if (el instanceof HTMLElement && el.isConnected && (document.activeElement === document.body || !document.activeElement)) el.focus();
    },
    start(row, e) {
      dragged.current = row;
      e.dataTransfer?.setData("text/plain", row.drag ?? "");
    },
    over(e, target) {
      const row = dragged.current;
      if (row && (target || row.dragOut)) e.preventDefault();
    },
    drop(e, target) {
      const row = dragged.current;
      if (!row) return;
      // Handled by the innermost target (a row before its section, a section before the Sidebar).
      e.preventDefault();
      e.stopPropagation();
      dragged.current = null;
      const line = target ? target(row.drag ?? "") : (row.dragOut ?? null);
      if (line) runRef.current(line);
    },
  }));

  return (
    <nav className={`sidebar side-${side}`} aria-label="Sidebar">
      <button type="button" className="sb-find" onMouseDown={keepFocus} onClick={() => run("find")}>
        Find a Host <kbd title={leaderHint}>␣ f</kbd>
      </button>
      <div
        className="sb-scroll"
        ref={scrollRef}
        onDragOver={(e) => drag.over(e, undefined)}
        onDrop={(e) => drag.drop(e, undefined)}
        onDragEnd={() => {
          dragged.current = null;
          drag.refocus();
        }}
      >
        {sections.map((section) => (
          <Section
            key={section.id}
            section={section}
            cursor={cursor !== null && cursorIn(section, cursor) ? cursor : null}
            run={stableRun}
            drag={drag}
          />
        ))}
      </div>
      <div className="sb-foot">
        <button type="button" onMouseDown={keepFocus} onClick={() => run("keys")}>
          Keys
        </button>
        <button type="button" onMouseDown={keepFocus} onClick={() => run("lock")}>
          Lock
        </button>
      </div>
    </nav>
  );
}

function cursorIn(section: SidebarSection, cursor: string): boolean {
  return cursor === headingId(section.id) || section.rows.some((r) => r.id === cursor);
}

/** A section's heading as a cursor stop. */
function headingRow(section: SidebarSection): SidebarRow {
  const id = headingId(section.id);
  return { id, label: section.title, level: -1, foldable: true, folded: section.folded ?? false, command: `togglefold ${id}` };
}

/** Every cursor stop, top to bottom (the order j/k walk): each heading, then its shown rows. */
export function allRows(sections: readonly SidebarSection[]): SidebarRow[] {
  return sections.flatMap((s) => [headingRow(s), ...(s.folded ? [] : s.rows)]);
}

/** The cursor after a list action; it stays put at either end. */
export function moveCursor(
  rows: readonly SidebarRow[],
  cursor: string | null,
  move: "down" | "up" | "top" | "bottom",
): string | null {
  if (rows.length === 0) return null;
  const i = rows.findIndex((r) => r.id === cursor);
  const last = rows.length - 1;
  const next =
    move === "top" ? 0
    : move === "bottom" ? last
    : i < 0 ? 0
    : Math.max(0, Math.min(last, i + (move === "down" ? 1 : -1)));
  return rows[next]?.id ?? null;
}
