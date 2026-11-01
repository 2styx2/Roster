/* eslint-disable no-control-regex -- terminal escape sequences are made of control characters */
// Shell hooks (ticket 121, #210; decision Q130): opt-in, roster sends one line to a Session's
// shell after login that turns on OSC 133 marks (and OSC 7, its folder) in that shell process
// only. Nothing is written to the Host's files: the hook goes when the shell exits.
//
// It's careful about when: only once the login has gone quiet at a prompt it knows (a POSIX
// shell's `$ `, `# ` or `% `, fish's `user@host ~> `, PowerShell's `PS …> `), never once the
// user has typed, never when the shell already marks its prompts. A login that isn't a plain
// shell (a forced command, a menu, a network CLI, ESXi's busybox prompt) shows no prompt it
// knows, so nothing is sent.

/** Which hook line fits the shell: one for bash and zsh (it checks which it's in, and does
 * nothing in another POSIX shell), one for fish, one for PowerShell. */
export type ShellKind = "posix" | "fish" | "pwsh";

/** CSI, OSC and other escape sequences, so a coloured prompt reads as its text. */
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[^[\]]/g;

/** The text of the line the cursor is on: what follows the last line feed or carriage return. */
export function lastLine(out: string): string {
  const plain = out.replace(ESCAPES, "");
  return plain.slice(Math.max(plain.lastIndexOf("\n"), plain.lastIndexOf("\r")) + 1);
}

