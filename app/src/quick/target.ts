// A Quick Connect address (GLOSSARY: Quick Connect, ticket 14): `user@address[:port]`, a box
// that isn't in the Inventory. Typed in the Picker or after `:connect` / `:quick`. The same rules
// as roster's quick.prepare, so nothing that ssh could read as an option gets that far.

export interface QuickTarget {
  user: string;
  address: string;
  port: number;
}

const USER = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const ADDRESS = /^[A-Za-z0-9_.:%][A-Za-z0-9_.:%-]*$/;

/** `user@address[:port]` (an IPv6 address with a port in brackets), or null when it isn't one. */
export function parseQuickTarget(text: string): QuickTarget | null {
  const t = text.trim();
  const at = t.indexOf("@");
  if (at < 0 || at !== t.lastIndexOf("@")) return null;
  const user = t.slice(0, at);
  let rest = t.slice(at + 1);
  let port = 22;
  let address: string;
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(rest);
  if (bracketed) {
    address = bracketed[1] ?? "";
    if (bracketed[2] !== undefined) port = Number(bracketed[2]);
  } else {
    const colons = rest.split(":").length - 1;
    if (colons === 1) {
      const [host, p] = rest.split(":") as [string, string];
      if (!/^\d+$/.test(p)) return null;
      port = Number(p);
      rest = host;
    }
    address = rest;
  }
  if (!USER.test(user) || !ADDRESS.test(address) || !(port >= 1 && port <= 65535)) return null;
  return { user, address, port };
}

/** How the app shows it: `user@address`, with `:port` when it isn't 22. */
export function formatQuickTarget({ user, address, port }: QuickTarget): string {
  if (port === 22) return `${user}@${address}`;
  return `${user}@${address.includes(":") ? `[${address}]` : address}:${port}`;
}
