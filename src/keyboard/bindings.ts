// The Key bindings panel's rows, generated from the resolved keymap, the command table and the
// options: grouped by area, one row per command line and source, with the keys as the user types
// them (␣ is the Leader).
import { describeLine, type Commands } from "../commands/table";
import { defaultOptions, type Keymap, type KeymapContext, type Options } from "../keymap";
import { BUILTIN, CONFIG, type Source } from "../registry";

export interface BindingRow {
  area: string;
  label: string;
  keys: string[];
  source: Source;
}

const NAMES: Record<string, string> = { ArrowDown: "↓", ArrowUp: "↑", Escape: "Esc" };

const PICKER_LABELS: Record<string, string> = {
  "picker.down": "Move down",
  "picker.up": "Move up",
  "picker.choose": "Open the Host",
  "picker.close": "Close the Picker",
};

const AREAS = ["Leader", "Hosts", "Sessions", "Sidebar", "App"];

function display(context: KeymapContext, seq: string): string {
  const keys = seq
    .split(" ")
    .map((k) => NAMES[k] ?? k)
    .join(" ");
  // App-mode keys are typed after the Leader, except Esc, which leaves App mode.
  return context === "leader" && seq !== "Escape" ? `␣ ${keys}` : keys;
}

export function bindingRows(keymap: Keymap, options: Options, commands: Commands): BindingRow[] {
  const contexts: KeymapContext[] = options.vim
    ? ["leader", "list", "listVim", "picker", "pickerVim"]
    : ["leader", "list", "picker"];
  const rows = new Map<string, BindingRow & { rank: number }>();
  const ids = commands.list().map((c) => c.id);
  for (const context of contexts) {
    for (const [seq, { action, source }] of Object.entries(keymap[context])) {
      const inPicker = context === "picker" || context === "pickerVim";
      const { area, label } = inPicker
        ? { area: "Picker", label: PICKER_LABELS[action] ?? action }
        : describeLine(commands, action);
      const key = `${area}\0${label}\0${source}`;
      const rank = inPicker ? 1000 + Object.keys(PICKER_LABELS).indexOf(action) : ids.indexOf(action.split(" ")[0] ?? "");
      const row = rows.get(key) ?? { area, label, keys: [], source, rank };
      row.keys.push(display(context, seq));
      rows.set(key, row);
    }
  }
  const areaRank = (a: string) => (a === "Picker" ? 99 : AREAS.includes(a) ? AREAS.indexOf(a) : 50);
  const sorted = [...rows.values()].sort(
    (a, b) =>
      areaRank(a.area) - areaRank(b.area) ||
      a.rank - b.rank ||
      a.label.localeCompare(b.label, undefined, { numeric: true }) ||
      (a.source === BUILTIN ? -1 : b.source === BUILTIN ? 1 : a.source.localeCompare(b.source)),
  );
  const leader: BindingRow = {
    area: "Leader",
    label: "Leader: take the keys back from the terminal",
    keys: [options.leader],
    source: options.leader === defaultOptions.leader ? BUILTIN : CONFIG,
  };
  return [leader, ...sorted.map(({ area, label, keys, source }) => ({ area, label, keys, source }))];
}

export function filterRows(rows: readonly BindingRow[], query: string): BindingRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter((r) => [r.area, r.label, r.source, ...r.keys].some((t) => t.toLowerCase().includes(q)));
}