const PWSH = /^PS \S.*> $/;
const FISH = /^[^\s@[\]:]+@[^\s@[\]:]+ [~/]\S*(?: \([^)]*\))?[>#] $/;
const POSIX = /[$#%] $/;

// The hook lines: the snippets in docs/plugins.md ("Shell integration"), squeezed to one line,
// plus OSC 7 (the folder) at each prompt. Each starts with a space, so a shell set to leave such
// lines out of its history (bash's HISTCONTROL=ignorespace or ignoreboth, zsh's
// HIST_IGNORE_SPACE, fish always) does. docs/plugins.md shows them as sent; keep it in step.
//
// The POSIX one runs in bash and zsh: bash's half is plain POSIX syntax behind a test of
// $BASH_VERSION; zsh's is a quoted string, eval'd behind $ZSH_VERSION, so another POSIX shell
// (dash, busybox ash, ksh) parses both and runs neither. The PowerShell one uses [char]27, not
// `e, so Windows PowerShell 5.1 gets marks and not stray letters.
const BASH =
  '[ -n "$BASH_VERSION" ] && { __roster_d(){ local c=$?; printf "\\e]133;D;%s\\a\\e]7;file://%s%s\\a" $c "$HOSTNAME" "$PWD"; return $c; }; ' +
  'PROMPT_COMMAND="__roster_d${PROMPT_COMMAND:+;$PROMPT_COMMAND}"; PS1="\\[\\e]133;A\\a\\]$PS1\\[\\e]133;B\\a\\]"; PS0="\\e]133;C\\a$PS0"; }';
const ZSH =
  "[ -n \"$ZSH_VERSION\" ] && eval '__roster_d(){ printf \"\\e]133;D;%s\\a\\e]7;file://%s%s\\a\" $? \"$HOST\" \"$PWD\"; }; " +
  '__roster_c(){ printf "\\e]133;C\\a"; }; precmd_functions=(__roster_d $precmd_functions); preexec_functions+=(__roster_c); ' +
  "PS1=\"%{$(printf \"\\e]133;A\\a\")%}$PS1%{$(printf \"\\e]133;B\\a\")%}\"'";
const FISH_HOOK =
  "function __roster_a --on-event fish_prompt; printf '\\e]7;file://%s%s\\a\\e]133;A\\a' $hostname $PWD; end; " +
  "functions -c fish_prompt __roster_p; function fish_prompt; __roster_p; printf '\\e]133;B\\a'; end; " +
  "function __roster_c --on-event fish_preexec; printf '\\e]133;C\\a'; end; " +
  "function __roster_d --on-event fish_postexec; printf '\\e]133;D;%s\\a' $status; end";
const PWSH_HOOK =
  "$Global:__roster_p=$function:prompt; function Global:prompt { $c=if($?){0}elseif($LASTEXITCODE){$LASTEXITCODE}else{1}; " +
  "$e=[char]27; $b=[char]7; $d='/'+($PWD.ProviderPath -replace '\\\\','/').TrimStart('/'); " +
  '"$e]133;D;$c$b$e]7;file://$([Environment]::MachineName)$d$b$e]133;A$b$(& $Global:__roster_p)$e]133;B$b" }; ' +
  'try { Set-PSReadLineOption -AddToHistoryHandler { param($l) [Console]::Write("$([char]27)]133;C$([char]7)"); ' +
  "try { [Microsoft.PowerShell.PSConsoleReadLine]::GetDefaultAddToHistoryOption($l) } catch { $true } } } catch {}";

/** The one line roster sends (without the Enter) to turn the marks on in a `kind` shell. */
export function hookLine(kind: ShellKind): string {
  if (kind === "fish") return ` ${FISH_HOOK}`;
  if (kind === "pwsh") return ` ${PWSH_HOOK}`;
  return ` ${BASH}; ${ZSH}`;
}

/** The shell whose idle prompt ends `out`, or null when it isn't a prompt roster knows. */
export function promptShell(out: string): ShellKind | null {
  const line = lastLine(out);
  if (PWSH.test(line)) return "pwsh";
  if (FISH.test(line)) return "fish";
  if (POSIX.test(line)) return "posix";
  return null;
}

/** How long the login must stay quiet at a prompt before roster sends the line. */
export const IDLE_MS = 400;
/** How long after the Session starts roster may send it: a prompt after that isn't the login's. */
export const WINDOW_MS = 20_000;
/** How long the echo is held off the screen waiting for the new prompt; then it all shows. */
export const HOLD_MS = 2_000;
/** The most output held; more, and it all shows. */
const HOLD_MAX = 16 * 1024;
const TAIL_MAX = 1024;

/** What `:integrate` did: sent the line, or why not. */
export type IntegrateResult = "sent" | "sent-already" | "marked" | "no-prompt" | "not-open";

export interface ShellHooksIo {
  /** Writes `line` to the Session; false when it isn't open (yet). */
  write(line: string): boolean;
  /** Puts output on the screen (and in its replay), after it was held. */
  show(data: Uint8Array): void;
  /** The shell said its folder (OSC 7). */
  cwd(path: string): void;
  /** Whether roster may send the line by itself (`shell_hooks`). */
  enabled(): boolean;
}

/** What the terminal answers by itself (a cursor or colour report, focus in or out, its
 * attributes): not typing. */
const REPORT = /^(?:\x1b\[\d+;\d+R|\x1b\[[IO]|\x1b\[[?>][\d;]*c|\x1b\]\d+;[^\x07\x1b]*(?:\x07|\x1b\\))+$/;
const MARK_A = /\x1b\]133;A[^\x07\x1b]*(?:\x07|\x1b\\)/;
const MARK_B = /\x1b\]133;B[^\x07\x1b]*(?:\x07|\x1b\\)/;
const OSC7 = /\x1b\]7;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
const OSC7_START = "\x1b]7;";

const squash = (s: string) => s.replace(ESCAPES, "").replace(/\s+/g, "");
const encoder = new TextEncoder();

/** The folder in an OSC 7 `file://host/path`, decoded where it can be; null for anything else. */
function folderOf(url: string): string | null {
  const m = /^file:\/\/[^/]*(\/.*)$/.exec(url);
  if (!m?.[1]) return null;
  let path = m[1];
  try {
    path = decodeURIComponent(path);
  } catch {
    // Not percent-encoded (the hook sends $PWD as it is): keep it.
  }
  return path.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 1024);
}

/** One Session attempt's shell hooks: watches its output for an idle prompt, sends the hook line
 * once, holds the echo back until the new prompt comes, and reads OSC 7. */
export class ShellHooks {
  private readonly io: ShellHooksIo;
  private tail = "";
  private armed = true;
  private typedYet = false;
  private marked = false;
  private sentLine: string | null = null;
  private held: Uint8Array[] | null = null;
  private heldText = "";
  private oscCarry = "";
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private holdTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly windowTimer: ReturnType<typeof setTimeout>;

  constructor(io: ShellHooksIo) {
    this.io = io;
    this.windowTimer = setTimeout(() => {
      this.armed = false;
      clearTimeout(this.idleTimer);
    }, WINDOW_MS);
  }

