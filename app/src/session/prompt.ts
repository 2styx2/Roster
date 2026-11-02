// Whether a Host Session waits at sudo's password prompt for its login user (ticket 119, decision
// Q129), read off a terminal's screen of its own (xterm's, never opened, as committed.ts does), so
// what the line shows is what the user sees: colours, rewrites and redraws are the terminal's. It
// only decides whether to *offer* the fill key; the Host prints all of it and can forge any of it.
// What makes a fill safe is checked elsewhere too: serve refuses a prompt that isn't this Host's
// own Login's, and a Host edited since the Session connected, and the core types the secret only
// after a probe shows the prompt doesn't echo (crates/roster-core/src/session.rs, `fill`).
//
// The rule is to refuse whenever in doubt. Only sudo's own prompt naming the login user is offered
// (`[sudo] password for ops:`): a bare `Password:` (su's, a login's) or ssh's says nothing roster
// can check here. With the shell's OSC 133 marks (Q121, or roster's shell hooks, Q130), it's
// offered only while the command running is sudo itself, running nothing that reaches another
// machine, and has printed nothing but sudo's own lines; at the shell's own prompt nothing is
// offered, and once a marked shell starts inside a command roster stays unsure for good. Without
// marks roster can't tell whether you've left the Host, and the offer says so.
//
// A nested ssh (ticket 120, decision Q131): with marks, the command line read at `C` is resolved to
// an Inventory Host (sshTarget.ts), shown as a breadcrumb until that ssh's D, and its login prompt
// (`USER@HOST's password:`, exactly the user and host ssh will print) is offered while that ssh
// logs in: before a shell starts there, before you type into it, with nothing printed after its
// first prompt but ssh's own retry line, once per ssh. That Host's sudo is offered only at the
// first command its own marked shell runs: once a command there ends, its marks can't be told from
// the outer shell's (a shell that dies sends no D). Without marks, nothing nested is offered.
import { Terminal } from "@xterm/xterm";
import type { NestedHost, TermSize } from "../backend/types";
import { resolveHop, type Hop, type HopHost } from "./sshTarget";

/** sudo's prompt, whole; the user is checked against the Session's login user. */
const SUDO = /^\[sudo\] password for ([^\s:]+):$/;
/** What sudo itself prints while it asks: its prompt (the password isn't echoed) and a retry. */
const SUDO_OWN = /^(?:\[sudo\] password for [^\s:]+:|Sorry, try again\.|)$/;
/** Programs that reach another machine, or run another program that may: sudo running any of
 * them is not sudo alone. */
