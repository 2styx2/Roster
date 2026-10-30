import { describe, expect, it } from "vitest";
import { memoryPlatform } from "../platform/memory";
import { StateStore } from "../state/store";
import { FoldersFile, foldersYml, HEADER, parseFoldersYml } from "./file";
import { STATE_KEY } from "./folders";

const TEXT = `# my folders
Lab ESXi:
  - esxi-02   # the new one
  - esxi-01
# nights
Night shift: []
`;

describe("folders.yml", () => {
  it("reads Folder names with their Hosts, in order", () => {
    expect(parseFoldersYml(TEXT)).toEqual({
      folders: [
        { name: "Lab ESXi", hosts: ["esxi-02", "esxi-01"] },
        { name: "Night shift", hosts: [] },
      ],
    });
    expect(parseFoldersYml("")).toEqual({ folders: [] });
    expect(parseFoldersYml("Empty:\n")).toEqual({ folders: [{ name: "Empty", hosts: [] }] });
  });

  it("says the line of what's wrong", () => {
    expect(parseFoldersYml("Lab:\n  - a\nNight: x: y\n")).toMatchObject({ error: { line: 3 } });
    expect(parseFoldersYml("Lab:\n  - a\nlab: []\n")).toEqual({ error: { line: 3, message: "there are two Folders named lab" } });
    expect(parseFoldersYml("Lab:\n  x: 1\n")).toMatchObject({ error: { line: 2 } });
    expect(parseFoldersYml("- a\n")).toMatchObject({ error: { line: 1 } });
  });

  it("round-trips: what it writes reads back as the same Folders", () => {
    const folders = [
      { name: "Lab ESXi", hosts: ["esxi-02"] },
      { name: "a: b # c", hosts: ["x"] },
      { name: "None", hosts: [] },
    ];
    const text = foldersYml(null, folders);
    expect(text.startsWith(`#${HEADER.split("\n")[0]}`)).toBe(true);
    expect(parseFoldersYml(text)).toEqual({ folders });
  });

  it("keeps comments and what it didn't change when it writes", () => {
    const added = foldersYml(TEXT, [
      { name: "Lab ESXi", hosts: ["esxi-02", "esxi-01", "esxi-03"] },
      { name: "Night shift", hosts: [] },
    ]);
    expect(added).toBe(`# my folders
Lab ESXi:
  - esxi-02 # the new one
  - esxi-01
  - esxi-03
# nights
Night shift: []
`);
    const renamed = foldersYml(TEXT, [
      { name: "Lab ESXi", hosts: ["esxi-02", "esxi-01"] },
      { name: "Nights", hosts: [] },
    ]);
    expect(renamed).toContain("# nights\nNights: []\n");
  });

  it("moves the State's Folders into a new folders.yml once, then leaves the State", async () => {
    const platform = memoryPlatform({ state: { [STATE_KEY]: [{ name: "Daily", hosts: ["orion3"] }] }, folders: null });
    const store = new StateStore(platform);
    const file = new FoldersFile(platform.folders!, store);
    await file.load();
    expect(parseFoldersYml(platform.foldersFile() ?? "")).toEqual({ folders: [{ name: "Daily", hosts: ["orion3"] }] });
    expect(store.get(STATE_KEY)).toBeUndefined();
    expect(file.get(STATE_KEY)).toEqual([{ name: "Daily", hosts: ["orion3"] }]);
  });

  it("an outside edit applies on reload; a broken one keeps the last good Folders and says the line", async () => {
    const platform = memoryPlatform({ folders: TEXT });
    const file = new FoldersFile(platform.folders!, new StateStore(platform));
    await file.load();
    file.set(STATE_KEY, [{ name: "Lab ESXi", hosts: ["esxi-02"] }]);
    expect(await file.isOutsideEdit()).toBe(false);
    platform.editFolders("Lab ESXi:\n  - esxi-09\n");
    expect(await file.isOutsideEdit()).toBe(true);
    expect(await file.reload()).toBeNull();
    expect(file.get(STATE_KEY)).toEqual([{ name: "Lab ESXi", hosts: ["esxi-09"] }]);
    platform.editFolders("Lab ESXi:\n  - esxi-01\nNight: x: y\n");
    expect(await file.reload()).toMatch(/^folders\.yml:3 has an error .*: the last good Folders are still in use$/);
    expect(file.get(STATE_KEY)).toEqual([{ name: "Lab ESXi", hosts: ["esxi-09"] }]);
  });
});
