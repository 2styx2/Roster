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
import {
  BackendStartError,
  CHECK_API_VERSION,
  type Backend,
  type BackendInfo,
  type BackendProblem,
  type HostList,
} from "./backend/types";
import { CommandLine } from "./cmdline/CommandLine";
import { complete, runLine, type CommandContext, type Commands, type FoldHow } from "./commands/table";
import { registerFolders } from "./folders/folders";
import { ErrorScreen } from "./ErrorScreen";
import { CheckPanel, type CheckState } from "./errors/CheckPanel";
import { BindingsPanel } from "./keyboard/BindingsPanel";
import { bindingRows } from "./keyboard/bindings";
import { press, terminalMode, type KeyState } from "./keyboard/mode";
import type { Clock } from "./lock/idle";
import { LockGate } from "./lock/LockScreen";
import { useVault } from "./lock/useVault";
import { actionsOf, chordOf, defaultOptions, keymapOf, type CommandLine as Line, type Keymap, type Options } from "./keymap";
import { Picker } from "./picker/Picker";
import { builtinRegistries, type Registries } from "./registries";
import { SessionPanes, TabStrip } from "./session/Sessions";
import { Tabs } from "./session/tabs";
import { allRows, moveCursor, Sidebar } from "./sidebar/Sidebar";
import { buildSections } from "./sidebar/sections";
import { TerminalView, type TerminalEnv, type TerminalViewComponent } from "./terminal/TerminalView";
import { isLeaderKey } from "./terminal/keys";
import { defaultTerminalOptions, zoom, type TerminalOptions, type ZoomAction } from "./terminal/options";
import { memoryPlatform } from "./platform/memory";
import type { Platform } from "./platform/types";
import { setFolded, usedHost } from "./state/appState";
import { StateStore } from "./state/store";

type Conn =
  | { state: "connecting" }
  | { state: "failed"; problem: BackendProblem }
  | { state: "ready"; info: BackendInfo; hosts: HostList };

/** An overlay with its own input, which takes the keys while it's open. */
type Overlay = "picker" | { cmdline: string } | null;

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
  /** For the idle lock; tests pass a manual one. */
  clock?: Clock;
  /** The terminal each Session draws in (tests pass a stub; xterm needs a real browser). */
  terminalView?: TerminalViewComponent;
  terminalOptions?: TerminalOptions;
  /** The State file, clipboard and Windows build (tests: an in-memory one). */
  platform?: Platform;
}

