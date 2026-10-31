// How long the Picker takes to open (ticket 20, decision Q86): from the key (or click) that asks
// for it to the frame it's first drawn in. `:info` shows the last one, so a run on a new
// platform (WebKitGTK on Linux, WSLg) can be read off without devtools.
import { describe, expect, it } from "vitest";
import { pickerTimer } from "./timing";

function clock() {
  let t = 0;
  const frames: (() => void)[] = [];
  return {
    now: () => t,
    frame: (f: () => void) => void frames.push(f),
    advance: (ms: number) => void (t += ms),
    paint: () => frames.splice(0).forEach((f) => f()),
  };
}

describe("The Picker's open time", () => {
  it("is unknown until the Picker has opened once", () => {
    const c = clock();
    expect(pickerTimer(c.now, c.frame).last()).toBeNull();
  });

  it("runs from the request to the frame the Picker is drawn in", () => {
    const c = clock();
    const timer = pickerTimer(c.now, c.frame);
    timer.start();
    c.advance(9);
    timer.shown();
    c.advance(7);
    expect(timer.last()).toBeNull();
    c.paint();
    expect(timer.last()).toBe(16);
  });

  it("counts from the first request when it's asked for twice before it shows", () => {
    const c = clock();
    const timer = pickerTimer(c.now, c.frame);
    timer.start();
    c.advance(5);
    timer.start();
    c.advance(5);
    timer.shown();
    c.paint();
    expect(timer.last()).toBe(10);
  });

  it("ignores a showing nobody timed (the Picker re-rendered while open)", () => {
    const c = clock();
    const timer = pickerTimer(c.now, c.frame);
    timer.start();
    timer.shown();
    c.advance(3);
    c.paint();
    timer.shown();
    c.advance(50);
    c.paint();
    expect(timer.last()).toBe(3);
  });
});
