// Which keys a terminal keeps from the shell: only the Leader (GLOSSARY: Terminal mode).
import { chordOf, type KeyLike } from "../keymap";

/** True for the Leader chord. Space is matched by its physical key (`code`), since what `key`
 * reports for Ctrl+Space depends on the keyboard layout and IME. */
export function isLeaderKey(e: KeyLike & { code: string }, leader: string): boolean {
  // Copy the fields: a real KeyboardEvent's are prototype getters, which a spread would drop.
  const { ctrlKey, altKey, metaKey, shiftKey } = e;
  const key = e.code === "Space" ? " " : e.key;
  return chordOf({ key, ctrlKey, altKey, metaKey, shiftKey }) === leader;
}
