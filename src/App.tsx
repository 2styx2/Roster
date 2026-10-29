// The app shell: connect to the Backend, then the Standard layout: the Sidebar, the Sessions'
// terminals (or an empty state), the Key bindings panel, the command line and the status bar.
// A Backend that can't start gets an error screen that says what to fix.
//
// Keys: the focus-mode machine (keyboard/mode.ts) decides whether a key is the terminal's or the
// app's; the app's keys are command lines run through the one command table (commands/table.ts),
// which is also what the command line and every button run. The commands, keymap and Sidebar
// sections are registries (ADR 0004), read live.
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { BackendStartError, type Backend, type BackendInfo, type BackendProblem, type HostList } from "./backend/types";
import { CommandLine } from "./cmdline/CommandLine";
import { complete, runLine, type CommandContext, type Commands } from "./commands/table";
import { ErrorScreen } from "./ErrorScreen";
import { BindingsPanel } from "./keyboard/BindingsPanel";
import { bindingRows } from "./keyboard/bindings";
import { press, terminalMode, type KeyState } from "./keyboard/mode";
import { chordOf, defaultOptions, keymapOf, type CommandLine as Line, type Keymap, type Options } from "./keymap";
import { Picker } from "./picker/Picker";
import { builtinRegistries, type Registries } from "./registries";
import { SessionPanes, TabStrip } from "./session/Sessions";
import { Tabs } from "./session/tabs";
import { allRows, moveCursor, Sidebar } from "./sidebar/Sidebar";
import { buildSections } from "./sidebar/sections";
import { TerminalView, type TerminalViewComponent } from "./terminal/TerminalView";
import { isLeaderKey } from "./terminal/keys";

type Conn =
  | { state: "connecting" }
  | { state: "failed"; problem: BackendProblem }
  | { state: "ready"; info: BackendInfo; hosts: HostList };

/** An overlay with its own input, which takes the keys while it's open. */
type Overlay = "picker" | "cmdline" | null;

const MODIFIERS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock"]);

function asProblem(e: unknown): BackendProblem {
  if (e instanceof BackendStartError) return e.problem;
  const message = e instanceof Error ? e.message : String(e);
  return { kind: "failed", message, hint: "Retry, or run the backend command in a terminal to see why.", detail: null };
}

/** The first key bound to `line` after the Leader, as the status bar hints write it. */
function hintFor(keymap: Keymap, line: Line): string | null {
  const key = Object.entries(keymap.leader).find(([, b]) => b.action === line)?.[0];
  return key ? `␣ ${key}` : null;
}

export interface AppProps {
  backend: Backend;
  options?: Options;
  /** Commands, keymap and Sidebar sections; the built-ins unless a test (or ticket 21) passes its own. */
  registries?: Registries;
  /** The terminal each Session draws in (tests pass a stub; xterm needs a real browser). */
  terminalView?: TerminalViewComponent;
}

