// What a Plugin asks of the UI (ticket 23, docs/plugins.md "Ops"): plain data from roster-core's
// Plugin host, one op per `roster.*` call. It comes from third-party code, so every op is checked
// here before the app draws anything: a field of the wrong kind drops the op with a reason, and
// text is cut to what the UI can show. A Lua function arrives as `{ handler: N }`.
import type { ThemeDef } from "../config/types";
import type { RowAction } from "../sidebar/Sidebar";
import { TUTOR_EVENTS, type StepMatch } from "../tutor/tutor";
import type { ColumnKind, Sort, TableColumn, TableRow, Tone } from "../ui/table";
import { GraphInvalid, parseGraph, parseGraphUpdate, type PluginGraph, type PluginGraphUpdate } from "./graphOps";

/** What choosing something runs: a function the Plugin handed over, or a command line. */
export type Run = { handler: number } | { command: string };

export interface PluginRowAction {
  label: string;
  icon: RowAction["icon"];
  run: Run;
}

export interface PluginRow {
  id: string;
  label: string;
  detail?: string;
  note?: string;
  host?: string;
  badge?: string;
  count?: number;
  level?: number;
  title?: string;
  run?: Run;
  actions: PluginRowAction[];
}

export interface PluginFinderItem {
  id: string;
  label: string;
  detail?: string;
  path?: string;
  run: Run;
}

/** One line of a Plugin's `:check` section. */
export interface PluginHealthCheck {
  level: "ok" | "warn" | "error";
  message: string;
  fix?: string;
}

/** A Plugin's tutorial (`roster.tutor.set`, ticket 55): Markdown text, and steps that wait for
 * app events (tutor.ts StepMatch). */
export interface PluginTutorStep {
  id: string;
  text: string;
  on: StepMatch[];
}

export interface PluginTutorLesson {
  title: string;
  text: string;
  steps: PluginTutorStep[];
}

export interface PluginFloat {
  title: string;
  lines: string[];
}

/** A label and its value (a Host's details, a view). `data`: set in the data font. */
export interface PluginFact {
  label: string;
  value: string;
  data?: true;
}

export interface PluginTableAction {
  label: string;
  /** One character that runs it on the selected row. */
  key?: string;
  icon?: RowAction["icon"];
  run: Run;
}

/** A table (ticket 76): rows are plain data; what a row does is the table's, and a function gets
 * the row (`{ row, host, view | section }`). */
export interface PluginTable {
  columns: TableColumn[];
  rows: TableRow[];
  sort: Sort | null;
  empty?: string;
  open?: Run;
  actions: PluginTableAction[];
}

/** What a view and a Host-details section hold, drawn top to bottom. */
export interface PluginContent {
  text?: string;
  facts: PluginFact[];
  table?: PluginTable;
}

export type ViewPlace = "panel" | "full";

export interface PluginView extends PluginContent {
  title: string;
  place: ViewPlace;
  /** A graph instead of a table (ticket 77). */
  graph?: PluginGraph;
}

export interface PluginViewUpdate {
  title?: string;
  /** "" takes the text away. */
  text?: string;
  facts?: PluginFact[];
  rows: TableRow[];
  /** Rows' ids, or in a graph, nodes' and clusters'. */
  remove: string[];
  /** Nodes, edges and clusters, in a graph (ticket 77). */
  graph?: PluginGraphUpdate;
}

export interface PluginDetails extends PluginContent {
  title: string;
  order: number;
}

