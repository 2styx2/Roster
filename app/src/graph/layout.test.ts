import { describe, expect, it } from "vitest";
import { layoutGraph, SPACING, type Layout } from "./layout";
import type { GraphData, GraphNode } from "./model";

const node = (id: string, cluster?: string): GraphNode => ({ id, label: id, shape: "dot", ...(cluster ? { cluster } : {}) });

function bigGraph(n: number, groups: number): GraphData {
  return {
    nodes: [node("box"), ...Array.from({ length: n }, (_, i) => node(`h${i}`, `g${i % groups}`))],
    edges: [],
    clusters: Array.from({ length: groups }, (_, i) => ({ id: `g${i}`, title: `group ${i}` })),
  };
}

const at = (l: Layout, id: string) => l.nodes.get(id);

function closest(l: Layout): number {
  const ps = [...l.nodes.values()];
  let best = Infinity;
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i]!;
      const b = ps[j]!;
      best = Math.min(best, Math.hypot(a.x - b.x, a.y - b.y));
    }
  return best;
}

describe("the graph's layout", () => {
  it("is the same every time for the same graph", () => {
    const g = bigGraph(200, 7);
    expect([...layoutGraph(g).nodes]).toEqual([...layoutGraph(g).nodes]);
  });

  it("keeps nodes apart and each cluster's nodes inside its circle, and clusters apart", () => {
    const g = bigGraph(300, 6);
    const l = layoutGraph(g);
    expect(closest(l)).toBeGreaterThan(SPACING * 0.75);
    for (const n of g.nodes) {
      if (!n.cluster) continue;
      const c = l.clusters.get(n.cluster)!;
      const p = at(l, n.id)!;
      expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeLessThan(c.r);
    }
    const cs = [...l.clusters.values()];
    for (let i = 0; i < cs.length; i++)
      for (let j = i + 1; j < cs.length; j++) expect(Math.hypot(cs[i]!.x - cs[j]!.x, cs[i]!.y - cs[j]!.y)).toBeGreaterThan(cs[i]!.r + cs[j]!.r);
  });

  it("keeps saved positions: a new node and a new cluster move nothing that was placed", () => {
    const g = bigGraph(60, 3);
    const first = layoutGraph(g);
    const saved = first.saved;
    const more: GraphData = {
      ...g,
      nodes: [...g.nodes, node("new-1", "g1"), node("new-2", "g9")],
      clusters: [...g.clusters, { id: "g9", title: "late" }],
    };
    const second = layoutGraph(more, saved);
    for (const n of g.nodes) expect(at(second, n.id)).toEqual(at(first, n.id));
    for (const c of g.clusters) expect(second.clusters.get(c.id)).toMatchObject({ x: first.clusters.get(c.id)!.x, y: first.clusters.get(c.id)!.y });
    expect(closest(second)).toBeGreaterThan(SPACING * 0.5);
    const late = second.clusters.get("g9")!;
    for (const c of g.clusters) {
      const o = second.clusters.get(c.id)!;
      expect(Math.hypot(o.x - late.x, o.y - late.y)).toBeGreaterThan(o.r + late.r);
    }
  });

  it("lays out 2,000 nodes in 40 clusters quickly", () => {
    const g = bigGraph(2000, 40);
    const t = performance.now();
    const l = layoutGraph(g);
    expect(performance.now() - t).toBeLessThan(150);
    expect(l.nodes.size).toBe(2001);
  });

  it("a node whose cluster is unknown is loose", () => {
    const l = layoutGraph({ nodes: [node("a", "nowhere"), node("b")], edges: [], clusters: [] });
    expect(l.nodes.size).toBe(2);
  });
});
