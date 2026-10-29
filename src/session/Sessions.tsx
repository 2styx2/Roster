// The Session tabs: a minimal tab strip (see, switch, close; the full tab and keyboard model is
// ticket 07) over one terminal per tab. Inactive terminals stay mounted, just hidden, so their
// screens survive switching.
import type { TerminalViewComponent } from "../terminal/TerminalView";
import type { Tab, Tabs, TabsSnapshot } from "./tabs";

export interface SessionsProps {
  tabs: Tabs;
  snapshot: TabsSnapshot;
  leader: string;
  terminalView: TerminalViewComponent;
}

/** The tab's state dot (as in the prototype): filled for a key login, hollow for a password one,
 * grey once the Session has ended or was refused. */
function StateDot({ tab }: { tab: Tab }) {
  const done = tab.status.state === "ended" || tab.status.state === "failed";
  const auth = tab.auth;
  const cls = ["st", auth === "password" ? "pw" : "", done ? "ended" : "", auth === null && !done ? "pending" : ""];
  const label = auth ? `${auth} login` : "not connected";
  return <span className={cls.filter(Boolean).join(" ")} role="img" aria-label={label} />;
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

export function Sessions({ tabs, snapshot, leader, terminalView: TerminalView }: SessionsProps) {
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
                <StateDot tab={tab} />
                <span className="tab-host">{tab.host}</span>
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
    </div>
  );
}
