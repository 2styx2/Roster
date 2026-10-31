// State nodes (ticket 29 M3, decision Q53, docs/app/design/taste.md): a Host's or Session's state
// drawn as a node whose shape carries it, so colour is never the only cue (WCAG 1.4.1), with the
// same state in words for assistive tech. Filled = key login, ring = password login, hollow grey
// = ended, dashed ring in the second tone = unreviewed (can't be opened; decision Q57), and an
// accent ring with an edge being drawn from it = connecting (issue #78; the edge is the row's). The
// colours are Theme tokens (styles.css).

/** A row's state: key or password login, a Session that has ended, or a Host that can't be
 * opened (unreviewed). */
export type Dot = "key" | "password" | "ended" | "off" | "connecting";

const SHAPES: Record<Dot, string> = { key: "filled", password: "ring", ended: "hollow", off: "dashed", connecting: "ring" };

/** The state in words, for an accessible name ("password login"). */
export const DOT_WORDS: Record<Dot, string> = {
  key: "key login",
  password: "password login",
  ended: "ended",
  off: "unreviewed, can't be opened",
  connecting: "connecting",
};

export function StateDot({ dot }: { dot: Dot }) {
  return (
    <svg className={`dot ${dot}`} data-shape={SHAPES[dot]} viewBox="0 0 8 8" width="8" height="8" aria-hidden="true">
      <circle cx="4" cy="4" r="3.25" />
    </svg>
  );
}