export function App({ backend, options = defaultOptions, registries: given, terminalView = TerminalView }: AppProps) {
  const [registries] = useState(() => given ?? builtinRegistries());
  const commandList = useSyncExternalStore(registries.commands.subscribe, registries.commands.list);
  const bindingList = useSyncExternalStore(registries.keymap.subscribe, registries.keymap.list);
  const sectionDefs = useSyncExternalStore(registries.sidebar.subscribe, registries.sidebar.list);
  const commands: Commands = useMemo(
    () => ({ get: (id) => registries.commands.get(id), list: () => commandList }),
    [registries, commandList],
  );
  const keymap = useMemo(() => keymapOf(bindingList), [bindingList]);

  const [conn, setConn] = useState<Conn>({ state: "connecting" });
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  const [keyState, setKeyState] = useState<KeyState>(terminalMode);
  const keyRef = useRef<KeyState>(terminalMode);
  const [cursor, setCursor] = useState<string | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(options.sidebar.visible);
  const [statusVisible, setStatusVisible] = useState(options.statusBar.visible);
  const [message, setMessage] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [tabs] = useState(() => new Tabs(backend));
  const sessions = useSyncExternalStore(tabs.subscribe, tabs.snapshot);
  const mainRef = useRef<HTMLElement>(null);
  const returnFocus = useRef<Element | null>(null);

  const hosts = conn.state === "ready" ? conn.hosts : null;
  const hostByName = useMemo(() => new Map((hosts?.hosts ?? []).map((h) => [h.name, h])), [hosts]);
  const sections = useMemo(
    () => (hosts ? buildSections(sectionDefs, { sessions, hosts, hostByName, sessionsIn: options.sessions }) : []),
    [sectionDefs, sessions, hosts, hostByName, options.sessions],
  );
  const rows = useMemo(() => allRows(sections), [sections]);
  const sidebarShown = sidebarVisible && sections.length > 0;

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

  useEffect(() => {
    if (conn.state === "ready") mainRef.current?.focus();
  }, [conn.state]);

  // With the last Session closed, the keys need somewhere to go.
  const noSessions = sessions.tabs.length === 0;
  useEffect(() => {
    if (noSessions && (document.activeElement === document.body || document.activeElement === null)) {
      mainRef.current?.focus();
    }
  }, [noSessions]);

  // Closing the app ends every Session.
  useEffect(() => () => tabs.closeAll(), [tabs]);

  const setMode = useCallback((next: KeyState) => {
    keyRef.current = next;
    setKeyState(next);
  }, []);

  /** Remembers where focus was (the terminal), for when an overlay or panel closes. */
  const rememberFocus = () => {
    returnFocus.current = document.activeElement;
  };
  const restoreFocus = () => {
    const el = returnFocus.current;
    if (el instanceof HTMLElement && el.isConnected) el.focus();
    else mainRef.current?.focus();
  };

  const closeOverlay = () => {
    setOverlay(null);
    setMode(terminalMode);
    restoreFocus();
  };

  const closeKeys = () => {
    setKeysOpen(false);
    if (document.activeElement?.closest(".keys-panel")) restoreFocus();
  };

  // What commands act on. Rebuilt each render, so it always sees the current state.
  const ctx: CommandContext = {
    openPicker: () => {
      if (overlay === null) rememberFocus();
      setOverlay("picker");
    },
    connect: (name) => {
      const host = hostByName.get(name);
      if (!host) return setMessage(`No Host named ${name}`);
      if (!host.reviewed) return setMessage(`${name} isn't reviewed yet, so it can't be opened. Review it in roster first.`);
      setRecent((r) => [name, ...r.filter((n) => n !== name)]);
      tabs.open(name);
    },
    selectRelative: (delta) => tabs.selectRelative(delta),
    selectNth: (n) => tabs.selectNth(n),
    close: (n) => {
      const id = n === null ? sessions.active : (sessions.tabs[n - 1]?.id ?? null);
      if (id !== null) tabs.close(id);
    },
    toggleSidebar: () => setSidebarVisible((v) => !v),
    toggleStatusBar: () => setStatusVisible((v) => !v),
    openCommandLine: () => {
      if (overlay === null) rememberFocus();
      setOverlay("cmdline");
    },
    toggleKeys: () => {
      if (keysOpen) return closeKeys();
      rememberFocus();
      setKeysOpen(true);
    },
    lock: () => setMessage("Lock isn't built yet (ticket 04)."),
    toTerminal: () => setMode(terminalMode),
    list: (move) => {
      if (move !== "choose") return setCursor(moveCursor(rows, cursor, move));
      const row = rows.find((r) => r.id === cursor);
      setMode(terminalMode);
      if (row) run(row.command);
    },
    say: setMessage,
  };

  function run(line: Line) {
    setMessage("");
    runLine(commands, ctx, line);
  }

  const staysInAppMode = (line: Line) => commands.get(line.split(" ")[0] ?? "")?.staysInAppMode ?? false;

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (MODIFIERS.has(e.key)) return;
    // An overlay (the Picker, the command line, the bindings filter) opens in Terminal mode, so its
    // input gets the keys as a terminal would, until the Leader.
    const leaderKey = isLeaderKey(e, options.leader);
    const chord = leaderKey ? options.leader : chordOf(e);
    const before = keyRef.current;
    const r = press(before, chord, { keymap, leader: options.leader, vim: options.vim, staysInAppMode });
    if (!r.consumed) return;
    e.preventDefault();
    e.stopPropagation();
    if (before.mode === "terminal" && r.state.mode === "app") {
      setCursor(rows.find((row) => row.raised)?.id ?? rows[0]?.id ?? null);
    }
    setMode(r.state);
    if (r.action) run(r.action);
  });

  // Caught before anything else sees it, the terminal included (capture phase on window).
  const ready = conn.state === "ready";
  useEffect(() => {
    if (!ready) return;
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [ready]);

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

  const { info } = conn;
  const appMode = keyState.mode === "app" && overlay === null;
  const hints = [
    [hintFor(keymap, "find"), "find"],
    [hintFor(keymap, "keys"), "keys"],
    [hintFor(keymap, "statusbar"), "hide this bar"],
  ].filter(([k]) => k);

  return (
    <div className={`screen app ${appMode ? "mode-app" : "mode-terminal"}`}>
      <div className={`body sidebar-${options.sidebar.side}`}>
        {sidebarShown && (
          <Sidebar
            sections={sections}
            side={options.sidebar.side}
            cursor={appMode ? cursor : null}
            leaderHint={options.leader}
            run={(line) => {
              setMode(terminalMode);
              run(line);
            }}
          />
        )}
        <main
          className="workspace"
          ref={mainRef}
          tabIndex={-1}
          aria-label="Workspace"
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).closest(".pane")) setMode(terminalMode);
          }}
        >
          {options.sessions === "tabs" && !noSessions && <TabStrip snapshot={sessions} run={run} />}
          {noSessions ? (
            <div className="empty">
              <p>No Sessions open.</p>
              <button type="button" className="find" onClick={() => run("find")}>
                Find a host
              </button>
              <p className="muted">
                or press <kbd>{options.leader}</kbd> then <kbd>f</kbd>
              </p>
            </div>
          ) : (
            <SessionPanes tabs={tabs} snapshot={sessions} leader={options.leader} terminalView={terminalView} />
          )}
        </main>
        {keysOpen && (
          <BindingsPanel rows={bindingRows(keymap, options, commands)} leader={options.leader} onClose={closeKeys} />
        )}
      </div>
      {overlay === "cmdline" && (
        <CommandLine
          complete={(input) => complete(commands, input, hosts?.hosts.map((h) => h.name) ?? [])}
          onClose={closeOverlay}
          onRun={(line) => {
            closeOverlay();
            run(line);
          }}
        />
      )}
      <div className="message-line" role="status">
        {message}
      </div>
      {statusVisible && (
        <footer className="statusbar">
          <span className="backend">{info.backend}</span>
          <span>{info.inventory.box}</span>
          <span>{conn.hosts.hosts.length} hosts</span>
          <span className="path" title={info.command.join(" ")}>
            {info.inventory.path}
          </span>
          <span className="grow" />
          {hints.map(([k, what]) => (
            <span key={what} className="hint">
              <b>{k}</b> {what}
            </span>
          ))}
          {appMode && (
            <span className="mode">
              APP{keyState.pending.length > 0 && <span className="pending"> {keyState.pending.join(" ")}</span>}
            </span>
          )}
        </footer>
      )}
      {overlay === "picker" && (
        <Picker
          hosts={conn.hosts}
          recent={recent}
          vim={options.vim}
          keymap={keymap}
          onClose={closeOverlay}
          onOpen={(host) => {
            closeOverlay();
            run(`connect ${host.name}`);
          }}
        />
      )}
    </div>
  );
}