export type PluginOp =
  | { op: "command"; name: string; desc: string; run: Run }
  | { op: "key"; context: string; keys: string; action: string | false }
  | { op: "theme"; id: string; theme: ThemeDef }
  | { op: "section"; id: string; title: string; order: number; empty?: string; rows: PluginRow[] }
  | { op: "status"; id: string; text: string; title?: string; run?: Run }
  | { op: "finder"; id: string; title: string; items: PluginFinderItem[] }
  | { op: "help"; id: string; title: string; summary: string; markdown: string }
  | { op: "health"; id: string; title: string; checks: PluginHealthCheck[] }
  | { op: "tutor"; id: string; title: string; summary: string; intro: string; lessons: PluginTutorLesson[]; outro: string }
  | { op: "badge"; host: string; text: string | null }
  | { op: "float"; spec: PluginFloat | null }
  | { op: "view"; id: string; view: PluginView }
  | { op: "view_update"; id: string; update: PluginViewUpdate }
  | { op: "view_open"; id: string }
  | { op: "view_close"; id: string }
  | { op: "details"; id: string; host: string; section: PluginDetails | null }
  | { op: "notify"; text: string; level: "info" | "warn" | "error" }
  | { op: "open"; host: string }
  | { op: "send"; session: number; text: string }
  | { op: "copy"; text: string }
  | { op: "remove"; kind: RemovableKind; id: string };

export const REMOVABLE = ["command", "section", "status", "finder", "help", "health", "tutor", "view", "details"] as const;
export type RemovableKind = (typeof REMOVABLE)[number];

const ICONS: readonly RowAction["icon"][] = ["close", "edit", "add", "addGroup", "review", "unreview", "info", "copy"];
const LEVELS = ["info", "warn", "error"] as const;
const HEALTH_LEVELS = ["ok", "warn", "error"] as const;

/** Most rows a section, items a finder, lines a float may have. */
export const MAX_ROWS = 2000;
/** Most rows a table may hold after updates (ticket 76). */
export const MAX_TABLE_ROWS = 10_000;
const MAX_TEXT = 500;
const MAX_VIEW_TEXT = 4000;
const MAX_COLUMNS = 20;
const MAX_ACTIONS = 8;
const KINDS: readonly ColumnKind[] = ["text", "data", "number"];
const TONES: readonly Tone[] = ["muted", "warn", "error"];
/** Keys a table uses itself (moving, sorting, and kept for a filter and its help). */
export const TABLE_KEYS = ["j", "k", "g", "G", "s", "S", "/", "?", "q"] as const;
const MAX_HELP = 200_000;
const MAX_COPY = 64 * 1024;

class Invalid extends Error {}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function str(o: Obj, key: string, what: string, max = MAX_TEXT): string {
  const v = o[key];
  if (typeof v !== "string") throw new Invalid(`${what}: ${key} must be text`);
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

function optStr(o: Obj, key: string, what: string, max = MAX_TEXT): string | undefined {
  return o[key] === undefined || o[key] === null ? undefined : str(o, key, what, max);
}

function num(o: Obj, key: string, what: string): number | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Invalid(`${what}: ${key} must be a number`);
  return v;
}

function list(o: Obj, key: string, what: string): unknown[] {
  const v = o[key];
  if (v === undefined || v === null || (isObj(v) && Object.keys(v).length === 0)) return [];
  if (!Array.isArray(v)) throw new Invalid(`${what}: ${key} must be a list`);
  if (v.length > MAX_ROWS) throw new Invalid(`${what}: ${key} has more than ${MAX_ROWS} entries`);
  return v;
}

function run(v: unknown, what: string): Run {
  if (typeof v === "string") return { command: v.slice(0, MAX_TEXT) };
  if (isObj(v) && typeof v.handler === "number" && Number.isInteger(v.handler)) return { handler: v.handler };
  throw new Invalid(`${what}: run must be a function or a command line`);
}

const optRun = (o: Obj, what: string): { run?: Run } => (o.run === undefined || o.run === null ? {} : { run: run(o.run, what) });

/** Leaves out the keys whose value is undefined (exactOptionalPropertyTypes). */
function defined<T>(o: { [K in keyof T]-?: T[K] | undefined }): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

