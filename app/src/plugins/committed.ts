// The lines a Session's terminal commits, for `terminal_output` (ticket 79, #137): its output goes
// through a terminal of its own (xterm's, never opened on screen), and a line is taken when the
// cursor moves past it, as the terminal shows it then. So escape sequences are gone, a line the
// program rewrote (a progress bar, `\r`) comes as it ended up, and one that wrapped comes whole.
//
// A line written again with the same text in the same row isn't taken again: that's a repaint (the
// screen ConPTY prints again after a resize, on Windows), not output. After a resize the rows
// above the cursor count as taken, since the reflowed screen is the same text in new places.
// What a full-screen program draws (the alternate screen: vim, top, less) is never taken.
//
// A shell with integration (ticket 94, #167; decision Q121) writes OSC 133 marks: `A` its prompt
// starts, `B` the command line starts (the prompt ended), `C` the command's output starts, `D;CODE`
// the command ended. Read only, from what the shell prints; roster never writes to the Session.
//
// - The rows from `B` to `C` (what's typed at the prompt) are held back. At `C` the shell has run
//   the command: its line is read off the screen for the Done and the held rows go. A prompt given
//   up (an `A`, `B` or `D` with no `C`: Ctrl-C, an erased line) drops them: they're typed input.
// - Held rows can't swallow output for good: more than HELD_MAX rows in one prompt, or dropped
//   since the last command that ran, and the marks are doubted: what's held is sent, and so is
//   everything after, as with no marks, until a `B` then a `C` show the shell does say `C`.
// - Each line says whether the marks vouch for it (`marks`): only a command's output, from a `C`
//   whose prompt was held back, until you type into the Session (then a running ssh or nested
//   shell may be echoing you, and that isn't the marks' to say).
// - `D` makes a Done: the command line, its output (as sent, plus what it printed before `D` on
//   the cursor's row, never what comes after it there) and the exit code. An `A` while a command
//   runs is a nested shell's (ssh to a Host with integration): it takes over, and the outer
//   command gets no Done, since its end can't be told from the nested shell's.
import { Terminal } from "@xterm/xterm";

/** The most text one `terminal_output` or one Done's `output` carries: its last whole lines. */
export const OUTPUT_MAX = 16 * 1024;
/** Dones kept between takes: the last ones. */
export const DONES_MAX = 20;
/** Rows held back in one prompt, or dropped since the last command ran, before the marks are doubted. */
export const HELD_MAX = 20;

/** The last whole lines of `text` that fit in `max` characters. */
export function lastLines(text: string, max = OUTPUT_MAX): string {
  return text.length > max ? text.slice(text.indexOf("\n", text.length - max - 1) + 1) : text;
}

/** A command a marked shell ran, from its `C` to its `D`. */
export interface Done {
  /** The command line as the shell showed it, read at `C`; null when it couldn't be read (no `B`,
   * or it scrolled away or was reflowed before `C`). */
  command: string | null;
  /** What it printed, each line ending in a newline. */
  output: string;
  /** Its exit code; null when the shell didn't say. */
  code: number | null;
}

/** Lines in a row that the marks vouch for alike, each ending in a newline. */
export interface Run {
  text: string;
  marks: boolean;
}

type Phase = "none" | "prompt" | "input" | "output" | "idle";

export class CommittedLines {
  private readonly term: Terminal;
  /** Per row of the screen: the text taken from the line that starts there. */
  private taken: (string | undefined)[];
  private runs: Run[] = [];
  /** Where the Session is between OSC 133 marks: "none" until it sends one. */
  private phase: Phase = "none";
  /** Whether the marks are believed: rows typed at a prompt are held back. */
  private trusted = true;
  /** Rows held back in this prompt (since `B`), and dropped since the last command ran. */
  private held: string[] = [];
  private dropped = 0;
  /** Whether this prompt's rows are being held (the marks were believed at its `B`). */
  private holding = false;
  /** Where the command line starts (`B`), as a row of the screen and a column. */
  private start: { row: number; col: number } | null = null;
  private command: string | null = null;
  /** Whether the marks vouch for the running command's lines. */
  private vouch = false;
  /** The running command's output since `C`: its lines from `outFrom` on, `outSize` characters. */
  private out: string[] = [];
  private outFrom = 0;
  private outSize = 0;
  private dones: Done[] = [];

