// A graph as plain data (ticket 77, decision Q99): nodes, edges and clusters a Plugin fills, and
// what can reach what. Pure, so the graph view (GraphView.tsx) is a drawing of it and its tests
// need no canvas.
//
// An edge's end is a node or a cluster: an edge to a cluster reaches every node in it, one from a
// cluster is every node's in it. A meshed cluster's nodes reach each other both ways (the Mesh's
// `mesh: true`, Q63) without n² edges. An end that names nothing (yet) is ignored.

/** How a node is drawn: its shape carries meaning, not only its colour (Q53, taste.md). */
export type NodeShape = "dot" | "ring" | "dashed" | "hollow" | "square";
/** `live` is in the accent (connected now); `down` is drawn quieter and crossed. */
export type NodeState = "live" | "down";
export type Mark = "warn" | "error";
export type EdgeDir = "one" | "both";
export type EdgeStyle = "solid" | "dashed" | "dotted";
export type EdgeTone = "live" | "muted" | "warn" | "error";

export interface GraphNode {
  id: string;
  label: string;
  /** What sort of thing it is ("esxi", "linux"): searched, and a column in the list. */
  kind?: string;
  shape: NodeShape;
  state?: NodeState;
  /** A small mark beside it, warn yellow or error raspberry. */
  mark?: Mark;
  /** A few words about it ("out of date", "cut pending"), beside it when selected and in the list. */
  note?: string;
  /** The cluster it's in. */
  cluster?: string;
  /** The Host it is: actions get it as `e.host`. */
  host?: string;
  /** A second line in the data font (an address). */
  detail?: string;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  /** `one`: from → to; `both`: each way. */
  dir: EdgeDir;
  style: EdgeStyle;
  tone?: EdgeTone;
  /** Drawn broken in the middle: about to be cut. */
  cut?: true;
  /** A few words, in the list. */
  label?: string;
}

export interface GraphCluster {
  id: string;
  title: string;
  /** Every node in it reaches every other, both ways. */
  mesh?: true;
  /** Starts collapsed to a count (or open); left out, it collapses when the graph is big. */
  collapsed?: boolean;
}

export interface GraphData {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  clusters: readonly GraphCluster[];
}

export interface GraphUpdate {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  clusters: readonly GraphCluster[];
  /** Node or cluster ids to take away: a node's edges go with it; a cluster's nodes stay, loose. */
  remove: readonly string[];
  removeEdges: readonly string[];
}

function upsert<T extends { id: string }>(items: readonly T[], changes: readonly T[]): T[] {
  const at = new Map(items.map((x, i) => [x.id, i]));
  const out = [...items];
  for (const c of changes) {
    const i = at.get(c.id);
    if (i === undefined) {
      at.set(c.id, out.length);
      out.push(c);
    } else out[i] = c;
  }
  return out;
}

/** `graph` with `update` in: what's there already is replaced where it stands, new things go at
 * the end, then the ids in `remove` and `removeEdges` are taken away. */
export function mergeGraph(graph: GraphData, update: GraphUpdate): GraphData {
  let nodes = upsert(graph.nodes, update.nodes);
  let edges = upsert(graph.edges, update.edges);
  let clusters = upsert(graph.clusters, update.clusters);
  if (update.remove.length) {
    const gone = new Set(update.remove);
    nodes = nodes.filter((n) => !gone.has(n.id)).map((n) => (n.cluster !== undefined && gone.has(n.cluster) ? withoutCluster(n) : n));
    clusters = clusters.filter((c) => !gone.has(c.id));
    edges = edges.filter((e) => !gone.has(e.from) && !gone.has(e.to));
  }
  if (update.removeEdges.length) {
    const gone = new Set(update.removeEdges);
    edges = edges.filter((e) => !gone.has(e.id));
  }
  return { nodes, edges, clusters };
}

function withoutCluster(n: GraphNode): GraphNode {
  const { cluster: _, ...rest } = n;
  return rest;
}

/** What `reachOf` needs, built once per graph. */
export interface GraphIndex {
  nodes: ReadonlyMap<string, GraphNode>;
  /** A cluster's nodes, in order. */
  members: ReadonlyMap<string, readonly string[]>;
  meshed: ReadonlySet<string>;
  /** Each end's next ends (node or cluster ids), forward and backward. */
  next: ReadonlyMap<string, readonly string[]>;
  prev: ReadonlyMap<string, readonly string[]>;
}

export function graphIndex(g: GraphData): GraphIndex {
  const nodes = new Map(g.nodes.map((n) => [n.id, n]));
  const clusterIds = new Set(g.clusters.map((c) => c.id));
  const members = new Map<string, string[]>(g.clusters.map((c) => [c.id, []]));
  for (const n of g.nodes) if (n.cluster !== undefined) members.get(n.cluster)?.push(n.id);
  const meshed = new Set(g.clusters.filter((c) => c.mesh).map((c) => c.id));
  const next = new Map<string, string[]>();
  const prev = new Map<string, string[]>();
  const add = (m: Map<string, string[]>, k: string, v: string) => {
    const list = m.get(k);
    if (list) list.push(v);
    else m.set(k, [v]);
  };
  const known = (id: string) => nodes.has(id) || clusterIds.has(id);
  for (const e of g.edges) {
    if (!known(e.from) || !known(e.to) || e.from === e.to) continue;
    add(next, e.from, e.to);
    add(prev, e.to, e.from);
    if (e.dir === "both") {
      add(next, e.to, e.from);
      add(prev, e.from, e.to);
    }
  }
  return { nodes, members, meshed, next, prev };
}

function walk(ix: GraphIndex, start: string, links: ReadonlyMap<string, readonly string[]>): Set<string> {
  const seen = new Set<string>([start]);
  const opened = new Set<string>();
  const queue = [start];
  const reach = (id: string) => {
    if (ix.nodes.has(id)) {
      if (!seen.has(id)) {
        seen.add(id);
        queue.push(id);
      }
      return;
    }
    // A cluster: every node in it, once.
    if (opened.has(id)) return;
    opened.add(id);
    for (const m of ix.members.get(id) ?? []) reach(m);
  };
  while (queue.length) {
    const id = queue.pop() as string;
    const cluster = ix.nodes.get(id)?.cluster;
    for (const t of links.get(id) ?? []) reach(t);
    if (cluster !== undefined && ix.members.has(cluster)) {
      for (const t of links.get(cluster) ?? []) reach(t);
      if (ix.meshed.has(cluster)) reach(cluster);
    }
  }
  seen.delete(start);
  return seen;
}

/** The nodes `id` can reach, however many hops away, and those that can reach it. */
export function reachOf(ix: GraphIndex, id: string): { out: Set<string>; in: Set<string> } {
  if (!ix.nodes.has(id)) return { out: new Set(), in: new Set() };
  return { out: walk(ix, id, ix.next), in: walk(ix, id, ix.prev) };
}
