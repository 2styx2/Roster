import { describe, expect, it } from "vitest";
import { isLeaderKey } from "./keys";

const ev = (over: Partial<KeyboardEvent>) =>
  ({ key: "", code: "", ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...over }) as KeyboardEvent;

describe("isLeaderKey: what the terminal keeps from the shell", () => {
  it("catches Ctrl+Space (which would otherwise send NUL)", () => {
    expect(isLeaderKey(ev({ key: " ", code: "Space", ctrlKey: true }), "Ctrl+Space")).toBe(true);
  });

  it("catches Ctrl+Space by its physical key, whatever the layout reports", () => {
    expect(isLeaderKey(ev({ key: "Unidentified", code: "Space", ctrlKey: true }), "Ctrl+Space")).toBe(true);
  });

  it.each([
    ["Esc", ev({ key: "Escape", code: "Escape" })],
    ["Ctrl+W", ev({ key: "w", code: "KeyW", ctrlKey: true })],
    ["Ctrl+C", ev({ key: "c", code: "KeyC", ctrlKey: true })],
    ["Space", ev({ key: " ", code: "Space" })],
    ["Ctrl+Shift+Space", ev({ key: " ", code: "Space", ctrlKey: true, shiftKey: true })],
  ])("lets %s through to the shell", (_, e) => {
    expect(isLeaderKey(e, "Ctrl+Space")).toBe(false);
  });

  it("follows a different Leader", () => {
    expect(isLeaderKey(ev({ key: "a", code: "KeyA", ctrlKey: true }), "Ctrl+a")).toBe(true);
    expect(isLeaderKey(ev({ key: " ", code: "Space", ctrlKey: true }), "Ctrl+a")).toBe(false);
  });
});

describe("isLeaderKey on a real KeyboardEvent", () => {
  it("reads the modifiers from the event", () => {
    const e = new KeyboardEvent("keydown", { key: " ", code: "Space", ctrlKey: true });
    expect(isLeaderKey(e, "Ctrl+Space")).toBe(true);
  });
});
