// init.lua's `vault` table as roster's `vault.configure` takes it (tickets 35, 41): this Box's own
// vault settings, which win over roster.yml's. Paths and choices only, never a secret. A setting
// init.lua leaves out isn't sent, so roster.yml's applies again.
import type { VaultSettings } from "../backend/types";
import type { VaultConfig } from "./types";

export function vaultSettingsOf(vault: VaultConfig | null | undefined): VaultSettings {
  const settings: VaultSettings = {};
  const kp = {
    ...(vault?.kp.database ? { database: vault.kp.database } : {}),
    ...(vault?.kp.keyFile ? { key_file: vault.kp.keyFile } : {}),
  };
  if (vault?.saveTo) settings.save_to = vault.saveTo;
  if (Object.keys(kp).length) settings.kp = kp;
  return settings;
}
