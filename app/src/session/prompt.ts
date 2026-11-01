// Whether a Session is waiting at a password prompt (ticket 119, decision Q129), read from its
// output as it streams in: the text of the line at the cursor, with escape sequences gone, matched
// against sudo's, su's and ssh's prompts. It only decides whether to *offer* the fill key: the
// Host prints it all, so it can forge a prompt. What makes filling safe is checked elsewhere: serve
// refuses a prompt naming another Host or account, and the core types the secret only after a
// probe shows the prompt doesn't echo (crates/roster-core/src/session.rs, `fill`).
//
// OSC 133 marks (Q121), when the shell prints them, are advice on top: the shell's own prompt
// (between `A` and `C`) is never a password prompt, and a command that leaves the Host (`ssh`,
// `mosh`, `telnet`) or a marked shell starting inside a command means a prompt may be another
// Host's, so roster refuses until that command's `D`, or for good when it can't pair them. Without
// marks roster can't tell that you ssh'd elsewhere unless the prompt says so (T120 will).

/** sudo's, su's (and login's, passwd's current one) and ssh's password prompts, whole. */
const PROMPT = /^(?:\[sudo\] password for [^\s:]+|[^\s@']+@[^\s@']+'s password|password(?: for [^\s:]+)?):$/i;
/** A command line that takes the terminal to another machine. */
const HOP = /^\s*(?:sudo\s+(?:-\S+\s+)*)?(?:\S*\/)?(ssh|mosh|telnet|rlogin|rsh|autossh|sshpass)\b/;
/** The cursor's line is kept to this many characters (a prompt is short). */
const LINE_MAX = 512;

type Phase = "none" | "prompt" | "input" | "output" | "idle";

export class PromptWatch {
  private line = "";
  /** An escape sequence cut off at the end of a chunk, finished by the next one. */
  private pending = "";
  private phase: Phase = "none";
  /** The command line typed since `B` (escape sequences gone), read at `C`. */
  private typed = "";
  /** Why a prompt may be another Host's now; `sticky` when no `D` can end it. */
  private hop: { why: string; sticky: boolean } | null = null;

  /** More of the Session's output, decoded. */
  feed(text: string) {
    const s = this.pending + text;
    this.pending = "";
    let i = 0;
    while (i < s.length) {
      const ch = s[i] ?? "";
      if (ch === "\x1b") {
        const end = escapeEnd(s, i);
        if (end === null) {
          this.pending = s.slice(i);
          if (this.pending.length > 4096) this.pending = ""; // never a real sequence: drop it
          return;
        }
        const seq = s.slice(i, end);
        if (seq.startsWith("\x1b]133;")) this.mark(seq.slice(6).replace(/(\x07|\x1b\\)$/, ""));
        i = end;
        continue;
      }
      i++;
      if (ch === "\n" || ch === "\r") {
        if (this.phase === "input" && ch === "\n") this.typed += "\n";
        this.line = "";
      } else if (ch === "\b") {
        this.line = this.line.slice(0, -1);
        if (this.phase === "input") this.typed = this.typed.slice(0, -1);
      } else if (ch >= " " || ch === "\t") {
        if (this.line.length < LINE_MAX) this.line += ch;
        if (this.phase === "input" && this.typed.length < LINE_MAX) this.typed += ch;
      }
    }
  }

  /** The password prompt at the cursor, trimmed, or null: none, or the marks say it's the
   * shell's own prompt. */
  prompt(): string | null {
    if (this.phase === "prompt" || this.phase === "input") return null;
    const line = this.line.trim();
    return PROMPT.test(line) ? line : null;
  }

  /** Why a prompt now may be another Host's, as far as the marks tell; null when they don't. */
  elsewhere(): string | null {
    return this.hop?.why ?? null;
  }

  private mark(data: string) {
    const kind = data.split(";")[0];
    switch (kind) {
      case "A":
        if (this.phase === "output") this.hop = { why: "a shell started inside a command in this Session", sticky: true };
        this.phase = "prompt";
        return;
      case "B":
        this.phase = "input";
        this.typed = "";
        return;
      case "C": {
        if (this.phase === "output") return;
        const command = (this.typed.split("\n").find((l) => l.trim()) ?? "").trim();
        if (HOP.test(command) && !this.hop?.sticky) this.hop = { why: `\`${command}\` is running in this Session`, sticky: false };
        this.phase = "output";
        return;
      }
      case "D":
        if (this.phase === "output" && this.hop && !this.hop.sticky) this.hop = null;
        this.phase = "idle";
        return;
    }
  }
}

/** Where the escape sequence starting at `i` ends (exclusive), or null if `s` ends first. */
function escapeEnd(s: string, i: number): number | null {
  const next = s[i + 1];
  if (next === undefined) return null;
  if (next === "[") {
    for (let j = i + 2; j < s.length; j++) {
      const c = s.charCodeAt(j);
      if (c >= 0x40 && c <= 0x7e) return j + 1;
    }
    return null;
  }
  if (next === "]" || next === "P" || next === "_" || next === "^") {
    for (let j = i + 2; j < s.length; j++) {
      if (s[j] === "\x07") return j + 1;
      if (s[j] === "\x1b" && s[j + 1] === "\\") return j + 2;
      if (s[j] === "\x1b" && j + 1 >= s.length) return null;
    }
    return null;
  }
  // Two-character sequences (ESC 7, ESC =, ESC ( B takes three).
  if (next === "(" || next === ")") return s.length > i + 2 ? i + 3 : null;
  return i + 2;
}
