// The Plugin pieces the core draws (ticket 23, decision Q81): the permission prompt, `:plugins`,
// a Plugin's floating window and its notices. A Plugin only ever hands over text; these draw it
// with roster's own tokens and keycaps, so a Plugin looks native and can't draw anything else.
// They open from a key or a command, so none of them animates (taste.md: motion confirms; a key
// confirms itself), like the other side panels.
import { useEffect, useRef, useState } from "react";
import { CloseGlyph } from "../ui/CloseGlyph";
import { Keys } from "../ui/Keys";
import type { PackageStatus, PackageUpdate } from "../backend/types";
import { kindOf, SIGN_WORD } from "../edit/ChangesPanel";
import { PACKAGE_PREFIX, type Notice, type PluginStatus, type Prompt, type Snapshot } from "./manager";

/** Install or update: who it's from, every permission with the risky ones flagged and explained.
 * A Package's shows its git URL as the source, and its update the new commit and its diff. */
/** It opens with the keys on the safe choice (Cancel, Keep, Not now), never on Install: a prompt can
 * come up while you're typing elsewhere (behind the lock screen, after a command line), and a stray
 * Enter mustn't run code you haven't read about. Install is a deliberate move (Shift+Tab, or a
 * click), and a held-down Enter answers nothing (decision Q87). `safe` is that button, for the
 * workspace to give the keys back to. */
