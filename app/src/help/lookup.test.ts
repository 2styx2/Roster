// Help from where you are (ticket 52): which topic the lookup keys open for what's typed or
// selected. The UI tests drive the keys; this pins the choices.
import { describe, expect, it } from "vitest";
import { builtinRegistries } from "../registries";
import { lineTopic, optionTopic, itemTopic } from "./lookup";

const commands = builtinRegistries().commands;

describe("lineTopic: the command being typed", () => {
  it("a whole or partial command name opens its entry", () => {
    expect(lineTopic(commands, "connect esx-02")).toBe(":connect");
    expect(lineTopic(commands, "conn")).toBe(":connect");
    expect(lineTopic(commands, "  host add lab")).toBe(":host");
  });
  it("nothing typed opens the commands page; something that's no command, nothing", () => {
    expect(lineTopic(commands, "")).toBe("commands");
    expect(lineTopic(commands, "zzqxj")).toBeNull();
  });
});

describe("itemTopic: a finder's selected result", () => {
  it("a source's own topic wins; a help result is its topic; else the command it runs", () => {
    expect(itemTopic(commands, { help: (i) => `themes#${i.id}` }, { id: "nord", label: "Nord", command: "theme nord" })).toBe("themes#nord");
    expect(itemTopic(commands, {}, { id: "x", label: "x", command: "help terminal.size" })).toBe("terminal.size");
    expect(itemTopic(commands, {}, { id: "x", label: "x", command: "help config#the-sandbox /require" })).toBe("config#the-sandbox /require");
    expect(itemTopic(commands, {}, { id: "x", label: "x", command: "session 2" })).toBe(":session");
  });
});

describe("optionTopic: an option in the Key bindings panel", () => {
  it("an option that's a topic opens it; a keys context opens 'keys' searched for the context", () => {
    expect(optionTopic("leader", new Set(["leader", "'keys'"]))).toBe("leader");
    expect(optionTopic("keys.cmdline", new Set(["leader", "'keys'"]))).toBe("'keys' /cmdline");
  });
});
