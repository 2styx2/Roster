import { afterEach, describe, expect, it, vi } from "vitest";
import { HOLD_MS, IDLE_MS, ShellHooks, WINDOW_MS, hookLine, promptShell, shellHooksOn } from "./shellHooks";

describe("promptShell: which shell an idle prompt is, from what it printed", () => {
  it.each([
    ["Last login: today\r\nuser@web-01:~$ ", "posix"],
    ["root@web-01:~# ", "posix"],
    ["web-01% ", "posix"],
    ["bash-5.2$ ", "posix"],
    ["\x1b[01;32muser@web-01\x1b[00m:\x1b[01;34m~\x1b[00m$ ", "posix"],
    ["\x1b]0;user@web-01: ~\x07user@web-01:~$ ", "posix"],
    ["user@web-01 ~> ", "fish"],
    ["root@web-01 /etc# ", "fish"],
    ["PS C:\\Users\\admin> ", "pwsh"],
    ["PS /home/admin> ", "pwsh"],
  ])("%j is %s", (out, shell) => {
    expect(promptShell(out)).toBe(shell);
  });

  it.each([
    ["[root@esx-02:~] ", "ESXi's busybox"],
    ["switch01#", "a network CLI with no space"],
    ["switch01>", "a network CLI"],
    ["user@router> ", "a router CLI"],
    ["[admin@appliance] > ", "an appliance CLI"],
    ["Select an option [1-4]: ", "a menu"],
    ["user@web-01's password: ", "a password prompt"],
    ["", "nothing yet"],
    ["user@web-01:~$ ls", "a prompt with something typed"],
    ["Press any key to continue", "a banner"],
  ])("%j (%s) is nothing it knows", (out) => {
    expect(promptShell(out)).toBeNull();
  });
});

