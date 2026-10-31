// The box's own name, for "Save to vault"'s Host name (ticket 15): read from what its shell printed
// after the login. Most Linux shells name the box in the window title (OSC 0 or 2, "root@nas-01:
// ~") or in the prompt ("[root@nas-01 ~]#"). It's the Host's text, so it only pre-fills a field the
// user can change, and only when it's a name roster would take.

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// eslint-disable-next-line no-control-regex
const TITLE = /\x1b\][02];([^\x07\x1b]*)(?:\x07|\x1b\\)/g;

function escaped(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The latest `user@HOST` the output shows for `user` (window title first, then a prompt), or null. */
export function hostnameIn(output: string, user: string): string | null {
  const at = new RegExp(`(?:^|[\\s\\[(])${escaped(user)}@([^\\s:\\]@#$>]+)`, "g");
  const pick = (text: string): string | null => {
    let found: string | null = null;
    for (const m of text.matchAll(at)) found = m[1] ?? null;
    return found !== null && NAME.test(found) ? found : null;
  };
  let fromTitle: string | null = null;
  for (const m of output.matchAll(TITLE)) fromTitle = pick(m[1] ?? "") ?? fromTitle;
  if (fromTitle) return fromTitle;
  // eslint-disable-next-line no-control-regex
  return pick(output.replace(TITLE, " ").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ""));
}

/** The Host name to start with: the box's own, else a DNS name's first label; an IP gives nothing. */
export function suggestedName(hostname: string | null, address: string): string {
  if (hostname) return hostname;
  if (/^[\d.]+$/.test(address) || address.includes(":")) return "";
  const label = address.split(".")[0] ?? "";
  return NAME.test(label) ? label : "";
}
