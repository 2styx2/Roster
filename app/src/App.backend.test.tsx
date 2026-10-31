// Changing which roster runs (ticket 19): `backend` (or `roster_command`) in init.lua is read when
// serve starts, so a reload that changes it starts serve again, both ways (WSL to Windows and
// back); a reload that keeps it leaves serve alone. Fake Backend, stub terminal; the memory
// Platform's `fileSaved` acts as the core's watcher, and `:source` applies the save.
import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { FAKE_PASSWORD, fakeBackend, makeHosts } from "./backend/fake";
import type { Backend } from "./backend/types";
import { configWith } from "./config/fixture";
import type { Config, ConfigReport } from "./config/types";
import { memoryPlatform, type MemoryPlatform } from "./platform/memory";
import { builtinRegistries } from "./registries";
import { StubTerminal } from "./terminal/StubTerminal";

const hosts = makeHosts(3);
const LEADER = "{Control>} {/Control}";

let reloads = 0;
const report = (config: Config): ConfigReport => ({
  config,
  error: null,
  path: "C:\\Users\\you\\AppData\\Roaming\\roster\\init.lua",
  version: ++reloads,
});

/** The fake Backend, counting the starts the app asks for (`restart: true` is a new serve). */
function counted() {
  const backend = fakeBackend({ hosts });
  const starts: boolean[] = [];
  const connect: Backend["connect"] = (options) => {
    starts.push(options?.restart ?? false);
    return backend.connect(options);
  };
  return { backend: { ...backend, connect } as Backend, starts };
}

async function ready(config: Config) {
  const user = userEvent.setup();
  const r = report(config);
  const platform = memoryPlatform({ config: r });
  const { backend, starts } = counted();
  render(<App backend={backend} terminalView={StubTerminal} registries={builtinRegistries()} platform={platform} config={r} />);
  await user.type(await screen.findByLabelText(/master password/i), `${FAKE_PASSWORD}{Enter}`);
  await screen.findByRole("main", { name: /workspace/i });
  const source = async (next: Config) => {
    await act(() => (platform as MemoryPlatform).fileSaved(report(next)));
    await user.keyboard(`${LEADER}:`);
    await user.keyboard("source{Enter}");
  };
  return { user, starts, source };
}

describe("backend in init.lua", () => {
  it("a :source that changes it starts serve again, both ways", async () => {
    const { user, starts, source } = await ready(configWith({ backend: "wsl:Ubuntu" }));
    expect(starts).toEqual([false]);

    await source(configWith({ backend: "local" }));
    // The new serve has never been unlocked: the lock screen asks again.
    await user.type(await screen.findByLabelText(/master password/i), `${FAKE_PASSWORD}{Enter}`);
    await screen.findByRole("main", { name: /workspace/i });
    expect(starts).toEqual([false, true]);

    await source(configWith({ backend: "wsl:Ubuntu" }));
    await screen.findByLabelText(/master password/i);
    expect(starts).toEqual([false, true, true]);
  });

  it("a :source that keeps it leaves serve running", async () => {
    const { starts, source } = await ready(configWith({ backend: "local" }));
    await source(configWith({ backend: "local", theme: "nord" }));
    await screen.findByText("Reloaded init.lua");
    expect(starts).toEqual([false]);
  });

  it("so does a changed roster_command", async () => {
    const { starts, source } = await ready(configWith({ rosterCommand: null }));
    await source(configWith({ rosterCommand: ["uv", "run", "roster"] }));
    await screen.findByLabelText(/master password/i);
    expect(starts).toEqual([false, true]);
  });
});
