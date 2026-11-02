// The fill key's offer (ticket 119, decision Q129): only sudo's own prompt for the Session's login
// user, read off a terminal's screen; with OSC 133 marks, only while the command running is sudo
// itself and has printed nothing but sudo's own lines. Refuse whenever in doubt.
import { afterEach, describe, expect, it } from "vitest";
import { PromptWatch, sudoOnly } from "./prompt";

const watches: PromptWatch[] = [];
async function fed(...chunks: string[]): Promise<PromptWatch> {
  const w = new PromptWatch({ cols: 80, rows: 24 }, "ops");
  watches.push(w);
  for (const c of chunks) await w.write(c);
  return w;
}
afterEach(() => watches.splice(0).forEach((w) => w.dispose()));

const A = "\x1b]133;A\x07";
const B = "\x1b]133;B\x07";
const C = "\x1b]133;C\x07";
const D = (code: number) => `\x1b]133;D;${code}\x07`;
const SUDO = "[sudo] password for ops: ";
/** A marked shell runs `command`, which asks for sudo's password. */
const marked = (command: string, before = "") => [`${A}ops@esx:~$ ${B}`, command, `\r\n${C}${before}${SUDO}`];

describe("PromptWatch without marks", () => {
  it("offers sudo's prompt for the login user, and says it can't tell where the Session is", async () => {
    const w = await fed(`ops@esx:~$ sudo -v\r\n${SUDO}`);
    expect(w.prompt()).toEqual({ line: "[sudo] password for ops:", elsewhere: null, marked: false });
  });

  it.each([
    "[sudo] password for root: ",
    "Password: ",
    "Password for ops: ",
    "ops@esx's password: ",
    "Enter passphrase for key '/home/ops/.ssh/id_ed25519': ",
    "ops@esx:~$ ",
    `${SUDO}typed`,
  ])("offers nothing at %j", async (line) => {
    expect((await fed(line)).prompt()).toBeNull();
  });

  it("reads the screen: colours, a rewritten line, a split escape", async () => {
    expect((await fed("\x1b[1m[sudo]\x1b", "[0m password for ops: ")).prompt()?.line).toBe("[sudo] password for ops:");
    expect((await fed("progress 50%\r[sudo] password for ops: ")).prompt()?.line).toBe("[sudo] password for ops:");
  });

  it("follows the line it's on, and offers nothing once a fill is spent until a new prompt shows", async () => {
    const w = await fed(SUDO);
    w.spent();
    expect(w.prompt()).toBeNull();
    await w.write("\r\nSorry, try again.\r\n");
    expect(w.prompt()).toBeNull();
    await w.write(SUDO);
    expect(w.prompt()).not.toBeNull();
  });
});

describe("PromptWatch with marks: only while sudo itself runs", () => {
  it.each(["sudo -v", "sudo apt upgrade", "FOO=1 sudo -u ops make install", "/usr/bin/sudo -l", "sudo -i"])(
    "offers it while %j runs",
    async (command) => {
      const w = await fed(...marked(command));
      expect(w.prompt()).toEqual({ line: "[sudo] password for ops:", elsewhere: null, marked: true });
    },
  );

  it.each([
    ["ssh other", /ssh other/],
    ["sudo -u x ssh other", /sudo -u x ssh other/],
    ["env ssh other", /env ssh other/],
    ["FOO=1 ssh other", /FOO=1 ssh other/],
    ["docker exec -it web sh", /docker exec/],
    ["kubectl exec -it pod -- sh", /kubectl/],
    ["sudo docker exec -it web sudo -v", /docker/],
    ["sudo bash -c 'ssh other'", /ssh other/],
    ["ls | sudo tee /etc/x", /tee/],
    ["time sudo -v", /time sudo/],
    ["make deploy", /make deploy/],
  ])("refuses while %j runs", async (command, says) => {
    const w = await fed(...marked(command));
    expect(w.prompt()?.elsewhere).toMatch(says);
  });

  it("refuses once the command has printed more than sudo's own lines", async () => {
    const w = await fed(...marked("sudo -i", `${SUDO}\r\nroot@esx:~# ssh other\r\nops@other:~$ sudo -v\r\n`));
    expect(w.prompt()?.elsewhere).toMatch(/printed/);
  });

  it("reads a C before the line feed as the command line's, not output (pwsh)", async () => {
    const w = await fed(`${A}PS C:\\> ${B}`, `sudo -v${C}\r\n${SUDO}`);
    expect(w.prompt()).toEqual({ line: "[sudo] password for ops:", elsewhere: null, marked: true });
  });

  it("offers it again after a wrong password", async () => {
    const w = await fed(...marked("sudo -v", `${SUDO}\r\nSorry, try again.\r\n`));
    expect(w.prompt()?.elsewhere).toBeNull();
  });

  it("reads the command line off the screen, history recall and redraws included", async () => {
    // Up-arrow brought back `ssh other`: the shell redrew the line in place.
    const w = await fed(`${A}ops@esx:~$ ${B}`, "sudo -v\r\x1b[Kops@esx:~$ ssh other", `\r\n${C}${SUDO}`);
    expect(w.prompt()?.elsewhere).toMatch(/ssh other/);
  });

  it("offers nothing at the shell's own prompt", async () => {
    expect((await fed(`${A}${SUDO}${B}`)).prompt()).toBeNull();
    expect((await fed(`${A}ops@esx:~$ ${B}sudo -v`)).prompt()).toBeNull();
  });

  it("stays unsure for good once a shell with marks starts inside a command", async () => {
    const w = await fed(...marked("bash"), `\r\n${A}$ ${B}ls\r\n${C}${D(0)}${A}$ ${B}sudo -v\r\n${C}${SUDO}`);
    expect(w.prompt()?.elsewhere).toMatch(/shell started inside/);
  });

  it("refuses when the command line couldn't be read", async () => {
    const w = await fed(`${A}ops@esx:~$ `, `sudo -v\r\n${C}${SUDO}`);
    expect(w.prompt()?.elsewhere).toMatch(/couldn't read/);
  });
});

describe("sudoOnly", () => {
  it.each(["sudo -v", "sudo -u ops -- make", "A=1 B=2 sudo apt update", "sudo -i", "sudo"])("takes %j", (c) => {
    expect(sudoOnly(c)).toBe(true);
  });
  it.each(["ssh x", "sudo ssh x", "sudo -u x ssh x", "sudo env ssh x", "sudo -v && ssh x", "sudo $(cmd)", "sudo `cmd`", "doas -v", ""])(
    "refuses %j",
    (c) => {
      expect(sudoOnly(c)).toBe(false);
    },
  );
});
