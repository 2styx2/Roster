// Syntax highlighting for help pages, the docs website and its PDF (ticket 71, decision Q90): a
// small tokenizer per language, read here as the coloured runs it gives back.
import { describe, expect, it } from "vitest";
import { highlight, shellCommand, type Token } from "./highlight";

/** The runs as `kind:text`, plain text as itself, whitespace-only plain runs left out. */
const runs = (tokens: Token[]) => tokens.filter((t) => t.kind || t.text.trim()).map((t) => (t.kind ? `${t.kind}:${t.text}` : t.text.trim()));

describe("highlight", () => {
  it("gives back the text unchanged, whatever the language", () => {
    const src = 'local x = { a = 1, "two" } -- note\nroster sync --dry-run | less\nkey: "v" # c\n{"a": [1, true]}\n[t]\nk = 0x1F';
    for (const lang of ["lua", "sh", "yaml", "json", "toml", "text", undefined, "rust"]) {
      expect(highlight(src, lang).map((t) => t.text).join(""), String(lang)).toBe(src);
    }
  });

  it("reads Lua: keywords, strings, numbers, comments, calls and table keys", () => {
    expect(runs(highlight('return {\n  theme = "nord", -- the Theme\n  size = 13,\n}\nlocal ok = roster.keys.set("a", function() end)', "lua"))).toEqual([
      "keyword:return",
      "punctuation:{",
      "key:theme",
      "punctuation:=",
      'string:"nord"',
      "punctuation:,",
      "comment:-- the Theme",
      "key:size",
      "punctuation:=",
      "number:13",
      "punctuation:,",
      "punctuation:}",
      "keyword:local",
      "ok",
      "punctuation:=",
      "roster",
      "punctuation:.",
      "keys",
      "punctuation:.",
      "function:set",
      "punctuation:(",
      'string:"a"',
      "punctuation:,",
      "keyword:function",
      "punctuation:()",
      "keyword:end",
      "punctuation:)",
    ]);
  });

  it("reads Lua's long strings and block comments", () => {
    expect(runs(highlight("--[[ a\nb ]] x = [==[ s ]] ]==]", "lua"))).toEqual(["comment:--[[ a\nb ]]", "key:x", "punctuation:=", "string:[==[ s ]] ]==]"]);
  });

  it("reads shell: the command, options, strings, variables, comments and operators", () => {
    expect(runs(highlight("$ roster mesh --dry-run   # the plan\nFOO=1 git log -n 3 | grep 'x' && echo \"$HOME\"", "bash"))).toEqual([
      "punctuation:$",
      "command:roster",
      "mesh",
      "keyword:--dry-run",
      "comment:# the plan",
      "key:FOO",
      "punctuation:=",
      "1",
      "command:git",
      "log",
      "keyword:-n",
      "number:3",
      "punctuation:|",
      "command:grep",
      "string:'x'",
      "punctuation:&&",
      "command:echo",
      'string:"$HOME"',
    ]);
  });

  it("doesn't take a line continued with a backslash for a new command", () => {
    expect(runs(highlight("roster setup \\\n  esx-02", "sh"))).toEqual(["command:roster", "setup \\\n  esx-02"]);
  });

  it("reads YAML: keys, list dashes, scalars, literals and comments", () => {
    expect(runs(highlight("hosts:\n  - name: esx-02 # lab\n    port: 22\n    key: true\n    title: 'A b'", "yaml"))).toEqual([
      "key:hosts",
      "punctuation::",
      "punctuation:-",
      "key:name",
      "punctuation::",
      "string:esx-02",
      "comment:# lab",
      "key:port",
      "punctuation::",
      "number:22",
      "key:key",
      "punctuation::",
      "keyword:true",
      "key:title",
      "punctuation::",
      "string:'A b'",
    ]);
  });

  it("reads a YAML flow mapping on one line", () => {
    expect(runs(highlight("esx-02: { ip: 10.0.0.12, ok: true }", "yaml"))).toEqual([
      "key:esx-02",
      "punctuation::",
      "punctuation:{",
      "key:ip",
      "punctuation::",
      "string:10.0.0.12",
      "punctuation:,",
      "key:ok",
      "punctuation::",
      "keyword:true",
      "punctuation:}",
    ]);
  });

  it("reads JSON: keys apart from string values", () => {
    expect(runs(highlight('{"id": 1, "ok": [true, null, "x"]}', "json"))).toEqual([
      "punctuation:{",
      'key:"id"',
      "punctuation::",
      "number:1",
      "punctuation:,",
      'key:"ok"',
      "punctuation::",
      "punctuation:[",
      "keyword:true",
      "punctuation:,",
      "keyword:null",
      "punctuation:,",
      'string:"x"',
      "punctuation:]}",
    ]);
  });

  it("reads TOML: tables, keys, values and comments", () => {
    expect(runs(highlight('[workspace]\nresolver = "3" # c\nmembers = ["a", 2]', "toml"))).toEqual([
      "keyword:[workspace]",
      "key:resolver",
      "punctuation:=",
      'string:"3"',
      "comment:# c",
      "key:members",
      "punctuation:=",
      "punctuation:[",
      'string:"a"',
      "punctuation:,",
      "number:2",
      "punctuation:]",
    ]);
  });

  it("leaves text, an unknown language and an untagged block plain", () => {
    for (const lang of ["text", "rust", undefined]) expect(highlight("fn main() { 1 }", lang)).toEqual([{ kind: null, text: "fn main() { 1 }" }]);
  });

  it("never runs away on a string or comment that isn't closed", () => {
    expect(runs(highlight('x = "open', "lua"))).toEqual(["key:x", "punctuation:=", 'string:"open']);
    expect(runs(highlight("echo 'open", "sh"))).toEqual(["command:echo", "string:'open"]);
    expect(runs(highlight("--[[ open", "lua"))).toEqual(["comment:--[[ open"]);
  });
});

describe("shellCommand: inline code that's a command line", () => {
  it("is a known command and something after it", () => {
    expect(shellCommand("roster sync")).toBe(true);
    expect(shellCommand("ssh esx-02")).toBe(true);
    expect(shellCommand("git log --oneline")).toBe(true);
  });
  it("isn't a lone word, a path or a :command", () => {
    expect(shellCommand("roster")).toBe(false);
    expect(shellCommand("roster.yml")).toBe(false);
    expect(shellCommand(":connect esx-02")).toBe(false);
    expect(shellCommand("theme = 'nord'")).toBe(false);
  });
});
