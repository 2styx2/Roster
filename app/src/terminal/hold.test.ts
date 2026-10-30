// A terminal that isn't on screen holds its Session's output and takes it in one write when it's
// shown (docs/app/performance.md): xterm.js redraws every row of a hidden DOM-rendered terminal on
// each scroll, measuring each character against a display:none box, so 11 busy hidden Sessions kept
// the webview at full CPU.
import { describe, expect, it } from "vitest";
import { holdWhileHidden } from "./hold";

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (chunks: Uint8Array[]) => chunks.map((c) => new TextDecoder().decode(c));

function terminal() {
  const writes: Uint8Array[] = [];
  return { writes, write: (d: Uint8Array) => writes.push(d) };
}

describe("A terminal's output while it's hidden", () => {
  it("goes straight through while the terminal is shown", () => {
    const t = terminal();
    const gate = holdWhileHidden(t.write);
    gate.write(bytes("one\r\n"));
    gate.write(bytes("two\r\n"));
    expect(text(t.writes)).toEqual(["one\r\n", "two\r\n"]);
  });

  it("is held while hidden and arrives in one write, in order, when shown", () => {
    const t = terminal();
    const gate = holdWhileHidden(t.write);
    gate.hide();
    gate.write(bytes("\x1b[32mone\x1b[0m\r\n"));
    gate.write(bytes("two\r\n"));
    expect(t.writes).toEqual([]);
    gate.show();
    expect(text(t.writes)).toEqual(["\x1b[32mone\x1b[0m\r\ntwo\r\n"]);
    gate.write(bytes("three"));
    expect(text(t.writes)).toEqual(["\x1b[32mone\x1b[0m\r\ntwo\r\n", "three"]);
  });

  // ConPTY asks for the cursor position before it starts anything (tabs.ts `pending`), and programs
  // ask for the terminal's colours, version or modes and wait for the answer, which xterm only gives
  // once it reads the question.
  it.each([
    ["the cursor position (ConPTY's start)", "\x1b[6n"],
    ["the device status", "\x1b[5n"],
    ["the device attributes", "\x1b[c"],
    ["the secondary device attributes", "\x1b[>0c"],
    ["a mode (DECRQM)", "\x1b[?2026$p"],
    ["the terminal's version", "\x1b[>q"],
    ["the background colour (OSC 11)", "\x1b]11;?\x07"],
    ["a setting (DECRQSS)", "\x1bP$qm\x1b\\"],
  ])("is let through at once, with what was held, when it asks for %s", (_what, query) => {
    const t = terminal();
    const gate = holdWhileHidden(t.write);
    gate.hide();
    gate.write(bytes("before\r\n"));
    gate.write(bytes(`prompt ${query}`));
    expect(text(t.writes)).toEqual([`before\r\nprompt ${query}`]);
  });

  it("is still held when it only sets colours, titles or moves the cursor", () => {
    const t = terminal();
    const gate = holdWhileHidden(t.write);
    gate.hide();
    gate.write(bytes("\x1b[2m00000001\x1b[0m \x1b[1;32mINFO\x1b[0m\r\n\x1b[2K\x1b[10;1H\x1b]0;box: ~\x07"));
    expect(t.writes).toEqual([]);
  });

  it("is let through once a lot of it is held, so a long-hidden busy Session doesn't pile up", () => {
    const t = terminal();
    const gate = holdWhileHidden(t.write, { limit: 1000 });
    gate.hide();
    for (let i = 0; i < 9; i++) gate.write(new Uint8Array(100));
    expect(t.writes).toEqual([]);
    gate.write(new Uint8Array(100));
    expect(t.writes.map((w) => w.length)).toEqual([1000]);
  });
});
