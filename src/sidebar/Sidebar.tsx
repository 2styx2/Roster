// The Sidebar (GLOSSARY): a pane of sections, each a list of rows, from the Sidebar section
// registry (sections.ts). The row on screen uses the raised style; in App mode a cursor row shows
// where j/k (or the arrows) are, and Enter chooses it. Rows and buttons only run command lines
// from the command table, so nothing here is a Sidebar-only action (decision Q36). The mouse
// works on every row without taking focus from the terminal.
import type { CommandLine } from "../keymap";

/** A row's state dot: key or password login, or a Session that has ended. */
export type Dot = "key" | "password" | "ended";

export interface SidebarRow {
  /** Unique across all sections (the cursor is a row id). */
  id: string;
  label: string;
  dot?: Dot;
  /** A short status after the label ("connecting…", "ended (code 0)"). */
  note?: string;
  /** The item on screen (GLOSSARY decision Q31: the raised style). */
  raised?: boolean;
  /** Tree depth, for ticket 17's groups and Folders. */
  level?: number;
  /** What Enter or a click runs. */
  command: CommandLine;
  /** A close button on the row (Sessions) runs this; it's named `closeLabel`. */
  closeCommand?: CommandLine;
  closeLabel?: string;
}

export interface SidebarSection {
  id: string;
  title: string;
  count?: number;
  rows: readonly SidebarRow[];
  /** Shown when there are no rows. */
  empty?: string;
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

/** Keeps focus where it is (the terminal) when a row or button is clicked. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

export function Sidebar({ sections, side, cursor, leaderHint, run }: SidebarProps) {
  return (
    <nav className={`sidebar side-${side}`} aria-label="Sidebar">
      <button type="button" className="sb-find" onMouseDown={keepFocus} onClick={() => run("find")}>
        Find a Host <kbd title={leaderHint}>␣ f</kbd>
      </button>
      <div className="sb-scroll">
        {sections.map((section) => (
          <section key={section.id} className="sb-section" aria-label={section.title}>
            <h2 className="sb-heading">
              {section.title}
              {section.count !== undefined && <span className="sb-count">{section.count}</span>}
            </h2>
            {section.rows.length === 0 && section.empty && <p className="sb-empty">{section.empty}</p>}
            <ul className="sb-rows">
              {section.rows.map((row) => (
                <li
                  key={row.id}
                  className={`sb-row${row.raised ? " raised" : ""}${row.id === cursor ? " cursor" : ""}`}
                  data-row={row.id}
                  style={row.level ? { paddingLeft: `${row.level * 16}px` } : undefined}
                >
                  <button
                    type="button"
                    className="sb-item"
                    aria-current={row.raised ? "true" : undefined}
                    tabIndex={-1}
                    onMouseDown={keepFocus}
                    onClick={() => run(row.command)}
                  >
                    {row.dot && <span className={`dot ${row.dot}`} aria-hidden="true" />}
                    <span className="sb-label">{row.label}</span>
                    {row.note && <span className="sb-note"> {row.note}</span>}
                  </button>
                  {row.closeCommand && (
                    <button
                      type="button"
                      className="sb-close"
                      aria-label={row.closeLabel ?? `Close ${row.label}`}
                      tabIndex={-1}
                      onMouseDown={keepFocus}
                      onClick={() => row.closeCommand && run(row.closeCommand)}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
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

/** Every row, top to bottom (the order j/k walk). */
export function allRows(sections: readonly SidebarSection[]): SidebarRow[] {
  return sections.flatMap((s) => s.rows);
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
