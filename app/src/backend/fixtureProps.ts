// What a fixture adds to the App beyond the fake Backend (ticket 27): its State (read fresh at
// each start and never saved over the real State file), the bindings a Plugin would register, and
// the Sessions to open. The dev page (main.tsx) and the UI tests both build the App this way.
import type { AppProps } from "../App";
import { registerBindings } from "../keymap";
import type { Platform } from "../platform/types";
import { builtinRegistries } from "../registries";
import type { FakeScenario } from "./fake";

export function fixtureProps(
  app: FakeScenario["app"],
  platform: Platform,
): Pick<AppProps, "platform" | "registries" | "openAtStart"> {
  const props: Pick<AppProps, "platform" | "registries" | "openAtStart"> = { platform };
  if (app?.state) {
    const state = app.state;
    props.platform = { ...platform, loadState: async () => structuredClone(state), saveState: async () => {} };
  }
  if (app?.bindings) {
    const registries = builtinRegistries();
    registerBindings(registries.keymap, app.bindings.tables, app.bindings.source);
    props.registries = registries;
  }
  if (app?.openAtStart) props.openAtStart = app.openAtStart;
  return props;
}
