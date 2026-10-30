// A stand-in for TerminalView in UI tests (xterm needs a real browser): shows the Session's
// output as text, and its input sends keys the way xterm would, keeping the Leader back. (Copy,
// paste, find and zoom need xterm itself: they're checked by hand, see ticket 08.)
import { useEffect, useRef, useState } from "react";
import type { TerminalViewProps } from "./TerminalView";
import type { TermSize } from "../backend/types";
import type { ViewMode } from "../view/layout";
import { isLeaderKey } from "./keys";

const KEYS: Record<string, string> = { Escape: "\x1b", Enter: "\r" };

/** The size the stub "fits" to in each view mode, so tests can see a resize reach the Session. */
export const STUB_SIZES = {
  standard: { cols: 100, rows: 30 },
  focus: { cols: 132, rows: 43 },
} satisfies Record<ViewMode, TermSize>;

export function StubTerminal({ active, leader, attach, onData, onResize, env }: TerminalViewProps) {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => attach((d) => setText((t) => t + new TextDecoder().decode(d))), [attach]);
  // Like TerminalView: a layout change (not the first one) fits again and tells the Session.
  const mode = env.layout.split(" ")[0] ?? "";
  const seen = useRef(mode);
  useEffect(() => {
    if (!active || seen.current === mode) return;
    seen.current = mode;
    onResize(STUB_SIZES[mode as ViewMode] ?? { cols: 80, rows: 24 });
  }, [mode, active, onResize]);
  // Like TerminalView: the tab that becomes active takes focus.
  useEffect(() => {
    if (active) input.current?.focus();
  }, [active]);
  return (
    <div hidden={!active}>
      <pre aria-label="terminal output">{text}</pre>
      <input
        aria-label="terminal input"
        ref={input}
        onKeyDown={(e) => {
          if (isLeaderKey(e, leader)) return e.preventDefault();
          const data = KEYS[e.key] ?? (e.key.length === 1 ? e.key : "");
          if (data) {
            e.preventDefault();
            onData(data);
          }
        }}
      />
    </div>
  );
}
