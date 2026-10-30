// The Sessions' terminals, one per tab, and the basic tab strip that the `sessions = "tabs"`
// option shows instead of the Sidebar's Sessions section. Inactive terminals stay mounted, just
// hidden, so their screens survive switching. Buttons here run command lines (`session N`,
// `close N`, `reconnect`) like every other way in.
import type { ErrorRow } from "../errors/catalog";
import { ErrorPanel, type ProblemActions } from "../errors/ErrorPanel";
import type { CommandLine } from "../keymap";
import type { TerminalEnv, TerminalViewComponent } from "../terminal/TerminalView";
import { Keys } from "../ui/Keys";
import type { Tab, Tabs, TabsSnapshot } from "./tabs";
import { CloseGlyph } from "../ui/CloseGlyph";

export function statusText(tab: Tab): string {
  const s = tab.status;
  switch (s.state) {
    case "connecting":
      return "connecting…";
    case "open":
      return "";
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
  const cls = ["st", auth === "password" ? "pw" : "", done ? "ended" : "", auth === null && !done ? "pending" : ""];
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
              title={tab.auth ? `${tab.auth} login` : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run(`session ${i + 1}`)}
            >
              <StateDot tab={tab} />
              <span className="tab-host">{tab.label}</span>
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

export interface SessionPanesProps {
  tabs: Pick<Tabs, "wiring">;
  snapshot: TabsSnapshot;
  leader: string;
  terminalView: TerminalViewComponent;
  /** Shared by every terminal (options, keys, clipboard). */
  terminalEnv: TerminalEnv;
  /** The keys that reconnect an ended tab ("␣ r"), if the keymap has them. */
  reconnectKeys: string | null;
  /** Runs a command line (the Retry and Reconnect buttons run `reconnect`). */
  run(line: CommandLine): void;
  /** The error catalog's rows (docs/errors.md), for a refused or failed Session. */
  errorRows: readonly ErrorRow[];
  /** Puts a command from an error's fix on the clipboard. */
  copy(text: string): Promise<void>;
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
            {s.state === "connecting" && <div className="session-note">Connecting to {tab.host}…</div>}
            {s.state === "ended" && s.problem && (
              <div className="session-error overlay">
                <ErrorPanel title="Session ended" problem={s.problem} rows={errorRows} actions={actions} />
              </div>
            )}
            {s.state === "ended" && !s.problem && (
              <div className="session-note ended">
                <span>{statusText(tab)}</span>
                {reconnectKeys && (
                  <span className="muted">
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
