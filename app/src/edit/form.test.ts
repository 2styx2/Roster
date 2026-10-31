// The edit form's rebase (decision Q88): a background pull that changed the Host updates the
// fields you hadn't touched, keeps the ones you had, and names where both changed.
import { describe, expect, it } from "vitest";
import { makeHosts } from "../backend/fake";
import type { Host } from "../backend/types";
import { draftOf, rebaseDraft } from "./form";

const host = makeHosts(1).hosts[0] as Host;
const moved = (h: Host, ip: string, title?: string): Host => ({
  ...h,
  ip,
  ...(title !== undefined ? { title } : {}),
});

describe("rebaseDraft", () => {
  it("takes the pulled values for the fields you hadn't touched", () => {
    const r = rebaseDraft(host, moved(host, "10.0.0.9"), draftOf(host));
    expect(r.draft.ip).toBe("10.0.0.9");
    expect(r.theirs).toEqual(["ip"]);
    expect(r.both).toEqual([]);
  });

  it("keeps what you typed, and names a field that changed there too", () => {
    const draft = { ...draftOf(host), ip: "10.0.0.7", title: "Mine" };
    const r = rebaseDraft(host, moved(host, "10.0.0.9", "Theirs"), draft);
    expect(r.draft.ip).toBe("10.0.0.7");
    expect(r.draft.title).toBe("Mine");
    expect(r.both).toEqual(["title", "ip"]);
    expect(r.theirs).toEqual([]);
  });

  it("says nothing when the pull left the Host alone, or made the same change you did", () => {
    expect(rebaseDraft(host, host, draftOf(host))).toMatchObject({
      theirs: [],
      both: [],
    });
    const r = rebaseDraft(host, moved(host, "10.0.0.9"), {
      ...draftOf(host),
      ip: "10.0.0.9",
    });
    expect(r).toMatchObject({ theirs: [], both: [] });
  });
});
