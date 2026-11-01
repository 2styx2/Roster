// Every command roster itself registers is, to the core, either one a Plugin may run (api.rs's
// COMMANDS) or one that's never a Plugin's own (api.rs's ROSTER_ONLY), so the core's check doesn't
// drift from the app's command table (issue #184). The built-ins register from many places (the
// table, the registries, App's effects), so the test lists them from the mounted App.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { FAKE_PASSWORD, fakeBackend, makeHosts } from "./backend/fake";
import { defaultOptions } from "./keymap";
import { manualClock } from "./lock/manualClock";
import { PLUGIN_COMMANDS, ROSTER_ONLY } from "./plugins/cmd";
import { memoryPlatform } from "./platform/memory";
import { builtinRegistries } from "./registries";
import { BUILTIN } from "./registry";
import { StubTerminal } from "./terminal/StubTerminal";

describe("roster's own commands, to the core", () => {
  it("are each one a Plugin may run or one never a Plugin's own", async () => {
    const user = userEvent.setup();
    const registries = builtinRegistries();
    render(
      <App
        backend={fakeBackend({ hosts: makeHosts(3) })}
        terminalView={StubTerminal}
        options={defaultOptions}
        registries={registries}
        platform={memoryPlatform()}
        clock={manualClock()}
      />,
    );
    await user.type(await screen.findByLabelText(/master password/i), `${FAKE_PASSWORD}{Enter}`);
    await screen.findByRole("main", { name: /workspace/i });
    const builtins = registries.commands
      .list()
      .filter((c) => c.source === BUILTIN)
      .map((c) => c.id);
    const known = new Set([...PLUGIN_COMMANDS.map((c) => c.name), ...ROSTER_ONLY]);
    expect(builtins.filter((id) => !known.has(id))).toEqual([]);
  });
});