function row(v: unknown, i: number, what: string): PluginRow {
  const at = `${what} row ${i + 1}`;
  if (!isObj(v)) throw new Invalid(`${at}: must be a table`);
  const label = str(v, "label", at);
  const actions = list(v, "actions", at).map((a, j): PluginRowAction => {
    const where = `${at} action ${j + 1}`;
    if (!isObj(a)) throw new Invalid(`${where}: must be a table`);
    const icon = a.icon === undefined ? "info" : a.icon;
    if (!ICONS.includes(icon as RowAction["icon"])) throw new Invalid(`${where}: icon must be one of ${ICONS.join(", ")}`);
    return { label: str(a, "label", where), icon: icon as RowAction["icon"], run: run(a.run, where) };
  });
  const level = num(v, "level", at);
  return defined<PluginRow>({
    id: optStr(v, "id", at, 100) ?? String(i + 1),
    label,
    detail: optStr(v, "detail", at),
    note: optStr(v, "note", at),
    host: optStr(v, "host", at, 200),
    badge: optStr(v, "badge", at, 40),
    count: num(v, "count", at),
    level: level === undefined ? undefined : Math.max(0, Math.min(8, Math.floor(level))),
    title: optStr(v, "title", at),
    run: optRun(v, at).run,
    actions,
  });
}

/** A list that may come from Lua as `{}` (an empty table is an object in JSON). */
const isList = (v: unknown): v is unknown[] => Array.isArray(v);

function facts(o: Obj, what: string): PluginFact[] {
  return list(o, "facts", what).map((v, i): PluginFact => {
    const at = `${what} fact ${i + 1}`;
    if (!isObj(v)) throw new Invalid(`${at}: must be a table`);
    if (v.data !== undefined && v.data !== null && typeof v.data !== "boolean") throw new Invalid(`${at}: data must be true or false`);
    return defined<PluginFact>({ label: str(v, "label", at, 100), value: str(v, "value", at), data: v.data === true ? true : undefined });
  });
}

/** A table's row: an id, its cells (text or numbers), its Host and tone. */
function tableRow(v: unknown, i: number, what: string): TableRow {
  const at = `${what} row ${i + 1}`;
  if (!isObj(v)) throw new Invalid(`${at}: must be a table`);
  const raw = v.cells;
  const cells: Record<string, string | number> = {};
  if (isObj(raw)) {
    for (const [k, c] of Object.entries(raw)) {
      if (typeof c === "number" && Number.isFinite(c)) cells[k] = c;
      else if (typeof c === "string") cells[k] = c.length > MAX_TEXT ? `${c.slice(0, MAX_TEXT - 1)}…` : c;
      else throw new Invalid(`${at}: cells.${k} must be text or a number`);
    }
  } else if (!(raw === undefined || raw === null || (isList(raw) && raw.length === 0))) throw new Invalid(`${at}: cells must be a table of column = value`);
  const tone = v.tone === undefined || v.tone === null ? undefined : TONES.find((t) => t === v.tone);
  if (v.tone !== undefined && v.tone !== null && !tone) throw new Invalid(`${at}: tone must be "muted", "warn" or "error"`);
  return defined<TableRow>({ id: str(v, "id", at, 100), cells, host: optStr(v, "host", at, 200), tone });
}

function tableRows(o: Obj, key: string, what: string): TableRow[] {
  const rows = list(o, key, what).map((r, i) => tableRow(r, i, what));
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) throw new Invalid(`${what}: row id ${r.id} is used twice`);
    seen.add(r.id);
  }
  return rows;
}

