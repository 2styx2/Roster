import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createBackend } from "./backend";
import { fixtureProps } from "./backend/fixtureProps";
import { createPlatform } from "./platform";
import { defaultAppearance } from "./theme/theme";
// The fonts ship in the bundle (the CSP allows no network fonts): Inter for the UI, Iosevka for
// the terminal and the wordmark (decision Q30).
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/iosevka/400.css";
import "@fontsource/iosevka/700.css";
import "./styles.css";

/** The terminal measures its cells when it opens, so its font must be loaded by then. Local
 * files load in a few milliseconds; the timeout only guards against a font that never comes. */
function fontsLoaded(): Promise<unknown> {
  const fonts = ['400 14px "Iosevka"', '700 14px "Iosevka"', '400 13px "Inter"', '500 13px "Inter"'];
  const loaded = Promise.all(fonts.map((f) => document.fonts.load(f))).catch(() => {});
  return Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, 1500))]);
}

// Until the Config (ticket 21) picks a Theme: `?theme=nord` in a plain browser, for trying them.
const appearance = { ...defaultAppearance, theme: new URLSearchParams(location.search).get("theme") ?? defaultAppearance.theme };

// The "Demo data / Worst case" toggle (ticket 27): dev builds only. `import.meta.env.DEV` is
// false in a production build, so the import below and its chunk are dropped from it.
const FixtureToggle = import.meta.env.DEV ? lazy(() => import("./dev/FixtureToggle")) : null;

const root = createRoot(document.getElementById("root") as HTMLElement);
void Promise.all([createBackend(), createPlatform(), fontsLoaded()]).then(([{ backend, app }, platform]) =>
  root.render(
    <StrictMode>
      <App backend={backend} appearance={appearance} {...fixtureProps(app, platform)} />
      {FixtureToggle && (
        <Suspense>
          <FixtureToggle />
        </Suspense>
      )}
    </StrictMode>,
  ),
);
