// A stand-in for TerminalView in UI tests (xterm needs a real browser): shows the Session's
// output as text, and its input sends keys the way xterm would, keeping the Leader back. (Copy,
// paste, find and zoom need xterm itself: they're checked by hand, see ticket 08.)
import { useEffect, useRef, useState } from "react";
import type { TerminalViewProps } from "./TerminalView";
import { isLeaderKey } from "./keys";

const KEYS: Record<string, string> = { Escape: "\x1b", Enter: "\r" };

export function StubTerminal({ active, leader, attach, onData }: TerminalViewProps) {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => attach((d) => setText((t) => t + new TextDecoder().decode(d))), [attach]);
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
