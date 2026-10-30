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

/** The Picker's and the terminal's own actions (not commands). */
const LOCAL: Record<string, { area: string; label: string }> = {
  "picker.down": { area: "Picker", label: "Move down" },
  "picker.up": { area: "Picker", label: "Move up" },
  "picker.choose": { area: "Picker", label: "Open the Host" },
  "picker.chooseHere": { area: "Picker", label: "Open it in this tab, if its Session has ended" },
  "picker.close": { area: "Picker", label: "Close the Picker" },
  "terminal.copy": { area: "Terminal", label: "Copy" },
  "terminal.paste": { area: "Terminal", label: "Paste" },
  "terminal.search": { area: "Terminal", label: "Find" },
  "terminal.zoomIn": { area: "Terminal", label: "Zoom in" },
  "terminal.zoomOut": { area: "Terminal", label: "Zoom out" },
  "terminal.zoomReset": { area: "Terminal", label: "Reset zoom" },
};

const AREAS = ["Leader", "Hosts", "Sessions", "View", "Sidebar", "App", "Terminal"];

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
    ? ["leader", "global", "list", "listVim", "picker", "pickerVim", "terminal"]
    : ["leader", "global", "list", "picker", "terminal"];
  const rows = new Map<string, BindingRow & { rank: number }>();
  const ids = commands.list().map((c) => c.id);
  for (const context of contexts) {
    for (const [seq, { action, source }] of Object.entries(keymap[context])) {
      const local = context === "picker" || context === "pickerVim" || context === "terminal";
      const { area, label } = local ? (LOCAL[action] ?? { area: "Other", label: action }) : describeLine(commands, action);
      const key = `${area}\0${label}\0${source}`;
      const rank = local ? 1000 + Object.keys(LOCAL).indexOf(action) : ids.indexOf(action.split(" ")[0] ?? "");
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
