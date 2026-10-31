import { describe, expect, it } from "vitest";
import { mergeRows, nextSort, sortRows, windowOf, type TableColumn, type TableRow } from "./table";

const columns: TableColumn[] = [
  { id: "name", label: "Host", kind: "data" },
  { id: "ports", label: "Ports", kind: "number" },
  { id: "note", label: "Note", kind: "text" },
];
const row = (id: string, cells: TableRow["cells"]): TableRow => ({ id, cells });

describe("sortRows", () => {
  const rows = [row("a", { name: "10.0.0.10", ports: 3 }), row("b", { name: "10.0.0.9", ports: 12 }), row("c", { ports: 1 }), row("d", { name: "esx-02" })];

  it("keeps the given order with no sort", () => {
    expect(sortRows(rows, columns, null).map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("sorts data with its numbers as numbers, and a missing value last either way", () => {
    expect(sortRows(rows, columns, { by: "name", desc: false }).map((r) => r.id)).toEqual(["b", "a", "d", "c"]);
    expect(sortRows(rows, columns, { by: "name", desc: true }).map((r) => r.id)).toEqual(["d", "a", "b", "c"]);
  });

  it("sorts a number column as numbers, and is stable", () => {
    expect(sortRows(rows, columns, { by: "ports", desc: true }).map((r) => r.id)).toEqual(["b", "a", "c", "d"]);
    const ties = [row("x", { ports: 1 }), row("y", { ports: 1 }), row("z", { ports: 0 })];
    expect(sortRows(ties, columns, { by: "ports", desc: false }).map((r) => r.id)).toEqual(["z", "x", "y"]);
  });
});

describe("mergeRows", () => {
  it("replaces a row in place, adds new ones at the end and takes removed ones away", () => {
    const rows = [row("a", { ports: 1 }), row("b", { ports: 2 }), row("c", { ports: 3 })];
    const merged = mergeRows(rows, [row("b", { ports: 20 }), row("d", { ports: 4 })], ["a"]);
    expect(merged.map((r) => [r.id, r.cells.ports])).toEqual([
      ["b", 20],
      ["c", 3],
      ["d", 4],
    ]);
  });

  it("takes 5,000 updates into 5,000 rows quickly", () => {
    const rows = Array.from({ length: 5000 }, (_, i) => row(String(i), { ports: i }));
    const updates = Array.from({ length: 5000 }, (_, i) => row(String(i * 2), { ports: -i }));
    const start = performance.now();
    const merged = mergeRows(rows, updates, []);
    expect(performance.now() - start).toBeLessThan(100);
    expect(merged).toHaveLength(7500);
  });
});

describe("nextSort", () => {
  it("goes to the next column, then back to none", () => {
    expect(nextSort(columns, null)).toEqual({ by: "name", desc: false });
    expect(nextSort(columns, { by: "name", desc: true })).toEqual({ by: "ports", desc: false });
    expect(nextSort(columns, { by: "note", desc: false })).toBeNull();
  });
});

describe("windowOf", () => {
  it("draws the rows on screen and a few more, never past the ends", () => {
    expect(windowOf({ count: 1000, rowHeight: 24, scrollTop: 2400, height: 240, overscan: 5 })).toEqual({ start: 95, end: 115 });
    expect(windowOf({ count: 3, rowHeight: 24, scrollTop: 0, height: 240, overscan: 5 })).toEqual({ start: 0, end: 3 });
  });

  it("draws a first screenful when it can't measure (a hidden panel, tests)", () => {
    expect(windowOf({ count: 1000, rowHeight: 24, scrollTop: 0, height: 0, overscan: 5 })).toEqual({ start: 0, end: 45 });
  });
});
