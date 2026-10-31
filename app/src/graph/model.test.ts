import { describe, expect, it } from "vitest";
import { graphIndex, mergeGraph, reachOf, type GraphData, type GraphEdge, type GraphNode } from "./model";

const node = (id: string, cluster?: string): GraphNode => ({ id, label: id, shape: "dot", ...(cluster ? { cluster } : {}) });
const edge = (from: string, to: string, dir: "one" | "both" = "one"): GraphEdge => ({ id: `${from}>${to}`, from, to, dir, style: "solid" });
const sorted = (s: Set<string>) => [...s].sort();

describe("reach, both ways", () => {
  it("follows edges as far as they go, and back", () => {
    const g: GraphData = { nodes: ["a", "b", "c", "d", "e"].map((n) => node(n)), edges: [edge("a", "b"), edge("b", "c"), edge("d", "a")], clusters: [] };
    const r = reachOf(graphIndex(g), "a");
    expect(sorted(r.out)).toEqual(["b", "c"]);
    expect(sorted(r.in)).toEqual(["d"]);
  });

  it("a two-way edge reaches both ways, and a cycle doesn't count the node itself", () => {
    const g: GraphData = { nodes: ["a", "b", "c"].map((n) => node(n)), edges: [edge("a", "b", "both"), edge("b", "c")], clusters: [] };
    const r = reachOf(graphIndex(g), "a");
    expect(sorted(r.out)).toEqual(["b", "c"]);
    expect(sorted(r.in)).toEqual(["b"]);
  });

  it("an edge to a cluster reaches every node in it; a meshed cluster's nodes reach each other", () => {
    const g: GraphData = {
      nodes: [node("box"), node("x1", "lab"), node("x2", "lab"), node("y1", "web"), node("y2", "web")],
      edges: [edge("box", "lab"), edge("x1", "y1")],
      clusters: [
        { id: "lab", title: "lab", mesh: true },
        { id: "web", title: "web" },
      ],
    };
    const ix = graphIndex(g);
    expect(sorted(reachOf(ix, "box").out)).toEqual(["x1", "x2", "y1"]);
    expect(sorted(reachOf(ix, "x2").out)).toEqual(["x1", "y1"]);
    expect(sorted(reachOf(ix, "y1").in)).toEqual(["box", "x1", "x2"]);
    expect(reachOf(ix, "y2").in.size).toBe(0);
  });

  it("an edge from a cluster is every node's in it; an edge to a missing node is ignored", () => {
    const g: GraphData = { nodes: [node("x1", "lab"), node("x2", "lab"), node("n")], edges: [edge("lab", "n"), edge("n", "gone")], clusters: [{ id: "lab", title: "lab" }] };
    const ix = graphIndex(g);
    expect(sorted(reachOf(ix, "n").in)).toEqual(["x1", "x2"]);
    expect(reachOf(ix, "n").out.size).toBe(0);
  });

  it("stays quick at 5,000 nodes in meshed clusters", () => {
    const nodes = Array.from({ length: 5000 }, (_, i) => node(`h${i}`, `c${i % 50}`));
    const clusters = Array.from({ length: 50 }, (_, i) => ({ id: `c${i}`, title: `c${i}`, mesh: true as const }));
    const edges = Array.from({ length: 49 }, (_, i) => edge(`c${i}`, `c${i + 1}`));
    const ix = graphIndex({ nodes, edges, clusters });
    const t = performance.now();
    expect(reachOf(ix, "h0").out.size).toBe(4999);
    expect(performance.now() - t).toBeLessThan(100);
  });
});

describe("an update in place", () => {
  const base: GraphData = { nodes: [node("a"), node("b"), node("c")], edges: [edge("a", "b"), edge("b", "c")], clusters: [{ id: "k", title: "k" }] };

  it("replaces nodes and edges by id where they stand and adds new ones at the end", () => {
    const next = mergeGraph(base, { nodes: [{ ...node("b"), state: "live" }, node("d")], edges: [edge("c", "d")], clusters: [], remove: [], removeEdges: [] });
    expect(next.nodes.map((n) => n.id)).toEqual(["a", "b", "c", "d"]);
    expect(next.nodes[1]?.state).toBe("live");
    expect(next.edges.map((e) => e.id)).toEqual(["a>b", "b>c", "c>d"]);
  });

  it("taking a node away takes its edges; taking a cluster away leaves its nodes loose", () => {
    const g: GraphData = { ...base, nodes: [node("a", "k"), node("b"), node("c")] };
    const next = mergeGraph(g, { nodes: [], edges: [], clusters: [], remove: ["b", "k"], removeEdges: [] });
    expect(next.nodes.map((n) => [n.id, n.cluster])).toEqual([
      ["a", undefined],
      ["c", undefined],
    ]);
    expect(next.edges).toEqual([]);
    expect(next.clusters).toEqual([]);
  });

  it("takes edges away by id", () => {
    expect(mergeGraph(base, { nodes: [], edges: [], clusters: [], remove: [], removeEdges: ["a>b"] }).edges.map((e) => e.id)).toEqual(["b>c"]);
  });
});
