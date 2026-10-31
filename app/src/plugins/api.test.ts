// The Plugin API's types (crates/roster-core/src/plugin/api.rs, ticket 70) against what the app
// really reads of them: ops.ts checks each op a Plugin sends, and this test records every field it
// reads of each table (a Proxy) and compares that with the type's documented fields. A field
// ops.ts starts reading, or one the reference lists that nothing reads, fails here: change api.rs
// and run `cargo run -p roster-core --example gen_plugin_api`.
import { describe, expect, it } from "vitest";
import api from "../../../crates/roster-core/tests/fixtures/plugin-api.json";
import { parseOp } from "./ops";

type Types = Record<string, { fields?: { name: string }[]; alias?: string }>;
const TYPES = api.types as Types;

const reads = new Map<string, Set<string>>();

/** `value`, recording each field read of it as a read of the type `type`. */
function typed<T extends object>(type: string, value: T): T {
  const seen = reads.get(type) ?? new Set<string>();
  reads.set(type, seen);
  return new Proxy(value, {
    get(target, key, receiver) {
      if (typeof key === "string" && !(key in Object.prototype)) seen.add(key);
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
}

const fields = (type: string) => (TYPES[type]?.fields ?? []).map((f) => f.name).filter((n) => !n.startsWith("["));

describe("the Plugin API reference and ops.ts agree", () => {
  const ops: unknown[] = [
    {
      op: "section",
      id: "s",
      spec: typed("Section", {
        title: "T",
        order: 1,
        empty: "none",
        rows: [
          typed("Row", {
            id: "r",
            label: "L",
            detail: "d",
            note: "n",
            host: "esx-02",
            badge: "b",
            count: 1,
            level: 1,
            title: "t",
            run: "open esx-02",
            actions: [typed("RowAction", { label: "A", icon: "copy", run: { handler: 1 } })],
          }),
        ],
      }),
    },
    { op: "status", id: "s", spec: typed("StatusSegment", { text: "x", title: "t", run: "finder x" }) },
    {
      op: "finder",
      id: "f",
      spec: typed("Finder", { title: "F", items: [typed("FinderItem", { id: "i", label: "L", detail: "d", path: "p", run: "x" })] }),
    },
    { op: "help", id: "h", spec: typed("HelpPage", { title: "H", summary: "s", markdown: "# H" }) },
    { op: "health", id: "h", spec: typed("HealthSection", { title: "H", checks: [typed("HealthCheck", { level: "warn", message: "m", fix: "f" })] }) },
    {
      op: "tutor",
      id: "t",
      spec: typed("Tutorial", {
        title: "T",
        summary: "s",
        intro: "i",
        outro: "o",
        lessons: [typed("Lesson", { title: "L", text: "t", steps: [typed("Step", { id: "a", text: "t", on: { event: "command", id: "finder" } })] })],
      }),
    },
    { op: "float", spec: typed("Float", { title: "F", lines: ["a"] }) },
    {
      op: "view",
      id: "v",
      spec: typed("View", {
        title: "V",
        place: "full",
        text: "t",
        facts: [typed("Fact", { label: "l", value: "v", data: true })],
        table: typed("Table", {
          columns: [typed("Column", { id: "a", label: "A", kind: "number", width: 6 })],
          rows: [typed("TableRow", { id: "r", cells: { a: 1 }, host: "esx-02", tone: "muted" })],
          sort: "a",
          desc: true,
          empty: "none",
          open: { handler: 1 },
          actions: [typed("TableAction", { label: "K", key: "x", icon: "add", run: { handler: 2 } })],
        }),
      }),
    },
    {
      op: "view_update",
      id: "v",
      changes: typed("ViewUpdate", { title: "V", text: "t", facts: [], rows: [{ id: "r", cells: { a: 2 } }], remove: ["q"] }),
    },
    {
      op: "details",
      id: "d",
      host: "esx-02",
      spec: typed("DetailsSection", { title: "D", order: 1, text: "t", facts: [], table: { columns: [{ id: "a", label: "A" }] } }),
    },
  ];

  it("ops.ts takes every op with every documented field", () => {
    for (const op of ops) expect(parseOp(op)).not.toHaveProperty("invalid");
  });

  it.each(["Section", "Row", "RowAction", "StatusSegment", "Finder", "FinderItem", "HelpPage", "HealthSection", "HealthCheck", "Tutorial", "Lesson", "Step", "Float", "View", "ViewUpdate", "DetailsSection", "Fact", "Table", "Column", "TableRow", "TableAction"])(
    "%s: ops.ts reads exactly the fields the reference lists",
    (type) => {
      for (const op of ops) parseOp(op);
      expect([...(reads.get(type) ?? [])].sort()).toEqual(fields(type).sort());
    },
  );

  it("the row icons and tutor events are the app's", async () => {
    const { TUTOR_EVENTS } = await import("../tutor/tutor");
    const literals = (alias: string | undefined) => [...(alias ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(literals(TYPES.TutorEvent?.alias)).toEqual([...TUTOR_EVENTS]);
    for (const icon of literals(TYPES.RowIcon?.alias)) {
      const op = { op: "section", id: "s", spec: { rows: [{ label: "x", actions: [{ label: "a", icon, run: "x" }] }] } };
      expect(parseOp(op), icon).not.toHaveProperty("invalid");
    }
    const bad = { op: "section", id: "s", spec: { rows: [{ label: "x", actions: [{ label: "a", icon: "nope", run: "x" }] }] } };
    const message = (parseOp(bad) as { invalid: string }).invalid;
    expect(message.split("icon must be one of ")[1]?.split(", ")).toEqual(literals(TYPES.RowIcon?.alias));
  });
});
