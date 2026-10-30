import { describe, expect, it } from "vitest";
import { commonPrefix, prefixFill } from "./completion";

describe("commonPrefix", () => {
  it("is what every word starts with, compared without case, spelled as the first has it", () => {
    expect(commonPrefix(["esxi-2-001", "esxi-2-009"])).toBe("esxi-2-00");
    expect(commonPrefix(["Lab ESXi", "lab esx old"])).toBe("Lab ESX");
    expect(commonPrefix(["connect ", "config"])).toBe("con");
    expect(commonPrefix(["one"])).toBe("one");
    expect(commonPrefix([])).toBe("");
  });
});

describe("prefixFill", () => {
  it("fills in what the candidates starting with the typed text share, when that's more", () => {
    expect(prefixFill("es", ["esxi-2-001", "esxi-2-009", "nessus"])).toBe("esxi-2-00");
    expect(prefixFill("ES", ["esxi-2-001"])).toBe("esxi-2-001");
    // A candidate that only contains it (a fuzzy or substring match) doesn't hold the fill back.
    expect(prefixFill("hub", ["lab-hub2", "hub-x"])).toBe("hub-x");
  });

  it("is null when there's nothing more to fill: Tab moves on instead", () => {
    expect(prefixFill("esxi-2-00", ["esxi-2-001", "esxi-2-009"])).toBeNull();
    expect(prefixFill("x", ["lab-hub2"])).toBeNull();
    expect(prefixFill("", [])).toBeNull();
  });
});
