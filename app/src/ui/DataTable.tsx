// A table (ticket 76): what a Plugin's view or Host-details section shows as rows. Keyboard first:
// j/k and the arrows move, g g / G go to the ends, Ctrl+D/U half a page, s sorts by the next column
// and S reverses it, Enter opens the row, an action's key runs it on the selected row. A click
// selects, a double click opens, a heading's click sorts. The selected row shows its actions as
// buttons (decision Q88: on the selected row, never on hover).
//
// It draws only the rows on screen (table.ts windowOf), so thousands of rows cost a screenful. It
// moves from a key, so nothing animates: rows changed by an update are simply there.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { TableModel } from "../view/views";
import { RowActionGlyph } from "../sidebar/Sidebar";
import { countOf } from "./format";
import { Keys } from "./Keys";
import { nextSort, sortRows, windowOf, type Sort, type TableColumn, type TableRow } from "./table";

export interface DataTableProps {
  model: TableModel;
  /** Its accessible name ("Discover"). */
  label: string;
  /** Takes focus when it first draws (a view's table). */
  autoFocus?: boolean;
  leader: string;
}

/** Rows drawn beyond the screen each way, so a quick scroll doesn't show blanks. */
const OVERSCAN = 8;
/** A row's height until one is measured. */
const ROW_GUESS = 26;

const keepFocus = (e: React.MouseEvent) => e.preventDefault();

function cellText(row: TableRow, c: TableColumn): string {
  const v = row.cells[c.id];
  if (v === undefined) return "";
  return typeof v === "number" && c.kind === "number" ? v.toLocaleString("en-US") : String(v);
}

const ariaSort = (c: TableColumn, sort: Sort | null) => (sort?.by !== c.id ? "none" : sort.desc ? "descending" : "ascending");

