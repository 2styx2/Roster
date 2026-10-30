// The session bar (ticket 22): Focus's optional tmux-style line, `[box] 1:esxi-02* 2:orion3-`,
// with the Session on screen starred, the one before it marked `-`, and the current Session's
// address and login type at the end. Numbers are what `␣ N` and `session N` take. A click runs
// `session N`, like every other way in.
import type { Host } from "../backend/types";
import type { CommandLine } from "../keymap";
import type { TabsSnapshot } from "../session/tabs";

export interface SessionBarProps {
  box: string;
  snapshot: TabsSnapshot;
  hostByName: ReadonlyMap<string, Host>;
  run(line: CommandLine): void;
}

export function SessionBar({ box, snapshot, hostByName, run }: SessionBarProps) {
  const current = snapshot.tabs.find((t) => t.id === snapshot.active);
  const host = current ? hostByName.get(current.host) : undefined;
  return (
    <nav className="sessionbar" aria-label="Session bar">
      <span className="sessionbar-box">[{box}]</span>
      {snapshot.tabs.map((tab, i) => {
        const mark = tab.id === snapshot.active ? "*" : tab.id === snapshot.previous ? "-" : "";
        return (
          <button
            key={tab.id}
            type="button"
            tabIndex={-1}
            className={`sessionbar-tab${mark === "*" ? " current" : ""}`}
            aria-current={mark === "*" || undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run(`session ${i + 1}`)}
          >
            {`${i + 1}:${tab.label}${mark}`}
          </button>
        );
      })}
      <span className="grow" />
      {current && (
        <span className="sessionbar-info">
          {[host?.ip, current.auth && `${current.auth} login`].filter(Boolean).join(" · ")}
        </span>
      )}
    </nav>
  );
}
