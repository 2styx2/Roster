// Keycaps: every key hint in the app is drawn by this, from the keymap's own notation (keymap.ts):
// chords separated by spaces ("␣ d d"), modifiers joined with "+" ("Ctrl+Shift+c"). "␣" is the
// Leader: it gets a cap with the space-bar glyph and the real chord as its tooltip, so it never
// reads as an underscore.
import { Fragment } from "react";

const NAMES: Record<string, string> = {
  ArrowDown: "↓",
  ArrowUp: "↑",
  ArrowLeft: "←",
  ArrowRight: "→",
  Escape: "Esc",
  Enter: "↵",
  Backspace: "⌫",
  Space: "Space",
  Meta: "Win",
};

export const LEADER = "␣";

/** A chord's parts: "Ctrl+Shift+c" → ["Ctrl", "Shift", "c"]; "Ctrl++" → ["Ctrl", "+"]. */
export function chordParts(chord: string): string[] {
  if (chord.length <= 1) return [chord];
  const parts = chord.split("+");
  // A trailing "+" key splits into two empty strings.
  if (chord.endsWith("++")) return [...parts.slice(0, -2), "+"];
  return parts;
}

const SpaceGlyph = () => (
  <svg viewBox="0 0 12 8" width="11" height="8" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3">
    <path d="M1 2.5v3h10v-3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function Cap({ name, leader }: { name: string; leader?: string | undefined }) {
  if (name === LEADER) {
    return (
      <kbd className="keycap keycap-leader" title={leader ? `Leader (${leader})` : "Leader"}>
        <SpaceGlyph />
        {/* The glossary's word, so a hint reads "Find a Host, Leader f", not "open box f". */}
        <span className="visually-hidden">Leader</span>
      </kbd>
    );
  }
  return <kbd className="keycap">{NAMES[name] ?? name}</kbd>;
}

export interface KeysProps {
  /** A key sequence in keymap notation, "␣ f" or "Ctrl+Space". */
  keys: string;
  /** The Leader chord, for the ␣ cap's tooltip. */
  leader?: string | undefined;
  className?: string;
}

export function Keys({ keys, leader, className }: KeysProps) {
  const chords = keys.split(" ").filter(Boolean);
  return (
    <span className={`keys${className ? ` ${className}` : ""}`}>
      {chords.map((chord, i) => (
        <Fragment key={i}>
          {i > 0 && " "}
          <span className="chord">
            {chordParts(chord).map((p, j) => (
              <Fragment key={j}>
                {/* The "+" is for copying and screen readers; the caps show the chord. */}
                {j > 0 && <span className="visually-hidden">+</span>}
                <Cap name={p} leader={leader} />
              </Fragment>
            ))}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

/** Text with key sequences in backticks drawn as keycaps: "Drag a Host here, or `␣ a`". The
 * word before the keys stays on their line ("press ␣ a"), so a wrap never leaves keys alone. */
export function WithKeys({ text, leader }: { text: string; leader?: string | undefined }) {
  const parts = text.split("`");
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) {
          // A text part: its last word goes with the keys that follow, if any.
          if (i + 1 >= parts.length) return part;
          const at = part.search(/\S+\s*$/);
          return at < 0 ? part : part.slice(0, at);
        }
        const before = parts[i - 1] ?? "";
        const at = before.search(/\S+\s*$/);
        return (
          <span key={i} className="keys-with-word">
            {at < 0 ? "" : before.slice(at)}
            <Keys keys={part} leader={leader} />
          </span>
        );
      })}
    </>
  );
}
