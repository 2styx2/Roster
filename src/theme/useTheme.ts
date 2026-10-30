// Puts the resolved Theme on the document: its colour tokens and the fonts as CSS variables, plus
// `color-scheme` (native scrollbars and form controls follow it). With `theme = "auto"` it
// follows the OS light/dark setting live. Returns the Theme, for the terminal's colours.
import { useLayoutEffect, useSyncExternalStore } from "react";
import { resolveTheme, themeVariables, type AppearanceOptions, type Theme, type ThemeRegistry } from "./theme";
import { rosterDark } from "./themes";

const DARK = "(prefers-color-scheme: dark)";

function subscribeScheme(onChange: () => void): () => void {
  const mq = window.matchMedia?.(DARK);
  mq?.addEventListener?.("change", onChange);
  return () => mq?.removeEventListener?.("change", onChange);
}

/** The OS prefers dark (and so does a test without matchMedia). */
const prefersDark = () => window.matchMedia?.(DARK).matches ?? true;

/** Sets the Theme's tokens and the fonts on `root` (the document element). */
export function applyTheme(root: HTMLElement, theme: Theme, fonts: AppearanceOptions["fonts"]) {
  const vars = { ...themeVariables(theme), "--font-ui": fonts.ui, "--font-mono": fonts.mono };
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  root.style.colorScheme = theme.appearance;
  root.dataset.theme = theme.id;
  root.dataset.appearance = theme.appearance;
}

export function useTheme(registry: ThemeRegistry, appearance: AppearanceOptions): Theme {
  const themes = useSyncExternalStore(registry.subscribe, registry.list);
  const dark = useSyncExternalStore(subscribeScheme, prefersDark);
  // `themes` changes when a Theme is registered, so a re-registered id is picked up.
  void themes;
  const theme = resolveTheme(registry, appearance, dark, rosterDark);
  const { ui, mono } = appearance.fonts;
  useLayoutEffect(() => applyTheme(document.documentElement, theme, { ui, mono }), [theme, ui, mono]);
  return theme;
}
