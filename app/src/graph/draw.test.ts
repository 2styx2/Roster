// A cluster's title on the map (T89): whole when there's room, even past a small circle, and cut
// only where it would cover another title.
import { describe, expect, it } from "vitest";
import { fitTitle } from "./draw";

// Iosevka is monospaced: 7 px a character at the map's size.
const measure = (s: string) => Array.from(s).length * 7;
const free = () => true;

describe("a cluster's title", () => {
  it("is whole over a small circle when nothing else is there", () => {
    expect(fitTitle(measure, "subnet-1 · password peers", false, 30, free)).toBe("subnet-1 · password peers");
    expect(fitTitle(measure, "lab", true, 30, free)).toBe("lab · mesh");
  });

  it("drops · mesh before cutting the name, where the whole one would cover another title", () => {
    const roomFor = (w: number) => (x: number) => x <= w;
    expect(fitTitle(measure, "subnet-1 · not in the Mesh", true, 30, roomFor(26 * 7))).toBe("subnet-1 · not in the Mesh");
    expect(fitTitle(measure, "subnet-1 · password peers", false, 30, roomFor(0))).toBe("subnet-1 ·…");
  });

  it("is cut at a long title's end, never past the room a big circle gives", () => {
    const long = "x".repeat(200);
    const got = fitTitle(measure, long, false, 600, free);
    expect(measure(got)).toBeLessThanOrEqual(600);
    expect(got.endsWith("…")).toBe(true);
  });
});
