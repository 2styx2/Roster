// A call the app stopped waiting for (decision Q43's adds and Q13's Publish) never leaves the user
// guessing: the app asks roster what actually happened and says that.
import { describe, expect, it } from "vitest";
import { addHostChecked, publishChecked } from "./afterTimeout";
import { BackendCallError, type Backend, type Host, type PendingChanges, type PublishResult } from "./types";

const timeout = () => new BackendCallError("The backend didn't answer in time.", null, null, true, true);

const host = (name: string): Host =>
  ({ name, group: "lab", ip: "10.0.0.5", ssh: { user: "root", port: 22, auth: "bw:nas ssh" }, reviewed: true }) as unknown as Host;

const pending = (count: number, pushed: boolean): PendingChanges => ({
  path: "/infra/roster.yml",
  repo: "/infra",
  diff: count ? "diff" : "",
  hosts: [],
  count,
  last_commit: { commit: "abc1234def", subject: "roster: change esx (title)", upstream: "origin/main", pushed },
});

function backend(over: Partial<Backend>): Backend {
  return over as Backend;
}

describe("host.add that timed out", () => {
  const params = { name: "nas", group: "lab", address: "10.0.0.5", user: "root", password: "pw", item: "nas ssh" };

  it("passes a normal answer through", async () => {
    const r = { added: true as const, host: host("nas"), backup: "b", verify: null, item: null, warnings: [] };
    const b = backend({ addHost: async () => r });
    expect(await addHostChecked(b, params)).toBe(r);
  });

  it("reports the add when the Host turns out to be there", async () => {
    const b = backend({ addHost: async () => Promise.reject(timeout()), getHost: async (n) => host(n) });
    const r = await addHostChecked(b, params);
    expect(r.host.name).toBe("nas");
    expect(r.item).toEqual({ provider: "bw", id: "", name: "nas ssh" });
    expect(r.warnings?.[0]).toMatch(/roster answered late.*checked afterwards/);
  });

  it("says nothing was added when the Host isn't there", async () => {
    const b = backend({
      addHost: async () => Promise.reject(timeout()),
      getHost: async (n) => Promise.reject(new BackendCallError(`unknown host '${n}'`, 2)),
    });
    await expect(addHostChecked(b, params)).rejects.toThrow(/checked afterwards: nas isn't in the Inventory, so it wasn't added/);
  });

  it("says it couldn't tell when the check fails too", async () => {
    const b = backend({ addHost: async () => Promise.reject(timeout()), getHost: async () => Promise.reject(timeout()) });
    await expect(addHostChecked(b, params)).rejects.toThrow(/couldn't check whether nas was added/);
  });

  it("leaves other failures alone", async () => {
    const refused = new BackendCallError("host 'nas' is already in the Inventory", 81);
    const b = backend({ addHost: async () => Promise.reject(refused) });
    await expect(addHostChecked(b, params)).rejects.toBe(refused);
  });
});

describe("changes.publish that timed out", () => {
  it("reports the Publish when nothing is pending and the last commit is on the upstream", async () => {
    const b = backend({ publishChanges: async () => Promise.reject(timeout()), pendingChanges: async () => pending(0, true) });
    const r: PublishResult = await publishChecked(b, "msg");
    expect(r.commit).toBe("abc1234def");
    expect(r.upstream).toBe("origin/main");
    expect(r.sync.ok).toBe(false);
    expect(r.sync.fix).toMatch(/roster sync/);
  });

  it("says nothing was published when the Pending changes are still there", async () => {
    const b = backend({ publishChanges: async () => Promise.reject(timeout()), pendingChanges: async () => pending(2, true) });
    const e = await publishChecked(b, "msg").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(BackendCallError);
    expect((e as BackendCallError).code).toBe(96);
    expect((e as BackendCallError).message).toMatch(/checked afterwards: the Pending changes are still here, so nothing was published/);
  });

  it("says it couldn't tell when the check fails too", async () => {
    const b = backend({ publishChanges: async () => Promise.reject(timeout()), pendingChanges: async () => Promise.reject(timeout()) });
    await expect(publishChecked(b, "msg")).rejects.toThrow(/couldn't check whether it was published/);
  });
});
