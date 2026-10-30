// What the app needs from the machine it runs on, apart from roster (that's the Backend): the
// State file, the clipboard, the Windows build and fullscreen (Focus mode). Tests and the plain
// browser use their own implementations (memory.ts, browser.ts); the app uses tauri.ts.

export interface Clipboard {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}

export interface Platform {
  /** The State file's contents (`{}` the first time). Untrusted: read it with `parseState`. */
  loadState(): Promise<unknown>;
  /** Replaces the State file's contents. */
  saveState(state: object): Promise<void>;
  /** The Windows build (26200 for 10.0.26200), for xterm's ConPTY handling; null off Windows. */
  windowsBuild(): Promise<number | null>;
  clipboard: Clipboard;
  /** OS fullscreen on or off (Focus mode, ticket 22). */
  setFullscreen(on: boolean): Promise<void>;
}
