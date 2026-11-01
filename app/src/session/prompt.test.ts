import { describe, expect, it } from "vitest";
import { PromptWatch } from "./prompt";

function fed(...chunks: string[]): PromptWatch {
  const w = new PromptWatch();
  for (const c of chunks) w.feed(c);
  return w;
}

const A = "\x1b]133;A\x07";
const B = "\x1b]133;B\x07";
const C = "\x1b]133;C\x07";
const D = (code: number) => `\x1b]133;D;${code}\x07`;

describe("PromptWatch: a password prompt at the cursor", () => {
  it.each(["[sudo] password for ops: ", "Password: ", "ops@10.0.0.5's password: ", "Password for ops: "])("sees %j", (prompt) => {
    expect(fed(`ops@esx:~$ sudo -v\r\n${prompt}`).prompt()).toBe(prompt.trim());
  });

  it("follows the line it's on: once the prompt is answered it's gone", () => {
    const w = fed("[sudo] password for ops: ");
    expect(w.prompt()).not.toBeNull();
    w.feed("\r\n");
    expect(w.prompt()).toBeNull();
    w.feed("Sorry, try again.\r\n[sudo] password for ops: ");
    expect(w.prompt()).toBe("[sudo] password for ops:");
  });

  it.each([
    "Enter passphrase for key '/home/ops/.ssh/id_ed25519': ",
    "Username: ",
    "ops@esx:~$ ",
    "password: shown",
    "New password: ",
    "Verification code: ",
  ])("doesn't take %j for one", (line) => {
    expect(fed(line).prompt()).toBeNull();
  });

  it("reads through colours, a split escape and a carriage return", () => {
    expect(fed("\x1b[1m[sudo]\x1b", "[0m password for ops: ").prompt()).toBe("[sudo] password for ops:");
    expect(fed("progress 50%\rPassword: ").prompt()).toBe("Password:");
    expect(fed("Passwd\b\bword: ").prompt()).toBe("Password:");
  });

  it("keeps only the line at the cursor, however long the output was", () => {
    const w = fed("x".repeat(100_000), "\r\nPassword: ");
    expect(w.prompt()).toBe("Password:");
  });
});

describe("PromptWatch: OSC 133 marks are advice, never enough", () => {
  it("doesn't offer at the shell's own prompt, even one that says password:", () => {
    expect(fed(`${A}password: ${B}`).prompt()).toBeNull();
  });

  it("offers inside a running command", () => {
    expect(fed(`${A}$ ${B}sudo -v\r\n${C}[sudo] password for ops: `).prompt()).toBe("[sudo] password for ops:");
  });

  it("says the prompt may be another Host's while an ssh runs, until it ends", () => {
    const w = fed(`${A}$ ${B}ssh other\r\n${C}ops@other:~$ sudo -v\r\n[sudo] password for ops: `);
    expect(w.elsewhere()).toMatch(/ssh other/);
    w.feed(`\r\nlogout\r\n${D(0)}${A}$ `);
    expect(w.elsewhere()).toBeNull();
  });

  it.each(["mosh other", "telnet 10.0.0.9", "sudo ssh root@other", "autossh -M 0 other"])("counts %j as leaving the Host", (cmd) => {
    expect(fed(`${A}$ ${B}${cmd}\r\n${C}`).elsewhere()).not.toBeNull();
  });

  it("stays unsure for good once a shell with marks starts inside a command", () => {
    const w = fed(`${A}$ ${B}bash\r\n${C}${A}$ ${B}ls\r\n${C}${D(0)}`);
    expect(w.elsewhere()).toMatch(/shell started inside/);
    w.feed(`${A}$ `);
    expect(w.elsewhere()).not.toBeNull();
  });

  it("without marks it can't tell, and says nothing", () => {
    expect(fed("$ ssh other\r\nops@other:~$ sudo -v\r\n[sudo] password for ops: ").elsewhere()).toBeNull();
  });
});
