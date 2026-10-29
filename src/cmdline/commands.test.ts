import { describe, expect, it } from "vitest";
import { complete, parseCommand } from "./commands";

const hosts = ["esxi-02", "esxi-01", "net-sw-core-01", "orion3", "hub2", "lab-hub2"];

describe("complete", () => {
  it("offers every command for an empty line", () => {
    expect(complete("", hosts)).toEqual(expect.arrayContaining(["connect ", "close", "lock"]));
  });

  it("completes a command name, with a space when it takes a Host", () => {
    expect(complete("co", hosts)).toEqual(["connect "]);
    expect(complete("l", hosts)).toEqual(["lock"]);
    expect(complete("c", hosts)).toEqual(["close", "connect "]);
  });

  it("completes Host names after connect: prefix matches first, then the rest that contain it", () => {
    expect(complete("connect esx", hosts)).toEqual(["connect esxi-01", "connect esxi-02"]);
    expect(complete("connect hub", hosts)).toEqual(["connect hub2", "connect lab-hub2"]);
    expect(complete("connect ", hosts)).toHaveLength(hosts.length);
  });

  it("offers nothing for a command that takes no argument", () => {
    expect(complete("lock x", hosts)).toEqual([]);
  });
});

describe("parseCommand", () => {
  it("turns a command into its action", () => {
    expect(parseCommand(" lock ")).toEqual({ kind: "action", action: "app.lock" });
    expect(parseCommand("close")).toEqual({ kind: "action", action: "session.close" });
  });

  it("reads connect's Host", () => {
    expect(parseCommand("connect esxi-02")).toEqual({ kind: "connect", host: "esxi-02" });
  });

  it("says what's wrong with a bad line", () => {
    expect(parseCommand("conect x")).toEqual({ kind: "error", message: "Not a command: conect" });
    expect(parseCommand("connect")).toEqual({ kind: "error", message: "connect needs a Host name" });
    expect(parseCommand("lock now")).toEqual({ kind: "error", message: "lock takes no argument" });
    expect(parseCommand("  ")).toEqual({ kind: "empty" });
  });
});
