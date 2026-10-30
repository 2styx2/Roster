# 40: Topology view

**Iteration:** 6 · **Repo:** roster (app, plus `roster serve` data) · **Issue:** [#73](https://github.com/2styx2/roster/issues/73)

**Why:** Owner request (2026-10-30), with the Mesh (Q63): see the whole network and who can reach whom at a glance. It's roster's network-map motif (`docs/app/design/taste.md`) as a real view.

**What to build:** A full-window **Topology** view (`:topology`, a Leader key, and in the Picker), keyboard first like the rest of the app:

- **Nodes:** this Box and every Host, grouped by Inventory group (the subnet groups become clusters). The node shapes follow Q53 (key, password, unreviewed, ended), live Sessions are in the accent (Q57), and down or unreachable Hosts are shown as such.
- **Edges:**
  - the Box's own access to each Host;
  - Mesh reach inside meshed groups;
  - Links across groups and networks, one-way arrows or two-way;
  - password peers drawn differently from key peers.

  Pending Mesh changes ("out of date") and "cut pending" Hosts are marked.
- **Interaction:**
  - select a Host to highlight what it can reach and what can reach it, with "can reach N Hosts" (Q63's visible risk);
  - open a Session, Check or Cut from the node;
  - filter by group, type or status;
  - zoom and pan;
  - `/` searches;
  - vim keys move between nodes.
- **Layout:** stable between openings (positions kept in State), and readable at 500+ Hosts (clusters collapse to a count), per the worst-case rule (Q47).
- **Data:** comes from `roster serve`, one method that returns nodes, edges and Mesh status. The app never reads `roster.yml` (ADR 0001).
- **Build rules:** `emil-design-eng` for the look; every animation (an edge drawing on connect, highlight transitions) goes through the `animate` skill, with reduced motion respected; accessible as a list too (every node and edge readable without the graph).
- Before the Mesh lands, the view still shows the Box → Host map and groups. Mesh edges appear with ticket 39.

**Blocked by:** 17 (done); Mesh edges need 39.

**Status:** ready-for-agent

- [ ] `:topology` opens the view; Esc returns to where you were.
- [ ] Groups as clusters, Box and Host nodes with the Q53 shapes and live and down states.
- [ ] Mesh, Links (with direction) and password peers drawn; out-of-date and cut-pending marked.
- [ ] Selecting a Host highlights its reach both ways, with counts; Session, Check and Cut work from the node.
- [ ] Filter, search, zoom and pan, and vim navigation; layout is stable across openings.
- [ ] 500+ Hosts stay readable and smooth (break-ui pass).
- [ ] Equivalent accessible list view; reduced motion respected.
- [ ] Tests through the typed client with the fake backend.
