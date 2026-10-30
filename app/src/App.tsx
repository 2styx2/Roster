// The app shell: connect to the Backend, then the view mode's layout (view/layout.ts): Standard
// has the Sidebar and the status bar around the Sessions' terminals (or an empty state); Focus is
// fullscreen with only the terminal and, if asked for, the session bar. The Key bindings panel,
// the check panel, the command line, the Picker and the Finder work the same in both. A Backend
// that can't start gets an error screen that says what to fix.
//
// Keys: the focus-mode machine (keyboard/mode.ts) decides whether a key is the terminal's or the
// app's; the app's keys are command lines run through the one command table (commands/table.ts),
// which is also what the command line and every button run. The commands, keymap and Sidebar
// sections are registries (ADR 0006), read live.
import {
  Fragment,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  BackendStartError,
  CHECK_API_VERSION,
  EDIT_API_VERSION,
  type Backend,
  type BackendInfo,
  type BackendProblem,
  type Host,
  type HostList,
} from "./backend/types";
import { CommandLine } from "./cmdline/CommandLine";
import { complete, runLine, type CommandContext, type Commands, type FoldHow } from "./commands/table";
import { deriveConfig, registerConfig, type ConfigWarning } from "./config/apply";
import { ConfigToast } from "./config/ConfigToast";
import { initLuaReloader } from "./config/source";
import type { ConfigReport } from "./config/types";
import { registerFolders } from "./folders/folders";
import { ErrorScreen } from "./ErrorScreen";
import { Finder } from "./finder/Finder";
import type { FinderContext, FinderItem } from "./finder/sources";
import { CheckPanel, type CheckState } from "./errors/CheckPanel";
import { ChangesPanel, type ChangesState } from "./edit/ChangesPanel";
import { EditPanel } from "./edit/EditPanel";
import { TitleBar } from "./chrome/TitleBar";
import { BindingsPanel } from "./keyboard/BindingsPanel";
import { bindingRows } from "./keyboard/bindings";
import { press, terminalMode, type KeyState } from "./keyboard/mode";
import { realClock, type Clock } from "./lock/idle";
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
import { defaultAppearance, terminalTheme, type AppearanceOptions } from "./theme/theme";
import { chosenAppearance, registerThemePicker, ThemeChoice } from "./theme/picker";
import { useTheme } from "./theme/useTheme";
import { Logo } from "./chrome/Logo";
import { countOf } from "./ui/format";
import { Keys } from "./ui/Keys";
import {
  defaultLayouts,
  isShown,
  otherMode,
  pick,
  pieceToggled,
  placed,
  STATUS_SEGMENTS,
  togglePiece,
  type Layouts,
  type Place,
  type ViewMode,
} from "./view/layout";
import { SessionBar } from "./view/SessionBar";

type Conn =
  | { state: "connecting" }
  | { state: "failed"; problem: BackendProblem }
  | { state: "ready"; info: BackendInfo; hosts: HostList };

/** An overlay with its own input, which takes the keys while it's open. */
type Overlay = "picker" | { cmdline: string } | { finder: string } | null;

/** How long the hint on entering a mode stays. */
const HINT_MS = 2000;

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

/** The global keys (no Leader) bound to any of `lines`. */
function globalKeysFor(keymap: Keymap, lines: readonly Line[]): string[] {
  return Object.entries(keymap.global)
    .filter(([, b]) => lines.includes(b.action))
    .map(([k]) => k);
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
  /** Theme, fonts and the title bar (ticket 09); the Config's later (ticket 21). */
  appearance?: AppearanceOptions;
  /** The State file, clipboard, Windows build, window controls and fullscreen (tests: an in-memory one). */
  platform?: Platform;
  /** The per-mode layout table (decision Q39); the defaults from the options unless ticket 21's
   * Config passes its own. */
  layouts?: Layouts;
  /** Hosts to open Sessions to once the Backend is up, in order (a fixture's open Sessions: the
   * dev page's `?fixture=worst-case`, and the UI tests), once the app is first unlocked. */
  openAtStart?: readonly string[];
  /** The Config as the app starts (ticket 21): it replaces `options`, `appearance`,
   * `terminalOptions` and `layouts`, and its keys, Themes and Folders go into the registries.
   * Later saves come through `platform.config`. */
  config?: ConfigReport | null;
}

