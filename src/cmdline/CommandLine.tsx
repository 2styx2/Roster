// The command line (`␣ :`): one input at the bottom, like vim's. Tab completes from the command
// table and the Inventory (cycling through the candidates, Shift+Tab back), Enter runs the line,
// Esc closes it.
import { useId, useMemo, useState, type KeyboardEvent } from "react";

/** Candidates listed at most; Tab still cycles through all of them. */
const SHOWN = 8;

export interface CommandLineProps {
  /** Typed in already (a command asking for the rest, like `folder add esxi-02 `). */
  initial?: string;
  complete(input: string): string[];
  onRun(line: string): void;
  onClose(): void;
}

export function CommandLine({ initial = "", complete, onRun, onClose }: CommandLineProps) {
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
          {candidates.slice(0, SHOWN).map((c, i) => (
            <li key={c} role="option" aria-selected={i === current} className={i === current ? "selected" : undefined}>
              {c}
            </li>
          ))}
          {candidates.length > SHOWN && <li className="more">+{candidates.length - SHOWN} more</li>}
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
