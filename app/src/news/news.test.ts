// What's new (ticket 47): the status line says once, on the first start after an upgrade, that
// `:help news` has this version's notes. The State keeps the last version seen.
import { describe, expect, it } from "vitest";
import { emptyState, parseState } from "../state/appState";
import { newsNote } from "./news";

describe("newsNote", () => {
  it("says it once after an upgrade, and keeps the version seen", () => {
    const { note, seen } = newsNote({ ...emptyState, newsSeen: "0.1.0" }, "0.2.0");
    expect(note).toBe("roster 0.2.0: what's new: :help news");
    expect(seen).toBe("0.2.0");
    expect(newsNote({ ...emptyState, newsSeen: "0.2.0" }, "0.2.0").note).toBeNull();
  });

  it("an older app's State (no version seen, but used) counts as an upgrade; a first start doesn't", () => {
    expect(newsNote(parseState({ recentHosts: ["esx-02"] }), "0.2.0").note).not.toBeNull();
    const first = newsNote(parseState({}), "0.2.0");
    expect(first).toEqual({ note: null, seen: "0.2.0" });
  });

  it("an older build on a newer State says nothing and leaves the State's version", () => {
    expect(newsNote({ ...emptyState, newsSeen: "0.10.0" }, "0.9.1")).toEqual({ note: null, seen: "0.10.0" });
  });
});