  /** The Session printed `data` (`text` decoded). Returns what to show now, or null: held. */
  output(data: Uint8Array, text: string): Uint8Array | null {
    this.scanFolder(text);
    if (this.held) {
      this.held.push(data);
      this.heldText += text;
      this.release();
      return null;
    }
    if (text.includes("\x1b]133;")) this.marked = true;
    this.tail = (this.tail + text).slice(-TAIL_MAX);
    if (this.armed && this.sentLine === null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => this.idle(), IDLE_MS);
    }
    return data;
  }

  /** The user typed `data` into the Session. */
  typed(data: string) {
    if (REPORT.test(data)) return;
    this.typedYet = true;
    clearTimeout(this.idleTimer);
    this.showHeld();
  }

  /** `:integrate`: sends the line now if the shell is at a prompt roster knows. */
  integrate(): IntegrateResult {
    if (this.sentLine !== null) return "sent-already";
    if (this.marked) return "marked";
    const kind = promptShell(this.tail);
    if (!kind) return "no-prompt";
    return this.send(kind) ? "sent" : "not-open";
  }

  /** The Session ended or its tab closed: what's held shows, and nothing more is sent. */
  stop() {
    clearTimeout(this.windowTimer);
    clearTimeout(this.idleTimer);
    this.armed = false;
    this.showHeld();
  }

  private idle() {
    if (!this.armed || this.typedYet || this.marked || this.sentLine !== null || !this.io.enabled()) return;
    const kind = promptShell(this.tail);
    if (kind && !this.send(kind)) this.idleTimer = setTimeout(() => this.idle(), IDLE_MS);
  }

  private send(kind: ShellKind): boolean {
    const line = hookLine(kind);
    if (!this.io.write(line + "\r")) return false;
    this.sentLine = line;
    this.armed = false;
    clearTimeout(this.idleTimer);
    this.held = [];
    this.heldText = "";
    this.holdTimer = setTimeout(() => this.showHeld(), HOLD_MS);
    return true;
  }

  /** The new prompt is in (its `A` and `B` marks) after nothing but the echo: the old prompt is
   * cleared and the new one drawn in its place. Anything else shows as it came. */
  private release() {
    const a = MARK_A.exec(this.heldText);
    const b = a ? MARK_B.exec(this.heldText.slice(a.index)) : null;
    if (!a || !b) {
      if (this.heldText.length > HOLD_MAX) this.showHeld();
      return;
    }
    const before = this.heldText.slice(0, a.index);
    if (squash(before) !== squash(this.sentLine ?? "")) return this.showHeld();
    // The echo goes; a mode the shell set or reset meanwhile (bracketed paste) stays.
    const modes = (before.match(/\x1b\[\?[\d;]*[hl]/g) ?? []).join("");
    const up = (this.heldText.slice(a.index, a.index + b.index).match(/\n/g) ?? []).length;
    const text = modes + "\r" + (up ? `\x1b[${up}A` : "") + "\x1b[J" + this.heldText.slice(a.index);
    this.endHold();
    this.io.show(encoder.encode(text));
  }

  private showHeld() {
    const held = this.held;
    if (!held) return;
    this.endHold();
    for (const chunk of held) this.io.show(chunk);
  }

  private endHold() {
    clearTimeout(this.holdTimer);
    this.held = null;
    this.heldText = "";
  }

  private scanFolder(text: string) {
    const s = this.oscCarry + text;
    this.oscCarry = "";
    if (!s.includes("\x1b")) return;
    let end = 0;
    for (const m of s.matchAll(OSC7)) {
      end = m.index + m[0].length;
      const folder = folderOf(m[1] ?? "");
      if (folder) this.io.cwd(folder);
    }
    // An OSC 7 cut off at the end of this read: the rest comes in the next.
    const open = s.lastIndexOf(OSC7_START);
    if (open >= end && s.length - open < 2048) this.oscCarry = s.slice(open);
    else {
      for (let n = OSC7_START.length - 1; n > 0; n--) {
        if (s.endsWith(OSC7_START.slice(0, n))) {
          this.oscCarry = s.slice(-n);
          break;
        }
      }
    }
  }
}

/** Whether roster sends the hook line by itself: init.lua's `terminal.shell_hooks` (`init`) and
 * the Host's `shell_hooks` in roster.yml (`host`; undefined for a Quick Connect). init.lua's
 * false is off everywhere; else the Host's own value wins, then init.lua's; off when neither says. */
export function shellHooksOn(init: boolean | null, host: boolean | null | undefined): boolean {
  if (init === false) return false;
  return host ?? init ?? false;
}