const REMOTE = new Set([
  "ssh", "slogin", "mosh", "telnet", "rlogin", "rsh", "autossh", "sshpass", "ssh-copy-id", "scp", "sftp", "rsync",
  "ftp", "docker", "podman", "kubectl", "oc", "lxc", "lxc-attach", "incus", "nc", "ncat", "netcat", "socat", "virsh",
  "machinectl", "nsenter", "chroot", "su", "sudo", "doas", "pdsh", "ansible", "salt", "vagrant", "multipass",
  "screen", "tmux", "script", "expect", "env", "exec", "command", "time", "nice", "nohup", "stdbuf", "timeout",
  "xargs", "watch", "eval",
]); // prettier-ignore
/** sudo's options that take a value. */
const SUDO_ARG = new Set([
  "-u", "-g", "-h", "-p", "-C", "-D", "-r", "-t", "-U", "-T", "--user", "--group", "--host", "--prompt",
  "--close-from", "--chdir", "--role", "--type", "--other-user", "--command-timeout",
]); // prettier-ignore
/** Shell syntax that runs more than one program, or one roster can't see. */
const SHELL_SYNTAX = /[;&|`<>(){}]|\$\(/;
/** Lines of the screen kept above it, so where `B` left the cursor survives a scroll. */
const SCROLLBACK = 200;

const base = (word: string) => word.replace(/^['"]+|['"]+$/g, "").split("/").pop() ?? "";

/** Whether `command` runs sudo itself and nothing that reaches another machine: env assignments,
 * then `sudo`, its options, and a program that isn't one of REMOTE (nor is any word after it). */
export function sudoOnly(command: string): boolean {
  if (SHELL_SYNTAX.test(command)) return false;
  const words = command.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i] ?? "")) i++;
  if (base(words[i] ?? "") !== "sudo") return false;
  i++;
  while ((words[i] ?? "").startsWith("-")) {
    const opt = words[i] ?? "";
    i++;
    if (opt === "--") break;
    if (SUDO_ARG.has(opt)) i++;
  }
  return words.slice(i).every((w) => !REMOTE.has(base(w)));
}

/** OpenSSH's password prompt, whole: the user and the host it logs in to. */
const SSH = /^([^\s@']+)@([^\s@']+)'s password:$/;
/** What ssh itself prints after its first password prompt while it logs in. */
const SSH_OWN = /^(?:[^\s@']+@[^\s@']+'s password:|Permission denied, please try again\.|)$/;
/** ssh saying the connection ended: the next D is the outer shell's. */
const SSH_GONE = /^(?:Connection to \S+ closed|Connection closed by |client_loop: send disconnect|packet_write_wait: |Timeout, server \S+ not responding)/;
/** A command that ends the shell it's typed into (with no D of its own). */
const ENDS_SHELL = /^(?:exit|logout|exec)(?:\s|$)/;

export interface PasswordPrompt {
  /** The prompt line, as the Host printed it. */
  line: string;
  /** Why roster won't fill it (the marks say it may be another machine's); null: it may. */
  elsewhere: string | null;
  /** The shell's marks told roster what runs; false: it can't tell whether you've left the Host. */
  marked: boolean;
  /** sudo's prompt, or a nested ssh's login prompt (ticket 120). */
  kind: "sudo" | "ssh";
  /** The Inventory Host a nested ssh went to, whose Login answers it, and what roster resolved it
   * to (for serve's check); null: the Session's own Host. Never a password. */
  hop: FillHop | null;
}

/** The Host a nested ssh went to, as roster resolved it from the Inventory at its `C` mark. */
export type FillHop = NestedHost;

/** Where a nested ssh took the Session (ticket 120): an Inventory Host, or a target roster can't
 * resolve (`known: false`). */
export interface Breadcrumb {
  to: string;
  known: boolean;
}

/** What PromptWatch needs to follow a nested ssh: the Inventory, and whether roster serve fills
 * another Host's prompt (API 26). */
export interface HopSource {
  hosts(): readonly HopHost[];
  fill: boolean;
}

type Phase = "none" | "prompt" | "input" | "output" | "idle";

/** One shell's marks: the Session's own, or the one a nested ssh started. */
interface Level {
  phase: Phase;
  /** Where `B` left the cursor: a line of the buffer (scrollback included) and a column. */
  start: { line: number; col: number } | null;
  /** The running command's line, read at `C`; null when it couldn't be read. */
  command: string | null;
  /** The running command printed a line that isn't sudo's own. */
  dirty: boolean;
  /** The line a `C` came on before its line feed (pwsh's, and some shells'): the command line's,
   * not the command's output. */
  cLine: number | null;
}

const level = (): Level => ({ phase: "none", start: null, command: null, dirty: false, cLine: null });

/** A nested ssh, from its `C` to the D roster takes for its end. */
interface HopState {
  hop: Hop;
  /** The shell it started, once that marked a prompt. */
  inner: Level;
  innerMarked: boolean;
  /** A command ended there: from then on its marks can't be told from the outer shell's (its shell
   * may have ended without one), so its sudo isn't filled. */
  innerDone: boolean;
  /** A marked shell started inside a command there. */
  innerNested: boolean;
  /** Its shell exited, or ssh said the connection closed: the next D is the outer shell's. */
  ending: boolean;
  /** The user sent keys since the ssh started (a host-key answer, a typed password, a command). */
  typed: boolean;
  /** ssh's password prompt was committed (Enter), and since then a line that isn't ssh's own. */
  asked: boolean;
  sshDirty: boolean;
  /** A fill was tried at its login prompt. */
  filled: boolean;
}

export class PromptWatch {
  private readonly term: Terminal;
  private readonly user: string;
  private readonly hops: HopSource | null;
  private readonly outer: Level = level();
  /** A marked shell started inside a command: roster can't pair the marks again. */
  private nested = false;
  private hopState: HopState | null = null;
  private writes = 0;
  /** A fill was tried at the prompt as it was after this many writes: not offered again until more. */
  private spentAt = -1;

  /** A watch for a Session of `size` whose login user is `user`; with `hops`, it follows a nested
   * ssh to an Inventory Host (ticket 120). */
  constructor(size: TermSize, user: string, hops: HopSource | null = null) {
    this.user = user;
    this.hops = hops;
    this.term = new Terminal({ cols: size.cols, rows: size.rows, scrollback: SCROLLBACK, allowProposedApi: false });
    this.term.onLineFeed(() => this.lineFeed());
    this.term.parser.registerOscHandler(133, (data) => {
      this.mark(data);
      return true;
    });
  }

  /** Feeds the terminal; resolves once it has taken in `data`. */
  write(data: Uint8Array | string): Promise<void> {
    this.writes++;
    return new Promise((resolve) => this.term.write(data, resolve));
  }

  /** The user sent the Session keys (typed, pasted, or the shell hook line): a nested ssh's prompt
   * after that may not be its login's. A fill's own keys never come here. */
  typed() {
    if (this.hopState) this.hopState.typed = true;
  }

  resize(size: TermSize) {
    if (size.cols === this.term.cols && size.rows === this.term.rows) return;
    this.term.resize(size.cols, size.rows);
    // reflowed: rows aren't where they were
    this.outer.start = null;
    if (this.hopState) this.hopState.inner.start = null;
  }

  /** A fill was tried at this prompt: it isn't offered again until the Session prints more (and a
   * nested ssh's login prompt not again in that ssh). */
  spent() {
    if (this.hopState && this.prompt()?.kind === "ssh") this.hopState.filled = true;
    this.spentAt = this.writes;
  }

  /** The fill tried at this prompt typed nothing (roster serve refused it): offer it again. */
  unspent() {
    this.spentAt = -1;
    if (this.hopState) this.hopState.filled = false;
  }

  dispose() {
    this.term.dispose();
  }

  /** Where a nested ssh has taken the Session, until it ends; null on the Session's own Host. */
  hop(): Breadcrumb | null {
    const hop = this.hopState?.hop;
    if (!hop) return null;
    return hop.known ? { to: hop.host, known: true } : { to: hop.label, known: false };
  }

  /** The password prompt at the cursor that roster might fill, and whether it may; null when
   * there's none (or the marks say it's a shell's own prompt, or a fill was just tried). */
  prompt(): PasswordPrompt | null {
    if (this.writes === this.spentAt) return null;
    const b = this.term.buffer.active;
    if (b.type !== "normal") return null;
    const row = b.getLine(b.baseY + b.cursorY);
    const line = (row?.translateToString(false, 0, b.cursorX) ?? "").trim();
    const rest = (row?.translateToString(true, b.cursorX) ?? "").trim();
    if (rest !== "") return null;
    const sudo = SUDO.exec(line);
    const ssh = sudo ? null : SSH.exec(line);
    if (!sudo && !ssh) return null;
    if (this.outer.phase === "none") {
      if (sudo) return sudo[1] === this.user ? { line, elsewhere: null, marked: false, kind: "sudo", hop: null } : null;
      if (!this.hops) return null;
      const elsewhere = "without the shell's marks roster can't tell where this ssh went (turn on shell integration, or :integrate)";
      return { line, elsewhere, marked: false, kind: "ssh", hop: null };
    }
    const hop = this.hopState;
    if (hop) return sudo ? this.innerSudo(hop, line, sudo[1] ?? "") : this.hopLogin(hop, line, ssh?.[1] ?? "", ssh?.[2] ?? "");
    if (!sudo || sudo[1] !== this.user || this.outer.phase !== "output") return null;
    return { line, elsewhere: this.why(), marked: true, kind: "sudo", hop: null };
  }

  /** Why the marks leave roster unsure this prompt is the Host's own sudo's; null when they don't. */
  private why(): string | null {
    const { command, dirty } = this.outer;
    if (this.nested) return "a shell started inside a command in this Session, so roster can't tell what runs now";
    if (command === null) return "roster couldn't read the running command";
    if (!sudoOnly(command)) return `\`${command}\` is running, not sudo itself, so this prompt may be another machine's`;
    if (dirty) return "the command has printed more than sudo's own lines, so this prompt may be another machine's";
    return null;
  }

  /** A nested ssh's password prompt: filled only while that ssh is logging in to the Inventory
   * Host it resolved to, for exactly the user and host ssh prints. */
  private hopLogin(state: HopState, line: string, who: string, where: string): PasswordPrompt {
    const { hop } = state;
    const refuse = (why: string): PasswordPrompt => ({ line, elsewhere: why, marked: true, kind: "ssh", hop: null });
    if (!hop.known) return refuse(`roster can't tell where this ssh went: ${hop.why}`);
    if (!this.hops?.fill) return refuse(`filling ${hop.host}'s ssh prompt needs a newer roster (API 26)`);
    if (hop.sshFill) return refuse(hop.sshFill);
    if (who !== hop.user || where !== hop.target) {
      return refuse(`the prompt asks for ${who}@${where}'s password, and this ssh logs in as ${hop.user}@${hop.target}`);
    }
    if (state.innerMarked) return refuse(`a shell has started on ${hop.host}, so this isn't its ssh's login prompt`);
    if (state.typed) return refuse(`you typed into this ssh, so roster can't tell this prompt is still ${hop.host}'s login`);
    if (state.sshDirty) return refuse(`this ssh has printed more than its login's lines, so this prompt may not be ${hop.host}'s login`);
    if (state.filled) return refuse(`roster already tried ${hop.host}'s password in this ssh; type it yourself`);
    return { line, elsewhere: null, marked: true, kind: "ssh", hop: fillHop(hop) };
  }

  /** sudo's prompt while a nested ssh runs: the Host it went to's sudo, only at the first command
   * of its marked shell (before then and after, roster can't be sure the marks are its). */
  private innerSudo(state: HopState, line: string, who: string): PasswordPrompt | null {
    const { hop, inner } = state;
    const refuse = (why: string): PasswordPrompt => ({ line, elsewhere: why, marked: true, kind: "sudo", hop: null });
    if (!hop.known) {
      return who === this.user ? refuse(`\`${this.outer.command}\` is running, not sudo itself, so this prompt may be another machine's`) : null;
    }
    if (who !== hop.user) return null;
    if (!this.hops?.fill) return refuse(`filling ${hop.host}'s sudo prompt needs a newer roster (API 26)`);
    if (hop.sudoFill) return refuse(hop.sudoFill);
    if (!state.innerMarked) return refuse(`the shell on ${hop.host} doesn't mark its commands, so roster can't tell what asks`);
    if (state.innerNested) return refuse(`a shell started inside a command on ${hop.host}, so roster can't tell what runs now`);
    if (state.innerDone) {
      return refuse(`a command ended on ${hop.host}, and after that roster can't tell its shell's marks from the Session's own Host's`);
    }
    if (inner.phase !== "output") return null;
    if (inner.command === null) return refuse("roster couldn't read the running command");
    if (!sudoOnly(inner.command)) return refuse(`\`${inner.command}\` is running, not sudo itself, so this prompt may be another machine's`);
    if (inner.dirty) return refuse("the command has printed more than sudo's own lines, so this prompt may be another machine's");
    return { line, elsewhere: null, marked: true, kind: "sudo", hop: fillHop(hop) };
  }

  private lineFeed() {
    const state = this.hopState;
    const out = (lv: Level) => (lv.phase === "output" ? lv : null);
    const lv = state ? (state.innerMarked ? out(state.inner) : null) : out(this.outer);
    if (!state && !lv) return;
    const text = this.lineAbove(lv);
    if (text === null) return;
    if (state) {
      if (SSH_GONE.test(text)) state.ending = true;
      if (!state.innerMarked) {
        if (state.asked && !SSH_OWN.test(text)) state.sshDirty = true;
        if (SSH.test(text)) state.asked = true;
      }
    }
    if (lv && !SUDO_OWN.test(text)) lv.dirty = true;
  }

  /** The line just ended by a line feed (through its wraps), or null for the command line's own
   * row in `lv` (a `C` before its line feed). */
  private lineAbove(lv: Level | null): string | null {
    const b = this.term.buffer.active;
    const y = b.baseY + b.cursorY - 1;
    const start = this.lineStartOf(y);
    if (lv && start === lv.cLine) {
      lv.cLine = null;
      return null;
    }
    let text = "";
    for (let r = start; r <= y; r++) text += b.getLine(r)?.translateToString(true) ?? "";
    return text.trim();
  }

  private mark(data: string) {
    const b = this.term.buffer.active;
    if (b.type !== "normal") return;
    const state = this.hopState;
    const lv = state && state.innerMarked ? state.inner : this.outer;
    switch (data.split(";")[0]) {
      case "A":
      case "N":
        if (state) {
          // A shell inside the ssh: the Host it went to's (Q121: the outer shell can't pair its
          // own marks again, so it stays unsure for good).
          if (state.inner.phase === "output") state.innerNested = true;
          state.innerMarked = true;
          this.nested = true;
          state.inner.phase = "prompt";
          state.inner.start = null;
          return;
        }
        if (this.outer.phase === "output") this.nested = true;
        this.outer.phase = "prompt";
        this.outer.start = null;
        return;
      case "B":
        if (state && !state.innerMarked) return;
        lv.phase = "input";
        lv.start = { line: b.baseY + b.cursorY, col: b.cursorX };
        return;
      case "C": {
        if (state && !state.innerMarked) return;
        if (lv.phase === "output") return;
        lv.command = lv.phase === "input" ? this.commandLine(lv) : null;
        lv.phase = "output";
        lv.dirty = false;
        lv.start = null;
        lv.cLine = b.cursorX > 0 ? this.lineStartOf(b.baseY + b.cursorY) : null;
        if (state) {
          if (ENDS_SHELL.test(lv.command ?? "")) state.ending = true;
          return;
        }
        const hop = this.hops && lv.command !== null ? resolveHop(lv.command, this.hops.hosts()) : null;
        if (hop) this.hopState = newHop(hop);
        return;
      }
      case "D":
        if (state) {
          // The D of a command on the Host it went to, unless that shell ended (or never marked).
          if (state.innerMarked && !state.ending && state.inner.phase === "output") {
            state.inner.phase = "idle";
            state.inner.command = null;
            state.innerDone = true;
            return;
          }
          this.hopState = null;
        }
        this.outer.phase = "idle";
        this.outer.command = null;
        return;
    }
  }

  /** The buffer line where the line through buffer line `y` starts (it may have wrapped). */
  private lineStartOf(y: number): number {
    const b = this.term.buffer.active;
    while (y > 0 && b.getLine(y)?.isWrapped) y--;
    return y;
  }

  /** The command line, from where `B` left the cursor to where it is at `C`, as the screen shows
   * it; null if it scrolled away or was reflowed. */
  private commandLine(lv: Level): string | null {
    const start = lv.start;
    const b = this.term.buffer.active;
    if (!start || start.line < 0) return null;
    let end = b.baseY + b.cursorY;
    let endCol = b.cursorX;
    if (endCol === 0 && end > start.line) {
      end--;
      endCol = this.term.cols;
    }
    let text = "";
    for (let y = start.line; y <= end; y++) {
      const row = b.getLine(y);
      if (!row) return null;
      const last = y === end;
      text += row.translateToString(false, y === start.line ? start.col : 0, last ? endCol : this.term.cols);
    }
    return text.trim() || null;
  }
}

function newHop(hop: Hop): HopState {
  return {
    hop,
    inner: level(),
    innerMarked: false,
    innerDone: false,
    innerNested: false,
    ending: false,
    typed: false,
    asked: false,
    sshDirty: false,
    filled: false,
  };
}

function fillHop(hop: Extract<Hop, { known: true }>): FillHop {
  return { host: hop.host, address: hop.address, port: hop.port, user: hop.user };
}