export function App({
  backend,
  options: optionsProp = defaultOptions,
  registries: given,
  clock,
  terminalView = TerminalView,
  terminalOptions: terminalOptionsProp = defaultTerminalOptions,
  platform: platformProp,
  appearance: appearanceProp = defaultAppearance,
  layouts: layoutsProp,
  openAtStart,
  config: configProp = null,
}: AppProps) {
  const [registries] = useState(() => given ?? builtinRegistries());
  const [platform] = useState(() => platformProp ?? memoryPlatform());

  // The Config (ticket 21): the one the app started with, then each save's. A broken save comes
  // with the last good Config and the error, so nothing changes but the toast.
  const [report, setReport] = useState<ConfigReport | null>(configProp);
  /** A Config file was saved since the last reload, and isn't applied yet. */
  const [stale, setStale] = useState(false);
  // The newest report wins: one that arrives late (or twice) never replaces a newer one.
  const takeReport = useCallback(
    (r: ConfigReport) => setReport((cur) => (cur && cur.version >= r.version ? cur : r)),
    [],
  );
  useEffect(() => {
    const source = platform.config;
    if (!source) return;
    const take = (r: ConfigReport) => {
      setStale(false);
      takeReport(r);
    };
    let live = true;
    // Listen first, then ask again: a save between main.tsx's load and now isn't lost.
    const stopChanges = source.watch(take);
    // A save that wasn't applied (auto_reload off, decision Q58): a quiet hint to :source.
    const stopStale = source.watchStale(() => setStale(true));
    const stop = () => {
      stopChanges();
      stopStale();
    };
    source.load().then(
      (r) => {
        if (live && r) take(r);
      },
      () => {},
    );
    return () => {
      live = false;
      stop();
    };
  }, [platform, takeReport]);
  const config = report?.config ?? null;
  const derived = useMemo(() => (config ? deriveConfig(config) : null), [config]);
  const options = derived?.options ?? optionsProp;
  const appearance = derived?.appearance ?? appearanceProp;
  const terminalOptions = derived?.terminalOptions ?? terminalOptionsProp;
  // Keys, Themes and Folders go through the registries as "init.lua"; the next Config replaces
  // them. Before paint, so a custom Theme never flashes the default.
  const [warnings, setWarnings] = useState<readonly ConfigWarning[]>([]);
  useLayoutEffect(() => {
    if (!config) return;
    const registered = registerConfig(registries, config);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- what registering found is its result
    setWarnings(registered.warnings);
    return registered.dispose;
  }, [registries, config]);
  const [toastClosedFor, setToastClosedFor] = useState<ConfigReport | null>(null);

  const commandList = useSyncExternalStore(registries.commands.subscribe, registries.commands.list);
  const bindingList = useSyncExternalStore(registries.keymap.subscribe, registries.keymap.list);
  const sectionDefs = useSyncExternalStore(registries.sidebar.subscribe, registries.sidebar.list);
  const errorRows = useSyncExternalStore(registries.errors.subscribe, registries.errors.list);
  const finderSources = useSyncExternalStore(registries.finders.subscribe, registries.finders.list);
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
  // Ticket 10: the edit form (a Host's name), the Pending changes panel, and the last count.
  const [editing, setEditing] = useState<string | null>(null);
  const [changesView, setChangesView] = useState<{ confirm: boolean } | null>(null);
  const [pending, setPending] = useState<ChangesState | null>(null);
  const [keyState, setKeyState] = useState<KeyState>(terminalMode);
  const keyRef = useRef<KeyState>(terminalMode);
  const [cursor, setCursor] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(options.defaultMode);
  const [layouts, setLayouts] = useState<Layouts>(() => layoutsProp ?? derived?.layouts ?? defaultLayouts(options));
  // A Config whose layouts differ replaces them (and what `␣ e` / `␣ s` toggled); one that only
  // changed a colour keeps them.
  const modesKey = config ? JSON.stringify(config.modes) : null;
  const [layoutsFrom, setLayoutsFrom] = useState(modesKey);
  if (modesKey !== layoutsFrom) {
    setLayoutsFrom(modesKey);
    if (derived) setLayouts(derived.layouts);
  }
  const layout = layouts[viewMode];
  const [hint, setHint] = useState(false);
  const [message, setMessage] = useState("");
  const [store] = useState(() => new StateStore(platform));
  const appState = useSyncExternalStore(store.subscribe, store.snapshot);
  // The Theme (ticket 30): a preview in the `themes` finder, else init.lua's `theme` if it names
  // one, else the choice kept in the State, else the Config's (`auto` follows the OS).
  const [themeChoice] = useState(() => new ThemeChoice(store, registries.themes));
  const preview = useSyncExternalStore(themeChoice.subscribe, themeChoice.previewing);
  const configTheme = config && config.theme !== "auto" ? config.theme : null;
  // The State's choice (a registered Theme's id); appState re-renders when it changes.
  const stored = themeChoice.stored();
  const chosen = useMemo(
    () => chosenAppearance(appearance, { configTheme, stored, preview }),
    [appearance, configTheme, stored, preview],
  );
  const theme = useTheme(registries.themes, chosen);
  useLayoutEffect(() => {
    themeChoice.setConfigTheme(configTheme);
    themeChoice.setActive(theme.id);
  }, [themeChoice, configTheme, theme.id]);
  const [fontSize, setFontSize] = useState(terminalOptions.fontSize);
  // A new size in the Config is a new zoom reset point, and where the font goes now.
  const [sizeFrom, setSizeFrom] = useState(terminalOptions.fontSize);
  if (terminalOptions.fontSize !== sizeFrom) {
    setSizeFrom(terminalOptions.fontSize);
    setFontSize(terminalOptions.fontSize);
  }
  const [windowsBuild, setWindowsBuild] = useState<number | null>(null);
  const [tabs] = useState(() => new Tabs(backend));
  const sessions = useSyncExternalStore(tabs.subscribe, tabs.snapshot);
  const mainRef = useRef<HTMLElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const vault = useVault(backend, conn.state === "ready", { idleMs: options.idleLockMinutes * 60_000, clock });
  // A password Host whose vault turns out locked (session.prepare code 14) brings up the lock
  // screen; the tab opens by itself once the vault is unlocked again.
  // `vault` is a new object each render; its `lock` is stable, so the handler is set once.
  const lockVault = vault.lock;
  useEffect(() => tabs.setVaultLockedHandler(() => void lockVault()), [tabs, lockVault]);
  const vaultUnlocked = vault.view.state === "unlocked";
  useEffect(() => {
    if (vaultUnlocked) tabs.resumeAfterUnlock();
  }, [vaultUnlocked, tabs]);

  const hosts = conn.state === "ready" ? conn.hosts : null;
  const hostByName = useMemo(() => new Map((hosts?.hosts ?? []).map((h) => [h.name, h])), [hosts]);
  const folded = useMemo(() => new Set(appState.folded), [appState.folded]);
  // The mode's layout may pick and order the Sidebar's sections (decision Q39).
  const shownSectionDefs = useMemo(
    () => (layout.sections ? [...pick(sectionDefs, layout.sections)].map((d, i) => ({ ...d, order: i })) : sectionDefs),
    [sectionDefs, layout.sections],
  );
  const sections = useMemo(
    () =>
      hosts
        ? buildSections(shownSectionDefs, { sessions, hosts, hostByName, sessionsIn: options.sessions, state: appState, folded })
        : [],
    [shownSectionDefs, sessions, hosts, hostByName, options.sessions, appState, folded],
  );
  const rows = useMemo(() => allRows(sections), [sections]);
  const sidebarAt = layout.pieces.find((p) => p.id === "sidebar")?.at;
  const sidebarSide = sidebarAt === "right" ? "right" : "left";
  const sidebarShown = isShown(layout, "sidebar") && layout.tree === "sidebar" && sections.length > 0;
  const finderCtx = useMemo<FinderContext | null>(
    () =>
      hosts
        ? {
            sessions,
            hosts,
            hostByName,
            sessionsIn: options.sessions,
            state: appState,
            folded,
            recent: appState.recentHosts,
            sidebar: sectionDefs,
          }
        : null,
    [sessions, hosts, hostByName, options.sessions, appState, folded, sectionDefs],
  );

  // The window follows the mode: OS fullscreen, or not (only when that changes).
  const fullscreen = useRef(false);
  useEffect(() => {
    if (fullscreen.current === layout.fullscreen) return;
    fullscreen.current = layout.fullscreen;
    platform.setFullscreen(layout.fullscreen).catch(() => {});
  }, [layout.fullscreen, platform]);

  // The hint on entering a mode that has one, for HINT_MS.
  const hintClock = clock ?? realClock;
  const showsHint = layout.hint;
  useEffect(() => {
    if (!showsHint) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- showing it is the effect
    setHint(true);
    const timer = hintClock.setTimeout(() => setHint(false), HINT_MS);
    return () => {
      hintClock.clearTimeout(timer);
      setHint(false);
    };
  }, [viewMode, showsHint, hintClock]);

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

  // Pending changes (ticket 10): asked for once the Backend is up, and after every edit, discard
  // and pull. A roster older than API 5 has none to show.
  const apiVersion = conn.state === "ready" ? conn.info.inventory.api_version : 0;
  const canEdit = apiVersion >= EDIT_API_VERSION;
  const refreshPending = useCallback(() => {
    if (!canEdit) return;
    backend.pendingChanges().then(
      (changes) => setPending({ state: "done", changes }),
      (e: unknown) => setPending({ state: "error", message: e instanceof Error ? e.message : String(e) }),
    );
  }, [backend, canEdit]);
  useEffect(() => refreshPending(), [refreshPending]);
  /** The Inventory again, after roster.yml changed (an edit, a discard, a pull). */
  const reloadHosts = useCallback(() => {
    backend.listHosts().then(
      (hosts) => setConn((c) => (c.state === "ready" ? { ...c, hosts } : c)),
      () => {},
    );
  }, [backend]);
  const pendingCount = pending?.state === "done" ? pending.changes.count : 0;

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

  // The window's size and place go in the State; the Tauri shell restores them at the next start.
  useEffect(() => platform.window?.watchGeometry((g) => store.set("window", g)), [platform, store]);

  // Folders (GLOSSARY) register their section, commands and keys like a Plugin (ADR 0006).
  useEffect(() => registerFolders(registries, store), [registries, store]);
  useEffect(() => registerThemePicker(registries, themeChoice), [registries, themeChoice]);
  // init.lua is what `:source` reloads (decision Q58); ticket 28 registers folders.yml and roster.yml.
  const reportPath = useRef<string | null>(null);
  reportPath.current = report?.path ?? null;
  useEffect(() => {
    const source = platform.config;
    if (!source) return;
    return registries.reloaders.register(
      initLuaReloader({
        path: () => reportPath.current,
        reload: async () => {
          const r = await source.reload();
          if (r) {
            setStale(false);
            takeReport(r);
          }
          return r;
        },
      }),
    );
  }, [registries, platform, takeReport]);

  const onZoom = useCallback(
    (action: ZoomAction) => setFontSize((size) => zoom(terminalOptions, size, action)),
    [terminalOptions],
  );
  const terminalKeys = useMemo(() => actionsOf(keymap.terminal), [keymap]);
  const termTheme = useMemo(() => terminalTheme(theme, terminalOptions.colors), [theme, terminalOptions.colors]);
  // What sits around the terminal: a change fits the terminal again and tells the Session.
  const layoutKey = [viewMode, ...(["top", "bottom", "left", "right"] as const).map((at) => placed(layout, at).join(","))].join(" ");
  const terminalEnv = useMemo<TerminalEnv>(
    () => ({
      options: terminalOptions,
      theme: termTheme,
      fontSize,
      windowsBuild,
      keys: terminalKeys,
      clipboard: platform.clipboard,
      onZoom,
      layout: layoutKey,
    }),
    [terminalOptions, termTheme, fontSize, windowsBuild, terminalKeys, platform, onZoom, layoutKey],
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

  // A fixture's Sessions open once the app is first unlocked, as if the user had opened them.
  const opened = useRef(false);
  const unlockedOnce = conn.state === "ready" && !vault.locked;
  useEffect(() => {
    if (!unlockedOnce || opened.current || !openAtStart) return;
    opened.current = true;
    for (const host of openAtStart) tabs.open(host);
  }, [unlockedOnce, openAtStart, tabs]);

  // Closing the app ends every Session.
  useEffect(() => () => tabs.closeAll(), [tabs]);

  const setMode = useCallback((next: KeyState) => {
    keyRef.current = next;
    setKeyState(next);
  }, []);

  // The Sidebar's tree takes focus in App mode, so assistive tech follows its cursor (ticket 29
  // M4); `beforeTree` is where focus was (the terminal), and where it goes back to.
  const treeRef = useRef<HTMLDivElement | null>(null);
  const beforeTree = useRef<Element | null>(null);
  const inTree = () => treeRef.current?.contains(document.activeElement) ?? false;
  const setTree = useCallback((el: HTMLDivElement | null) => {
    treeRef.current = el;
  }, []);

  /** Remembers where focus was (the terminal), for when an overlay or panel closes. */
  const rememberFocus = () => {
    returnFocus.current = inTree() ? beforeTree.current : document.activeElement;
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

  const closeEdit = () => {
    setEditing(null);
    restoreFocus();
  };
  const closeChanges = () => {
    setChangesView(null);
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
    toggleSidebar: () => {
      if (layout.tree === "finder") return ctx.openFinder("tree");
      const next = togglePiece(layout, "sidebar");
      setLayouts((l) => ({ ...l, [viewMode]: next }));
      setMessage(pieceToggled(viewMode, next, "sidebar"));
    },
    toggleStatusBar: () => {
      const next = togglePiece(layout, layout.bar);
      setLayouts((l) => ({ ...l, [viewMode]: next }));
      setMessage(pieceToggled(viewMode, next, layout.bar));
    },
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
    toTerminal: () => {
      setMode(terminalMode);
      ctx.closePanel();
    },
    // The panel drawn last (Key bindings, beside :check) is the topmost.
    closePanel: () => {
      if (keysOpen) return closeKeys();
      if (editing !== null) return closeEdit();
      if (changesView) return closeChanges();
      if (check) {
        checkRun.current++;
        setCheck(null);
      }
    },
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
    viewMode: () => viewMode,
    setViewMode: (mode) => setViewMode(mode ?? otherMode(viewMode)),
    showInfo: () => {
      if (conn.state === "ready") {
        // The command too: it's the program the master password and sign-in codes go to.
        const { backend, command, inventory } = conn.info;
        setMessage(`Backend ${backend} · Box ${inventory.box} · Inventory ${inventory.path} · Command ${command.join(" ")}`);
      }
    },
    edit: (name) => {
      const host = name ?? ctx.selectedHost();
      if (!host) return setMessage("edit needs a Host name (no Host is selected)");
      if (!hostByName.has(host)) return setMessage(`No Host named ${host}`);
      if (!canEdit) return setMessage(`:edit needs a newer roster (API version ${EDIT_API_VERSION}; this one speaks ${apiVersion})`);
      if (editing === null && !changesView) rememberFocus();
      setChangesView(null);
      setEditing(host);
    },
    showChanges: (discard = false) => {
      if (!canEdit) return setMessage(`:changes needs a newer roster (API version ${EDIT_API_VERSION}; this one speaks ${apiVersion})`);
      if (editing === null && !changesView) rememberFocus();
      setEditing(null);
      setPending((p) => p ?? { state: "loading" });
      refreshPending();
      setChangesView({ confirm: discard });
    },
    pull: () => {
      if (!canEdit) return setMessage(`:pull needs a newer roster (API version ${EDIT_API_VERSION}; this one speaks ${apiVersion})`);
      setMessage("Pulling the infra repo…");
      backend.pullInventory().then(
        (r) => {
          if (r.updated) reloadHosts();
          setMessage(
            !r.upstream
              ? "This branch has no upstream: nothing to pull."
              : r.updated
                ? `Pulled ${countOf(r.commits, "commit")} from ${r.upstream}.`
                : `Up to date with ${r.upstream}.`,
          );
        },
        (e: unknown) => setMessage(`Couldn't pull: ${e instanceof Error ? e.message : String(e)}`),
      );
    },
    config: (what) => {
      const source = platform.config;
      if (!source) return setMessage("There's no init.lua here: this window isn't the app (a plain browser)");
      const failed = (e: unknown) => (e instanceof Error ? e.message : String(e));
      if (what === "path") return setMessage(report ? `init.lua is at ${report.path}` : "init.lua hasn't been read yet");
      // `:config reload` is `:source init.lua` (decision Q58).
      if (what === "reload") return void runLine(commands, ctx, "source init.lua");
      source.open().then(
        ({ path, created }) =>
          setMessage(
            created
              ? `Created ${path} with every option commented out. Uncomment one and save: it applies at once.`
              : `Opened ${path}. Saving it applies it.`,
          ),
        (e: unknown) => setMessage(`Can't open init.lua: ${failed(e)}`),
      );
    },
    openFinder: (source) => {
      if (!registries.finders.get(source)) return setMessage(`No finder named ${source}`);
      if (overlay === null) rememberFocus();
      setOverlay({ finder: source });
    },
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

  // App mode with the Sidebar shown puts focus on its tree (the cursor is its active descendant);
  // back in Terminal mode, focus goes back where it was. An overlay or panel that took focus
  // keeps it, and a Session that became active has taken it already.
  const treeMode = keyState.mode === "app" && overlay === null;
  useEffect(() => {
    const tree = treeRef.current;
    if (treeMode) {
      if (tree && !tree.contains(document.activeElement)) {
        beforeTree.current = document.activeElement;
        tree.focus({ preventScroll: true });
      }
      return;
    }
    const back = beforeTree.current;
    if (keyState.mode !== "terminal" || back === null) return;
    beforeTree.current = null;
    // Focus is still on the tree, or was lost with it (the Sidebar hid with the view mode).
    const focused = document.activeElement;
    const lost = !focused || focused === document.body || (tree?.contains(focused) ?? false);
    if (!lost) return;
    if (back instanceof HTMLElement && back.isConnected) back.focus();
    if (document.activeElement === focused) mainRef.current?.focus();
  }, [treeMode, keyState.mode]);

  // Caught before anything else sees it, the terminal included (capture phase on window). While
  // locked, keys belong to the lock screen alone.
  const ready = conn.state === "ready" && !vault.locked;
  useEffect(() => {
    if (!ready) return;
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [ready]);

  // The custom title bar (decision Q32) sits above every screen, the lock screen too, so the
  // window can always be moved and closed; it shows nothing but the mark. The view mode's layout
  // says whether it shows at all (Focus is OS fullscreen without it).
  const toast = report !== toastClosedFor && (
    <ConfigToast error={report?.error ?? null} warnings={warnings} onClose={() => setToastClosedFor(report)} />
  );
  const frame = (content: React.ReactNode) => (
    <div className="window">
      {isShown(layout, "titlebar") && <TitleBar controls={platform.window} />}
      <div className="window-body">{content}</div>
      {toast}
    </div>
  );

  if (conn.state === "connecting") {
    return frame(
      <div className="screen center">
        <p className="muted starting">Starting the backend…</p>
      </div>,
    );
  }
  if (conn.state === "failed") {
    return frame(<ErrorScreen problem={conn.problem} onRetry={() => void connect(true)} copy={copy} />);
  }

  const { info } = conn;
  const reconnectKey = hintFor(keymap, "reconnect");
  const appMode = keyState.mode === "app" && overlay === null;
  const findKeys = hintFor(keymap, "find");
  const sourceKeys = hintFor(keymap, "source");
  const hints = [
    [findKeys, "find"],
    [hintFor(keymap, "keys"), "keys"],
    [hintFor(keymap, "statusbar"), "hide this bar"],
  ].filter((h): h is [string, string] => h[0] !== null);

  const modeKeys = [hintFor(keymap, "mode"), hintFor(keymap, "focus"), ...globalKeysFor(keymap, ["mode", "focus"])].filter(
    (k): k is string => k !== null,
  );
  /** The pieces the layout places at `at`, in order. The title bar is drawn by `frame` above
   * every screen (the lock and error screens too); a Plugin's pieces come with ticket 23. */
  const pieces = (at: Place) =>
    placed(layout, at).map((id) => {
      if (id === "statusbar") return statusBar;
      if (id === "sessionbar") {
        return (
          <div key={id} className="piece" data-place={at}>
            <SessionBar box={info.inventory.box} snapshot={sessions} hostByName={hostByName} run={run} />
          </div>
        );
      }
      return null;
    });
  const finderSource = overlay !== null && typeof overlay === "object" && "finder" in overlay
    ? finderSources.find((s) => s.id === overlay.finder)
    : undefined;

  // The status bar's segments, as the mode's layout picks and orders them (decision Q39); the
  // hints and the mode go to the right.
  const segment = (id: string) => {
    switch (id) {
      case "backend":
        return (
          <span key={id} className="backend" title={info.backend}>
            <span className="status-dot" aria-hidden="true" />
            <span className="statusbar-cut">{info.backend}</span>
          </span>
        );
      case "box":
        return (
          <span key={id} className="box" title={info.inventory.box}>
            <span className="box-mark" aria-hidden="true" />
            <span className="statusbar-cut">{info.inventory.box}</span>
          </span>
        );
      case "hosts":
        return (
          <span key={id} className="count">
            {countOf(conn.hosts.hosts.length, "Host")}
          </span>
        );
      case "path":
        return (
          <span key={id} className="statusbar-cut path" title={`${info.inventory.path}\n${info.command.join(" ")}`}>
            {info.inventory.path}
          </span>
        );
      case "changes":
        // Pending changes (ticket 10): only when there are some; it opens them.
        return (
          pendingCount > 0 && (
            <button
              key={id}
              type="button"
              className="statusbar-changes"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run("changes")}
              title="Show the Pending changes"
            >
              <span className="changes-dot" aria-hidden="true" />
              {countOf(pendingCount, "Pending change")}
            </button>
          )
        );
      case "hints":
        // They drop out whole, last first, when the bar runs out of room (never cut mid-key).
        return (
          <span key={id} className="statusbar-hints">
            {stale && (
              <span className="hint stale" title="Saved, not applied yet: auto_reload is off in init.lua">
                init.lua changed {sourceKeys ? <Keys keys={sourceKeys} leader={options.leader} /> : <code>:source</code>} apply
              </span>
            )}
            {hints.map(([k, what]) => (
              <span key={what} className="hint">
                <Keys keys={k} leader={options.leader} /> {what}
              </span>
            ))}
          </span>
        );
      case "mode":
        return (
          appMode && (
            <span key={id} className="mode">
              APP{keyState.pending.length > 0 && <span className="pending"> {keyState.pending.join(" ")}</span>}
            </span>
          )
        );
      default:
        return null;
    }
  };
  const segments = layout.segments ?? STATUS_SEGMENTS;
  const right = new Set(["hints", "mode"]);
  const statusBar = (
    <footer key="statusbar" className="statusbar">
      {segments.filter((id) => !right.has(id)).map(segment)}
      <span className="statusbar-right">{segments.filter((id) => right.has(id)).map(segment)}</span>
    </footer>
  );

  const shell = (
    <div className={`screen app ${appMode ? "mode-app" : "mode-terminal"}`} data-view={viewMode}>
      {pieces("top")}
      <div className={`body sidebar-${sidebarSide}`}>
        {sidebarShown && (
          <Sidebar
            sections={sections}
            side={sidebarSide}
            cursor={appMode ? cursor : null}
            leaderHint={options.leader}
            findKeys={hintFor(keymap, "find")}
            run={(line) => {
              setMode(terminalMode);
              run(line);
            }}
            treeRef={setTree}
            onTreeFocus={(from) => {
              // Tab (or a screen reader) reached the tree: it's App mode, as after the Leader.
              if (keyRef.current.mode !== "terminal") return;
              beforeTree.current = from;
              setCursor(rows.find((row) => row.raised)?.id ?? rows[0]?.id ?? null);
              setMode({ mode: "app", pending: [] });
            }}
            onTreeBlur={(to) => {
              // Focus went elsewhere (Tab on, a click): keys are the terminal's again.
              if (keyRef.current.mode === "app" && to !== null && !to.closest(".picker-backdrop, .cmdline")) setMode(terminalMode);
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
          {noSessions && conn.hosts.hosts.length === 0 ? (
            // Nothing to find yet: say where Hosts come from (S7), not "Find a Host".
            <div className="empty">
              <Logo size={48} className="empty-mark" />
              <p className="empty-title">No Hosts in the Inventory yet.</p>
              <p className="empty-hint">
                Add them to <code>{info.inventory.path}</code> and they show up here.
              </p>
            </div>
          ) : noSessions ? (
            <div className="empty">
              <Logo size={48} className="empty-mark" />
              <p className="empty-title">No Sessions open</p>
              <button type="button" className="find primary" onMouseDown={(e) => e.preventDefault()} onClick={() => run("find")}>
                Find a Host
              </button>
              {findKeys && (
                <p className="empty-hint">
                  or press <Keys keys={findKeys} leader={options.leader} />
                </p>
              )}
            </div>
          ) : (
            <SessionPanes
              tabs={tabs}
              snapshot={sessions}
              leader={options.leader}
              terminalView={terminalView}
              terminalEnv={terminalEnv}
              reconnectKeys={reconnectKey}
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
        {editing !== null && hostByName.get(editing) && (
          <EditPanel
            key={editing}
            backend={backend}
            host={hostByName.get(editing) as Host}
            pendingCount={pendingCount}
            rows={errorRows}
            actions={{ run, copy }}
            onPulled={() => reloadHosts()}
            onSaved={(update) => {
              closeEdit();
              reloadHosts();
              refreshPending();
              setMessage(
                update.changed
                  ? `Saved ${update.host.name} as a Pending change. Sessions use it after roster sync.`
                  : `Nothing changed on ${update.host.name}.`,
              );
            }}
            onClose={closeEdit}
          />
        )}
        {changesView && pending && (
          <ChangesPanel
            key={changesView.confirm ? "ask" : "show"}
            changes={pending}
            confirm={changesView.confirm}
            editKeys={hintFor(keymap, "edit")}
            leader={options.leader}
            onDiscard={async () => {
              try {
                const r = await backend.discardChanges();
                setMessage(r.discarded ? "Discarded the Pending changes: roster.yml is as the last commit has it." : "Nothing to discard.");
              } catch (e) {
                setMessage(`Couldn't discard: ${e instanceof Error ? e.message : String(e)}`);
              }
              reloadHosts();
              refreshPending();
            }}
            onClose={closeChanges}
          />
        )}
        {keysOpen && (
          <BindingsPanel rows={bindingRows(keymap, options, commands)} leader={options.leader} onClose={closeKeys} />
        )}
      </div>
      {overlay !== null && typeof overlay === "object" && "cmdline" in overlay && (
        <CommandLine
          key={overlay.cmdline}
          initial={overlay.cmdline}
          complete={(input) => complete(commands, input, hosts?.hosts.map((h) => h.name) ?? [])}
          describe={(candidate) => {
            // A command name (not a command and its argument): its label and key.
            const [id = "", arg = ""] = candidate.split(" ");
            const command = arg === "" ? commands.get(id) : undefined;
            return command ? { label: command.label(), keys: hintFor(keymap, id) } : null;
          }}
          leader={options.leader}
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
      {pieces("bottom")}
      {hint && modeKeys.length > 0 && (
        <div className="mode-hint" role="status" aria-label={`How to leave ${viewMode === "focus" ? "Focus" : "this mode"}`}>
          {/* Two ways out, not one sequence: "␣ m or F11", never "␣ m F11". */}
          {modeKeys.map((k, i) => (
            <Fragment key={k}>
              {i > 0 && <span className="muted"> or </span>}
              <Keys keys={k} leader={options.leader} />
            </Fragment>
          ))}{" "}
          leave {viewMode === "focus" ? "Focus" : "this mode"}
        </div>
      )}
      {finderSource && finderCtx && !vault.locked && (
        <Finder
          key={finderSource.id}
          source={finderSource}
          ctx={finderCtx}
          keymap={keymap}
          vim={options.vim}
          onClose={closeOverlay}
          onChoose={(item: FinderItem) => {
            closeOverlay();
            run(item.command);
          }}
        />
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
          <Keys keys={lockKey} leader={options.leader} /> locks now.
        </>
      )}
    </>
  );
  return frame(
    <LockGate vault={vault} hint={lockHint} errorRows={errorRows} copy={copy}>
      {shell}
    </LockGate>,
  );
}
