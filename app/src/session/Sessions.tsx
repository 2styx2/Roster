// The Sessions' terminals, one per tab, and the basic tab strip that the `sessions = "tabs"`
// option shows instead of the Sidebar's Sessions section. Inactive terminals stay mounted, just
// hidden, so their screens survive switching. Buttons here run command lines (`session N`,
// `close N`, `reconnect`) like every other way in.
import { useEffect, useRef, useState } from "react";
import type { HostKeyScan } from "../backend/types";
import type { ErrorRow } from "../errors/catalog";
import { ErrorPanel, type ProblemActions } from "../errors/ErrorPanel";
import type { CommandLine } from "../keymap";
import type { TerminalEnv, TerminalViewComponent } from "../terminal/TerminalView";
import { Keys } from "../ui/Keys";
import type { Tab, Tabs, TabsSnapshot } from "./tabs";
import { CloseGlyph } from "../ui/CloseGlyph";

/** Where a Session is on its way to a shell (issue #78): `starting` while roster prepares it and
 * ssh starts on this Box, `logging-in` once ssh runs and the Host hasn't answered yet, null once
 * it has (or it ended, or was refused). For a Host whose key roster hasn't seen (ticket 36):
 * `checking-key` while its key is fetched, `asking` while the user decides, `trusting` while
 * roster records it. */
export type ConnectPhase = "starting" | "logging-in" | "checking-key" | "asking" | "trusting";

export function connectPhase(tab: Tab): ConnectPhase | null {
  const s = tab.status;
  if (s.state === "asking") return !s.key ? "checking-key" : s.trusting ? "trusting" : "asking";
  if (s.state === "connecting") return "starting";
  if (tab.status.state === "open" && !tab.shell) return "logging-in";
  return null;
}

/** How the Session's link to its Host stands, for the edge drawn from its node (taste.md: an
 * edge drawn on connect, snapping back on failure): drawing, up, or down. */
export function linkOf(tab: Tab): "connecting" | "up" | "down" {
  if (connectPhase(tab)) return "connecting";
  return tab.status.state === "open" ? "up" : "down";
}

export function statusText(tab: Tab): string {
  const s = tab.status;
  switch (s.state) {
    case "connecting":
      return "connecting…";
    case "asking":
      return s.key ? "new host key" : "connecting…";
    case "open":
      return tab.shell ? "" : "connecting…";
    case "failed":
      return "failed";
    case "ended":
      if (s.exit.closed) return "closed";
      return s.exit.code === null ? "ended (signal)" : `ended (code ${s.exit.code})`;
  }
}

/** The tab's state dot (as in the prototype): filled for a key login, hollow for a password one,
 * grey once the Session has ended or was refused. */
function StateDot({ tab }: { tab: Tab }) {
  const done = tab.status.state === "ended" || tab.status.state === "failed";
  const auth = tab.auth;
  const connecting = connectPhase(tab) !== null;
  const cls = [
    "st",
    auth === "password" ? "pw" : "",
    done ? "ended" : "",
    connecting ? "connecting" : auth === null && !done ? "pending" : "",
  ];
  return <span className={cls.filter(Boolean).join(" ")} aria-hidden="true" />;
}

export interface TabStripProps {
  snapshot: TabsSnapshot;
  /** Runs a command line (`session N`, `close N`): the strip has no actions of its own. */
  run(line: CommandLine): void;
}

