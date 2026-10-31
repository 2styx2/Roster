// The Plugin pieces the core draws (ticket 23, decision Q81): the permission prompt, `:plugins`,
// a Plugin's floating window and its notices. A Plugin only ever hands over text; these draw it
// with roster's own tokens and keycaps, so a Plugin looks native and can't draw anything else.
// They open from a key or a command, so none of them animates (taste.md: motion confirms; a key
// confirms itself), like the other side panels.
import { useEffect, useRef, useState } from "react";
import { CloseGlyph } from "../ui/CloseGlyph";
import { Keys } from "../ui/Keys";
import type { Notice, PluginStatus, Prompt, Snapshot } from "./manager";

/** Install or update: who it's from, every permission with the risky ones flagged and explained. */
export function PluginPrompt({ prompt, onAnswer }: { prompt: Prompt; onAnswer(allow: boolean): void }) {
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => yes.current?.focus(), []);
  const m = prompt.manifest;
  const install = prompt.kind === "install";
  const asked = m.permissions.filter((p) => prompt.asking.includes(p.name));
  const title = install ? `Install ${m.name}?` : `${m.name} asks for more`;
  const action = install ? "Install" : "Allow";
  return (
    <section
      tabIndex={-1}
      className="side-panel plugin-prompt"
      role="alertdialog"
      aria-label={title}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        onAnswer(false);
      }}
    >
      <header>
        <h2>{title}</h2>
        <button type="button" className="icon-button close" aria-label="Cancel" onClick={() => onAnswer(false)}>
          <CloseGlyph />
        </button>
      </header>
      <p className="plugin-about">
        {m.description || "No description."} <span className="mono">{m.version}</span>
        {m.author ? <> by {m.author}</> : null}
      </p>
      <p className="plugin-source muted">
        Unverified: from <span className="mono">{prompt.path}</span>. A Plugin is code; install only what you trust.
      </p>
      {asked.length === 0 ? (
        <p>It asks for no permissions: it can add commands, keys and its own UI, and nothing else.</p>
      ) : (
        <>
          <p>{install ? "It asks to:" : "Its new version also asks to:"}</p>
          <ul className="plugin-permissions">
            {asked.map((p) => (
              <li key={p.name} className={p.risk ? "risky" : undefined}>
                <span className="mono">{p.name}</span> {p.summary}
                {p.risk && <span className="plugin-risk">{p.risk}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted">It never sees a password, the vault or what you type at a login prompt, and it can&rsquo;t Publish.</p>
      <div className="edit-actions">
        <button ref={yes} type="button" onClick={() => onAnswer(true)}>
          {action}
        </button>
        <button type="button" onClick={() => onAnswer(false)}>
          {install ? "Cancel" : "Not now"}
        </button>
        <span className="edit-keys muted key-hint">
          <Keys keys="Enter" /> {action.toLowerCase()} <Keys keys="Escape" /> {install ? "cancel" : "run without them"}
        </span>
      </div>
    </section>
  );
}

const ago = (at: number, now: number) => {
  const s = Math.max(0, Math.round((now - at) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};

function PluginRow({ p, onGrant, now }: { p: PluginStatus; onGrant(name: string, permission: string, on: boolean): void; now: number }) {
  const state = p.waiting ? "waiting for you" : p.problem ? "stopped" : "running";
  return (
    <li className="plugin-row" aria-label={`${p.name}, ${state}`}>
      <div className="plugin-head">
        <span className="plugin-name mono">{p.name}</span>
        {p.manifest && <span className="mono muted">{p.manifest.version}</span>}
        <span className={`plugin-state${p.problem ? " problem" : ""}`}>{state}</span>
      </div>
      <div className="plugin-source muted mono">{p.builtin ? "built into roster" : p.path}</div>
      {p.problem && <div className="plugin-problem">{p.problem}</div>}
      {p.manifest && p.manifest.permissions.length > 0 ? (
        <ul className="plugin-permissions">
          {p.manifest.permissions.map((perm) => {
            const on = p.granted.includes(perm.name);
            return (
              <li key={perm.name} className={perm.risk ? "risky" : undefined}>
                <label>
                  <input type="checkbox" role="switch" checked={on} onChange={() => onGrant(p.name, perm.name, !on)} />{" "}
                  <span className="mono">{perm.name}</span> {perm.summary}
                </label>
              </li>
            );
          })}
        </ul>
      ) : (
        p.manifest && <div className="muted">No permissions.</div>
      )}
      {p.uses.length > 0 && (
        <div className="plugin-uses muted">
          Recently: {p.uses.slice(0, 3).map((u) => `${u.what} ${ago(u.at, now)}`).join(", ")}
        </div>
      )}
    </li>
  );
}

/** `:plugins`: every Plugin, whether it runs, its grants as toggles, and what it did lately. */
export function PluginsPanel({
  snapshot,
  onGrant,
  onClose,
}: {
  snapshot: Snapshot;
  onGrant(name: string, permission: string, on: boolean): void;
  onClose(): void;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => panel.current?.focus(), []);
  // "2m ago" is counted from when the panel opened.
  const [now] = useState(() => Date.now());
  return (
    <section
      ref={panel}
      tabIndex={-1}
      className="side-panel plugins-panel"
      aria-label="Plugins"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <header>
        <h2>Plugins</h2>
        <button type="button" className="icon-button close" aria-label="Close" onClick={onClose}>
          <CloseGlyph />
        </button>
      </header>
      {snapshot.plugins.length === 0 ? (
        <p className="panel-empty">
          No Plugins. <code>:plugins install PATH</code> installs one from a folder.
        </p>
      ) : (
        <ul className="plugin-list">
          {snapshot.plugins.map((p) => (
            <PluginRow key={p.name} p={p} onGrant={onGrant} now={now} />
          ))}
        </ul>
      )}
      <p className="panel-foot muted">
        A switch off takes that permission away at once. <code>:plugins remove NAME</code> uninstalls; <code>:help plugins</code> says more.
      </p>
    </section>
  );
}

/** A Plugin's floating window over the terminal: a title and lines of text. Esc closes it. */
export function PluginFloatPanel({ float, onClose }: { float: NonNullable<Snapshot["float"]>; onClose(): void }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => panel.current?.focus(), []);
  return (
    <aside
      ref={panel}
      tabIndex={-1}
      className="side-panel plugin-float"
      aria-label={`${float.title || float.plugin} (from ${float.plugin})`}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <header>
        <h2>{float.title || float.plugin}</h2>
        <button type="button" className="icon-button close" aria-label="Close" onClick={onClose}>
          <CloseGlyph />
        </button>
      </header>
      <pre className="plugin-float-lines">{float.lines.join("\n")}</pre>
      <p className="panel-foot muted">From {float.plugin}</p>
    </aside>
  );
}

/** What Plugins said, and their errors (naming the Plugin, file and line). */
export function PluginNotices({ notices, onClose }: { notices: readonly Notice[]; onClose(id: number): void }) {
  if (notices.length === 0) return null;
  return (
    <div className="plugin-notices">
      {notices.map((n) => (
        <div
          key={n.id}
          className={`config-toast${n.level === "error" ? " error" : ""}`}
          role={n.level === "info" ? "status" : "alert"}
          aria-label={`From ${n.plugin}`}
        >
          <div className="config-toast-head">
            <span className="config-toast-title">{n.text}</span>
            <button type="button" className="config-toast-close" aria-label="Close" onClick={() => onClose(n.id)}>
              <CloseGlyph />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
