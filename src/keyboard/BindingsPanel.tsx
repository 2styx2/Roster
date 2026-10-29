// The Key bindings panel (`␣ ?`): the resolved keymap, grouped by area, with where each binding
// comes from (builtin, init.lua, or a Plugin), and a filter. Esc in the filter closes it.
import { useMemo, useState } from "react";
import { BUILTIN } from "../registry";
import { filterRows, type BindingRow } from "./bindings";

export interface BindingsPanelProps {
  rows: readonly BindingRow[];
  /** The Leader chord, as the ␣ key's tooltip. */
  leader: string;
  onClose(): void;
}

function Keys({ keys, leader }: { keys: string; leader: string }) {
  return (
    <>
      {keys.split(" ").map((k, i) => (
        <kbd key={i} title={k === "␣" ? leader : undefined}>
          {k}
        </kbd>
      ))}
    </>
  );
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
        <button type="button" className="keys-close" aria-label="Close key bindings" onClick={onClose}>
          ×
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
                <th colSpan={2} scope="colgroup">
                  {area}
                </th>
              </tr>
              {list.map((r) => (
                <tr key={`${r.label}\0${r.source}`}>
                  <td>{r.label}</td>
                  <td className="keys-keys">
                    {r.keys.map((k, i) => (
                      <span key={k}>
                        {i > 0 && " "}
                        <Keys keys={k} leader={leader} />
                      </span>
                    ))}
                    <span className={`keys-source${r.source === BUILTIN ? "" : " config"}`}>{r.source}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
        {shown.length === 0 && <p className="muted">No bindings match “{query}”.</p>}
      </div>
    </aside>
  );
}