export function DataTable({ model, label, autoFocus = false, leader }: DataTableProps) {
  const base = useId();
  const grid = useRef<HTMLDivElement>(null);
  const [sort, setSort] = useState<Sort | null>(model.sort);
  // A new sort from the Plugin (set again with another) wins over the user's.
  const [given, setGiven] = useState(model.sort);
  if (given !== model.sort && (given?.by !== model.sort?.by || given?.desc !== model.sort?.desc)) {
    setGiven(model.sort);
    setSort(model.sort);
  }
  const rows = useMemo(() => sortRows(model.rows, model.columns, sort), [model.rows, model.columns, sort]);
  // The selected row's id, and where it was: the selection follows its row across updates and
  // sorts, and a row taken away hands it to the one that took its place.
  const [selected, setSelected] = useState<{ id: string; at: number } | null>(null);
  let index = selected === null ? -1 : rows.findIndex((r) => r.id === selected.id);
  if (index < 0 && rows.length > 0) index = Math.min(selected?.at ?? 0, rows.length - 1);
  const current = rows[index];

  const [view, setView] = useState({ scrollTop: 0, height: 0 });
  const [rowH, setRowH] = useState(ROW_GUESS);
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const measure = () => {
      const row = el.querySelector<HTMLElement>(".dt-row");
      const h = row?.getBoundingClientRect().height ?? 0;
      if (h > 0) setRowH(h);
      setView((v) => (v.height === el.clientHeight ? v : { ...v, height: el.clientHeight }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (autoFocus) grid.current?.focus();
  }, [autoFocus]);

  const head = rowH;
  const { start, end } = windowOf({ count: rows.length, rowHeight: rowH, scrollTop: view.scrollTop, height: Math.max(0, view.height - head), overscan: OVERSCAN });

  // The rows on screen, and the selected one wherever it is: it's the grid's active descendant.
  const shown = Array.from({ length: Math.max(0, end - start) }, (_, j) => start + j);
  if (current && (index < start || index >= end)) shown.push(index);

  /** Selects row `i` and scrolls it into view. */
  const select = (i: number) => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, i))];
    if (!row) return;
    const at = rows.indexOf(row);
    setSelected({ id: row.id, at });
    const el = grid.current;
    if (!el || el.clientHeight === 0) return;
    const top = at * rowH;
    const room = el.clientHeight - head;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + rowH > el.scrollTop + room) el.scrollTop = top + rowH - room;
  };

  const sortBy = (c: TableColumn) => setSort((s) => (s?.by === c.id ? { by: c.id, desc: !s.desc } : { by: c.id, desc: false }));
  const page = () => Math.max(1, Math.floor((view.height - head) / rowH / 2) || 10);
  const pendingG = useRef(false);

  /** What a key does here, or null when it isn't the table's. */
  const keyAction = (e: KeyboardEvent<HTMLDivElement>, g: boolean): (() => void) | null => {
    const k = e.key;
    if (e.altKey || e.metaKey) return null;
    if (e.ctrlKey) {
      if (k === "d") return () => select(index + page());
      if (k === "u") return () => select(index - page());
      return null;
    }
    switch (k) {
      case "j":
      case "ArrowDown":
        return () => select(index + 1);
      case "k":
      case "ArrowUp":
        return () => select(index - 1);
      case "PageDown":
        return () => select(index + page() * 2);
      case "PageUp":
        return () => select(index - page() * 2);
      case "G":
      case "End":
        return () => select(rows.length - 1);
      case "Home":
        return () => select(0);
      case "g":
        return () => {
          if (g) select(0);
          else pendingG.current = true;
        };
      case "s":
        return () => setSort((s) => nextSort(model.columns, s));
      case "S":
        return () => setSort((s) => (s ? { ...s, desc: !s.desc } : s));
      case "Enter": {
        // A key held from before (the Enter that opened the view) runs nothing.
        if (e.repeat) return () => {};
        const open = model.open;
        return current && open ? () => open(current) : null;
      }
    }
    const action = model.actions.find((a) => a.key === k);
    if (!action || !current) return null;
    return e.repeat ? () => {} : () => action.run(current);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const g = pendingG.current;
    pendingG.current = false;
    const act = keyAction(e, g);
    if (!act) return;
    e.preventDefault();
    e.stopPropagation();
    act();
  };

  const template = model.columns.map((c) => (c.width ? `${c.width}ch` : "minmax(0, 1fr)")).join(" ") + (model.actions.length ? " auto" : "");
  const sortedBy = sort && model.columns.find((c) => c.id === sort.by);
  const keyed = model.actions.filter((a) => a.key);

  return (
    <div className="data-table">
      {rows.length === 0 ? (
        <>
          <div className="dt-head dt-head-alone" aria-hidden="true" style={{ gridTemplateColumns: template }}>
            {model.columns.map((c) => (
              <span key={c.id} className={`dt-th kind-${c.kind}`}>
                {c.label}
              </span>
            ))}
          </div>
          <p className="panel-empty dt-empty">{model.empty ?? "Nothing here."}</p>
        </>
      ) : (
        <div
          ref={grid}
          role="grid"
          aria-label={label}
          aria-rowcount={rows.length + 1}
          aria-colcount={model.columns.length}
          aria-activedescendant={current ? `${base}-r${index}` : undefined}
          tabIndex={0}
          className="dt-grid"
          onKeyDown={onKeyDown}
          onScroll={(e) => {
            const top = e.currentTarget.scrollTop;
            setView((v) => (v.scrollTop === top ? v : { ...v, scrollTop: top }));
          }}
        >
          <div role="row" aria-rowindex={1} className="dt-head" style={{ gridTemplateColumns: template }}>
            {model.columns.map((c) => (
              <div key={c.id} role="columnheader" aria-sort={ariaSort(c, sort)} className={`dt-th kind-${c.kind}`}>
                <button type="button" className="dt-sort" tabIndex={-1} onMouseDown={keepFocus} onClick={() => sortBy(c)}>
                  {c.label}
                  <span className="dt-arrow" aria-hidden="true">
                    {sort?.by === c.id ? (sort.desc ? "↓" : "↑") : ""}
                  </span>
                </button>
              </div>
            ))}
            {model.actions.length > 0 && <div role="columnheader" className="dt-th dt-th-actions" aria-label="Actions" />}
          </div>
          <div role="rowgroup" className="dt-body" style={{ height: rows.length * rowH }}>
            {shown.map((i) => {
              const row = rows[i] as TableRow;
              const on = i === index;
              return (
                <div
                  key={row.id}
                  id={`${base}-r${i}`}
                  role="row"
                  aria-rowindex={i + 2}
                  aria-selected={on}
                  className={`dt-row${on ? " selected" : ""}${row.tone ? ` tone-${row.tone}` : ""}`}
                  style={{ transform: `translateY(${i * rowH}px)`, gridTemplateColumns: template }}
                  onMouseDown={(e) => {
                    // A click selects and keeps the keys in the table.
                    if (!(e.target as HTMLElement).closest("button")) {
                      e.preventDefault();
                      grid.current?.focus();
                    }
                    setSelected({ id: row.id, at: i });
                  }}
                  onDoubleClick={() => model.open?.(row)}
                >
                  {model.columns.map((c, ci) => (
                    <div key={c.id} role="gridcell" className={`dt-td kind-${c.kind}`} title={cellText(row, c) || undefined}>
                      {ci === 0 && row.tone && row.tone !== "muted" && <span className="dt-mark" aria-label={row.tone === "warn" ? "warning" : "error"} role="img" />}
                      {cellText(row, c)}
                    </div>
                  ))}
                  {model.actions.length > 0 && (
                    <div role="gridcell" className="dt-actions">
                      {on &&
                        model.actions.map((a) => (
                          <button
                            key={a.label}
                            type="button"
                            className={a.icon ? "dt-action icon" : "dt-action"}
                            tabIndex={-1}
                            aria-label={a.label}
                            title={a.key ? `${a.label} (${a.key})` : a.label}
                            onMouseDown={keepFocus}
                            onClick={() => a.run(row)}
                          >
                            {a.icon ? <RowActionGlyph name={a.icon} /> : a.label}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <p className="dt-foot muted key-hint">
        <span className="dt-count">
          {countOf(rows.length, "row")}
          {sortedBy ? `, by ${sortedBy.label}${sort?.desc ? " (highest first)" : ""}` : ""}
        </span>
        {rows.length > 0 && (
          <span className="dt-keys">
            {model.open && (
              <span>
                <Keys keys="Enter" leader={leader} /> open
              </span>
            )}
            {keyed.map((a) => (
              <span key={a.label}>
                <Keys keys={a.key as string} leader={leader} /> {a.label.toLowerCase()}
              </span>
            ))}
            <span>
              <Keys keys="s" leader={leader} /> sort
            </span>
          </span>
        )}
      </p>
    </div>
  );
}
