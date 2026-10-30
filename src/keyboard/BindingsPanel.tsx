// The Key bindings panel (`␣ ?`): the resolved keymap, grouped by area, with where each binding
// comes from (builtin, init.lua, or a Plugin), and a filter. Esc in the filter closes it.
import { useMemo, useState } from "react";
import { BUILTIN } from "../registry";
import { CloseGlyph } from "../ui/CloseGlyph";
import { Keys } from "../ui/Keys";
import { filterRows, type BindingRow } from "./bindings";

export interface BindingsPanelProps {
  rows: readonly BindingRow[];
  /** The Leader chord, as the ␣ key's tooltip. */
  leader: string;
  onClose(): void;
}

export function BindingsPanel({ rows, leader, onClose }: BindingsPanelProps) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => filterRows(rows, query), [rows, query]);
  const groups = useMemo(() => {
    const out = new Map<string, BindingRow[]>();
    for (const r of shown) out.set(r.area, [...(out.get(r.area) ?? []), r]);
    return [...out];
  }, [shown]);

  return (
    <aside className="keys-panel" aria-label="Key bindings">
      <header>
        <h2>Key bindings</h2>
        <button type="button" className="icon-button keys-close" aria-label="Close key bindings" onClick={onClose}>
          <CloseGlyph />
        </button>
      </header>
      <input
        type="search"
        className="keys-filter"
        aria-label="Filter key bindings"
        placeholder="Filter…"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <div className="keys-scroll">
        <table>
          {groups.map(([area, list]) => (
            <tbody key={area}>
              <tr className="group">
                <th colSpan={3} scope="colgroup">
                  {area}
                </th>
              </tr>
              {list.map((r) => (
                <tr key={`${r.label}\0${r.source}`}>
                  <td>{r.label}</td>
                  <td className="keys-keys">
                    <span className="keys-list">
                      {r.keys.map((k, i) => (
                        <span key={k}>
                          {i > 0 && " "}
                          <Keys keys={k} leader={leader} />
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className={`keys-source${r.source === BUILTIN ? "" : " config"}`}>{r.source}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
        {shown.length === 0 && <p className="panel-empty">No bindings match “{query}”.</p>}
      </div>
    </aside>
  );
}
