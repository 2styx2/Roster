// The Sessions' terminals, one per tab, and the basic tab strip that the `sessions = "tabs"`
// option shows instead of the Sidebar's Sessions section. Inactive terminals stay mounted, just
// hidden, so their screens survive switching.
import type { CommandLine } from "../keymap";
import type { TerminalViewComponent } from "../terminal/TerminalView";
import type { Tab, Tabs, TabsSnapshot } from "./tabs";

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
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run(`session ${i + 1}`)}
            >
              <span className="tab-host">{tab.host}</span>
              {status && <span className="tab-status"> {status}</span>}
            </button>
            <button
              type="button"
              className="tab-close"
              aria-label={`Close ${tab.host}`}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run(`close ${i + 1}`)}
            >
              ×
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
}

export function SessionPanes({ tabs, snapshot, leader, terminalView: TerminalView }: SessionPanesProps) {
  return (
    <div className="panes">
      {snapshot.tabs.map((tab) => {
        const active = tab.id === snapshot.active;
        const s = tab.status;
        const wiring = tabs.wiring(tab.id);
        return (
          <div key={tab.id} className="pane" role="group" aria-label={`Session ${tab.host}`} hidden={!active}>
            {s.state === "failed" ? (
              <div className="session-error" role="alert">
                <p>Couldn't open a Session to {tab.host}:</p>
                <p className="session-error-message">{s.message}</p>
              </div>
            ) : (
              wiring && <TerminalView active={active} leader={leader} {...wiring} />
            )}
            {s.state === "connecting" && <div className="session-note">Connecting to {tab.host}…</div>}
            {s.state === "ended" && <div className="session-note ended">{statusText(tab)}</div>}
          </div>
        );
      })}
    </div>
  );
}
