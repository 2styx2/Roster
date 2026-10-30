// View modes (GLOSSARY: Standard and Focus, decision Q36) and their layouts as data (decision
// Q39): per mode, which pieces show around the terminal, where, and in what order. A piece is
// named by id ("titlebar", "sidebar", "sessionbar", "statusbar"); the app draws the ids it knows,
// and the Config (ticket 21) or a Plugin (ticket 23) can place others. A mode changes only how
// roster is shown: every command works in every mode (commands/table.ts).
import type { Options } from "../keymap";

export type ViewMode = "standard" | "focus";
export const VIEW_MODES: readonly ViewMode[] = ["standard", "focus"];

/** Where a piece goes around the terminal. */
export type Place = "top" | "bottom" | "left" | "right";

export interface Placement {
  id: string;
  at: Place;
  shown: boolean;
}

export interface ModeLayout {
  /** OS fullscreen (the window's own title bar goes too). */
  fullscreen: boolean;
  /** The pieces, in order within each place (top: top to bottom; left: outside in). */
  pieces: readonly Placement[];
  /** How the Sidebar's tree (Folders, Inventory) is reached: the Sidebar piece, or the tree
   * finder as an overlay. `␣ e` shows or hides that. */
  tree: "sidebar" | "finder";
  /** The bar `␣ s` shows or hides. */
  bar: string;
  /** A hint on entering, saying how to leave. */
  hint: boolean;
}

export type Layouts = Record<ViewMode, ModeLayout>;

/** The two modes as prototyped, following the options that already place pieces. */
export function defaultLayouts(options: Pick<Options, "sidebar" | "statusBar" | "focus">): Layouts {
  const sessionbar = options.focus.sessionbar;
  return {
    standard: {
      fullscreen: false,
      pieces: [
        { id: "titlebar", at: "top", shown: true },
        { id: "sidebar", at: options.sidebar.side, shown: options.sidebar.visible },
        { id: "statusbar", at: "bottom", shown: options.statusBar.visible },
      ],
      tree: "sidebar",
      bar: "statusbar",
      hint: false,
    },
    focus: {
      fullscreen: true,
      pieces: [{ id: "sessionbar", at: sessionbar || "bottom", shown: sessionbar !== false }],
      tree: "finder",
      bar: "sessionbar",
      hint: true,
    },
  };
}

/** The ids shown at `at`, in order. */
export function placed(layout: ModeLayout, at: Place): string[] {
  return layout.pieces.filter((p) => p.at === at && p.shown).map((p) => p.id);
}

export function isShown(layout: ModeLayout, id: string): boolean {
  return layout.pieces.some((p) => p.id === id && p.shown);
}

/** Shows or hides a piece; one the layout doesn't place yet is shown at the bottom. */
export function togglePiece(layout: ModeLayout, id: string): ModeLayout {
  const has = layout.pieces.some((p) => p.id === id);
  const pieces = has
    ? layout.pieces.map((p) => (p.id === id ? { ...p, shown: !p.shown } : p))
    : [...layout.pieces, { id, at: "bottom" as const, shown: true }];
  return { ...layout, pieces };
}

/** `mode` with no argument: the other one. */
export function otherMode(mode: ViewMode): ViewMode {
  return mode === "standard" ? "focus" : "standard";
}
