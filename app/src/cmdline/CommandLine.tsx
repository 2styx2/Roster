// The command line (`␣ :`): one input at the bottom, like vim's. Tab completes from the command
// table and the Inventory (cycling through the candidates, Shift+Tab back), Enter runs the line,
// Esc closes it. Each command candidate says what it does and its key (ticket 29 S8), so the
// command line is also where commands are discovered.
import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { formatCount } from "../ui/format";
import { Keys } from "../ui/Keys";

/** What a candidate does: its command's label, and the keys bound to it. */
export interface Candidate {
  label: string;
  keys: string | null;
}

/** Candidates listed at most; Tab still cycles through all of them. */
const SHOWN = 8;

export interface CommandLineProps {
  /** Typed in already (a command asking for the rest, like `folder add esxi-02 `). */
  initial?: string;
  complete(input: string): string[];
  /** A command candidate's label and keys; null for an argument (a Host name). */
  describe?(candidate: string): Candidate | null;
  /** The Leader chord, for the ␣ cap's tooltip. */
  leader?: string;
  onRun(line: string): void;
  onClose(): void;
}

export function CommandLine({ initial = "", complete, describe, leader, onRun, onClose }: CommandLineProps) {
  const [value, setValue] = useState(initial);
  /** While cycling with Tab: the candidates for what was typed, and which one is in the input. */
  const [cycle, setCycle] = useState<{ candidates: string[]; index: number } | null>(null);
  const listId = useId();
  const candidates = useMemo(() => cycle?.candidates ?? complete(value), [cycle, complete, value]);

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Tab") {
      e.preventDefault();
      const list = cycle?.candidates ?? complete(value);
      if (list.length === 0) return;
      const step = e.shiftKey ? -1 : 1;
      const index = cycle ? (cycle.index + step + list.length) % list.length : e.shiftKey ? list.length - 1 : 0;
      setCycle({ candidates: list, index });
      setValue(list[index] ?? value);
    } else if (e.key === "Enter") {
      e.preventDefault();
      onRun(value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  const current = cycle?.index ?? -1;
  return (
    <div className="cmdline">
      {candidates.length > 0 && (
        <ul className="cmdline-candidates" role="listbox" id={listId} aria-label="Completions">
          {candidates.slice(0, SHOWN).map((c, i) => {
            const about = describe?.(c) ?? null;
            return (
              <li key={c} role="option" aria-selected={i === current} className={i === current ? "selected" : undefined}>
                <span className="cmd-id">{c}</span>
                {about && (
                  <>
                    <span className="visually-hidden">: </span>
                    <span className="cmd-label" title={about.label}>
                      {about.label}
                    </span>
                    {about.keys && <Keys keys={about.keys} leader={leader} className="cmd-keys" />}
                  </>
                )}
              </li>
            );
          })}
          {candidates.length > SHOWN && <li className="more">+{formatCount(candidates.length - SHOWN)} more</li>}
        </ul>
      )}
      <div className="cmdline-input">
        <span aria-hidden="true">:</span>
        <input
          role="combobox"
          aria-label="Command"
          aria-expanded={candidates.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          autoFocus
          spellCheck={false}
          autoComplete="off"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setCycle(null);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  );
}
