// A stand-in Plugin with a view, a 600-row table and Host-details sections (ticket 76), for the
// `?fixture=plugin-views` and `?fixture=plugin-views-worst` dev pages: the table and sections can
// be looked at, and broken (break-ui), in a plain browser. Made-up addresses only.
import type { FakePlugin } from "./fakePlugins";

export const VIEWS_PATH = "~/plugins/demo-scan";

const TONES = [undefined, undefined, undefined, "muted", "warn", "error"] as const;

/** Worst-case cells: long and unbreakable, one letter, non-Latin, emoji, huge and missing. */
const WORST_TITLES = [
  "a",
  "Storage appliance in the far rack with a very long title that goes on and on past any column width",
  "ストレージ装置 (ラック 4)",
  "خادم النسخ الاحتياطي",
  "🔥 hot spare 🔥",
  "unbreakable-name-without-any-spaces-at-all-for-the-column-to-wrap-on.example.internal",
  "",
];

export function demoScanPlugin(worst = false, count = 600): FakePlugin {
  return {
    manifest: { name: "demo-scan", version: "1.0.0", description: "A made-up network scan, to look at views", author: "roster", api: 2, permissions: [] },
    load(roster) {
      const rows = Array.from({ length: count }, (_, i) => {
        const address = `10.${Math.floor(i / 250)}.${i % 250}.${(i * 7) % 254}`;
        const title = worst ? WORST_TITLES[i % WORST_TITLES.length] : `host-${i}`;
        const cells: Record<string, string | number> = { address, ports: worst && i % 9 === 0 ? 9_999_999 : (i * 13) % 40, state: i % 4 === 0 ? "changed" : "new" };
        if (title) cells.title = title;
        const tone = TONES[i % TONES.length];
        return { id: address, cells, ...(tone ? { tone } : {}) };
      });
      roster.views.set("demo-scan", {
        title: worst ? "Discover: a scan of 10.0.0.0/16 with a long name that keeps going" : "Discover",
        place: "full",
        text: worst
          ? "Scanning 10.0.0.0/16 gently. ".repeat(12) + "\n\nResults are kept as unreviewed Pending changes."
          : "Scanning 10.0.0.0/22 gently: 600 found so far.\n\nChoose which to keep; they're added unreviewed, as Pending changes.",
        facts: [
          { label: "range", value: "10.0.0.0/22", data: true },
          { label: "done", value: "64%" },
        ],
        table: {
          columns: [
            { id: "address", label: "Address", kind: "data", width: 16 },
            { id: "title", label: "Title" },
            { id: "ports", label: "Open ports", kind: "number", width: 11 },
            { id: "state", label: "State", width: 9 },
          ],
          rows,
          sort: "address",
          empty: "Nothing found yet.",
          open: (e: Record<string, unknown>) => roster.notify(`would open ${String(e.row)}`),
          actions: [
            { label: "Keep", key: "a", icon: "add", run: (e: Record<string, unknown>) => roster.views.update("demo-scan", { rows: [{ id: e.row, cells: { address: e.row, title: "kept", ports: 0, state: "kept" } }] }) },
            { label: "Skip", key: "x", icon: "close", run: (e: Record<string, unknown>) => roster.views.update("demo-scan", { remove: [e.row] }) },
            { label: "Copy address", key: "c", icon: "copy", run: (e: Record<string, unknown>) => roster.clipboard.copy(String(e.row)) },
          ],
        },
      });
      roster.views.set("demo-empty", {
        title: "Mesh links",
        text: "No Links yet: add one in the editor.",
        table: { columns: [{ id: "from", label: "From", kind: "data" }, { id: "to", label: "To", kind: "data" }], rows: [], empty: "No Links." },
      });
      roster.keymap.set("leader", "y v", "view demo-scan");
      for (const host of ["linux-1-000", "esxi-2-001", "nas-4-007"]) {
        roster.details.set("mesh", host, {
          title: "Mesh",
          facts: [{ label: "reach", value: worst ? "can reach 4,812 Hosts across 37 groups and 12 Links" : "can reach 7 Hosts" }],
          table: {
            columns: [
              { id: "peer", label: "Peer", kind: "data" },
              { id: "how", label: "How" },
            ],
            rows: Array.from({ length: worst ? 40 : 3 }, (_, i) => ({ id: String(i), cells: { peer: `web-${i}`, how: i % 2 ? "key" : "password" }, ...(i === 1 ? { tone: "warn" } : {}) })),
            actions: [{ label: "Cut", key: "x", icon: "close", run: (e: Record<string, unknown>) => roster.notify(`would cut ${String(e.host)}`) }],
          },
        });
      }
    },
  };
}