/** A basic tab strip: see, switch and close. */
export function TabStrip({ snapshot, run }: TabStripProps) {
  return (
    <div className="tabstrip" role="tablist" aria-label="Sessions">
      {snapshot.tabs.map((tab, i) => {
        const selected = tab.id === snapshot.active;
        const status = statusText(tab);
        return (
          <div key={tab.id} className={`tab${selected ? " selected" : ""} ${tab.status.state}`}>
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={-1}
              title={tab.auth ? `${tab.label}\n${tab.auth} login` : tab.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run(`session ${i + 1}`)}
            >
              <StateDot tab={tab} />
              <span className="tab-host">
                <span className="tab-name">{tab.label === tab.host ? tab.label : tab.label.slice(0, tab.host.length)}</span>
                {tab.label !== tab.host && <span className="tab-tail">{tab.label.slice(tab.host.length)}</span>}
              </span>
              {status && <span className="tab-status"> {status}</span>}
            </button>
            <button
              type="button"
              className="tab-close"
              aria-label={`Close ${tab.label}`}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run(`close ${i + 1}`)}
            >
              <CloseGlyph />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** What the connect card says on its second line: honest about where it is (taste.md). */
const PHASE_WORDS: Record<ConnectPhase, string> = {
  starting: "Starting ssh on this Box…",
  "logging-in": "Logging in…",
  "checking-key": "Fetching the Host's key…",
  asking: "",
  trusting: "Recording the key…",
};

/** The host key question's answers (ticket 36), from the tab's store. */
export interface KeyAnswers {
  trust(): void;
  cancel(): void;
}

/**
 * The pane while its Session connects (issue #78): not a blank terminal, but this Box's square, an
 * edge drawn to the Host's node, the Host and its address in Iosevka, and what's happening now.
 * It's the network-map motif (taste.md), never a spinner. When the shell answers, it fades out
 * over the first output; a failure replaces it with the error at once.
 */
export function ConnectCard({
  host,
  address,
  phase,
  again,
  hostKey = null,
  answers,
  active = true,
}: {
  host: string;
  address: string | null;
  /** Null: the shell answered, so the card fades out and then goes. */
  phase: ConnectPhase | null;
  /** A reconnect ("Reconnecting to …"). */
  again: boolean;
  /** The key to ask about (ticket 36), while `phase` is asking or trusting. */
  hostKey?: HostKeyScan | null;
  answers?: KeyAnswers;
  /** Its pane is the one showing: the question then takes focus. */
  active?: boolean;
}) {
  const card = useRef<HTMLDivElement>(null);
  const trustButton = useRef<HTMLButtonElement>(null);
  const question = (phase === "asking" || phase === "trusting") && hostKey !== null && answers !== undefined;
  // Keyboard first: the question takes focus (after the terminal, which the active pane focuses
  // first), so Enter trusts and Esc cancels. Once answered, focus goes back to the terminal.
  const asked = useRef(false);
  useEffect(() => {
    if (question && active) trustButton.current?.focus();
    if (question) asked.current = true;
    else if (asked.current) {
      asked.current = false;
      if (active && (document.activeElement === document.body || document.activeElement === null)) {
        card.current?.parentElement?.querySelector<HTMLElement>("textarea, input")?.focus();
      }
    }
  }, [question, active]);
  // The last phase, kept while the card fades out after the shell answered; then it's gone.
  const [last, setLast] = useState<ConnectPhase | null>(phase);
  if (phase !== null && phase !== last) setLast(phase);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (phase !== null) return;
    const t = setTimeout(() => setGone(true), FADE_MS);
    return () => clearTimeout(t);
  }, [phase]);
  const words = phase ?? (gone ? null : last);
  if (words === null) return null;
  const title = `${again ? "Reconnecting" : "Connecting"} to ${host}`;
  const where = question ? `${hostKey.address}:${hostKey.port}` : address;
  // The question stays in this same card (no new surface, no second entrance): the edge waits,
  // dashed, short of the Host until the user answers.
  return (
    <div
      ref={card}
      className={`connect-card${phase === null ? " leaving" : ""}${question ? " key-question" : ""}`}
      role={question ? "alertdialog" : "status"}
      aria-label={question ? `Trust ${host}'s host key?` : phase === null ? undefined : title}
      onKeyDown={
        question
          ? (e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                answers.cancel();
              } else if (e.key === "Enter" && e.target === e.currentTarget) {
                e.preventDefault();
                answers.trust();
              }
            }
          : undefined
      }
      tabIndex={question ? -1 : undefined}
    >
      <svg className={`connect-map${question ? " waiting" : ""}`} viewBox="0 0 72 12" width="72" height="12" aria-hidden="true">
        <rect className="connect-box" x="1" y="2" width="8" height="8" rx="1.6" />
        <line className="connect-edge" x1="12" y1="6" x2="59" y2="6" />
        <circle className="connect-host" cx="65" cy="6" r="4.25" />
      </svg>
      <p className="connect-title">
        <span className="muted">{again ? "Reconnecting to " : "Connecting to "}</span>
        <span className="connect-name">{host}</span>
        {where && <span className="connect-address"> {where}</span>}
      </p>
      {question ? (
        <>
          <p className="key-says">roster hasn't seen this Host's key before.</p>
          <p className="key-print">
            <span className="key-type">{hostKey.key_type}</span> <span className="key-fingerprint">{hostKey.fingerprint}</span>
          </p>
          <p className="muted key-advice">Compare it with the Host's console or its owner before you trust it.</p>
          <div className="key-actions">
            <button type="button" className="primary" ref={trustButton} onClick={() => answers.trust()}>
              Trust and connect
            </button>
            <button type="button" onClick={() => answers.cancel()}>
              Cancel
            </button>
          </div>
          <p className="connect-phase muted" aria-live="polite">
            {phase === "trusting" ? (
              PHASE_WORDS.trusting
            ) : (
              <span className="key-hint">
                <Keys keys="Enter" /> trust · <Keys keys="Escape" /> cancel
              </span>
            )}
          </p>
        </>
      ) : (
        <p className="connect-phase muted">{PHASE_WORDS[words]}</p>
      )}
    </div>
  );
}

/** How long the card takes to fade out (--dur-fade in styles.css). */
const FADE_MS = 120;

export interface SessionPanesProps {
  tabs: Pick<Tabs, "wiring" | "trustKey" | "cancelKey">;
  snapshot: TabsSnapshot;
  leader: string;
  terminalView: TerminalViewComponent;
  /** Shared by every terminal (options, keys, clipboard). */
  terminalEnv: TerminalEnv;
  /** The keys that reconnect an ended tab ("␣ r"), if the keymap has them. */
  reconnectKeys: string | null;
  /** Runs a command line (the Retry and Reconnect buttons run `reconnect`). */
  run(line: CommandLine): void;
  /** The error catalog's rows (docs/app/errors.md), for a refused or failed Session. */
  errorRows: readonly ErrorRow[];
  /** Puts a command from an error's fix on the clipboard. */
  copy(text: string): Promise<void>;
  /** A Host's address, for the connect card ("10.0.0.6"), or null. */
  addressOf?(host: string): string | null;
}

export function SessionPanes({
  tabs,
  snapshot,
  leader,
  terminalView: TerminalView,
  terminalEnv,
  reconnectKeys,
  run,
  errorRows,
  copy,
  addressOf,
}: SessionPanesProps) {
  const actions: ProblemActions = { run, copy };
  return (
    <div className="panes">
      {snapshot.tabs.map((tab) => {
        const active = tab.id === snapshot.active;
        const s = tab.status;
        const wiring = tabs.wiring(tab.id);
        return (
          <div key={tab.id} className="pane" role="group" aria-label={`Session ${tab.label}`} hidden={!active}>
            {s.state === "failed" ? (
              <div className="session-error">
                <ErrorPanel title="Couldn't open a Session" problem={s.problem} rows={errorRows} actions={actions} />
              </div>
            ) : (
              wiring && <TerminalView active={active} leader={leader} {...wiring} env={terminalEnv} />
            )}
            {s.state !== "failed" && s.state !== "ended" && (
              <ConnectCard
                key={tab.attempt}
                host={tab.host}
                address={addressOf?.(tab.host) ?? null}
                phase={connectPhase(tab)}
                again={tab.attempt > 1}
                hostKey={s.state === "asking" ? s.key : null}
                answers={{ trust: () => tabs.trustKey(tab.id), cancel: () => tabs.cancelKey(tab.id) }}
                active={active}
              />
            )}
            {s.state === "ended" && s.problem && (
              <div className="session-error overlay">
                <ErrorPanel title="Session ended" problem={s.problem} rows={errorRows} actions={actions} />
              </div>
            )}
            {s.state === "ended" && !s.problem && (
              <div className="session-note ended">
                <span>{statusText(tab)}</span>
                {reconnectKeys && (
                  <span className="muted key-hint">
                    {" "}
                    · <Keys keys={reconnectKeys} leader={leader} /> or
                  </span>
                )}{" "}
                <button type="button" className="reconnect" onClick={() => run("reconnect")}>
                  Reconnect
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
