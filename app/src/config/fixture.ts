// For tests: the Config's defaults exactly as the core sends them, read from the core's own
// fixture (crates/desk-core/tests/fixtures/config-defaults.json, checked by a Rust test), so the
// Rust and TypeScript defaults can't drift apart.
import defaults from "../../crates/desk-core/tests/fixtures/config-defaults.json";
import type { Config } from "./types";

export const configFixture = defaults as unknown as {
  config: Config;
  themeColors: string[];
  themeTerminal: string[];
  ansi: string[];
};

export const defaultConfig: Config = configFixture.config;

/** The defaults with `patch` over them, as the core would send it. */
export function configWith(patch: Partial<Config>): Config {
  return { ...structuredClone(defaultConfig), ...patch };
}
