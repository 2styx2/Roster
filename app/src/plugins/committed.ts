// The lines a Session's terminal commits, for `terminal_output` (ticket 79, #137): its output goes
// through a terminal of its own (xterm's, never opened on screen), and a line is taken when the
// cursor moves past it, as the terminal shows it then. So escape sequences are gone, a line the
// program rewrote (a progress bar, `\r`) comes as it ended up, and one that wrapped comes whole.
//
// A line written again with the same text in the same row isn't taken again: that's a repaint (the
// screen ConPTY prints again after a resize, on Windows), not output. After a resize the rows
// above the cursor count as taken, since the reflowed screen is the same text in new places.
// What a full-screen program draws (the alternate screen: vim, top, less) is never taken.
import { Terminal } from "@xterm/xterm";

export interface ScreenSize {
  cols: number;
  rows: number;
}

export class CommittedLines {
  private readonly term: Terminal;
  /** Per row of the screen: the text taken from the line that starts there. */
  private taken: (string | undefined)[];
  private lines: string[] = [];

  constructor(size: ScreenSize) {
    this.term = new Terminal({ cols: size.cols, rows: size.rows, scrollback: 0, allowProposedApi: false });
    this.taken = new Array<string | undefined>(size.rows).fill(undefined);
    // A scroll moves every row up one: so does what was taken from them.
    this.term.onScroll(() => {
      if (!this.normal()) return;
      this.taken.shift();
      this.taken.push(undefined);
    });
    this.term.onLineFeed(() => this.lineFeed());
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

  private lineFeed() {
    if (!this.normal()) return;
    let y = this.term.buffer.active.cursorY - 1;
    if (y < 0) return;
    while (y > 0 && this.row(y)?.isWrapped) y--;
    const text = this.lineAt(y);
    if (this.taken[y] === text) return;
    this.taken[y] = text;
    this.lines.push(text);
  }
}
