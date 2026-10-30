import { describe, expect, it } from "vitest";
import { defaultConfig } from "./fixture";
import { vaultSettingsOf } from "./vault";

describe("init.lua's vault settings, as roster's vault.configure takes them", () => {
  it("send nothing by default, so roster.yml's apply", () => {
    expect(vaultSettingsOf(defaultConfig.vault)).toEqual({});
    expect(vaultSettingsOf(null)).toEqual({});
  });

  it("send KeePassXC's database and key file in roster's names", () => {
    const kp = { database: "~/roster.kdbx", keyFile: "/home/you/roster.keyx" };
    expect(vaultSettingsOf({ ...defaultConfig.vault, kp })).toEqual({
      kp: { database: "~/roster.kdbx", key_file: "/home/you/roster.keyx" },
    });
    expect(vaultSettingsOf({ ...defaultConfig.vault, kp: { database: "~/roster.kdbx", keyFile: null } })).toEqual({
      kp: { database: "~/roster.kdbx" },
    });
  });

  it("send where Save to vault goes by default (ticket 35)", () => {
    const saveTo = { organization: "My Team", collection: "Infra logins" };
    expect(vaultSettingsOf({ ...defaultConfig.vault, saveTo })).toEqual({ save_to: saveTo });
    expect(vaultSettingsOf({ ...defaultConfig.vault, saveTo: "personal" })).toEqual({ save_to: "personal" });
  });
});
