// The Picker (GLOSSARY): fuzzy search over the Inventory's Hosts. Typing goes to the query.
// Arrows and Ctrl+N/P move; once you've moved, j/k move too (vim on) until you type anything
// else. Tab and Shift+Tab move too, wrapping (ticket 34); before you've moved, Tab first fills the
// query with what the matching names share, as a shell does. Enter or a click opens the selected Host, Esc closes. Unreviewed Hosts are listed but
// marked and never opened (spec story 14).
import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Host, HostList } from "../backend/types";
import { chordOf, defaultKeymap, type Keymap, type KeyTable, type PickerAction } from "../keymap";
import { countOf, formatCount } from "../ui/format";
import { Keys } from "../ui/Keys";
import { prefixFill } from "../ui/completion";
import { searchHosts } from "./match";

/** Rows actually rendered; the rest are counted. Keeps every keystroke cheap. */
const MAX_ROWS = 200;

export interface PickerProps {
  hosts: HostList;
  /** Host names, most recently used first. */
  recent: readonly string[];
  vim: boolean;
  keymap?: Keymap;
  /** `here`: open it in the current tab if that tab's Session has ended (else a new tab). */
  onOpen: (host: Host, how?: { here: true }) => void;
  /** Marks an unreviewed Host reviewed (`:review`, ticket 11); without it the Picker only says why
   * the Host can't be opened. */
  onReview?: (host: Host) => void;
  onClose: () => void;
}

/** The first key bound to `action`, for the footer's hints. */
const keyFor = (table: KeyTable<PickerAction>, action: PickerAction) =>
  Object.entries(table).find(([, b]) => b.action === action)?.[0] ?? null;

export function Picker({ hosts, recent, vim, keymap = defaultKeymap, onOpen, onReview, onClose }: PickerProps) {
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

  function choose(host: Host | undefined, here = false) {
    if (!host) return;
    if (!host.reviewed) {
      const review = keyFor(keymap.picker, "picker.review");
      setNotice(
        onReview && review
          ? `${host.name} isn't reviewed yet, so it can't be opened. ${review} marks it reviewed.`
          : `${host.name} isn't reviewed yet, so it can't be opened. Review it in roster first.`,
      );
      return;
    }
    if (here) onOpen(host, { here: true });
    else onOpen(host);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const chord = chordOf(e);
    const action = (keymap.picker[chord] ?? (vim && inList ? keymap.pickerVim[chord] : undefined))?.action;
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
      case "picker.next":
      case "picker.prev": {
        const fill = action === "picker.next" && !inList ? prefixFill(query, shown.map((r) => r.host.name)) : null;
        if (fill !== null) {
          setQuery(fill);
          setIndex(0);
          setNotice("");
          break;
        }
        if (shown.length === 0) break;
        setIndex((current + (action === "picker.next" ? 1 : -1) + shown.length) % shown.length);
        setInList(true);
        break;
      }
      case "picker.choose":
        choose(shown[current]?.host);
        break;
      case "picker.chooseHere":
        choose(shown[current]?.host, true);
        break;
      case "picker.review": {
        const host = shown[current]?.host;
        if (host && !host.reviewed && onReview) onReview(host);
        else if (host) setNotice(onReview ? `${host.name} is already reviewed.` : "");
        break;
      }
      case "picker.close":
        onClose();
        break;
    }
  }

  const activeId = shown[current] ? `${listId}-${current}` : undefined;
  const move = [keyFor(keymap.picker, "picker.up"), keyFor(keymap.picker, "picker.down")].filter((k) => k !== null).join(" ");
  const hints: [string | null, string][] = [
    [move, "move"],
    [keyFor(keymap.picker, "picker.choose"), "open"],
    [keyFor(keymap.picker, "picker.close"), "close"],
  ];

  return (
    <div className="picker-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="picker" role="dialog" aria-label="Find a Host">
        <div className="picker-search">
          <svg className="picker-search-icon" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5L14 14" strokeLinecap="round" />
          </svg>
          <input
          className="picker-query"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          placeholder="Find a Host: name, address, type, product, group…"
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
        </div>
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
              <span className="host-name" title={host.name}>
                {host.name}
              </span>
              <span className="host-ip" title={host.ip || undefined}>
                {host.ip}
              </span>
              <span className="host-group" title={host.group}>
                {host.group}
              </span>
              <span className="host-type" title={host.type}>
                {host.type}
              </span>
              {!host.reviewed && (
                <span className="badge" title="unreviewed: can't be opened until it's reviewed in roster">
                  unreviewed
                </span>
              )}
            </li>
          ))}
        </ul>
        {shown.length === 0 && (
          <p className="picker-empty">
            {query.trim() === "" && hosts.hosts.length === 0
              ? "The Inventory has no Hosts yet. Add them to roster.yml and they show up here."
              : `No Hosts match “${query}”.`}
          </p>
        )}
        <div className="picker-footer">
          <span role="status" title={notice || undefined}>
            {notice}
          </span>
          <span className="picker-count">
            {results.length > shown.length
              ? `${formatCount(shown.length)} of ${countOf(results.length, "Host")}`
              : countOf(results.length, "Host")}
          </span>
          {hints.map(
            ([keys, what]) =>
              keys && (
                <span key={what} className="picker-hint key-hint">
                  <Keys keys={keys} /> {what}
                </span>
              ),
          )}
        </div>
      </div>
    </div>
  );
}
