// The demo Inventory `:tutor` runs on (ticket 55, decision Q76): the fake Backend the UI tests use,
// with a few made-up Hosts whose Sessions are pretend shells in the app, so nothing tried here
// reaches a network, a vault or roster.yml. Its State lives in memory and is thrown away on
// leaving; the real Platform lends only what can't touch the real State or a Host: the window,
// the clipboard, fonts, and init.lua (read, and opened in the editor by `:config`).
import type { Backend, Host, HostList } from "../backend/types";
import type { Platform } from "../platform/types";
import { HINTS_KEY } from "../ui/hints";
import { THEME_KEY, THEME_OVER_KEY } from "../theme/picker";

/** The demo's Hosts: names a tutorial can point at (`demo-01`), made-up addresses, every Login a
 * key, so no Session ever asks for a vault. */
export function demoHosts(): HostList {
  const kinds: [string, string][] = [
    ["linux", "A Linux box to practise on"],
    ["linux", "Another one, for a second Session"],
    ["proxmox", "A hypervisor"],
    ["switch", "A switch in the lab rack"],
    ["nas", "The lab's file server"],
    ["printer", "The office printer"],
  ];
  const hosts = kinds.map(([type, title], i): Host => {
    const n = String(i + 1).padStart(2, "0");
    return {
      name: `demo-${n}`,
      group: i < 4 ? "demo-lab" : "demo-office",
      ip: `10.0.0.${11 + i}`,
      type,
      product: "",
      title,
      description: "",
      reviewed: true,
      enroll: true,
      ssh: { user: "admin", port: 22, auth: "key" },
      services: {},
      login: { user: null, auth: null },
      web: null,
    };
  });
  return {
    hosts,
    groups: {
      "demo-lab": { title: "The demo lab (made up)", description: "" },
      "demo-office": { title: "The demo office (made up)", description: "" },
    },
  };
}

/** The fake Backend over the demo's Hosts, loaded when a tutorial starts. */
export async function demoBackend(): Promise<Backend> {
  const { fakeBackend } = await import("../backend/fake");
  return fakeBackend({ hosts: demoHosts(), vault: { status: "unsupported" } });
}

/** The State keys the demo starts from, so it looks like your app: the Theme and the hints. */
const LOOKS = [THEME_KEY, THEME_OVER_KEY, HINTS_KEY];

/** A Platform for the demo: a State in memory (seeded with how the app looks, never saved), and
 * from `real` only the window, the clipboard, fonts and init.lua. No folders.yml (the demo's
 * Folders Plugin keeps Folders in the demo's fake Backend), no browser (its Hosts' addresses are made up), no fullscreen
 * (Focus in the demo leaves the window as it is), and `:config import-terminal` can't write. */
export function demoPlatform(real: Platform, looks: (key: string) => unknown): Platform {
  const seed = Object.fromEntries(LOOKS.flatMap((k) => (looks(k) === undefined ? [] : [[k, looks(k)]])));
  const config = real.config;
  return {
    loadState: async () => structuredClone(seed),
    saveState: async () => {},
    windowsBuild: () => real.windowsBuild(),
    clipboard: real.clipboard,
    ...(real.window ? { window: real.window } : {}),
    setFullscreen: async () => {},
    ...(real.fontInstalled ? { fontInstalled: real.fontInstalled } : {}),
    ...(config
      ? {
          config: {
            ...config,
            async importApply() {
              throw new Error("not on the demo Inventory: :tutor quit first");
            },
          },
        }
      : {}),
  };
}
