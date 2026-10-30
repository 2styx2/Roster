import type { ConfigSource } from "../config/types";
import type { FontProbe } from "../terminal/fonts";

// What the app needs from the machine it runs on, apart from roster (that's the Backend): the
// State file, the clipboard, the Windows build, the window's controls (title bar) and fullscreen
// (Focus mode). Tests and the plain browser use their own implementations (memory.ts,
// browser.ts); the app uses tauri.ts.

export interface Clipboard {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}

/** Where the window is and how big (physical pixels), for the State: the Tauri shell puts it
 * back there at the next start (roster-core window.rs). */
export interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

/** The custom title bar's buttons (decision Q32), and the window's geometry for the State. */
export interface WindowControls {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  /** Calls `onChange` with the maximized state now and whenever it changes; returns stop. */
  watchMaximized(onChange: (maximized: boolean) => void): () => void;
  /** Calls `onSettle` after the window stops moving or resizing (not while it's minimized);
   * returns stop. */
  watchGeometry(onSettle: (geometry: WindowGeometry) => void): () => void;
}

/** folders.yml next to init.lua (decision Q46): its text, written whole, and when it changed. */
export interface FoldersSource {
  /** Its full path, and its text (null while there's no file). */
  read(): Promise<{ path: string; text: string | null }>;
  /** Replaces it with `text`, atomically. */
  write(text: string): Promise<void>;
  /** Calls `onSaved` after each save of it (the app's own writes too); returns stop. */
  watch(onSaved: () => void): () => void;
}

export interface Platform {
  /** The State file's contents (`{}` the first time). Untrusted: read it with `parseState`. */
  loadState(): Promise<unknown>;
  /** Replaces the State file's contents. */
  saveState(state: object): Promise<void>;
  /** The Windows build (26200 for 10.0.26200), for xterm's ConPTY handling; null off Windows. */
  windowsBuild(): Promise<number | null>;
  clipboard: Clipboard;
  /** The window's controls; absent where there's no window to control (tests). */
  window?: WindowControls;
  /** OS fullscreen on or off (Focus mode, ticket 22). */
  setFullscreen(on: boolean): Promise<void>;
  /** Whether a font family is installed (ticket 33), null if it can't tell; absent in tests. */
  fontInstalled?: FontProbe;
  /** The Config (init.lua, ticket 21) and its live changes; absent in a plain browser. */
  config?: ConfigSource;
  /** folders.yml (ticket 28); absent where there's no config folder: Folders then stay in the State. */
  folders?: FoldersSource;
}
