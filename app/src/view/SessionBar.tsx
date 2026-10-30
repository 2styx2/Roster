// The session bar (ticket 22): Focus's optional tmux-style line, `[box] 1:esxi-02* 2:orion3-`,
// with the Session on screen starred, the one before it marked `-`, and the current Session's
// address and login type at the end. Numbers are what `␣ N` and `session N` take. A click runs
// `session N`, like every other way in.
//
// Fifty Sessions don't fit on one line (ticket 27): the list scrolls itself to keep the current
// one in view, a long name is cut in the middle of the line's room but keeps its number, its
// " (2)" and its mark, and the whole name is in its tooltip.
import { useLayoutEffect, useRef } from "react";
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
  const list = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    list.current?.querySelector(".current")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [snapshot.active]);
  const info = current ? [host?.ip, current.auth && `${current.auth} login`].filter(Boolean).join(" · ") : "";
  return (
    <nav className="sessionbar" aria-label="Session bar">
      <span className="sessionbar-box" title={box}>
        [<span className="sessionbar-box-name">{box}</span>]
      </span>
      <span className="sessionbar-tabs" ref={list}>
        {snapshot.tabs.map((tab, i) => {
          const mark = tab.id === snapshot.active ? "*" : tab.id === snapshot.previous ? "-" : "";
          const tail = tab.label === tab.host ? "" : tab.label.slice(tab.host.length);
          return (
            <button
              key={tab.id}
              type="button"
              tabIndex={-1}
              className={`sessionbar-tab${mark === "*" ? " current" : ""}`}
              aria-current={mark === "*" || undefined}
              aria-label={`${i + 1}:${tab.label}${mark === "*" ? ", current" : mark === "-" ? ", previous" : ""}`}
              title={tab.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run(`session ${i + 1}`)}
            >
              <span aria-hidden="true">{i + 1}:</span>
              <span className="sessionbar-name" aria-hidden="true">
                {tab.label.slice(0, tab.label.length - tail.length)}
              </span>
              {(tail || mark) && <span aria-hidden="true">{`${tail}${mark}`}</span>}
            </button>
          );
        })}
      </span>
      {info && (
        <span className="sessionbar-info" title={info}>
          {info}
        </span>
      )}
    </nav>
  );
}