  constructor(size: ScreenSize) {
    this.term = new Terminal({ cols: size.cols, rows: size.rows, scrollback: 0, allowProposedApi: false });
    this.taken = new Array<string | undefined>(size.rows).fill(undefined);
    // A scroll moves every row up one: so does what was taken from them.
    this.term.onScroll(() => {
      if (!this.normal()) return;
      this.taken.shift();
      this.taken.push(undefined);
      if (this.start) this.start = this.start.row > 0 ? { row: this.start.row - 1, col: this.start.col } : null;
    });
    this.term.onLineFeed(() => this.lineFeed());
    this.term.parser.registerOscHandler(133, (data) => {
      this.mark(data);
      return true;
    });
  }

  /** Feeds the terminal; resolves once it has taken in `data`. */
  write(data: Uint8Array | string): Promise<void> {
    return new Promise((resolve) => this.term.write(data, resolve));
  }

  /** The Session's terminal was resized: so is this one, and what's on screen counts as taken. */
  resize(size: ScreenSize) {
    if (size.cols === this.term.cols && size.rows === this.term.rows) return;
    this.term.resize(size.cols, size.rows);
    this.taken = new Array<string | undefined>(size.rows).fill(undefined);
    // Reflowed: where the command line started isn't where it is now.
    this.start = null;
    if (!this.normal()) return;
    const cursor = this.term.buffer.active.cursorY;
    for (let y = 0; y < cursor; y++) {
      if (!this.row(y)?.isWrapped) this.taken[y] = this.lineAt(y);
    }
  }

  /** The user typed into the Session (not what: only that). A running command's lines from here
   * on may be echoing it, so the marks don't vouch for them. */
  typed() {
    if (this.phase === "output") this.vouch = false;
  }

  /** The lines committed since the last take, in runs the marks vouch for alike. */
  takeRuns(): Run[] {
    const r = this.runs;
    this.runs = [];
    return r;
  }

  /** The lines committed since the last take, each ending in a newline. */
  take(): string {
    return this.takeRuns()
      .map((r) => r.text)
      .join("");
  }

  /** The commands that ended since the last take (a marked shell's), oldest first. */
  takeDone(): Done[] {
    const d = this.dones;
    this.dones = [];
    return d;
  }

  dispose() {
    this.term.dispose();
  }

  private normal() {
    return this.term.buffer.active.type === "normal";
  }

  private row(y: number) {
    const b = this.term.buffer.active;
    return b.getLine(b.baseY + y);
  }

  /** The whole line that starts at row `y`, with the rows it wrapped onto. */
  private lineAt(y: number): string {
    let text = this.row(y)?.translateToString(true) ?? "";
    for (let next = y + 1; next < this.term.rows && this.row(next)?.isWrapped; next++) {
      text = `${text.padEnd(this.term.cols)}${this.row(next)?.translateToString(true) ?? ""}`;
    }
    return text.trimEnd();
  }

  /** The row where the line through row `y` starts (it may have wrapped onto `y`). */
  private lineStart(y: number): number {
    while (y > 0 && this.row(y)?.isWrapped) y--;
    return y;
  }

  private lineFeed() {
    if (!this.normal()) return;
    const below = this.term.buffer.active.cursorY - 1;
    if (below < 0) return;
    const y = this.lineStart(below);
    const text = this.lineAt(y);
    if (this.taken[y] === text) return;
    this.taken[y] = text;
    if (this.phase === "input" && this.holding) {
      this.held.push(text);
      // Too much for what's typed at a prompt: doubt the marks, and send it all.
      if (this.held.length > HELD_MAX) this.doubt();
      return;
    }
    this.push(text);
  }

  /** Takes a line: vouched for only as a command's output the marks placed. */
  private push(text: string) {
    const marks = this.phase === "output" && this.vouch;
    const last = this.runs[this.runs.length - 1];
    if (last && last.marks === marks) last.text += `${text}\n`;
    else this.runs.push({ text: `${text}\n`, marks });
    if (this.phase === "output") this.collect(text);
  }

  /** Keeps a line of the running command's output, its last OUTPUT_MAX characters only. */
  private collect(text: string) {
    this.out.push(text);
    this.outSize += text.length + 1;
    while (this.outSize > OUTPUT_MAX && this.outFrom < this.out.length) {
      this.outSize -= (this.out[this.outFrom] ?? "").length + 1;
      this.outFrom++;
    }
    // Drop the lines gone by now and then, not each time: amortized, no shifting every line.
    if (this.outFrom > 1024 && this.outFrom * 2 > this.out.length) {
      this.out = this.out.slice(this.outFrom);
      this.outFrom = 0;
    }
  }

  private resetOutput() {
    this.out = [];
    this.outFrom = 0;
    this.outSize = 0;
  }

