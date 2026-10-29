import { describe, expect, it } from "vitest";
import { defaultKeymap, defaultOptions, resolveKeymap } from "../keymap";
import { press, terminalMode, type KeyState } from "./mode";

const ctx = { keymap: defaultKeymap, leader: defaultOptions.leader, vim: true };

/** Presses each chord in turn; returns the final state and every action that fired. */
function run(chords: string[], c = ctx, start: KeyState = terminalMode) {
  let state = start;
  const actions: string[] = [];
  const consumed: boolean[] = [];
  for (const chord of chords) {
    const r = press(state, chord, c);
    state = r.state;
    if (r.action) actions.push(r.action);
    consumed.push(r.consumed);
  }
  return { state, actions, consumed };
}

describe("press (Terminal mode / App mode)", () => {
  it("leaves every key to the terminal in Terminal mode, except the Leader", () => {
    const r = run(["f", "Escape", "Ctrl+c"]);
    expect(r.consumed).toEqual([false, false, false]);
    expect(r.state.mode).toBe("terminal");
    expect(run(["Ctrl+Space"]).state.mode).toBe("app");
  });

  it("runs a Leader binding and goes back to the terminal", () => {
    const r = run(["Ctrl+Space", "]"]);
    expect(r.actions).toEqual(["session.next"]);
    expect(r.consumed).toEqual([true, true]);
    expect(r.state.mode).toBe("terminal");
  });

  it("waits for the rest of a sequence", () => {
    const half = run(["Ctrl+Space", "d"]);
    expect(half.actions).toEqual([]);
    expect(half.state).toEqual({ mode: "app", pending: ["d"] });
    expect(run(["Ctrl+Space", "d", "d"]).actions).toEqual(["session.close"]);
  });

  it("stays in App mode while moving in a list, until Esc", () => {
    const r = run(["Ctrl+Space", "j", "j", "k", "g", "g", "G"]);
    expect(r.actions).toEqual(["list.down", "list.down", "list.up", "list.top", "list.bottom"]);
    expect(r.state.mode).toBe("app");
    const back = run(["Escape"], ctx, r.state);
    expect(back.actions).toEqual(["mode.terminal"]);
    expect(back.state.mode).toBe("terminal");
  });

  it("with vim off, j and k do nothing, but arrows still move", () => {
    const r = run(["Ctrl+Space", "j", "k", "ArrowDown"], { ...ctx, vim: false });
    expect(r.actions).toEqual(["list.down"]);
    expect(r.state.mode).toBe("app");
  });

  it("swallows an unbound key in App mode and forgets a half-typed sequence", () => {
    const r = run(["Ctrl+Space", "d", "x"]);
    expect(r.actions).toEqual([]);
    expect(r.consumed).toEqual([true, true, true]);
    expect(r.state).toEqual({ mode: "app", pending: [] });
  });

  it("uses whatever Leader and bindings it's given", () => {
    const c = { ...ctx, leader: "Ctrl+b", keymap: resolveKeymap({ leader: { n: "session.next" } }) };
    expect(run(["Ctrl+Space"], c).state.mode).toBe("terminal");
    expect(run(["Ctrl+b", "n"], c).actions).toEqual(["session.next"]);
  });
});
