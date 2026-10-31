import { describe, expect, it } from "vitest";
import { defaultOptions } from "../keymap";
import { defaultLayouts, otherMode, placed, togglePiece } from "./layout";

describe("the per-mode layout table (decision Q39)", () => {
  it("Standard shows the title bar, the Sidebar on its side and the status bar, in a window", () => {
    const { standard } = defaultLayouts(defaultOptions);
    expect(standard.fullscreen).toBe(false);
    expect(placed(standard, "top")).toEqual(["titlebar", "toolbar"]); // the toolbar sits in the title bar (Q65)
    expect(placed(standard, "left")).toEqual(["sidebar"]);
    expect(placed(standard, "right")).toEqual([]);
    expect(placed(standard, "bottom")).toEqual(["statusbar"]);
  });

  it("Standard follows the Sidebar and status bar options", () => {
    const { standard } = defaultLayouts({
      ...defaultOptions,
      sidebar: { visible: true, side: "right" },
      statusBar: { visible: false },
    });
    expect(placed(standard, "right")).toEqual(["sidebar"]);
    expect(placed(standard, "bottom")).toEqual([]);
  });

  it("Focus is fullscreen with no chrome and shows a hint", () => {
    const { focus } = defaultLayouts(defaultOptions);
    expect(focus.fullscreen).toBe(true);
    for (const at of ["top", "bottom", "left", "right"] as const) expect(placed(focus, at)).toEqual([]);
    expect(focus.hint).toBe(true);
  });

  it("puts Focus's session bar where the focus.sessionbar option says", () => {
    const top = defaultLayouts({ ...defaultOptions, focus: { sessionbar: "top" } }).focus;
    expect(placed(top, "top")).toEqual(["sessionbar"]);
    const bottom = defaultLayouts({ ...defaultOptions, focus: { sessionbar: "bottom" } }).focus;
    expect(placed(bottom, "bottom")).toEqual(["sessionbar"]);
  });

  it("toggles a piece, and a piece the layout doesn't place yet goes to the bottom", () => {
    const { standard, focus } = defaultLayouts(defaultOptions);
    expect(placed(togglePiece(standard, "statusbar"), "bottom")).toEqual([]);
    expect(placed(togglePiece(togglePiece(standard, "statusbar"), "statusbar"), "bottom")).toEqual(["statusbar"]);
    expect(placed(togglePiece(focus, "sessionbar"), "bottom")).toEqual(["sessionbar"]);
    expect(placed(togglePiece(focus, "clock"), "bottom")).toEqual(["clock"]);
  });

  it("the other mode of each mode", () => {
    expect(otherMode("standard")).toBe("focus");
    expect(otherMode("focus")).toBe("standard");
  });
});