export function PluginPrompt({ prompt, onAnswer, safe }: { prompt: Prompt; onAnswer(allow: boolean): void; safe?: (button: HTMLButtonElement | null) => void }) {
  const no = useRef<HTMLButtonElement>(null);
  useEffect(() => no.current?.focus(), []);
  const m = prompt.manifest;
  const install = prompt.kind === "install";
  const pkg = prompt.package;
  const update = pkg?.update;
  const asked = m.permissions.filter((p) => prompt.asking.includes(p.name));
  const title = install ? `Install ${m.name}?` : update ? `Update ${m.name}?` : `${m.name} asks for more`;
  const action = install ? "Install" : update ? "Update" : "Allow";
  const noLabel = install ? "Cancel" : update ? `Keep ${short(update.from)}` : "Not now";
  const noHint = install ? "cancel" : update ? "keep the version it has" : "run without them";
  return (
    <section
      tabIndex={-1}
      className="side-panel plugin-prompt"
      role="alertdialog"
      aria-label={title}
      onKeyDown={(e) => {
        // A key held down from before the prompt (the Enter that unlocked, say) answers nothing.
        if (e.key === "Enter" && e.repeat) {
          e.preventDefault();
          return;
        }
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        onAnswer(false);
      }}
    >
      <header>
        <h2>{title}</h2>
        <button type="button" className="icon-button close" aria-label={noLabel} onClick={() => onAnswer(false)}>
          <CloseGlyph />
        </button>
      </header>
      <p className="plugin-about">
        {m.description || "No description."} <span className="mono">{m.version}</span>
        {m.author ? <> by {m.author}</> : null}
      </p>
      <p className="plugin-source muted">
        Unverified: from <span className="mono">{pkg ? pkg.url : prompt.path}</span>
        {pkg?.commit && !update ? (
          <>
            {" "}
            at <span className="mono">{short(pkg.commit)}</span>
          </>
        ) : null}
        . A Plugin is code; install only what you trust.
      </p>
      {update && <PackageChange update={update} />}
      {asked.length === 0 ? (
        <p>
          {update
            ? "It asks for no new permissions."
            : "It asks for no permissions: it can add commands, keys and its own UI, and nothing else."}
        </p>
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
        <button type="button" onClick={() => onAnswer(true)}>
          {action}
        </button>
        <button
          ref={(el) => {
            no.current = el;
            safe?.(el);
          }}
          type="button"
          onClick={() => onAnswer(false)}
        >
          {noLabel}
        </button>
        <span className="edit-keys muted key-hint">
          <Keys keys="Shift+Tab Enter" /> {action.toLowerCase()} <Keys keys="Escape" /> {noHint}
        </span>
      </div>
    </section>
  );
}

const short = (commit: string | null) => (commit ?? "").slice(0, 7);

/** What a Package's update changes: the commits, then the diff (data, so Iosevka; tinted lines). */
function PackageChange({ update }: { update: PackageUpdate }) {
  const lines = update.diff.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return (
    <>
      <p>
        <span className="mono">{short(update.from)}</span> to <span className="mono">{short(update.to)}</span>
        {update.log.length > 0 && <>, {update.log.length === 1 ? "1 commit" : `${update.log.length} commits`}:</>}
      </p>
      {update.log.length > 0 && (
        <ul className="package-log mono">
          {update.log.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      <pre className="diff package-diff" aria-label={`What changes from ${short(update.from)} to ${short(update.to)}`}>
        {lines.map((line, i) => {
          const kind = kindOf(line);
          return (
            <span key={i} className={`diff-line ${kind}`}>
              {(kind === "add" || kind === "del") && <span className="visually-hidden">{SIGN_WORD[kind]}</span>}
              {line || " "}
              {"\n"}
            </span>
          );
        })}
      </pre>
      {update.truncated && <p className="muted">The diff is cut short here; the rest is in the repo.</p>}
    </>
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
      <div className="plugin-source muted mono">
        {p.builtin ? "built into roster" : p.path.startsWith(PACKAGE_PREFIX) ? `Package ${p.path.slice(PACKAGE_PREFIX.length)}` : p.path}
      </div>
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
        // A key held down from before the prompt (the Enter that unlocked, say) answers nothing.
        if (e.key === "Enter" && e.repeat) {
          e.preventDefault();
          return;
        }
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
        // A key held down from before the prompt (the Enter that unlocked, say) answers nothing.
        if (e.key === "Enter" && e.repeat) {
          e.preventDefault();
          return;
        }
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

/** What a Package is doing, in a word or two. */
function packageState(p: PackageStatus, plugin: PluginStatus | undefined): { text: string; problem: boolean } {
  if (p.error) return { text: "can't fetch", problem: true };
  if (!p.pinned) return { text: "not installed", problem: false };
  if (!plugin) return { text: "installed", problem: false };
  if (plugin.waiting) return { text: "waiting for you", problem: false };
  if (plugin.problem) return { text: "stopped", problem: true };
  return { text: "running", problem: false };
}

/** `:packages`: what init.lua names, the commit each is at, and whether it runs. */
export function PackagesPanel({ snapshot, onClose }: { snapshot: Snapshot; onClose(): void }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => panel.current?.focus(), []);
  return (
    <section
      ref={panel}
      tabIndex={-1}
      className="side-panel plugins-panel"
      aria-label="Packages"
      onKeyDown={(e) => {
        // A key held down from before the prompt (the Enter that unlocked, say) answers nothing.
        if (e.key === "Enter" && e.repeat) {
          e.preventDefault();
          return;
        }
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <header>
        <h2>Packages</h2>
        <button type="button" className="icon-button close" aria-label="Close" onClick={onClose}>
          <CloseGlyph />
        </button>
      </header>
      {snapshot.packages.length === 0 ? (
        <p className="panel-empty">
          No Packages. Name one in init.lua: <code>packages = {"{"} {"{"} &quot;owner/repo&quot;, tag = &quot;v1.0.0&quot; {"}"} {"}"}</code>
        </p>
      ) : (
        <ul className="plugin-list">
          {snapshot.packages.map((p) => {
            const plugin = snapshot.plugins.find((x) => x.path === `${PACKAGE_PREFIX}${p.name}`);
            const state = packageState(p, plugin);
            return (
              <li key={p.name} className="plugin-row" aria-label={`${p.name}, ${state.text}`}>
                <div className="plugin-head">
                  <span className="plugin-name mono">{p.name}</span>
                  {p.commit && <span className="mono muted">{short(p.commit)}</span>}
                  <span className={`plugin-state${state.problem ? " problem" : ""}`}>{state.text}</span>
                </div>
                <div className="plugin-source muted mono">{p.url}</div>
                <div className="muted">{p.wants}</div>
                {p.note && <div className="muted">{p.note}</div>}
                {(p.error ?? plugin?.problem) && <div className="plugin-problem">{p.error ?? plugin?.problem}</div>}
              </li>
            );
          })}
        </ul>
      )}
      <p className="panel-foot muted">
        <code>:packages update</code> shows what&rsquo;s new before applying it; <code>:packages clean</code> removes what init.lua no
        longer names. Pinned in <code>roster.lock</code>, next to init.lua.
      </p>
    </section>
  );
}
