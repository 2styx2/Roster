// The app shell: connect to the Backend, then Session tabs (or an empty state) with the Picker on
// <leader> f or a click; Enter there opens a Session in a new tab. A Backend that can't start gets
// an error screen that says what to fix.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { BackendStartError, type Backend, type BackendInfo, type BackendProblem, type HostList } from "./backend/types";
import { chordOf, defaultKeymap, defaultOptions, type Keymap, type Options } from "./keymap";
import { Picker } from "./picker/Picker";
import { ErrorScreen } from "./ErrorScreen";
import { Sessions } from "./session/Sessions";
import { Tabs } from "./session/tabs";
import { TerminalView, type TerminalEnv, type TerminalViewComponent } from "./terminal/TerminalView";
import { isLeaderKey } from "./terminal/keys";
import { defaultTerminalOptions, zoom, type TerminalOptions, type ZoomAction } from "./terminal/options";
import { memoryPlatform } from "./platform/memory";
import type { Platform } from "./platform/types";
import { emptyState, parseState, usedHost, type AppState } from "./state/appState";

type Conn =
  | { state: "connecting" }
  | { state: "failed"; problem: BackendProblem }
  | { state: "ready"; info: BackendInfo; hosts: HostList };

const MODIFIERS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock"]);

function asProblem(e: unknown): BackendProblem {
  if (e instanceof BackendStartError) return e.problem;
  const message = e instanceof Error ? e.message : String(e);
  return { kind: "failed", message, hint: "Retry, or run the backend command in a terminal to see why.", detail: null };
}

export interface AppProps {
  backend: Backend;
  options?: Options;
  keymap?: Keymap;
  /** The terminal each Session tab draws in (tests pass a stub; xterm needs a real browser). */
  terminalView?: TerminalViewComponent;
  terminalOptions?: TerminalOptions;
  /** The State file, clipboard and Windows build (tests: an in-memory one). */
  platform?: Platform;
}

/** The keys after the Leader that do `action`, as the user would type them ("Ctrl+Space r"). */
function leaderKeysFor(keymap: Keymap, leader: string, action: string): string | null {
  const key = Object.entries(keymap.leader).find(([, a]) => a === action)?.[0];
  return key ? `${leader} ${key}` : null;
}

