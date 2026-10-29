// The Picker (GLOSSARY): fuzzy search over the Inventory's Hosts. Typing goes to the query.
// Arrows and Ctrl+N/P move; once you've moved, j/k move too (vim on) until you type anything
// else. Enter or a click opens the selected Host, Esc closes. Unreviewed Hosts are listed but
// marked and never opened (spec story 14).
import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Host, HostList } from "../backend/types";
import { chordOf, defaultKeymap, type Keymap } from "../keymap";
import { searchHosts } from "./match";

/** Rows actually rendered; the rest are counted. Keeps every keystroke cheap. */
const MAX_ROWS = 200;

export interface PickerProps {
  hosts: HostList;
  /** Host names, most recently used first. */
  recent: readonly string[];
  vim: boolean;
  keymap?: Keymap;
  onOpen: (host: Host) => void;
  onClose: () => void;
}

export function Picker({ hosts, recent, vim, keymap = defaultKeymap, onOpen, onClose }: PickerProps) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [inList, setInList] = useState(false);
  const [notice, setNotice] = useState("");
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => searchHosts(hosts, query, recent), [hosts, query, recent]);
  const shown = results.slice(0, MAX_ROWS);
  const current = Math.min(index, Math.max(0, shown.length - 1));

  useLayoutEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`);
    row?.scrollIntoView?.({ block: "nearest" });
  }, [current]);

  function choose(host: Host | undefined) {
    if (!host) return;
    if (!host.reviewed) {
      setNotice(`${host.name} isn't reviewed yet, so it can't be opened. Review it in roster first.`);
      return;
    }
    onOpen(host);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const chord = chordOf(e);
    const action = keymap.picker[chord] ?? (vim && inList ? keymap.pickerVim[chord] : undefined);
    if (!action) {
      if (chord.length === 1 || chord === "Backspace") setInList(false);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    switch (action) {
      case "picker.down":
        setIndex(Math.min(current + 1, shown.length - 1));
        setInList(true);
        break;
      case "picker.up":
        setIndex(Math.max(current - 1, 0));
        setInList(true);
        break;
      case "picker.choose":
        choose(shown[current]?.host);
        break;
      case "picker.close":
        onClose();
        break;
    }
  }

  const activeId = shown[current] ? `${listId}-${current}` : undefined;

  return (
    <div className="picker-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="picker" role="dialog" aria-label="Find a Host">
        <input
          className="picker-query"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          placeholder="Find a host: name, address, type, product, group…"
          autoFocus
          spellCheck={false}
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
            setNotice("");
          }}
          onKeyDown={onKeyDown}
        />
        <ul className="picker-list" role="listbox" id={listId} ref={listRef} aria-label="Hosts">
          {shown.map(({ host }, i) => (
            <li
              key={host.name}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === current}
              aria-disabled={!host.reviewed}
              data-host={host.name}
              data-index={i}
              className={`picker-row${i === current ? " selected" : ""}${host.reviewed ? "" : " unreviewed"}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => i !== current && setIndex(i)}
              onClick={() => {
                setIndex(i);
                choose(host);
              }}
            >
              <span className="host-name">{host.name}</span>
              <span className="host-ip">{host.ip}</span>
              <span className="host-group">{host.group}</span>
              <span className="host-type">{host.type}</span>
              {!host.reviewed && <span className="badge" title="Not reviewed: can't be opened">unreviewed</span>}
            </li>
          ))}
        </ul>
        {shown.length === 0 && <p className="picker-empty">No hosts match “{query}”.</p>}
        <div className="picker-footer">
          <span role="status">{notice}</span>
          <span className="picker-count">
            {results.length > shown.length ? `${shown.length} of ${results.length}` : results.length}{" "}
            {results.length === 1 ? "host" : "hosts"}
          </span>
        </div>
      </div>
    </div>
  );
}
