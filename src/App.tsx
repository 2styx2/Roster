// The app shell: connect to the Backend, then a terminal-first empty state (Sessions come in
// ticket 05) with the Picker on <leader> f or a click. A Backend that can't start gets an error
// screen that says what to fix.
import { useCallback, useEffect, useRef, useState } from "react";
import { BackendStartError, type Backend, type BackendInfo, type BackendProblem, type HostList } from "./backend/types";
import { chordOf, defaultKeymap, defaultOptions, type Keymap, type Options } from "./keymap";
import { Picker } from "./picker/Picker";
import { ErrorScreen } from "./ErrorScreen";
import type { Clock } from "./lock/idle";
import { LockGate } from "./lock/LockScreen";
import { useVault } from "./lock/useVault";

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
  /** For the idle lock; tests pass a manual one. */
  clock?: Clock;
}

export function App({ backend, options = defaultOptions, keymap = defaultKeymap, clock }: AppProps) {
  const [conn, setConn] = useState<Conn>({ state: "connecting" });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [leader, setLeader] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const mainRef = useRef<HTMLElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const vault = useVault(backend, conn.state === "ready", { idleMs: options.idleLockMinutes * 60_000, clock });

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
    if (conn.state === "ready" && !vault.locked) mainRef.current?.focus();
  }, [conn.state, vault.locked]);

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
    if (conn.state !== "ready" || vault.locked) return;
    function onKey(e: KeyboardEvent) {
      const chord = chordOf(e);
      if (chord === options.leader) {
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
      if (action === "app.lock" && !vault.lock()) setMessage("Nothing to lock: no Host Login uses a vault with a master password.");
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [conn.state, leader, options.leader, keymap, openPicker, vault]);

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
  const shell = (
    <div className="screen app">
      <main className="workspace" ref={mainRef} tabIndex={-1} aria-label="Sessions">
        <div className="empty">
          <p>No Sessions open.</p>
          <button type="button" className="find" onClick={openPicker}>
            Find a host
          </button>
          <p className="muted">
            or press <kbd>{options.leader}</kbd> then <kbd>f</kbd>
          </p>
          {message && <p className="message">{message}</p>}
        </div>
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
      {pickerOpen && !vault.locked && (
        <Picker
          hosts={hosts}
          recent={recent}
          vim={options.vim}
          keymap={keymap}
          onClose={closePicker}
          onOpen={(host) => {
            setRecent((r) => [host.name, ...r.filter((n) => n !== host.name)]);
            setMessage(`${host.name}: Sessions aren't built yet (ticket 05).`);
            closePicker();
          }}
        />
      )}
    </div>
  );
  const lockHint = (
    <>
      Locks after {options.idleLockMinutes} minutes idle. <kbd>{options.leader}</kbd> then <kbd>L</kbd> locks now.
    </>
  );
  return (
    <LockGate vault={vault} hint={lockHint}>
      {shell}
    </LockGate>
  );
}