export function App({
  backend,
  options = defaultOptions,
  registries: given,
  clock,
  terminalView = TerminalView,
  terminalOptions = defaultTerminalOptions,
  platform: platformProp,
}: AppProps) {
  const [registries] = useState(() => given ?? builtinRegistries());
  const [platform] = useState(() => platformProp ?? memoryPlatform());
  const commandList = useSyncExternalStore(registries.commands.subscribe, registries.commands.list);
  const bindingList = useSyncExternalStore(registries.keymap.subscribe, registries.keymap.list);
  const sectionDefs = useSyncExternalStore(registries.sidebar.subscribe, registries.sidebar.list);
  const errorRows = useSyncExternalStore(registries.errors.subscribe, registries.errors.list);
  const commands: Commands = useMemo(
    () => ({ get: (id) => registries.commands.get(id), list: () => commandList }),
    [registries, commandList],
  );
  const keymap = useMemo(() => keymapOf(bindingList), [bindingList]);

  const [conn, setConn] = useState<Conn>({ state: "connecting" });
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  const [check, setCheck] = useState<CheckState | null>(null);
  const checkRun = useRef(0);
  const [keyState, setKeyState] = useState<KeyState>(terminalMode);
  const keyRef = useRef<KeyState>(terminalMode);
  const [cursor, setCursor] = useState<string | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(options.sidebar.visible);
  const [statusVisible, setStatusVisible] = useState(options.statusBar.visible);
  const [message, setMessage] = useState("");
  const [store] = useState(() => new StateStore(platform));
  const appState = useSyncExternalStore(store.subscribe, store.snapshot);
  const [fontSize, setFontSize] = useState(terminalOptions.fontSize);
  const [windowsBuild, setWindowsBuild] = useState<number | null>(null);
  const [tabs] = useState(() => new Tabs(backend));
  const sessions = useSyncExternalStore(tabs.subscribe, tabs.snapshot);
  const mainRef = useRef<HTMLElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const vault = useVault(backend, conn.state === "ready", { idleMs: options.idleLockMinutes * 60_000, clock });
  // A password Host whose vault turns out locked (session.prepare code 14) brings up the lock
  // screen; the tab opens by itself once the vault is unlocked again.
  useEffect(() => tabs.setVaultLockedHandler(() => void vault.lock()), [tabs, vault]);
  const vaultUnlocked = vault.view.state === "unlocked";
  useEffect(() => {
    if (vaultUnlocked) tabs.resumeAfterUnlock();
  }, [vaultUnlocked, tabs]);

  const hosts = conn.state === "ready" ? conn.hosts : null;
  const hostByName = useMemo(() => new Map((hosts?.hosts ?? []).map((h) => [h.name, h])), [hosts]);
  const folded = useMemo(() => new Set(appState.folded), [appState.folded]);
  const sections = useMemo(
    () =>
      hosts
        ? buildSections(sectionDefs, { sessions, hosts, hostByName, sessionsIn: options.sessions, state: appState, folded })
        : [],
    [sectionDefs, sessions, hosts, hostByName, options.sessions, appState, folded],
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

  // The State file and the Windows build, once. What changed before the file was read (Hosts
  // picked) is replayed over it.
  useEffect(() => {
    let live = true;
    void store.load();
    platform.windowsBuild().then(
      (build) => live && setWindowsBuild(build),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [platform, store]);

  // Folders (GLOSSARY) register their section, commands and keys like a Plugin (ADR 0004).
  useEffect(() => registerFolders(registries, store), [registries, store]);

  const onZoom = useCallback(
    (action: ZoomAction) => setFontSize((size) => zoom(terminalOptions, size, action)),
    [terminalOptions],
  );
  const terminalKeys = useMemo(() => actionsOf(keymap.terminal), [keymap]);
  const terminalEnv = useMemo<TerminalEnv>(
    () => ({ options: terminalOptions, fontSize, windowsBuild, keys: terminalKeys, clipboard: platform.clipboard, onZoom }),
    [terminalOptions, fontSize, windowsBuild, terminalKeys, platform, onZoom],
  );

  const openHost = useCallback(
    (host: string, here: boolean) => {
      const current = tabs.snapshot().active;
      if (!(here && current !== null && tabs.reconnect(current, host))) tabs.open(host);
      store.update((s) => usedHost(s, host));
    },
    [tabs, store],
  );

  useEffect(() => {
    if (conn.state === "ready" && !vault.locked) mainRef.current?.focus();
  }, [conn.state, vault.locked]);

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

  const cursorRow = () => rows.find((r) => r.id === cursor) ?? null;

  /** h, l and the chevrons: fold or unfold a row, or move to its parent or first child. */
  const fold = (id: string | null, how: FoldHow) => {
    const row = id === null ? cursorRow() : (rows.find((r) => r.id === id) ?? null);
    const target = id ?? row?.id;
    if (!target) return;
    const isFolded = row ? row.folded === true : folded.has(target);
    const foldable = row ? row.foldable === true : true;
    if (foldable && (how === "toggle" || (how === "fold") !== isFolded)) {
      const next = how === "toggle" ? !isFolded : how === "fold";
      store.update((s) => setFolded(s, target, next));
      // The cursor doesn't vanish into a folded row.
      if (next && cursor !== null && ancestorsOf(cursor).includes(target)) setCursor(target);
      return;
    }
    if (id !== null || !row) return;
    if (how === "fold" && row.parent) setCursor(row.parent);
    if (how === "unfold" && foldable) {
      const child = rows[rows.indexOf(row) + 1];
      if (child?.parent === row.id) setCursor(child.id);
    }
  };
  const ancestorsOf = (id: string): string[] => {
    const out: string[] = [];
    for (let r = rows.find((x) => x.id === id); r?.parent; r = rows.find((x) => x.id === r?.parent)) out.push(r.parent);
    return out;
  };

  // What commands act on. Rebuilt each render, so it always sees the current state.
  const ctx: CommandContext = {
    openPicker: () => {
      if (overlay === null) rememberFocus();
      setOverlay("picker");
    },
    connect: (name, here = false) => {
      const host = hostByName.get(name);
      if (!host) return setMessage(`No Host named ${name}`);
      if (!host.reviewed) return setMessage(`${name} isn't reviewed yet, so it can't be opened. Review it in roster first.`);
      openHost(name, here);
    },
    open: (name) => {
      const tab = sessions.tabs.find((t) => t.host === name);
      if (tab) tabs.select(tab.id);
      else ctx.connect(name);
    },
    reconnect: () => {
      if (sessions.active !== null) tabs.reconnect(sessions.active);
    },
    check: (name) => {
      const host = name ?? sessions.tabs.find((t) => t.id === sessions.active)?.host;
      if (!host) return setMessage("check needs a Host name (no Session is open)");
      if (!hostByName.has(host)) return setMessage(`No Host named ${host}`);
      const api = conn.state === "ready" ? conn.info.inventory.api_version : 0;
      if (api < CHECK_API_VERSION) {
        return setMessage(`:check needs a newer roster (API version ${CHECK_API_VERSION}; this one speaks ${api})`);
      }
      const run = ++checkRun.current;
      setCheck({ state: "running", host });
      backend.checkHost(host).then(
        (result) => run === checkRun.current && setCheck({ state: "done", host, result }),
        (e: unknown) =>
          run === checkRun.current &&
          setCheck({ state: "error", host, message: e instanceof Error ? e.message : String(e) }),
      );
    },
    selectRelative: (delta) => tabs.selectRelative(delta),
    selectNth: (n) => tabs.selectNth(n),
    close: (n) => {
      const id = n === null ? sessions.active : (sessions.tabs[n - 1]?.id ?? null);
      if (id !== null) tabs.close(id);
    },
    toggleSidebar: () => setSidebarVisible((v) => !v),
    toggleStatusBar: () => setStatusVisible((v) => !v),
    openCommandLine: (initial = "") => {
      if (overlay === null) rememberFocus();
      setOverlay({ cmdline: initial });
    },
    toggleKeys: () => {
      if (keysOpen) return closeKeys();
      rememberFocus();
      setKeysOpen(true);
    },
    lock: () => {
      if (!vault.lock()) setMessage("Nothing to lock: no Host Login uses a vault with a master password.");
    },
    toTerminal: () => setMode(terminalMode),
    list: (move) => {
      if (move !== "choose") return setCursor(moveCursor(rows, cursor, move));
      const row = rows.find((r) => r.id === cursor);
      // Enter on a group, Folder or heading folds it and stays in the Sidebar.
      setMode(row && staysInAppMode(row.command) ? { mode: "app", pending: [] } : terminalMode);
      if (row) run(row.command);
    },
    fold,
    cursorRow,
    selectedHost: () => {
      const row = cursorRow();
      if (row?.host) return row.host;
      return sessions.tabs.find((t) => t.id === sessions.active)?.host ?? null;
    },
    hostNames: () => hosts?.hosts.map((h) => h.name) ?? [],
    say: setMessage,
  };

  const copy = (text: string) => platform.clipboard.writeText(text);

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

  // Caught before anything else sees it, the terminal included (capture phase on window). While
  // locked, keys belong to the lock screen alone.
  const ready = conn.state === "ready" && !vault.locked;
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
  const reconnectKey = hintFor(keymap, "reconnect");
  const appMode = keyState.mode === "app" && overlay === null;
  const hints = [
    [hintFor(keymap, "find"), "find"],
    [hintFor(keymap, "keys"), "keys"],
    [hintFor(keymap, "statusbar"), "hide this bar"],
  ].filter(([k]) => k);

  const shell = (
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
            <SessionPanes
              tabs={tabs}
              snapshot={sessions}
              leader={options.leader}
              terminalView={terminalView}
              terminalEnv={terminalEnv}
              reconnectKeys={reconnectKey ? `${options.leader} ${reconnectKey.slice(2)}` : null}
              run={run}
              errorRows={errorRows}
              copy={copy}
            />
          )}
        </main>
        {check && (
          <CheckPanel
            check={check}
            rows={errorRows}
            actions={{ run, copy }}
            onClose={() => {
              checkRun.current++;
              setCheck(null);
            }}
          />
        )}
        {keysOpen && (
          <BindingsPanel rows={bindingRows(keymap, options, commands)} leader={options.leader} onClose={closeKeys} />
        )}
      </div>
      {overlay !== null && overlay !== "picker" && (
        <CommandLine
          key={overlay.cmdline}
          initial={overlay.cmdline}
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
      {overlay === "picker" && !vault.locked && (
        <Picker
          hosts={conn.hosts}
          recent={appState.recentHosts}
          vim={options.vim}
          keymap={keymap}
          onClose={closeOverlay}
          onOpen={(host, how) => {
            closeOverlay();
            run(`${how?.here ? "here" : "connect"} ${host.name}`);
          }}
        />
      )}
    </div>
  );
  const lockKey = hintFor(keymap, "lock");
  const lockHint = (
    <>
      Locks after {options.idleLockMinutes} minutes idle.
      {lockKey && (
        <>
          {" "}
          <kbd>{options.leader}</kbd> then <kbd>{lockKey.slice(2)}</kbd> locks now.
        </>
      )}
    </>
  );
  return (
    <LockGate vault={vault} hint={lockHint}>
      {shell}
    </LockGate>
  );
}
