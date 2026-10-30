// One Session's terminal: xterm.js with the WebGL renderer (the DOM renderer when WebGL isn't
// there or its context is lost), fit, and search. Every key goes to the shell except the Leader
// and the keymap's `terminal` chords (copy, paste, find, zoom); see docs/dev/xterm-setup.md.
// Nothing is added to or rewritten in what the shell prints (decision Q37). Tests substitute a
// stub for this component (App's `terminalView`).
import { useEffect, useRef, useState } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import type { TermSize } from "../backend/types";
import { chordOf, type Action } from "../keymap";
import type { Clipboard } from "../platform/types";
import { isLeaderKey } from "./keys";
import type { TerminalOptions, TerminalTheme, ZoomAction } from "./options";
import { SearchBar, type SearchResults } from "./SearchBar";

/** What every terminal shares: options, keys and the machine's services. One object, so the
 * Session list only passes it through. */
export interface TerminalEnv {
  options: TerminalOptions;
  /** The colours: the Theme's, with the options' `colors` over them. */
  theme: TerminalTheme;
  /** The current (zoomed) font size. */
  fontSize: number;
  /** For xterm's ConPTY handling; null off Windows (or not known yet). */
  windowsBuild: number | null;
  /** The keymap's `terminal` table: chords caught before the shell. */
  keys: Record<string, Action>;
  clipboard: Clipboard;
  /** A zoom key or Ctrl+wheel: the app owns the font size, so every terminal follows. */
  onZoom(action: ZoomAction): void;
  /** The view mode and the pieces around the terminal: when it changes, the terminal fits
   * itself again and tells the Session (Focus mode, ticket 22). */
  layout: string;
}

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
  env: TerminalEnv;
}

export type TerminalViewComponent = (props: TerminalViewProps) => React.ReactNode;

/** The theme without the app's own entries (search highlights), as xterm takes it. */
function xtermTheme(t: TerminalTheme): ITheme {
  const theme: Partial<TerminalTheme> = { ...t };
  delete theme.searchMatch;
  delete theme.searchActiveMatch;
  return theme;
}

