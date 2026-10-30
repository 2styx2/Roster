import { describe, expect, it } from "vitest";
import { hostnameIn, suggestedName } from "./hostname";

describe("hostnameIn", () => {
  it("reads the box's name from the window title its shell sets (OSC 0 and 2)", () => {
    expect(hostnameIn("\x1b]0;root@nas-01: ~\x07root@nas-01:~# ", "root")).toBe("nas-01");
    expect(hostnameIn("\x1b]2;admin@sw-core.lab:/etc\x1b\\", "admin")).toBe("sw-core.lab");
  });

  it("falls back to a prompt that shows user@host", () => {
    expect(hostnameIn("Last login: Thu\r\n[root@esx-07 ~]# ", "root")).toBe("esx-07");
    expect(hostnameIn("root@pve:~# ", "root")).toBe("pve");
  });

  it("takes the latest name it saw", () => {
    expect(hostnameIn("\x1b]0;root@old: ~\x07 ... \x1b]0;root@new: ~\x07", "root")).toBe("new");
  });

  it("ignores another user's name and anything a Host name can't be", () => {
    expect(hostnameIn("bob@laptop:~$ ", "root")).toBeNull();
    expect(hostnameIn("\x1b]0;root@-oProxy: ~\x07", "root")).toBeNull();
    expect(hostnameIn("Welcome\r\n$ ", "root")).toBeNull();
  });
});

describe("suggestedName", () => {
  it("prefers the box's own name, else a DNS name's first label, else nothing", () => {
    expect(suggestedName("nas-01", "10.0.0.5")).toBe("nas-01");
    expect(suggestedName(null, "sw-core.lab.example")).toBe("sw-core");
    expect(suggestedName(null, "10.0.0.5")).toBe("");
    expect(suggestedName(null, "fe80::1")).toBe("");
  });
});
