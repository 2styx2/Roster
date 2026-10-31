// A graph as two tables (ticket 77): every node, and every edge, so nothing in the drawing is
// only in the drawing (WCAG 1.1.1). The nodes' table runs the graph's `open` and actions; the
// edges' table's Enter goes to the edge's first end in the graph.
import type { TableModel } from "../view/views";
import type { TableRow } from "../ui/table";
import { reachCounts, type GraphData, type GraphEdge, type GraphIndex, type GraphNode, type NodeShape } from "./model";
import type { GraphModel } from "../view/views";

/** A shape in words, as the list says it. */
export const SHAPE_WORDS: Record<NodeShape, string> = { dot: "filled", ring: "ring", dashed: "dashed ring", hollow: "hollow", square: "square" };

/** A node's state in words: live or down, its mark, its note. */
export function stateWords(n: GraphNode): string {
  return [n.state, n.mark === "warn" ? "warning" : n.mark === "error" ? "error" : undefined, n.note].filter(Boolean).join(", ");
}

export function nodeTable(model: GraphModel, ix: GraphIndex): TableModel {
  const titles = new Map(model.data.clusters.map((c) => [c.id, c.title]));
  const counts = reachCounts(ix);
  const rows: TableRow[] = model.data.nodes.map((n) => {
    const r = counts.get(n.id) ?? { out: 0, in: 0 };
    const cells: Record<string, string | number> = { name: n.label, shape: SHAPE_WORDS[n.shape], reaches: r.out, reached: r.in };
    if (n.kind) cells.kind = n.kind;
    const state = stateWords(n);
    if (state) cells.state = state;
    if (n.cluster !== undefined && titles.has(n.cluster)) cells.cluster = titles.get(n.cluster) as string;
    if (n.detail) cells.detail = n.detail;
    const tone = n.mark ?? (n.state === "down" ? "muted" : undefined);
    return { id: n.id, cells, ...(n.host ? { host: n.host } : {}), ...(tone ? { tone } : {}) };
  });
  const byId = ix.nodes;
  const node = (row: TableRow) => byId.get(row.id);
  return {
    columns: [
      { id: "name", label: "Node", kind: "data" },
      { id: "detail", label: "Detail", kind: "data" },
      { id: "kind", label: "Kind", kind: "text", width: 10 },
      { id: "shape", label: "Shape", kind: "text", width: 11 },
      { id: "state", label: "State", kind: "text" },
      { id: "cluster", label: "Cluster", kind: "data" },
      { id: "reaches", label: "Reaches", kind: "number", width: 9 },
      { id: "reached", label: "Reached by", kind: "number", width: 11 },
    ],
    rows,
    sort: null,
    empty: "No nodes yet.",
    ...(model.open
      ? {
          open: (row: TableRow) => {
            const n = node(row);
            if (n) model.open?.(n);
          },
        }
      : {}),
    actions: model.actions.map((a) => ({
      ...a,
      run: (row: TableRow) => {
        const n = node(row);
        if (n) a.run(n);
      },
    })),
  };
}

const WAY: Record<GraphEdge["dir"], string> = { one: "one way", both: "both ways" };

export function edgeTable(data: GraphData, ix: GraphIndex, go: (id: string) => void): TableModel {
  const titles = new Map(data.clusters.map((c) => [c.id, c.title]));
  const name = (id: string) => ix.nodes.get(id)?.label ?? (titles.has(id) ? `every node in ${titles.get(id)}` : undefined);
  const rows: TableRow[] = [];
  for (const e of data.edges) {
    const from = name(e.from);
    const to = name(e.to);
    if (from === undefined || to === undefined) continue;
    const state = [e.tone === "muted" ? undefined : e.tone === "warn" ? "warning" : e.tone, e.cut ? "cut pending" : undefined, e.label].filter(Boolean).join(", ");
    const cells: Record<string, string | number> = { from, to, way: WAY[e.dir], style: e.style };
    if (state) cells.state = state;
    const tone = e.tone === "warn" || e.tone === "error" || e.tone === "muted" ? e.tone : e.cut ? "error" : undefined;
    rows.push({ id: e.id, cells, ...(tone ? { tone } : {}) });
  }
  // A meshed cluster's reach isn't edges: it's one row.
  for (const c of data.clusters)
    if (c.mesh) rows.push({ id: `\u0000mesh:${c.id}`, cells: { from: `every node in ${c.title}`, to: "each other", way: "both ways", style: "mesh" } });
  const ends = new Map(data.edges.map((e) => [e.id, e.from]));
  return {
    columns: [
      { id: "from", label: "From", kind: "data" },
      { id: "to", label: "To", kind: "data" },
      { id: "way", label: "Way", kind: "text", width: 10 },
      { id: "style", label: "Line", kind: "text", width: 8 },
      { id: "state", label: "State", kind: "text" },
    ],
    rows,
    sort: null,
    empty: "No edges yet.",
    open: (row: TableRow) => {
      const from = ends.get(row.id);
      if (from !== undefined) go(from);
    },
    actions: [],
  };
}
