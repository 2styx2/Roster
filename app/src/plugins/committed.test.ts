// Ticket 79 (#137): what `terminal_output` sends is the lines a Session's terminal commits, read from
// a terminal's buffer (xterm, with no screen), not the raw stream: a repaint of the same screen
// after a resize isn't output, a rewritten line (a progress bar) arrives as it ended up, and a
// full-screen program's drawing isn't sent at all.
import { afterEach, describe, expect, it } from "vitest";
import { CommittedLines, DONE_OUTPUT_MAX, PROMPT_LINES_MAX } from "./committed";

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

// Ticket 94 (#167): a shell that writes OSC 133 marks (A prompt, B command line, C output, D done)
// says where its prompt and the command line end, so neither is sent as output, and each command
// that ends is a `command_done` with its line, its output and its exit code.
const A = "\x1b]133;A\x07";
const B = "\x1b]133;B\x07";
const C = "\x1b]133;C\x07";
const D = (code?: number) => `\x1b]133;D${code === undefined ? "" : `;${code}`}\x07`;

describe("a shell that marks its prompts (OSC 133)", () => {
  it("sends the output but not the prompt or the command line, and says when the command ends", async () => {
    const s = screen();
    await s.write(`${A}esx-02$ ${B}`);
    await s.write("grep ERROR /var/log/syslog");
    await s.write(`\r\n${C}ERROR disk full\r\nERROR again\r\n${D(1)}${A}esx-02$ ${B}`);
    expect(s.take()).toBe("ERROR disk full\nERROR again\n");
    expect(s.marked()).toBe(true);
    expect(s.takeDone()).toEqual([{ command: "grep ERROR /var/log/syslog", output: "ERROR disk full\nERROR again\n", code: 1 }]);
    expect(s.takeDone()).toEqual([]);
  });

  it("never sends a line typed and given up (Ctrl-C), nor anything typed before the command runs", async () => {
    const s = screen();
    await s.write(`${A}esx-02$ ${B}mysql -p hunter2-typed-by-mistake^C\r\n${A}esx-02$ ${B}`);
    await s.write("echo ok\b\b\x1b[K");
    expect(s.take()).toBe("");
    expect(s.takeDone()).toEqual([]);
    await s.write(`\r\n${A}esx-02$ ${B}uptime\r\n${C}up 3 days\r\n${D(0)}${A}esx-02$ ${B}`);
    expect(s.take()).toBe("up 3 days\n");
    expect(s.takeDone()).toEqual([{ command: "uptime", output: "up 3 days\n", code: 0 }]);
  });

  it("output with no line feed at the end is output, and a long command line comes whole", async () => {
    const s = screen(20, 6);
    await s.write(`${A}$ ${B}printf 'disk full' # a long comment\r\n${C}disk full${D()}${A}$ ${B}`);
    expect(s.take()).toBe("disk full\n");
    expect(s.takeDone()).toEqual([{ command: "printf 'disk full' # a long comment", output: "disk full\n", code: null }]);
  });

  it("a mark it doesn't know, or a D with no C (an empty line), isn't a command", async () => {
    const s = screen();
    await s.write(`${A}$ ${B}\r\n\x1b]133;P;k=i\x07${D(0)}${A}$ ${B}`);
    expect(s.takeDone()).toEqual([]);
    expect(s.take()).toBe("");
  });

  it("a shell that never says C: after the line limit its marks are ignored, and what was held back is never sent", async () => {
    const s = screen(40, 6);
    await s.write(`${A}$ ${B}secret-ish\r\n`);
    for (let i = 0; i < PROMPT_LINES_MAX; i++) await s.write(`held ${i}\r\n`);
    expect(s.take()).toBe("");
    expect(s.marked()).toBe(false);
    await s.write(`${A}$ ${B}ls\r\nERROR one\r\n`);
    expect(s.take()).toBe("$ ls\nERROR one\n");
    // A C puts the marks back in use.
    await s.write(`${C}two\r\n${D(0)}${A}$ ${B}`);
    expect(s.marked()).toBe(true);
    expect(s.take()).toBe("two\n");
    expect(s.takeDone()).toEqual([{ command: null, output: "two\n", code: 0 }]);
  });

  it("keeps each command's last 16 KB of output", async () => {
    const s = screen(80, 6);
    const line = "x".repeat(99);
    await s.write(`${A}$ ${B}yes\r\n${C}${`${line}\r\n`.repeat(400)}tail\r\n${D(130)}`);
    const [done] = s.takeDone();
    expect(done?.output.endsWith(`${line}\ntail\n`)).toBe(true);
    expect(done?.output.length).toBeLessThanOrEqual(DONE_OUTPUT_MAX);
    expect(done?.output.length).toBeGreaterThan(DONE_OUTPUT_MAX - 200);
    expect(done?.code).toBe(130);
  });

  it("a C written before the line feed (pwsh's) still keeps the command line out of the output", async () => {
    const s = screen();
    await s.write(`${A}PS C:\\logs> ${B}Get-Content app.log${C}\r\nERROR boot\r\n${D(0)}`);
    expect(s.take()).toBe("ERROR boot\n");
    expect(s.takeDone()).toEqual([{ command: "Get-Content app.log", output: "ERROR boot\n", code: 0 }]);
  });

  it("marks sent twice (a shell's own and a snippet's) count once", async () => {
    const s = screen();
    await s.write(`${A}${A}$ ${B}${B}ls\r\n${C}${C}file\r\n${D(0)}${D(0)}`);
    expect(s.take()).toBe("file\n");
    expect(s.takeDone()).toEqual([{ command: "ls", output: "file\n", code: 0 }]);
  });

  it("reads what bash 5 with the snippet in docs/plugins.md prints (recorded)", async () => {
    // Typed: `echo ERROR disk full`, a line given up with Ctrl-C, an empty line, `false`,
    // `printf done`, `exit`.
    const s = screen(80, 24);
    await s.write("\x1b]133;D;0\x07\x1b[?2004h\x1b]133;A\x07esx-02$ \x1b]133;B\x07echo ERROR disk full\r\n\x1b[?2004l\r\x1b]133;C\x07ERROR disk full\r\n\x1b]133;D;0\x07\x1b[?2004h\x1b]133;A\x07esx-02$ \x1b]133;B\x07\x1b[K^C\x1b[?2004l\r\x1b[?2004h\x1b[?2004l\r\r\n\x1b]133;D;130\x07\x1b[?2004h\x1b]133;A\x07esx-02$ \x1b]133;B\x07\r\n\x1b[?2004l\r\x1b]133;D;130\x07\x1b[?2004h\x1b]133;A\x07esx-02$ \x1b]133;B\x07false\r\n\x1b[?2004l\r\x1b]133;C\x07\x1b]133;D;1\x07\x1b[?2004h\x1b]133;A\x07esx-02$ \x1b]133;B\x07printf done\r\n\x1b[?2004l\r\x1b]133;C\x07done\x1b]133;D;0\x07\x1b[?2004h\x1b]133;A\x07esx-02$ \x1b]133;B\x07exit\r\n\x1b[?2004l\r\x1b]133;C\x07exit\r\n");
    expect(s.take()).toBe("ERROR disk full\ndone\nexit\n");
    expect(s.takeDone()).toEqual([
      { command: "echo ERROR disk full", output: "ERROR disk full\n", code: 0 },
      { command: "false", output: "", code: 1 },
      { command: "printf done", output: "done\n", code: 0 },
    ]);
  });

  it("a shell with no marks is read as before", async () => {
    const s = screen();
    await s.write("esx-02$ ls\r\nfile\r\n");
    expect(s.marked()).toBe(false);
    expect(s.take()).toBe("esx-02$ ls\nfile\n");
    expect(s.takeDone()).toEqual([]);
  });
});