  /** The marks don't add up: send what's held, and hold nothing until a `B` then a `C`. */
  private doubt() {
    const held = this.held;
    this.held = [];
    this.holding = false;
    this.trusted = false;
    for (const text of held) this.push(text);
  }

  /** A prompt given up with no `C` (Ctrl-C, an erased line): what was typed at it is dropped,
   * unless that's more than the marks are believed for. */
  private abandon() {
    if (!this.holding) return;
    if (this.dropped + this.held.length > HELD_MAX) return this.doubt();
    this.dropped += this.held.length;
    this.held = [];
    this.holding = false;
  }

  /** An OSC 133 mark: `A`, `B`, `C`, or `D` with the exit code after a `;`. */
  private mark(data: string) {
    const [kind, arg] = data.split(";");
    const b = this.term.buffer.active;
    switch (kind) {
      case "A":
      case "N":
        if (!this.normal()) return;
        // While a command runs: a nested shell's prompt (ssh to a Host with integration). It takes
        // over; the outer command gets no Done (its end can't be told from the nested shell's).
        if (this.phase === "output") this.resetOutput();
        if (this.phase === "input") this.abandon();
        this.phase = "prompt";
        this.start = null;
        return;
      case "B":
        if (!this.normal()) return;
        // Again in the same prompt (a redraw): it starts where the cursor is now.
        if (this.phase !== "input") {
          if (this.phase === "output") this.resetOutput();
          this.phase = "input";
          this.holding = this.trusted;
          this.held = [];
        }
        this.start = { row: b.cursorY, col: b.cursorX };
        return;
      case "C": {
        // Twice (a shell's own mark and a snippet's): the first one counts.
        if (!this.normal() || this.phase === "output") return;
        const prompted = this.phase === "input";
        this.command = prompted ? this.commandLine() : null;
        // It ran: what was typed is in the command line now, not held. Only a prompt whose rows
        // were held vouches for the output; a `B` then a `C` shows the marks can be believed.
        this.vouch = prompted && this.holding;
        if (prompted) {
          this.trusted = true;
          this.dropped = 0;
        }
        this.held = [];
        this.holding = false;
        // A `C` before the line feed (pwsh's): the row with the command line isn't output.
        if (b.cursorX > 0) {
          const y = this.lineStart(b.cursorY);
          this.taken[y] = this.lineAt(y);
        }
        this.phase = "output";
        this.start = null;
        this.resetOutput();
        return;
      }
      case "D": {
        if (this.phase === "input") this.abandon();
        if (this.phase !== "output") {
          this.phase = "idle";
          return;
        }
        // What it printed with no line feed after it (`printf done`): only what's before the
        // cursor now, never what comes after on that row (zsh's PROMPT_SP, the next prompt).
        if (this.normal() && b.cursorX > 0) {
          const text = this.before(b.cursorY, b.cursorX);
          if (text) this.push(text);
        }
        const code = arg !== undefined && /^-?\d+$/.test(arg) ? Number(arg) : null;
        const output = lastLines(
          this.out
            .slice(this.outFrom)
            .map((l) => `${l}\n`)
            .join(""),
        );
        this.dones.push({ command: this.command, output, code });
        if (this.dones.length > DONES_MAX) this.dones.shift();
        this.phase = "idle";
        this.command = null;
        this.resetOutput();
        return;
      }
    }
  }

  /** The text of the line through row `y`, up to column `x` of that row. */
  private before(y: number, x: number): string {
    const from = this.lineStart(y);
    let text = "";
    for (let r = from; r < y; r++) text += this.row(r)?.translateToString(false) ?? "";
    text += this.row(y)?.translateToString(false, 0, x) ?? "";
    return text.trimEnd();
  }

  /** The command line, from where `B` left the cursor to where it is at `C`; null if it's gone. */
  private commandLine(): string | null {
    const start = this.start;
    if (!start) return null;
    const b = this.term.buffer.active;
    let endRow = b.cursorY;
    let endCol = b.cursorX;
    if (endCol === 0 && endRow > start.row) {
      endRow--;
      endCol = this.term.cols;
    }
    let text = "";
    for (let y = start.row; y <= endRow; y++) {
      const row = this.row(y);
      if (!row) break;
      const last = y === endRow;
      const next = this.row(y + 1);
      const wraps = !last && next?.isWrapped === true;
      text += row.translateToString(!wraps, y === start.row ? start.col : 0, last ? endCol : this.term.cols);
      if (!last && !wraps) text += "\n";
    }
    return text.trimEnd();
  }
}

export interface ScreenSize {
  cols: number;
  rows: number;
}
