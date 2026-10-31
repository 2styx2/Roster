// Which renderer a terminal draws with (ticket 20): WebGL when it loads, the DOM renderer when it
// doesn't. A WebGL context can fail to start or be lost on WebKitGTK, WSLg and VMs; the terminal
// must keep drawing either way, and `:info` says which one it got.
import { describe, expect, it } from "vitest";
import { loadWebgl, rendererLabel, showRenderer, type RendererInUse } from "./renderer";

function addon() {
  const a = { disposed: 0, lose: () => {}, dispose: () => void a.disposed++ };
  return a;
}

describe("Loading the WebGL renderer", () => {
  it("reports WebGL when the addon loads, and DOM is never reported", () => {
    const seen: RendererInUse[] = [];
    const a = addon();
    const stop = loadWebgl((lose) => ((a.lose = lose), a), (r) => seen.push(r));
    expect(stop).not.toBeNull();
    expect(seen).toEqual(["webgl"]);
  });

  it("falls back to the DOM renderer when there's no WebGL context (the load throws)", () => {
    const seen: RendererInUse[] = [];
    const stop = loadWebgl(
      () => {
        throw new Error("WebGL2 not supported");
      },
      (r) => seen.push(r),
    );
    expect(stop).toBeNull();
    expect(seen).toEqual(["dom-unavailable"]);
  });

  it("goes back to the DOM renderer when the context is lost, and disposes the addon once", () => {
    const seen: RendererInUse[] = [];
    const a = addon();
    const stop = loadWebgl((lose) => ((a.lose = lose), a), (r) => seen.push(r));
    a.lose();
    stop?.();
    expect(seen).toEqual(["webgl", "dom-lost"]);
    expect(a.disposed).toBe(1);
  });

  it("stop gives the context back without reporting (the terminal was hidden)", () => {
    const seen: RendererInUse[] = [];
    const a = addon();
    const stop = loadWebgl(() => a, (r) => seen.push(r));
    stop?.();
    expect(a.disposed).toBe(1);
    expect(seen).toEqual(["webgl"]);
  });
});

describe(":info's words for it", () => {
  it("names the renderer and why it isn't WebGL", () => {
    expect(rendererLabel("webgl")).toBe("WebGL");
    expect(rendererLabel("dom")).toBe("DOM");
    expect(rendererLabel("dom-unavailable")).toBe("DOM (no WebGL here)");
    expect(rendererLabel("dom-lost")).toBe("DOM (WebGL context lost)");
  });
});

describe("A terminal coming on screen", () => {
  it("uses DOM when the Config asks for it, without trying WebGL", () => {
    const seen: RendererInUse[] = [];
    let tried = 0;
    showRenderer("dom", { noWebgl: false }, () => (tried++, addon()), (r) => seen.push(r));
    expect(seen).toEqual(["dom"]);
    expect(tried).toBe(0);
  });

  it("doesn't try WebGL again once it failed to load", () => {
    const seen: RendererInUse[] = [];
    const memo = { noWebgl: false };
    let tried = 0;
    const fail = () => {
      tried++;
      throw new Error("no context");
    };
    showRenderer("webgl", memo, fail, (r) => seen.push(r))();
    showRenderer("webgl", memo, fail, (r) => seen.push(r))();
    expect(seen).toEqual(["dom-unavailable", "dom-unavailable"]);
    expect(tried).toBe(1);
  });

  it("tries WebGL again after a lost context, the next time it's shown", () => {
    const seen: RendererInUse[] = [];
    const memo = { noWebgl: false };
    const a = addon();
    showRenderer("webgl", memo, (lose) => ((a.lose = lose), a), (r) => seen.push(r));
    a.lose();
    showRenderer("webgl", memo, () => addon(), (r) => seen.push(r));
    expect(seen).toEqual(["webgl", "dom-lost", "webgl"]);
  });
});
