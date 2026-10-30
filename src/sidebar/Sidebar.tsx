// The Sidebar (GLOSSARY): a pane of sections, each a tree of rows, from the Sidebar section
// registry (sections.ts). The row on screen uses the raised style, and the same Host further down
// is only brighter ("also"); in App mode a cursor row shows where j/k (or the arrows) are, h/l fold
// and unfold, and Enter chooses. Rows, buttons, chevrons and drops only run command lines from the
// command table, so nothing here is a Sidebar-only action (decision Q36). The mouse works on every
// row without taking focus from the terminal.
//
// For assistive tech (ticket 29 M4) the rows are an ARIA tree: the scroller is the tree, each
// section a group, each row a treeitem with its level, and the App-mode cursor is the tree's
// aria-activedescendant while App takes focus there. Each row's name says its state in words
// (M3), and App mode shows the cursor row whole below the tree (M6).
//
// 91 Hosts is a few hundred elements: rows are memoized on their object (sections are rebuilt only
// when what they show changes), so moving the cursor re-renders two rows, not the tree.
import { memo, useCallback, useLayoutEffect, useRef, useState, type DragEvent } from "react";
import type { CommandLine } from "../keymap";
import { formatCount } from "../ui/format";
import { Keys, WithKeys } from "../ui/Keys";
import { DOT_WORDS, StateDot, type Dot } from "../ui/StateDot";

export type { Dot } from "../ui/StateDot";

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
  /** The end of the label that must stay in view when the rest is cut off (a Session's " (2)"). */
  tail?: string;
  /** Right-aligned and faint: an address. It shows whole or not at all: the name comes first. */
  detail?: string;
  /** Right-aligned: how many Hosts a Folder or group holds. Formatted, and never cut off. */
  count?: number;
  /** A small badge ("unreviewed"). It gives way to the name: shown on hover, raised or under the
   * cursor, and always in the tooltip. */
  badge?: string;
  /** A glyph before the label: a Folder, an Inventory group. */
  icon?: "folder" | "group";
  /** A tooltip (and accessible description), e.g. "password login". */
  title?: string;
  /** The item on screen (decision Q31: the raised style). Set by the section, or by
   * buildSections for the on-screen Host's first row. */
  raised?: boolean;
  /** The on-screen Host where it appears again: brighter, not raised (set by buildSections). */
  also?: boolean;
  /** The raised row stands for a live Session (connected or connecting, not ended): it gets the
   * accent bar (decision Q53). Set by the Sessions section, or by buildSections. */
  live?: boolean;
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
  /** Shown when there are no rows. Key sequences in backticks are drawn as keycaps. */
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
  /** The keys that open the Picker ("␣ f"), if the keymap has them. */
  findKeys?: string | null;
  /** Runs a command line: for rows, and the buttons at the top and bottom. */
  run(line: CommandLine): void;
  /** Gets the tree element (App focuses it in App mode). */
  treeRef?(el: HTMLDivElement | null): void;
  /** The tree took focus from outside (Tab, a click): App enters App mode. */
  onTreeFocus?(from: Element | null): void;
  /** Focus left the tree for somewhere outside it. */
  onTreeBlur?(to: Element | null): void;
}

/** A row's DOM id, for aria-activedescendant: any row id, made a valid id. */
export const rowDomId = (id: string) => `sb-${Array.from(id, (c) => (/[\w-]/.test(c) ? c : `_${c.codePointAt(0)}_`)).join("")}`;

const hostsCount = (n: number) => `${formatCount(n)} ${n === 1 ? "Host" : "Hosts"}`;

/** What a row says about itself, beyond its label: its state in words (never only a dot's colour),
 * its note, a badge, its address, its count. */
export function rowFacts(row: SidebarRow): string[] {
  const facts: string[] = [];
  // An ended Session's note already says how it ended.
  if (row.dot && !(row.dot === "ended" && row.note)) facts.push(DOT_WORDS[row.dot]);
  if (row.note) facts.push(row.note);
  // An unreviewed Host's badge is what its dot already said.
  if (row.badge && row.dot !== "off") facts.push(row.badge);
  if (row.detail) facts.push(row.detail);
  if (row.count !== undefined) facts.push(hostsCount(row.count));
  return facts;
}

/** The row's accessible name: "esxi-02, password login, 10.19.77.5". */
export const rowName = (row: SidebarRow) => [row.label, ...rowFacts(row)].join(", ");

const SearchIcon = () => (
  <svg className="sb-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14" strokeLinecap="round" />
  </svg>
);

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
  <svg className={`sb-chev${folded ? " folded" : ""}`} viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
    <path d="M2.5 3.75L5 6.25l2.5-2.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ROW_ICONS: Record<NonNullable<SidebarRow["icon"]>, React.ReactNode> = {
  folder: <path d="M2 4.5h4l1.5 1.5H14v6.5H2z" />,
  group: (
    <>
      <rect x="2" y="3" width="12" height="4" rx="1" />
      <rect x="2" y="9" width="12" height="4" rx="1" />
    </>
  ),
};

const RowIcon = ({ name }: { name: NonNullable<SidebarRow["icon"]> }) => (
  <svg className="sb-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
    {ROW_ICONS[name]}
  </svg>
);


