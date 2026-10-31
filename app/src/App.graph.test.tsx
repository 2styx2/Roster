// A Plugin's graph in a view (ticket 77, decision Q99) through the App, with the fake Backend's
// Plugin host: the graph opens with focus, vim keys move between nodes and say where they are,
// selecting lights up its reach both ways with counts, / searches, o collapses a cluster to its
// count, Enter and action keys run the graph's functions with the node, t lists every node and
// edge, an update changes a node in place, and positions and folds are kept in the State.
import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { FAKE_PASSWORD, fakeBackend, makeHosts } from "./backend/fake";
import type { FakePlugin } from "./backend/fakePlugins";
import { memoryPlatform } from "./platform/memory";
import { StubTerminal } from "./terminal/StubTerminal";
import { GRAPHS_KEY } from "./graph/memory";

const LEADER = "{Control>} {/Control}";
const PATH = "~/plugins/topo";

/** A Topology-like Plugin: this Box, two clusters (one meshed), a Link and a password peer. */
function topoPlugin(): FakePlugin {
  return {
    manifest: { name: "topo", version: "1.0.0", description: "A map", author: "A. Author", api: 3, permissions: [] },
    load(roster) {
      roster.views.set("topo", {
        title: "Topology",
        place: "full",
        graph: {
          clusters: [
            { id: "lab", title: "lab", mesh: true },
            { id: "web", title: "web" },
          ],
          nodes: [
            { id: "box", label: "devbox", shape: "square" },
            { id: "esx-01", cluster: "lab", host: "esx-01", detail: "10.0.0.5", kind: "esxi" },
            { id: "esx-02", cluster: "lab", host: "esx-02", shape: "ring", mark: "warn", note: "out of date" },
            { id: "web-1", cluster: "web", host: "web-1" },
            { id: "appliance", cluster: "web", shape: "ring", state: "down" },
          ],
          edges: [
            { from: "box", to: "lab" },
            { from: "box", to: "web" },
            { from: "esx-01", to: "web-1", style: "solid" },
            { from: "esx-02", to: "appliance", style: "dashed", cut: true },
          ],
          open: (e: Record<string, unknown>) => roster.notify(`opened ${String(e.node)} on ${String(e.host)}`),
          actions: [
            { label: "Check", key: "c", run: (e: Record<string, unknown>) => roster.notify(`checked ${String(e.node)}`) },
            { label: "Connect", key: "s", run: (e: Record<string, unknown>) => roster.views.update("topo", { nodes: [{ id: e.node, cluster: "web", host: e.node, state: "live" }] }) },
          ],
        },
      });
      roster.keymap.set("leader", "y t", "view topo");
    },
  };
}

async function ready(platform = memoryPlatform()) {
  const user = userEvent.setup();
  const backend = fakeBackend({ hosts: makeHosts(12), plugins: { [PATH]: topoPlugin() } });
  const view = render(<App backend={backend} terminalView={StubTerminal} platform={platform} />);
  await user.type(await screen.findByLabelText(/master password/i), `${FAKE_PASSWORD}{Enter}`);
  await screen.findByRole("main", { name: /workspace/i });
  await user.keyboard(`${LEADER}:plugins install ${PATH}{Enter}`);
  await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Install" }));
  await screen.findByText("12 Hosts");
  return { user, view, platform };
}

const graph = () => screen.getByRole("application", { name: "Topology" });
const said = async (text: string | RegExp) => waitFor(() => expect(screen.getAllByRole("status").some((s) => (typeof text === "string" ? s.textContent?.includes(text) : text.test(s.textContent ?? "")))).toBe(true));
const foot = () => document.querySelector(".graph-about")?.textContent ?? "";