export function TerminalView({ active, leader, attach, onData, onResize, env }: TerminalViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const search = useRef<SearchAddon | null>(null);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResults | null>(null);
  // Latest props, read by handlers registered once.
  const cb = useRef({ leader, onData, onResize, env, openSearch: () => {} });
  useEffect(() => {
    cb.current = { leader, onData, onResize, env, openSearch: () => setSearching(true) };
  });

  useEffect(() => {
    const host = el.current;
    if (!host) return;
    const { options } = cb.current.env;
    const t = new Terminal({
      scrollback: options.scrollback,
      allowProposedApi: true,
      fontFamily: options.fontFamily,
      fontSize: cb.current.env.fontSize,
      lineHeight: options.lineHeight,
      theme: xtermTheme(cb.current.env.theme),
    });
    const f = new FitAddon();
    const s = new SearchAddon();
    t.loadAddon(f);
    t.loadAddon(s);
    t.open(host);
    // data-renderer says which one it got (for `:info` later, and devtools now). WebGL comes
    // and goes with `active` (below).
    host.dataset.renderer = "dom";

    const copy = () => {
      const text = t.getSelection();
      if (text) void cb.current.env.clipboard.writeText(text).catch(() => {});
      return Boolean(text);
    };
    const paste = () => {
      void cb.current.env.clipboard
        .readText()
        .then((text) => text && t.paste(text))
        .catch(() => {});
    };

    // The Leader never reaches the shell (Ctrl+Space would send NUL); App's keymap acts on it.
    // The keymap's terminal chords don't either; they act on keydown only.
    t.attachCustomKeyEventHandler((e) => {
      if (isLeaderKey(e, cb.current.leader)) {
        e.preventDefault();
        return false;
      }
      const action = cb.current.env.keys[chordOf(e)];
      if (!action?.startsWith("terminal.")) return true;
      e.preventDefault();
      if (e.type !== "keydown") return false;
      switch (action) {
        case "terminal.copy":
          copy();
          break;
        case "terminal.paste":
          paste();
          break;
        case "terminal.search":
          cb.current.openSearch();
          break;
        case "terminal.zoomIn":
        case "terminal.zoomOut":
        case "terminal.zoomReset":
          cb.current.env.onZoom(action);
          break;
      }
      return false;
    });

    // Select to copy (xterm has no option for it).
    let copyTimer: ReturnType<typeof setTimeout> | undefined;
    const onSelection = t.onSelectionChange(() => {
      if (!cb.current.env.options.copyOnSelect) return;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(copy, 120);
    });
    // Right-click: copy the selection, or paste when there's none (as Windows Terminal).
    const onContextMenu = (e: MouseEvent) => {
      if (!cb.current.env.options.rightClickCopyPaste) return;
      e.preventDefault();
      if (t.hasSelection()) {
        copy();
        t.clearSelection();
      } else {
        paste();
      }
      t.focus();
    };
    // Ctrl+wheel zooms the terminal, not the page.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || e.deltaY === 0) return;
      e.preventDefault();
      e.stopPropagation();
      cb.current.env.onZoom(e.deltaY < 0 ? "terminal.zoomIn" : "terminal.zoomOut");
    };
    host.addEventListener("contextmenu", onContextMenu);
    host.addEventListener("wheel", onWheel, { capture: true, passive: false });

    const subs = [
      onSelection,
      t.onData((d) => cb.current.onData(d)),
      t.onResize(({ cols, rows }) => cb.current.onResize({ cols, rows })),
      s.onDidChangeResults(({ resultIndex, resultCount }) => setResults({ index: resultIndex, count: resultCount })),
    ];
    const detach = attach((d) => t.write(d));
    term.current = t;
    fit.current = f;
    search.current = s;

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
      clearTimeout(copyTimer);
      observer.disconnect();
      host.removeEventListener("contextmenu", onContextMenu);
      host.removeEventListener("wheel", onWheel, { capture: true });
      detach();
      for (const sub of subs) sub.dispose();
      t.dispose();
      term.current = null;
      fit.current = null;
      search.current = null;
    };
    // attach belongs to this tab for its whole life
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The WebGL renderer only while the terminal is on screen. A browser keeps about 16 WebGL
  // contexts and drops the oldest past that, so 50 open Sessions each holding one left blank,
  // lost canvases behind (ticket 27). A hidden terminal draws nothing, so it gives its context
  // back and the DOM renderer keeps its state; showing it again takes a fresh one.
  const noWebgl = useRef(false);
  useEffect(() => {
    const t = term.current;
    const host = el.current;
    if (!active || !t || !host || noWebgl.current) return;
    let webgl: WebglAddon | null = null;
    const drop = () => {
      webgl?.dispose();
      webgl = null;
      host.dataset.renderer = "dom";
    };
    try {
      webgl = new WebglAddon();
      webgl.onContextLoss(drop);
      t.loadAddon(webgl);
      host.dataset.renderer = "webgl";
    } catch {
      // no WebGL2: the DOM renderer it is, for good
      noWebgl.current = true;
      webgl = null;
    }
    return drop;
  }, [active]);

  // ConPTY sits between us and the shell on Windows (WSL included); xterm adapts its reflow to
  // the real build (>= 21376 keeps reflow on).
  const { windowsBuild, fontSize, options, theme } = env;
  useEffect(() => {
    const t = term.current;
    if (!t) return;
    t.options.windowsPty = windowsBuild === null ? {} : { backend: "conpty", buildNumber: windowsBuild };
  }, [windowsBuild]);

  useEffect(() => {
    const t = term.current;
    if (!t) return;
    t.options.fontFamily = options.fontFamily;
    t.options.lineHeight = options.lineHeight;
    t.options.theme = xtermTheme(theme);
    if (t.options.fontSize !== fontSize) t.options.fontSize = fontSize;
    if (el.current?.offsetParent !== null) fit.current?.fit();
  }, [fontSize, options, theme]);

  // A view mode change resizes the window (OS fullscreen) after the layout does, so fit again
  // once it has settled; the ResizeObserver catches most of it, this catches the rest.
  const { layout } = env;
  const firstLayout = useRef(true);
  useEffect(() => {
    if (firstLayout.current) {
      firstLayout.current = false;
      return;
    }
    const t = term.current;
    if (!active || !t) return;
    const refit = () => {
      if (el.current?.offsetParent === null) return;
      fit.current?.fit();
      cb.current.onResize({ cols: t.cols, rows: t.rows });
    };
    const frame = requestAnimationFrame(refit);
    const late = setTimeout(refit, 300);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(late);
    };
  }, [layout, active]);

  useEffect(() => {
    const t = term.current;
    if (!active || !t) return;
    fit.current?.fit();
    cb.current.onResize({ cols: t.cols, rows: t.rows });
    t.focus();
  }, [active]);

  function find(query: string, direction: "next" | "previous", incremental: boolean) {
    const s = search.current;
    if (!s) return;
    if (!query) {
      s.clearDecorations();
      setResults(null);
      return;
    }
    const { searchMatch, searchActiveMatch } = env.theme;
    const opts = {
      decorations: {
        matchBackground: searchMatch,
        matchOverviewRuler: searchMatch,
        activeMatchBackground: searchActiveMatch,
        activeMatchColorOverviewRuler: searchActiveMatch,
      },
    };
    // Scrollback is above, so "previous" walks up, as in Windows Terminal. While typing, start
    // again from the bottom: the newest match of what's typed so far.
    if (incremental) term.current?.clearSelection();
    if (direction === "previous") s.findPrevious(query, opts);
    else s.findNext(query, opts);
  }

  function closeSearch() {
    search.current?.clearDecorations();
    term.current?.clearSelection();
    setSearching(false);
    setResults(null);
    term.current?.focus();
  }

  return (
    <div className="term-wrap">
      <div className="term-host" ref={el} />
      {searching && active && <SearchBar results={results} onFind={find} onClose={closeSearch} />}
    </div>
  );
}
