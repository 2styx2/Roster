// The Session tabs: a minimal tab strip (see, switch, close; the full tab and keyboard model is
// ticket 07) over one terminal per tab. Inactive terminals stay mounted, just hidden, so their
// screens survive switching.
import type { TerminalEnv, TerminalViewComponent } from "../terminal/TerminalView";
import type { Tab, Tabs, TabsSnapshot } from "./tabs";

export interface SessionsProps {
  tabs: Tabs;
  snapshot: TabsSnapshot;
  leader: string;
  terminalView: TerminalViewComponent;
  /** Shared by every terminal (options, keys, clipboard). */
  terminalEnv: TerminalEnv;
  /** The keys that reconnect an ended tab ("Ctrl+Space r"), if the keymap has them. */
  reconnectKeys: string | null;
}

function statusText(tab: Tab): string {
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

export function Sessions({
  tabs,
  snapshot,
  leader,
  terminalView: TerminalView,
  terminalEnv,
  reconnectKeys,
}: SessionsProps) {
  return (
    <div className="sessions">
      <div className="tabstrip" role="tablist" aria-label="Sessions">
        {snapshot.tabs.map((tab) => {
          const selected = tab.id === snapshot.active;
          const status = statusText(tab);
          return (
            <div key={tab.id} className={`tab${selected ? " selected" : ""} ${tab.status.state}`}>
              <button
                type="button"
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={`pane-${tab.id}`}
                tabIndex={-1}
                onClick={() => tabs.select(tab.id)}
              >
                <span className="tab-host">{tab.label}</span>
                {status && <span className="tab-status"> {status}</span>}
              </button>
              <button
                type="button"
                className="tab-close"
                aria-label={`Close ${tab.host}`}
                tabIndex={-1}
                onClick={() => tabs.close(tab.id)}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <div className="panes">
        {snapshot.tabs.map((tab) => {
          const active = tab.id === snapshot.active;
          const s = tab.status;
          const wiring = tabs.wiring(tab.id);
          return (
            <div
              key={tab.id}
              className="pane"
              role="tabpanel"
              id={`pane-${tab.id}`}
              aria-labelledby={`tab-${tab.id}`}
              hidden={!active}
            >
              {s.state === "failed" ? (
                <div className="session-error" role="alert">
                  <p>Couldn't open a Session to {tab.host}:</p>
                  <p className="session-error-message">{s.message}</p>
                  <button type="button" onClick={() => tabs.reconnect(tab.id)}>
                    Retry
                  </button>
                </div>
              ) : (
                wiring && <TerminalView active={active} leader={leader} {...wiring} env={terminalEnv} />
              )}
              {s.state === "connecting" && <div className="session-note">Connecting to {tab.host}…</div>}
              {s.state === "ended" && (
                <div className="session-note ended">
                  <span>{statusText(tab)}</span>
                  {reconnectKeys && (
                    <span className="muted">
                      {" "}
                      · <kbd>{reconnectKeys}</kbd> or
                    </span>
                  )}{" "}
                  <button type="button" className="reconnect" onClick={() => tabs.reconnect(tab.id)}>
                    Reconnect
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
