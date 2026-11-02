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
// marks roster can't tell whether you've left the Host, and the offer says so (T120 will tell).
import { Terminal } from "@xterm/xterm";
import type { TermSize } from "../backend/types";

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

export interface PasswordPrompt {
  /** The prompt line, as the Host printed it. */
  line: string;
  /** Why roster won't fill it (the marks say it may be another machine's); null: it may. */
  elsewhere: string | null;
  /** The shell's marks told roster what runs; false: it can't tell whether you've left the Host. */
  marked: boolean;
}

type Phase = "none" | "prompt" | "input" | "output" | "idle";

export class PromptWatch {
  private readonly term: Terminal;
  private readonly user: string;
  private phase: Phase = "none";
  /** Where `B` left the cursor: a line of the buffer (scrollback included) and a column. */
  private start: { line: number; col: number } | null = null;
  /** The running command's line, read at `C`; null when it couldn't be read. */
  private command: string | null = null;
  /** The running command printed a line that isn't sudo's own. */
  private dirty = false;
  /** The line a `C` came on before its line feed (pwsh's, and some shells'): the command line's,
   * not the command's output. */
  private cLine: number | null = null;
  /** A marked shell started inside a command: roster can't pair the marks again. */
  private nested = false;
  private writes = 0;
  /** A fill was tried at the prompt as it was after this many writes: not offered again until more. */
  private spentAt = -1;

  /** A watch for a Session of `size` whose login user is `user`. */
  constructor(size: TermSize, user: string) {
    this.user = user;
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

  resize(size: TermSize) {
    if (size.cols === this.term.cols && size.rows === this.term.rows) return;
    this.term.resize(size.cols, size.rows);
    this.start = null; // reflowed: rows aren't where they were
  }

  /** A fill was tried at this prompt: it isn't offered again until the Session prints more. */
  spent() {
    this.spentAt = this.writes;
  }

  /** The fill tried at this prompt typed nothing (roster serve refused it): offer it again. */
  unspent() {
    this.spentAt = -1;
  }

  dispose() {
    this.term.dispose();
  }

  /** sudo's prompt for the login user at the cursor, and whether roster may fill it; null when
   * there's none (or the marks say it's the shell's own prompt, or a fill was just tried). */
  prompt(): PasswordPrompt | null {
    if (this.writes === this.spentAt) return null;
    const b = this.term.buffer.active;
    if (b.type !== "normal") return null;
    const row = b.getLine(b.baseY + b.cursorY);
    const line = (row?.translateToString(false, 0, b.cursorX) ?? "").trim();
    const rest = (row?.translateToString(true, b.cursorX) ?? "").trim();
    const m = SUDO.exec(line);
    if (!m || m[1] !== this.user || rest !== "") return null;
    if (this.phase === "none") return { line, elsewhere: null, marked: false };
    if (this.phase !== "output") return null;
    return { line, elsewhere: this.why(), marked: true };
  }

  /** Why the marks leave roster unsure this prompt is the Host's own sudo's; null when they don't. */
  private why(): string | null {
    if (this.nested) return "a shell started inside a command in this Session, so roster can't tell what runs now";
    if (this.command === null) return "roster couldn't read the running command";
    if (!sudoOnly(this.command)) return `\`${this.command}\` is running, not sudo itself, so this prompt may be another machine's`;
    if (this.dirty) return "the command has printed more than sudo's own lines, so this prompt may be another machine's";
    return null;
  }

  private lineFeed() {
    if (this.phase !== "output") return;
    const b = this.term.buffer.active;
    const y = b.baseY + b.cursorY - 1;
    const start = this.lineStartOf(y);
    let text = "";
    if (start === this.cLine) {
      this.cLine = null;
      return;
    }
    for (let r = start; r <= y; r++) text += b.getLine(r)?.translateToString(true) ?? "";
    if (!SUDO_OWN.test(text.trim())) this.dirty = true;
  }

  private mark(data: string) {
    const b = this.term.buffer.active;
    if (b.type !== "normal") return;
    switch (data.split(";")[0]) {
      case "A":
      case "N":
        if (this.phase === "output") this.nested = true;
        this.phase = "prompt";
        this.start = null;
        return;
      case "B":
        this.phase = "input";
        this.start = { line: b.baseY + b.cursorY, col: b.cursorX };
        return;
      case "C":
        if (this.phase === "output") return;
        this.command = this.phase === "input" ? this.commandLine() : null;
        this.phase = "output";
        this.dirty = false;
        this.start = null;
        this.cLine = b.cursorX > 0 ? this.lineStartOf(b.baseY + b.cursorY) : null;
        return;
      case "D":
        this.phase = "idle";
        this.command = null;
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
  private commandLine(): string | null {
    const start = this.start;
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