const Row = memo(function Row({ row, cursor, run, drag }: { row: SidebarRow; cursor: boolean; run: Run; drag: Drag }) {
  const cls = `sb-row${row.raised ? " raised" : ""}${row.raised && row.live ? " live" : ""}${row.also ? " also" : ""}${cursor ? " cursor" : ""}${row.actions ? " has-actions" : ""}`;
  const cut = row.tail !== undefined && row.label.endsWith(row.tail);
  return (
    <li
      role="none"
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
        role="treeitem"
        id={rowDomId(row.id)}
        className="sb-item"
        aria-level={(row.level ?? 0) + 2}
        aria-label={rowName(row)}
        aria-selected={cursor ? true : undefined}
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
        {row.icon && <RowIcon name={row.icon} />}
        {row.dot && <StateDot dot={row.dot} />}
        {/* The name first: what follows it in here drops out whole (to a hidden second line)
            when there's no room, and the name is cut only when it alone is too long. */}
        {/* Hovering the text shows the whole name (it may be cut off), then the row's tooltip. */}
        <span className="sb-text" title={row.title ? `${row.label}\n${row.title}` : row.label}>
          {/* A note ("ended (code 0)") stays beside the name like the " (2)" tail: when the name
              is cut, the label gives way, never the state. */}
          <span className="sb-name">
            <span className="sb-label" dir="auto">
              {cut ? row.label.slice(0, -(row.tail as string).length) : row.label}
            </span>
            {cut && <span className="sb-tail">{row.tail}</span>}
            {row.note && <span className="sb-note"> {row.note}</span>}
          </span>
          {row.badge && <span className="sb-badge"> {row.badge}</span>}
          {row.detail && <span className="sb-detail"> {row.detail}</span>}
        </span>
        {row.count !== undefined && <span className="sb-num">{formatCount(row.count)}</span>}
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
  leader,
}: {
  section: SidebarSection;
  /** The cursor if it's in this section, else null (so the other sections don't re-render). */
  cursor: string | null;
  run: Run;
  drag: Drag;
  leader: string;
}) {
  const id = headingId(section.id);
  const folded = section.folded ?? false;
  const emptyShown = !folded && section.rows.length === 0 && section.empty !== undefined;
  return (
    <section
      role="group"
      className="sb-section"
      aria-label={section.title}
      onDragOver={section.drop ? (e) => drag.over(e, section.drop) : undefined}
      onDrop={section.drop ? (e) => drag.drop(e, section.drop) : undefined}
    >
      <div className={`sb-heading${cursor === id ? " cursor" : ""}`} data-row={id} role="none">
        <div
          role="treeitem"
          id={rowDomId(id)}
          className="sb-heading-button"
          aria-level={1}
          aria-expanded={!folded}
          aria-label={section.title}
          aria-selected={cursor === id ? true : undefined}
          aria-describedby={emptyShown ? `${rowDomId(id)}-empty` : undefined}
          onMouseDown={keepFocus}
          onClick={() => run(`togglefold ${id}`)}
        >
          <Chevron folded={folded} />
          <h2>{section.title}</h2>
          {section.count !== undefined && <span className="sb-count">{formatCount(section.count)}</span>}
        </div>
        {section.actions && <Actions actions={section.actions} run={run} />}
      </div>
      {emptyShown && (
        <p className="sb-empty" id={`${rowDomId(id)}-empty`}>
          <WithKeys text={section.empty ?? ""} leader={leader} />
        </p>
      )}
      {!folded && (
        <ul className="sb-rows" role="none">
          {section.rows.map((row) => (
            <Row key={row.id} row={row} cursor={row.id === cursor} run={run} drag={drag} />
          ))}
        </ul>
      )}
    </section>
  );
});

/** The cursor row, whole (M6): a cut-off name, its state and address, readable from the keyboard.
 * It repeats what the tree item's name already tells assistive tech, so it's hidden from it. */
function Details({ row }: { row: SidebarRow }) {
  const facts = rowFacts(row);
  return (
    <div className="sb-details" data-testid="sidebar-details" aria-hidden="true">
      <p className={`sb-details-name${row.dot ? " data" : ""}`} dir="auto">
        {row.label}
      </p>
      {(facts.length > 0 || row.title) && <p className="sb-details-facts">{[...facts, ...(row.title ? [row.title] : [])].join(" · ")}</p>}
    </div>
  );
}

export function Sidebar({ sections, side, cursor, leaderHint, findKeys = "␣ f", run, treeRef, onTreeFocus, onTreeBlur }: SidebarProps) {
  // A stable `run` for the memoized rows; it always calls the latest one.
  const runRef = useRef(run);
  useLayoutEffect(() => {
    runRef.current = run;
  });
  const stableRun = useCallback((line: CommandLine) => runRef.current(line), []);

  // Keep the cursor row in view as j/k walk a long tree.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const setTree = useCallback(
    (el: HTMLDivElement | null) => {
      scrollRef.current = el;
      treeRef?.(el);
    },
    [treeRef],
  );
  useLayoutEffect(() => {
    if (cursor === null) return;
    const el = scrollRef.current?.querySelector(`[data-row="${CSS.escape(cursor)}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [cursor]);

  // The dragged row lives here; its Host also goes on the dataTransfer as text (WebView2 needs
  // some data for a drag to start).
  const dragged = useRef<SidebarRow | null>(null);
  const focusBefore = useRef<Element | null>(null);
  const cursorRow = cursor === null ? null : (allRows(sections).find((r) => r.id === cursor) ?? null);

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
        <SearchIcon />
        <span className="sb-find-label">Find a Host</span>
        {findKeys && <Keys keys={findKeys} leader={leaderHint} />}
      </button>
      <div
        className="sb-scroll"
        ref={setTree}
        role="tree"
        aria-label="Sessions and Hosts"
        tabIndex={0}
        aria-activedescendant={cursor !== null ? rowDomId(cursor) : undefined}
        onFocus={(e) => {
          if (e.target === e.currentTarget && !e.currentTarget.contains(e.relatedTarget)) onTreeFocus?.(e.relatedTarget);
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) onTreeBlur?.(e.relatedTarget);
        }}
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
            leader={leaderHint}
          />
        ))}
      </div>
      {cursorRow && <Details row={cursorRow} />}
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
