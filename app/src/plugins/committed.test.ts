// Ticket 79 (#137): what `terminal_output` sends is the lines a Session's terminal commits, read from
// a terminal's buffer (xterm, with no screen), not the raw stream: a repaint of the same screen
// after a resize isn't output, a rewritten line (a progress bar) arrives as it ended up, and a
// full-screen program's drawing isn't sent at all.
import { afterEach, describe, expect, it } from "vitest";
import { CommittedLines } from "./committed";

const screens: CommittedLines[] = [];
function screen(cols = 40, rows = 6) {
  const s = new CommittedLines({ cols, rows });
  screens.push(s);
  return s;
}
afterEach(() => screens.splice(0).forEach((s) => s.dispose()));

describe("the lines a Session commits", () => {
  it("sends each line once the Session moves past it, as plain text", async () => {
    const s = screen();
    await s.write("\x1b]0;title\x07\x1b[1;31mERROR\x1b[0m disk full\r\nesx-02$ ");
    expect(s.take()).toBe("ERROR disk full\n");
    // The prompt waits until it's finished.
    await s.write("ls\r\n");
    expect(s.take()).toBe("esx-02$ ls\n");
    expect(s.take()).toBe("");
  });

  it("keeps going past the bottom of the screen", async () => {
    const s = screen(40, 3);
    await s.write("one\r\ntwo\r\nthree\r\nfour\r\nfive\r\n");
    expect(s.take()).toBe("one\ntwo\nthree\nfour\nfive\n");
    await s.write("five\r\n");
    expect(s.take()).toBe("five\n");
  });

  it("a rewritten line arrives as it ended up, and a wrapped one whole", async () => {
    const s = screen(20, 6);
    await s.write("copying 10%\rcopying 100%\r\n");
    await s.write("ERROR: a line longer than twenty\r\n");
    expect(s.take()).toBe("copying 100%\nERROR: a line longer than twenty\n");
  });

  it("the same screen printed again after a resize (ConPTY) isn't output; what's new is", async () => {
    const s = screen(40, 6);
    await s.write("mounting\r\nERROR: disk full\r\nesx-02$ ");
    expect(s.take()).toBe("mounting\nERROR: disk full\n");
    s.resize({ cols: 30, rows: 6 });
    // ConPTY's repaint: home, each row cleared to its end, the cursor back where it was.
    await s.write("\x1b[?25l\x1b[Hmounting\x1b[K\r\nERROR: disk full   \x1b[K\r\nesx-02$ \x1b[K\x1b[3;9H\x1b[?25h");
    expect(s.take()).toBe("");
    await s.write("\r\nERROR: new one\r\nERROR: disk full\r\n");
    expect(s.take()).toBe("esx-02$\nERROR: new one\nERROR: disk full\n");
  });

  it("after clear, the same lines are new again", async () => {
    const s = screen(40, 6);
    await s.write("ERROR: disk full\r\n");
    s.take();
    await s.write("\x1b[H\x1b[2J\x1b[3Jesx-02$ clear\r\nERROR: disk full\r\n");
    expect(s.take()).toBe("esx-02$ clear\nERROR: disk full\n");
  });

  it("what a full-screen program draws isn't sent", async () => {
    const s = screen(40, 6);
    await s.write("\x1b[?1049h\x1b[Htop - 10:00\r\nERROR in a process name\r\n\x1b[?1049l");
    await s.write("esx-02$ done\r\n");
    expect(s.take()).toBe("esx-02$ done\n");
  });

  it("takes text split in the middle of a character", async () => {
    const s = screen();
    const bytes = new TextEncoder().encode("é ERROR\r\n");
    await s.write(bytes.slice(0, 1));
    await s.write(bytes.slice(1));
    expect(s.take()).toBe("é ERROR\n");
  });
});
