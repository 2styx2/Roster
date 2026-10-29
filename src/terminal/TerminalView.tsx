// One Session's terminal: xterm.js with the WebGL renderer (the DOM renderer when WebGL isn't
// there or its context is lost) and the fit addon. Every key goes to the shell except the Leader
// (docs/dev/xterm-setup.md). Tests substitute a stub for this component (App's `terminalView`).
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import type { TermSize } from "../backend/types";
import { isLeaderKey } from "./keys";

export interface TerminalViewProps {
  /** The visible tab: it fits itself and takes focus. */
  active: boolean;
  /** The Leader chord, caught before the shell sees it. */
  leader: string;
  /** Routes the Session's output (from the start) here; returns detach. */
  attach(sink: (data: Uint8Array) => void): () => void;
  /** Keys and pastes for the shell. */
  onData(data: string): void;
  onResize(size: TermSize): void;
}

export type TerminalViewComponent = (props: TerminalViewProps) => React.ReactNode;

const onWindows = typeof navigator !== "undefined" && /Windows/.test(navigator.userAgent);

export function TerminalView({ active, leader, attach, onData, onResize }: TerminalViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  // Latest callbacks, read by handlers registered once.
  const cb = useRef({ leader, onData, onResize });
  useEffect(() => {
    cb.current = { leader, onData, onResize };
  });

  useEffect(() => {
    const host = el.current;
    if (!host) return;
    const t = new Terminal({
      scrollback: 10000,
      allowProposedApi: true,
      fontFamily: '"Cascadia Mono", "JetBrains Mono", Consolas, ui-monospace, monospace',
      fontSize: 14,
      theme: { background: "#16181d" },
      // ConPTY sits between us and WSL; 22000 (Windows 11) keeps reflow on. The real build
      // number from Rust is a ticket 08 refinement.
      ...(onWindows ? { windowsPty: { backend: "conpty", buildNumber: 22000 } } : {}),
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(host);
    // data-renderer says which one it got (for `:info` later, and devtools now).
    host.dataset.renderer = "dom";
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl.dispose();
        host.dataset.renderer = "dom";
      });
      t.loadAddon(webgl);
      host.dataset.renderer = "webgl";
    } catch {
      // no WebGL2: the DOM renderer it is
    }
    // The Leader never reaches the shell (Ctrl+Space would send NUL); App's keymap acts on it.
    t.attachCustomKeyEventHandler((e) => {
      if (isLeaderKey(e, cb.current.leader)) {
        e.preventDefault();
        return false;
      }
      return true;
    });
    const subs = [
      t.onData((d) => cb.current.onData(d)),
      t.onResize(({ cols, rows }) => cb.current.onResize({ cols, rows })),
    ];
    const detach = attach((d) => t.write(d));
    term.current = t;
    fit.current = f;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (host.offsetParent !== null) f.fit();
      }, 30);
    });
    observer.observe(host);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      detach();
      for (const s of subs) s.dispose();
      t.dispose();
      term.current = null;
      fit.current = null;
    };
    // attach belongs to this tab for its whole life
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = term.current;
    if (!active || !t) return;
    fit.current?.fit();
    cb.current.onResize({ cols: t.cols, rows: t.rows });
    t.focus();
  }, [active]);

  return <div className="term-host" ref={el} />;
}