export function App({
  backend,
  options = defaultOptions,
  keymap = defaultKeymap,
  terminalView = TerminalView,
  terminalOptions = defaultTerminalOptions,
  platform: platformProp,
}: AppProps) {
  const [platform] = useState(() => platformProp ?? memoryPlatform());
  const [conn, setConn] = useState<Conn>({ state: "connecting" });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [leader, setLeader] = useState(false);
  const [appState, setAppState] = useState<AppState>(emptyState);
  const [fontSize, setFontSize] = useState(terminalOptions.fontSize);
  const [windowsBuild, setWindowsBuild] = useState<number | null>(null);
  const [tabs] = useState(() => new Tabs(backend));
  const sessions = useSyncExternalStore(tabs.subscribe, tabs.snapshot);
  const mainRef = useRef<HTMLElement>(null);
  const returnFocus = useRef<Element | null>(null);

  const connect = useCallback(
    async (restart: boolean) => {
      setConn({ state: "connecting" });
      try {
        const info = await backend.connect(restart ? { restart: true } : undefined);
        const hosts = await backend.listHosts();
        setConn({ state: "ready", info, hosts });
      } catch (e) {
        setConn({ state: "failed", problem: asProblem(e) });
      }
    },
    [backend],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- connecting is the effect
    void connect(false);
  }, [connect]);

  // The State file and the Windows build, once. Hosts picked before the file is read stay first.
  useEffect(() => {
    let live = true;
    platform.loadState().then(
      (json) => {
        if (!live) return;
        const loaded = parseState(json);
        setAppState((now) => now.recentHosts.reduceRight(usedHost, loaded));
      },
      () => {},
    );
    platform.windowsBuild().then(
      (build) => live && setWindowsBuild(build),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [platform]);

  const onZoom = useCallback(
    (action: ZoomAction) => setFontSize((size) => zoom(terminalOptions, size, action)),
    [terminalOptions],
  );
  const terminalEnv = useMemo<TerminalEnv>(
    () => ({
      options: terminalOptions,
      fontSize,
      windowsBuild,
      keys: keymap.terminal,
      clipboard: platform.clipboard,
      onZoom,
    }),
    [terminalOptions, fontSize, windowsBuild, keymap, platform, onZoom],
  );

  const stateChanged = useRef(false);
  const openHost = useCallback(
    (host: string, here: boolean) => {
      const current = tabs.snapshot().active;
      if (!(here && current !== null && tabs.reconnect(current, host))) tabs.open(host);
      stateChanged.current = true;
      setAppState((s) => usedHost(s, host));
    },
    [tabs],
  );

  // Write the State file after the user changed something (not after loading it).
  useEffect(() => {
    if (!stateChanged.current) return;
    stateChanged.current = false;
    void platform.saveState(appState).catch(() => {});
  }, [appState, platform]);

  useEffect(() => {
    if (conn.state === "ready") mainRef.current?.focus();
  }, [conn.state]);

  // Closing the app ends every Session.
  useEffect(() => () => tabs.closeAll(), [tabs]);

  const openPicker = useCallback(() => {
    returnFocus.current = document.activeElement;
    setPickerOpen(true);
  }, []);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    const el = returnFocus.current;
    if (el instanceof HTMLElement) el.focus();
  }, []);

  // The Leader: caught before anything else sees it (a terminal will sit under this later).
  useEffect(() => {
    if (conn.state !== "ready") return;
    function onKey(e: KeyboardEvent) {
      const chord = chordOf(e);
      if (isLeaderKey(e, options.leader)) {
        e.preventDefault();
        e.stopPropagation();
        setLeader(true);
        return;
      }
      if (!leader || MODIFIERS.has(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      setLeader(false);
      const action = keymap.leader[chord];
      if (action === "picker.open") openPicker();
      else if (action === "session.reconnect") {
        const current = tabs.snapshot().active;
        if (current !== null) tabs.reconnect(current);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [conn.state, leader, options.leader, keymap, openPicker, tabs]);

  if (conn.state === "connecting") {
    return (
      <div className="screen center">
        <p className="muted">Starting the backend…</p>
      </div>
    );
  }
  if (conn.state === "failed") {
    return <ErrorScreen problem={conn.problem} onRetry={() => void connect(true)} />;
  }

  const { info, hosts } = conn;
  return (
    <div className="screen app">
      <main className="workspace" ref={mainRef} tabIndex={-1} aria-label="Workspace">
        {sessions.tabs.length > 0 ? (
          <Sessions
            tabs={tabs}
            snapshot={sessions}
            leader={options.leader}
            terminalView={terminalView}
            terminalEnv={terminalEnv}
            reconnectKeys={leaderKeysFor(keymap, options.leader, "session.reconnect")}
          />
        ) : (
          <div className="empty">
            <p>No Sessions open.</p>
            <button type="button" className="find" onClick={openPicker}>
              Find a host
            </button>
            <p className="muted">
              or press <kbd>{options.leader}</kbd> then <kbd>f</kbd>
            </p>
          </div>
        )}
      </main>
      <footer className="statusbar">
        <span className="backend">{info.backend}</span>
        <span>{info.inventory.box}</span>
        <span>{hosts.hosts.length} hosts</span>
        <span className="path" title={info.command.join(" ")}>
          {info.inventory.path}
        </span>
        {leader && <span className="leader">LEADER</span>}
      </footer>
      {pickerOpen && (
        <Picker
          hosts={hosts}
          recent={appState.recentHosts}
          vim={options.vim}
          keymap={keymap}
          onClose={closePicker}
          onOpen={(host, how) => {
            closePicker();
            openHost(host.name, how?.here ?? false);
          }}
        />
      )}
    </div>
  );
}
