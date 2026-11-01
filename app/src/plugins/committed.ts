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
// With marks, the rows from `A` to `C` (the prompt and what's typed at it) are never taken as
// output; the command line is read off the screen only at `C`, once the shell has run it (so input
// that's erased, or a line given up with Ctrl-C, never leaves), and `D` makes a Done: that line,
// the output since `C` and the exit code. A shell that marks prompts but never says `C` would hide
// all its output: after PROMPT_LINES_MAX lines with no `C` the marks are ignored (until a `C`), and
// the lines held back are dropped, never sent, since they may be what was typed.
import { Terminal } from "@xterm/xterm";

/** The most one Done's `output` holds: its last whole lines. */
export const DONE_OUTPUT_MAX = 16 * 1024;
/** Dones kept between takes: the last ones. */
export const DONES_MAX = 20;
/** Lines a prompt may take before a `C` (a long prompt, a command typed over several lines). */
export const PROMPT_LINES_MAX = 20;

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

type Phase = "none" | "prompt" | "output" | "idle";

export interface ScreenSize {
  cols: number;
  rows: number;
}

export class CommittedLines {
  private readonly term: Terminal;
  /** Per row of the screen: the text taken from the line that starts there. */
  private taken: (string | undefined)[];
  private lines: string[] = [];
  /** Where the Session is between OSC 133 marks: "none" until it sends one. */
  private phase: Phase = "none";
  /** Where the command line starts (`B`), as a row of the screen and a column. */
  private start: { row: number; col: number } | null = null;
  private command: string | null = null;
  /** Lines held back in a prompt since its `A`. */
  private held = 0;
  /** The marks didn't add up (no `C`): ignored until a `C` comes. */
  private ignoring = false;
  private output: string[] = [];
  private outputSize = 0;
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

  /** The lines committed since the last take, each ending in a newline. */
  take(): string {
    const text = this.lines.map((l) => `${l}\n`).join("");
    this.lines = [];
    return text;
  }

  /** The commands that ended since the last take (a marked shell's), oldest first. */
  takeDone(): Done[] {
    const d = this.dones;
    this.dones = [];
    return d;
  }

  /** Whether the shell's OSC 133 marks are in use: its prompts and command lines aren't taken. */
  marked(): boolean {
    return this.phase !== "none" && !this.ignoring;
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
    if (this.marked() && this.phase === "prompt") {
      // The prompt, or what's typed at it: held back, never sent.
      if (++this.held > PROMPT_LINES_MAX) this.ignoring = true;
      return;
    }
    this.push(text);
  }

  private push(text: string) {
    this.lines.push(text);
    if (this.phase !== "output") return;
    this.output.push(text);
    this.outputSize += text.length + 1;
    while (this.outputSize > DONE_OUTPUT_MAX && this.output.length > 1) {
      this.outputSize -= (this.output.shift() ?? "").length + 1;
    }
  }

  /** An OSC 133 mark: `A`, `B`, `C`, or `D` with the exit code after a `;`. */
  private mark(data: string) {
    const [kind, arg] = data.split(";");
    const b = this.term.buffer.active;
    switch (kind) {
      case "A":
      case "N":
        if (this.ignoring || !this.normal()) return;
        this.phase = "prompt";
        this.start = null;
        this.held = 0;
        return;
      case "B":
        if (this.ignoring || !this.normal()) return;
        this.phase = "prompt";
        this.start = { row: b.cursorY, col: b.cursorX };
        return;
      case "C":
        // Twice (a shell's own mark and a snippet's): the first one counts.
        if (!this.normal() || this.phase === "output") return;
        this.command = this.ignoring ? null : this.commandLine();
        // A `C` before the line feed (pwsh's): the row with the command line isn't output either.
        if (b.cursorX > 0) {
          const y = this.lineStart(b.cursorY);
          this.taken[y] = this.lineAt(y);
        }
        this.ignoring = false;
        this.phase = "output";
        this.start = null;
        this.output = [];
        this.outputSize = 0;
        return;
      case "D": {
        if (this.phase !== "output") return;
        // What it printed with no line feed after it (`printf done`) is output too.
        if (this.normal() && b.cursorX > 0) {
          const y = this.lineStart(b.cursorY);
          const text = this.lineAt(y);
          if (this.taken[y] !== text) {
            this.taken[y] = text;
            this.push(text);
          }
        }
        const code = arg !== undefined && /^-?\d+$/.test(arg) ? Number(arg) : null;
        this.dones.push({ command: this.command, output: this.output.map((l) => `${l}\n`).join(""), code });
        if (this.dones.length > DONES_MAX) this.dones.shift();
        this.phase = "idle";
        this.command = null;
        this.output = [];
        this.outputSize = 0;
        return;
      }
    }
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
