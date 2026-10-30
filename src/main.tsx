import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createBackend } from "./backend";
import { createPlatform } from "./platform";
import type { ConfigReport } from "./config/types";
import { defaultAppearance } from "./theme/theme";
// The fonts ship in the bundle (the CSP allows no network fonts): Inter for the UI, Iosevka for
// the terminal and the wordmark (decision Q30). The terminal is medium (500) by default, with
// 700 for bold; 400 stays for init.lua's `terminal.weight = 400`.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/iosevka/400.css";
import "@fontsource/iosevka/500.css";
import "@fontsource/iosevka/700.css";
import "./styles.css";

/** The terminal measures its cells when it opens, so its font must be loaded by then (the
 * Config's, if it names one). Local files load in a few milliseconds; the timeout only guards
 * against a font that never comes. */
function fontsLoaded(report: ConfigReport | null): Promise<unknown> {
  const t = report?.config.terminal;
  const family = t ? `"${t.font.split(",")[0]?.replace(/"/g, "").trim()}"` : '"Iosevka"';
  const fonts = [
    `${t?.weight ?? 500} 14px ${family}`,
    `${t?.boldWeight ?? 700} 14px ${family}`,
    '400 13px "Inter"',
    '500 13px "Inter"',
  ];
  const loaded = Promise.all(fonts.map((f) => document.fonts.load(f))).catch(() => {});
  return Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, 1500))]);
}

// In a plain browser (no Config): `?theme=nord` picks a Theme, for trying them.
const appearance = { ...defaultAppearance, theme: new URLSearchParams(location.search).get("theme") ?? defaultAppearance.theme };

const root = createRoot(document.getElementById("root") as HTMLElement);
void Promise.all([createBackend(), createPlatform()]).then(async ([backend, platform]) => {
  // The Config (init.lua, ticket 21) before the first paint, so its Theme and keys are there
  // from the start.
  const config = (await platform.config?.load().catch(() => null)) ?? null;
  await fontsLoaded(config);
  root.render(
    <StrictMode>
      <App backend={backend} platform={platform} appearance={appearance} config={config} />
    </StrictMode>,
  );
});