describe("a Plugin's graph", () => {
  it("opens with focus on the first node, and says what it reaches both ways", async () => {
    const { user } = await ready();
    await user.keyboard(`${LEADER}:view topo{Enter}`);
    await screen.findByRole("region", { name: "Topology (from topo)" });
    expect(graph()).toHaveFocus();
    expect(foot()).toBe("devbox, square. Reaches 4 nodes; reached by 0");
    await said("devbox, square. Reaches 4 nodes");
  });

  it("vim keys move to the nearest node; a node in a meshed cluster reaches its peers and onward", async () => {
    const { user } = await ready();
    await user.keyboard(`${LEADER}:view topo{Enter}`);
    await screen.findByRole("application", { name: "Topology" });
    // The Box is alone at the top left; the clusters are to its right.
    await user.keyboard("l");
    expect(foot()).toMatch(/^esx-0[12]/);
    // Find esx-02 by search: it reaches esx-01 (mesh), web-1 (via esx-01) and appliance.
    await user.keyboard("/esx-02{Enter}");
    expect(graph()).toHaveFocus();
    expect(foot()).toBe("esx-02, ring, warning, out of date. Reaches 3 nodes; reached by 2");
  });

  it("/ searches, n goes through the matches, Esc clears the search and a second Esc closes the view", async () => {
    const { user } = await ready();
    await user.keyboard(`${LEADER}:view topo{Enter}`);
    await screen.findByRole("application", { name: "Topology" });
    await user.keyboard("/esx");
    expect(screen.getByRole("searchbox", { name: "Search Topology" })).toHaveFocus();
    expect(screen.getByText("2 matches for esx")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    const first = foot();
    await user.keyboard("n");
    expect(foot()).not.toBe(first);
    expect(foot()).toMatch(/^esx-0/);
    await user.keyboard("{Escape}");
    expect(screen.queryByText(/matches for/)).toBeNull();
    expect(screen.getByRole("region", { name: "Topology (from topo)" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Topology (from topo)" })).toBeNull();
  });

  it("Enter and an action's key run the graph's functions with the node and its Host", async () => {
    const { user } = await ready();
    await user.keyboard(`${LEADER}:view topo{Enter}`);
    await screen.findByRole("application", { name: "Topology" });
    await user.keyboard("/esx-01{Enter}");
    await user.keyboard("{Enter}");
    expect(await screen.findByText(/opened esx-01 on esx-01/)).toBeInTheDocument();
    await user.keyboard("c");
    expect(await screen.findByText(/checked esx-01/)).toBeInTheDocument();
  });

  it("o collapses the selected node's cluster to its count and opens it again", async () => {
    const { user } = await ready();
    await user.keyboard(`${LEADER}:view topo{Enter}`);
    await screen.findByRole("application", { name: "Topology" });
    await user.keyboard("/web-1{Enter}o");
    expect(foot()).toBe("web: 2 nodes, collapsed. Reaches 0 nodes; reached by 3");
    await user.keyboard("{Enter}");
    expect(foot()).toMatch(/^web-1/);
  });

  it("t lists every node with its reach, then every edge; Enter on an edge goes to its start in the graph", async () => {
    const { user } = await ready();
    await user.keyboard(`${LEADER}:view topo{Enter}`);
    await screen.findByRole("application", { name: "Topology" });
    await user.keyboard("t");
    const nodes = screen.getByRole("grid", { name: "Topology: nodes" });
    expect(nodes).toHaveFocus();
    const rows = within(nodes).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(5);
    expect(rows[2]).toHaveTextContent("esx-02");
    expect(rows[2]).toHaveTextContent("warning, out of date");
    expect(rows[4]).toHaveTextContent("appliance");
    expect(rows[4]).toHaveTextContent("down");
    await user.keyboard("t");
    const edges = screen.getByRole("grid", { name: "Topology: edges" });
    const lines = within(edges).getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(lines).toEqual([
      expect.stringContaining("devboxevery node in lab"),
      expect.stringContaining("devboxevery node in web"),
      expect.stringContaining("esx-01web-1"),
      expect.stringContaining("cut pending"),
      expect.stringContaining("every node in labeach otherboth ways"),
    ]);
    await user.keyboard("jjj{Enter}");
    expect(graph()).toHaveFocus();
    expect(foot()).toMatch(/^esx-02/);
  });

  it("an update changes a node in place and keeps the selection", async () => {
    const { user } = await ready();
    await user.keyboard(`${LEADER}:view topo{Enter}`);
    await screen.findByRole("application", { name: "Topology" });
    await user.keyboard("/web-1{Enter}");
    await user.keyboard("s");
    await waitFor(() => expect(foot()).toBe("web-1, filled, live. Reaches 0 nodes; reached by 3"));
  });

  it("keeps where each node was placed and which clusters are collapsed in the State", async () => {
    const { user, platform } = await ready();
    await user.keyboard(`${LEADER}:view topo{Enter}`);
    await screen.findByRole("application", { name: "Topology" });
    await user.keyboard("/web-1{Enter}o");
    await waitFor(async () => {
      const state = (await platform.loadState()) as Record<string, unknown>;
      const graphs = state[GRAPHS_KEY] as { key: string; nodes: Record<string, unknown>; folds: Record<string, boolean> }[];
      expect(graphs[0]?.key).toBe("topo/topo");
      expect(Object.keys(graphs[0]?.nodes ?? {}).sort()).toEqual(["appliance", "box", "esx-01", "esx-02", "web-1"]);
      expect(graphs[0]?.folds).toEqual({ web: true });
    });
  });
});
