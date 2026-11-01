// What counts as the user's call, and the manager's own guards (the iteration 8 review): only what
// the user chose (a command, a row or button, a finder item, a toolbar control, a key, a
// question's answer) is the user's call. A finder's items, a `:check` section's lines, and a
// question's `cancel` run because another Plugin's question took its place are the app's doing.
import { describe, expect, it } from "vitest";
import { fakeBackend, makeHosts } from "../backend/fake";
import type { FakePlugin, FakeRoster } from "../backend/fakePlugins";
import { builtinRegistries } from "../registries";
import { PluginManager, STATE_KEY, type PluginUi } from "./manager";

/** What only the user's call may do, tried: "copy ok" or "copy refused". */
function tried(roster: FakeRoster): string {
  try {
    roster.clipboard.copy("10.0.0.5");
    return "copy ok";
  } catch {
    return "copy refused";
  }
}

function plugin(name: string, load: FakePlugin["load"]): FakePlugin {
  return { manifest: { name, version: "1.0.0", description: "", author: null, api: 3, permissions: [] }, load };
}

function setup(plugins: Record<string, FakePlugin>) {
  const backend = fakeBackend({ hosts: makeHosts(2), plugins });
  const registries = builtinRegistries();
  const state: Record<string, unknown> = {
    [STATE_KEY]: Object.values(plugins).map((p) => ({ path: p.manifest.name, name: p.manifest.name, granted: [], asked: [] })),
  };
  const store = { get: (k: string) => state[k], set: (k: string, v: unknown) => void (state[k] = v) };
  const ran: string[] = [];
  const ui: PluginUi = { run: (l) => void ran.push(l), send: () => undefined, copy: async () => undefined };
  const manager = new PluginManager(backend, registries, store, ui);
  return { manager, registries, ran };
}

const settle = () => new Promise((done) => setTimeout(done, 0));

describe("the user's call", () => {
  it("a finder's items and a :check section's lines are never it", async () => {
    const said: string[] = [];
    const lists = plugin("lists", (roster) => {
      roster.finders.set("picks", { title: "Picks", items: () => [{ id: "a", label: tried(roster), run: () => said.push(`item ${tried(roster)}`) }] });
      roster.health.set("lab", { title: "Lab", check: () => [{ level: "ok", message: tried(roster) }] });
    });
    const { manager, registries } = setup({ lists });
    await manager.start();
    registries.finders.get("picks")?.open?.();
    await settle();
    const items = registries.finders.get("picks")?.items({} as never) ?? [];
    expect(items.map((i) => i.label)).toEqual(["copy refused"]);
    const lines = await registries.health.get("lab")?.checks({} as never);
    expect(lines?.map((l) => l.message)).toEqual(["copy refused"]);
  });

  it("a question's cancel, run because another Plugin's question took its place, isn't it", async () => {
    const said: string[] = [];
    const asker = (name: string) =>
      plugin(name, (roster) => {
        roster.commands.add(`ask-${name}`, {
          run: () => roster.confirm({ title: `${name}?`, run: () => said.push(`${name} yes ${tried(roster)}`), cancel: () => said.push(`${name} no ${tried(roster)}`) }),
        });
      });
    const { manager, registries } = setup({ a: asker("a"), b: asker("b") });
    await manager.start();
    registries.commands.get("ask-a")?.run({} as never, "");
    await settle();
    registries.commands.get("ask-b")?.run({} as never, "");
    await settle();
    // b's question took a's place: a hears its cancel, but the user chose nothing of a's.
    expect(said).toEqual(["a no copy refused"]);
    manager.answerConfirm(false);
    await settle();
    expect(said).toEqual(["a no copy refused", "b no copy ok"]);
  });
});