function table(v: unknown, what: string): PluginTable {
  const at = `${what} table`;
  if (!isObj(v)) throw new Invalid(`${at}: must be a table`);
  const ids = new Set<string>();
  const columns = list(v, "columns", at).map((c, i): TableColumn => {
    const where = `${at} column ${i + 1}`;
    if (!isObj(c)) throw new Invalid(`${where}: must be a table`);
    const id = str(c, "id", where, 64);
    if (ids.has(id)) throw new Invalid(`${where}: id ${id} is used twice`);
    ids.add(id);
    const kind = c.kind === undefined || c.kind === null ? "text" : KINDS.find((k) => k === c.kind);
    if (!kind) throw new Invalid(`${where}: kind must be "text", "data" or "number"`);
    const width = num(c, "width", where);
    return defined<TableColumn>({ id, label: str(c, "label", where, 100), kind, width: width === undefined ? undefined : Math.max(2, Math.min(80, Math.round(width))) });
  });
  if (columns.length === 0) throw new Invalid(`${at}: columns must have at least one column`);
  if (columns.length > MAX_COLUMNS) throw new Invalid(`${at}: columns has more than ${MAX_COLUMNS}`);
  const by = optStr(v, "sort", at, 64);
  if (by !== undefined && !ids.has(by)) throw new Invalid(`${at}: sort names no column (${by})`);
  if (v.desc !== undefined && v.desc !== null && typeof v.desc !== "boolean") throw new Invalid(`${at}: desc must be true or false`);
  const keys = new Set<string>();
  const actions = list(v, "actions", at).map((a, j): PluginTableAction => {
    const where = `${at} action ${j + 1}`;
    if (!isObj(a)) throw new Invalid(`${where}: must be a table`);
    const key = optStr(a, "key", where, 8);
    if (key !== undefined) {
      if ([...key].length !== 1 || key.trim() === "") throw new Invalid(`${where}: key must be one character`);
      if ((TABLE_KEYS as readonly string[]).includes(key)) throw new Invalid(`${where}: the table uses ${key} itself (${TABLE_KEYS.join(" ")})`);
      if (keys.has(key)) throw new Invalid(`${where}: key ${key} is used twice`);
      keys.add(key);
    }
    const icon = a.icon === undefined || a.icon === null ? undefined : ICONS.find((x) => x === a.icon);
    if (a.icon !== undefined && a.icon !== null && !icon) throw new Invalid(`${where}: icon must be one of ${ICONS.join(", ")}`);
    return defined<PluginTableAction>({ label: str(a, "label", where, 100), key, icon, run: run(a.run, where) });
  });
  if (actions.length > MAX_ACTIONS) throw new Invalid(`${at}: actions has more than ${MAX_ACTIONS}`);
  return defined<PluginTable>({
    columns,
    rows: tableRows(v, "rows", at),
    sort: by === undefined ? null : { by, desc: v.desc === true },
    empty: optStr(v, "empty", at),
    open: optRun({ run: v.open }, `${at} open`).run,
    actions,
  });
}

/** The text, facts and table a view or a Host-details section holds. */
function content(spec: Obj, what: string): PluginContent {
  return defined<PluginContent>({
    text: optStr(spec, "text", what, MAX_VIEW_TEXT),
    facts: facts(spec, what),
    table: spec.table === undefined || spec.table === null ? undefined : table(spec.table, what),
  });
}

/** The op, checked; or why it can't be used. */
export function parseOp(raw: unknown): PluginOp | { invalid: string } {
  try {
    return parse(raw);
  } catch (e) {
    if (e instanceof Invalid || e instanceof GraphInvalid) return { invalid: e.message };
    throw e;
  }
}