describe("ShellHooks: when roster sends the hook line, and what the screen shows", () => {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const PROMPT = "Last login: today\r\nuser@web-01:~$ ";
  const A = "\x1b]133;A\x07";
  const B = "\x1b]133;B\x07";

  function setup({ enabled = true, session = true } = {}) {
    vi.useFakeTimers();
    const sent: string[] = [];
    const shown: string[] = [];
    const folders: string[] = [];
    let on = enabled;
    let open = session;
    const hooks = new ShellHooks({
      write: (line) => (open ? (sent.push(line), true) : false),
      show: (data) => shown.push(dec.decode(data)),
      cwd: (path) => folders.push(path),
      enabled: () => on,
    });
    const print = (s: string) => {
      const data = enc.encode(s);
      const now = hooks.output(data, s);
      if (now) shown.push(dec.decode(now));
    };
    return {
      hooks, sent, shown, folders, print,
      screen: () => shown.join(""),
      enable: (v: boolean) => (on = v),
      openSession: () => (open = true),
    };
  }

  afterEach(() => vi.useRealTimers());

  it("sends the line for the shell once the login is quiet at a prompt", () => {
    const { sent, print, screen } = setup();
    print(PROMPT);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(IDLE_MS);
    expect(sent).toEqual([hookLine("posix") + "\r"]);
    expect(screen()).toBe(PROMPT);
  });

  it("sends nothing when it's off, or the user has typed, or the shell marks its prompts already", () => {
    const off = setup({ enabled: false });
    off.print(PROMPT);
    vi.advanceTimersByTime(IDLE_MS);
    expect(off.sent).toEqual([]);
    vi.useRealTimers();

    const typed = setup();
    typed.print("Last login: today\r\n");
    typed.hooks.typed("l");
    typed.print("user@web-01:~$ ");
    vi.advanceTimersByTime(IDLE_MS);
    expect(typed.sent).toEqual([]);
    vi.useRealTimers();

    const marked = setup();
    marked.print(`${A}user@web-01:~$ ${B}`);
    vi.advanceTimersByTime(IDLE_MS);
    expect(marked.sent).toEqual([]);
  });

  it("doesn't count the terminal's own answers (a cursor report, focus) as typing", () => {
    const { hooks, sent, print } = setup();
    hooks.typed("\x1b[24;1R");
    hooks.typed("\x1b[I");
    print(PROMPT);
    vi.advanceTimersByTime(IDLE_MS);
    expect(sent).toHaveLength(1);
  });

  it("waits through a login that isn't at a prompt it knows, and gives up after a while", () => {
    const { sent, print } = setup();
    print("Select an option [1-4]: ");
    vi.advanceTimersByTime(IDLE_MS * 3);
    expect(sent).toEqual([]);
    print("\r\nuser@web-01:~$ ");
    vi.advanceTimersByTime(IDLE_MS);
    expect(sent).toHaveLength(1);

    const late = setup();
    vi.advanceTimersByTime(WINDOW_MS);
    late.print(PROMPT);
    vi.advanceTimersByTime(IDLE_MS);
    expect(late.sent).toEqual([]);
  });

  it("waits for the Session to open before it writes", () => {
    const s = setup({ session: false });
    s.print(PROMPT);
    vi.advanceTimersByTime(IDLE_MS);
    expect(s.sent).toEqual([]);
    s.openSession();
    vi.advanceTimersByTime(IDLE_MS);
    expect(s.sent).toHaveLength(1);
  });

  it("keeps the echo off the screen and draws the new prompt where the old one was", () => {
    const { sent, print, screen } = setup();
    print(PROMPT);
    vi.advanceTimersByTime(IDLE_MS);
    const line = sent[0]!.slice(0, -1);
    // readline echoes the line (wrapped with a space and CR at the edge), then the new prompt.
    print(line.slice(0, 50) + " \r" + line.slice(50) + "\r\n");
    print("\x1b]133;D;0\x07\x1b]7;file://web-01/home/user\x07" + A + "user@web-01:~$ " + B);
    expect(screen()).toBe(PROMPT + "\r\x1b[J" + A + "user@web-01:~$ " + B);
  });

  it("keeps the terminal modes the shell set while the echo was held (bracketed paste)", () => {
    const { sent, print, screen } = setup();
    print(PROMPT);
    vi.advanceTimersByTime(IDLE_MS);
    print(sent[0]!.slice(0, -1) + "\r\n\x1b[?2004l\r\x1b]133;D;0\x07\x1b[?2004h" + A + "$ " + B);
    expect(screen()).toBe(PROMPT + "\x1b[?2004l\x1b[?2004h\r\x1b[J" + A + "$ " + B);
  });

  it("moves up over a prompt of several lines before drawing it again", () => {
    const { sent, print, screen } = setup();
    print("[web-01 ~]\r\n$ ");
    vi.advanceTimersByTime(IDLE_MS);
    print(sent[0]!.slice(0, -1) + "\r\n" + A + "[web-01 ~]\r\n$ " + B);
    expect(screen()).toBe("[web-01 ~]\r\n$ " + "\r\x1b[1A\x1b[J" + A + "[web-01 ~]\r\n$ " + B);
  });

  it("shows everything as it came when the shell said something else, never marked, or the user typed", () => {
    const error = setup();
    error.print(PROMPT);
    vi.advanceTimersByTime(IDLE_MS);
    const echo = error.sent[0]!.slice(0, -1) + "\r\n";
    error.print(echo + "fish: Unknown command\r\n" + A + "$ " + B);
    expect(error.screen()).toBe(PROMPT + echo + "fish: Unknown command\r\n" + A + "$ " + B);
    vi.useRealTimers();

    const silent = setup();
    silent.print(PROMPT);
    vi.advanceTimersByTime(IDLE_MS);
    silent.print(echo + "user@web-01:~$ ");
    expect(silent.screen()).toBe(PROMPT);
    vi.advanceTimersByTime(HOLD_MS);
    expect(silent.screen()).toBe(PROMPT + echo + "user@web-01:~$ ");
    vi.useRealTimers();

    const typing = setup();
    typing.print(PROMPT);
    vi.advanceTimersByTime(IDLE_MS);
    typing.print(echo);
    typing.hooks.typed("l");
    expect(typing.screen()).toBe(PROMPT + echo);
    typing.print("l");
    expect(typing.screen()).toBe(PROMPT + echo + "l");
  });

  it("says the folder a shell reports with OSC 7, split across reads or not", () => {
    const { print, folders } = setup({ enabled: false });
    print("\x1b]7;file://web-01/home/user/my%20src\x07$ ");
    print("\x1b]7;file://web-01/e");
    print("tc\x1b\\$ ");
    print("\x1b]7;file://web-01/bad%zz\x07");
    expect(folders).toEqual(["/home/user/my src", "/etc", "/bad%zz"]);
  });

  it("sends the line when asked (:integrate), or says why not", () => {
    const now = setup({ enabled: false });
    now.print(PROMPT);
    vi.advanceTimersByTime(IDLE_MS);
    expect(now.hooks.integrate()).toBe("sent");
    expect(now.sent).toEqual([hookLine("posix") + "\r"]);
    expect(now.hooks.integrate()).toBe("sent-already");
    vi.useRealTimers();

    const busy = setup({ enabled: false });
    busy.print("user@web-01:~$ ls");
    expect(busy.hooks.integrate()).toBe("no-prompt");
    vi.useRealTimers();

    const marked = setup({ enabled: false });
    marked.print(`${A}$ ${B}`);
    expect(marked.hooks.integrate()).toBe("marked");
    vi.useRealTimers();

    const closed = setup({ enabled: false, session: false });
    closed.print(PROMPT);
    expect(closed.hooks.integrate()).toBe("not-open");
  });
});

describe("shellHooksOn: init.lua's terminal.shell_hooks and the Host's shell_hooks", () => {
  it.each([
    [null, undefined, false, "both unset: off"],
    [null, true, true, "the Host turns it on"],
    [null, false, false, "the Host keeps it off"],
    [true, undefined, true, "init.lua turns it on for every Session"],
    [true, false, false, "a Host's false wins over init.lua's true"],
    [false, true, false, "init.lua's false turns it off everywhere"],
  ] as [boolean | null, boolean | undefined, boolean, string][])("init.lua %s, Host %s: %s (%s)", (init, host, on) => {
    expect(shellHooksOn(init, host)).toBe(on);
  });
});