function parse(raw: unknown): PluginOp {
  if (!isObj(raw) || typeof raw.op !== "string") throw new Invalid("not an op");
  const spec = isObj(raw.spec) ? raw.spec : {};
  const id = typeof raw.id === "string" ? raw.id : "";
  switch (raw.op) {
    case "command":
      return { op: "command", name: str(raw, "name", "roster.commands.add", 64), desc: str(raw, "desc", "roster.commands.add"), run: run(raw.run, "roster.commands.add") };
    case "key": {
      const action = raw.action === false ? false : str(raw, "action", "roster.keymap.set");
      return { op: "key", context: str(raw, "context", "roster.keymap.set", 40), keys: str(raw, "keys", "roster.keymap.set", 60), action };
    }
    case "theme":
      if (!isObj(raw.theme)) throw new Invalid("roster.themes.define: the Theme must be a table");
      return { op: "theme", id, theme: raw.theme as unknown as ThemeDef };
    case "section": {
      const what = `roster.sidebar.set ${id}`;
      return defined<Extract<PluginOp, { op: "section" }>>({
        op: "section",
        id,
        title: optStr(spec, "title", what) ?? id,
        order: num(spec, "order", what) ?? 400,
        empty: optStr(spec, "empty", what),
        rows: list(spec, "rows", what).map((r, i) => row(r, i, what)),
      });
    }
    case "status": {
      const what = `roster.status.set ${id}`;
      return defined<Extract<PluginOp, { op: "status" }>>({
        op: "status",
        id,
        text: str(spec, "text", what, 80),
        title: optStr(spec, "title", what),
        run: optRun(spec, what).run,
      });
    }
    case "finder": {
      const what = `roster.finders.set ${id}`;
      return {
        op: "finder",
        id,
        title: optStr(spec, "title", what) ?? id,
        items: list(spec, "items", what).map((v, i): PluginFinderItem => {
          const at = `${what} item ${i + 1}`;
          if (!isObj(v)) throw new Invalid(`${at}: must be a table`);
          return defined<PluginFinderItem>({
            id: optStr(v, "id", at, 100) ?? String(i + 1),
            label: str(v, "label", at),
            detail: optStr(v, "detail", at),
            path: optStr(v, "path", at),
            run: run(v.run, at),
          });
        }),
      };
    }
    case "help": {
      const what = `roster.help.set ${id}`;
      const title = optStr(spec, "title", what) ?? id;
      return { op: "help", id, title, summary: optStr(spec, "summary", what) ?? title, markdown: str(spec, "markdown", what, MAX_HELP) };
    }
    case "health": {
      const what = `roster.health.set ${id}`;
      return {
        op: "health",
        id,
        title: optStr(spec, "title", what) ?? id,
        checks: list(spec, "checks", what).map((c, i): PluginHealthCheck => {
          const at = `${what} check ${i + 1}`;
          if (!isObj(c)) throw new Invalid(`${at}: must be a table`);
          const level = HEALTH_LEVELS.find((l) => l === c.level);
          if (!level) throw new Invalid(`${at}: level must be "ok", "warn" or "error"`);
          return defined<PluginHealthCheck>({ level, message: str(c, "message", at), fix: optStr(c, "fix", at) });
        }),
      };
    }
    case "tutor": {
      const what = `roster.tutor.set ${id}`;
      const title = optStr(spec, "title", what) ?? id;
      const ids = new Set<string>();
      const lessons = list(spec, "lessons", what).map((l, i): PluginTutorLesson => {
        const at = `${what} lesson ${i + 1}`;
        if (!isObj(l)) throw new Invalid(`${at}: must be a table`);
        return {
          title: str(l, "title", at, 100),
          text: optStr(l, "text", at, MAX_HELP) ?? "",
          steps: list(l, "steps", at).map((st, j): PluginTutorStep => {
            const where = `${at} step ${j + 1}`;
            if (!isObj(st)) throw new Invalid(`${where}: must be a table`);
            const stepId = str(st, "id", where, 100);
            if (ids.has(stepId)) throw new Invalid(`${where}: id ${stepId} is used twice`);
            ids.add(stepId);
            const raw = Array.isArray(st.on) ? st.on : [st.on];
            if (raw.length === 0) throw new Invalid(`${where}: on must name an event`);
            const on = raw.map((m): StepMatch => {
              if (!isObj(m)) throw new Invalid(`${where}: on must be a table, { event = "…" }, or a list of them`);
              const event = str(m, "event", where, 40);
              if (!(TUTOR_EVENTS as readonly string[]).includes(event)) throw new Invalid(`${where}: event must be one of ${TUTOR_EVENTS.join(", ")}`);
              const fields = Object.fromEntries(Object.keys(m).filter((k) => k !== "event").map((k) => [k.slice(0, 40), str(m, k, where, 200)]));
              return { ...fields, event };
            });
            return { id: stepId, text: str(st, "text", where), on };
          }),
        };
      });
      if (lessons.length === 0) throw new Invalid(`${what}: lessons must have at least one lesson`);
      return {
        op: "tutor",
        id,
        title,
        summary: optStr(spec, "summary", what) ?? title,
        intro: optStr(spec, "intro", what, MAX_HELP) ?? "",
        lessons,
        outro: optStr(spec, "outro", what, MAX_HELP) ?? "",
      };
    }
    case "badge":
      return { op: "badge", host: str(raw, "host", "roster.badges.set", 200), text: raw.text === null ? null : str(raw, "text", "roster.badges.set", 40) };
    case "float": {
      if (raw.spec === null) return { op: "float", spec: null };
      const what = "roster.float.open";
      const lines = list(spec, "lines", what).map((l) => (typeof l === "string" ? l.slice(0, MAX_TEXT) : String(l)));
      return { op: "float", spec: { title: optStr(spec, "title", what) ?? "", lines } };
    }
    case "view": {
      const what = `roster.views.set ${id}`;
      const place = spec.place === undefined || spec.place === null ? "panel" : spec.place;
      if (place !== "panel" && place !== "full") throw new Invalid(`${what}: place must be "panel" or "full"`);
      const graph = spec.graph === undefined || spec.graph === null ? undefined : parseGraph(spec.graph, what);
      if (graph && spec.table !== undefined && spec.table !== null) throw new Invalid(`${what}: a view has a table or a graph, not both`);
      return { op: "view", id, view: { title: optStr(spec, "title", what) ?? id, place, ...content(spec, what), ...(graph ? { graph } : {}) } };
    }
    case "view_update": {
      const what = `roster.views.update ${id}`;
      const c = isObj(raw.changes) ? raw.changes : {};
      return {
        op: "view_update",
        id,
        update: defined<PluginViewUpdate>({
          title: optStr(c, "title", what),
          text: optStr(c, "text", what, MAX_VIEW_TEXT),
          facts: c.facts === undefined || c.facts === null ? undefined : facts(c, what),
          rows: tableRows(c, "rows", what),
          remove: list(c, "remove", what).map((r, i) => {
            if (typeof r !== "string") throw new Invalid(`${what}: remove ${i + 1} must be a row's id`);
            return r;
          }),
          graph: parseGraphUpdate(c, what),
        }),
      };
    }
    case "view_open":
    case "view_close":
      return { op: raw.op, id };
    case "details": {
      const host = str(raw, "host", "roster.details.set", 200);
      if (raw.spec === null || raw.spec === undefined) return { op: "details", id, host, section: null };
      const what = `roster.details.set ${id} ${host}`;
      return { op: "details", id, host, section: { title: optStr(spec, "title", what) ?? id, order: num(spec, "order", what) ?? 500, ...content(spec, what) } };
    }
    case "notify": {
      const level = LEVELS.find((l) => l === raw.level) ?? "info";
      return { op: "notify", text: str(raw, "text", "roster.notify"), level };
    }
    case "open":
      return { op: "open", host: str(raw, "host", "roster.sessions.open", 200) };
    case "send": {
      const session = num(raw, "session", "roster.terminal.send");
      if (session === undefined) throw new Invalid("roster.terminal.send: which Session?");
      return { op: "send", session, text: str(raw, "text", "roster.terminal.send", 64 * 1024) };
    }
    case "copy":
      return { op: "copy", text: str(raw, "text", "roster.clipboard.copy", MAX_COPY) };
    case "remove": {
      const kind = REMOVABLE.find((k) => k === raw.kind);
      if (!kind) throw new Invalid("remove: of what?");
      return { op: "remove", kind, id };
    }
    default:
      throw new Invalid(`there's no op ${raw.op}`);
  }
}
