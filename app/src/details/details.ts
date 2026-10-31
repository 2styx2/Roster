// Host details (ticket 18, spec stories 79-80, decision Q71): what `roster info HOST` says about a
// Host, as rows for the panel, and which of its services open in the default browser. Pure: the
// panel (HostDetails.tsx) draws these, `:open` (commands/table.ts) resolves through resolveOpen.
// A Login is shown as roster shows it: the user and the vault reference (`bw:esx-02 ssh`, the
// Vault item's name). roster never sends a secret, and nothing here asks for one.
import type { Host, HostList } from "../backend/types";

/** One line of the panel: roster info's label and value. `data`: something you could paste into
 * a shell (an address, a reference), so it's set in Iosevka. */
export interface Fact {
  label: string;
  value: string;
  data?: true;
}

/** roster's `login_label`: who logs in and where the password comes from, the reference only. */
export function loginLabel(s: { user?: string | null; auth?: string | null }): string {
  if (!s.user && !s.auth) return "no login";
  return `${s.user || "(no user)"}, auth ${s.auth || "none"}`;
}

/** How Sessions reach the Host, in roster info's words. */
function access(h: Host): string {
  if (!h.reviewed) return "not set up yet (reviewed: false)";
  return h.enroll ? `key: ssh ${h.name}` : `password: roster run ${h.name} -- CMD`;
}

/** roster info's fields in its order (the name is the panel's heading), empty ones left out. */
export function hostFacts(h: Host, groups: HostList["groups"]): Fact[] {
  const title = groups[h.group]?.title;
  const login = h.login && (h.login.user || h.login.auth) ? `${loginLabel(h.login)} (default for services)` : "";
  const facts: [string, string | null | undefined, boolean][] = [
    ["title", h.title, false],
    ["description", h.description, false],
    ["type", h.type, true],
    ["product", h.product, false],
    ["group", h.group + (title ? ` (${title})` : ""), true],
    ["address", `${h.ssh.user}@${h.ip}:${h.ssh.port}`, true],
    ["access", access(h), true],
    ["mac", h.mac, true],
    ["ssh login", loginLabel(h.ssh), true],
    ["login", login, true],
    ["web UI", h.web && shownUrl(h.web), true],
  ];
  return facts.filter((f): f is [string, string, boolean] => !!f[1]).map(([label, value, data]) => (data ? { label, value, data } : { label, value }));
}

/** One service row: roster info's columns, and the URL it opens, if it's a web one. */
export interface ServiceRow {
  name: string;
  port: number;
  url: string | null;
  login: string;
  open: string | null;
}

export function serviceRows(h: Host): ServiceRow[] {
  return Object.entries(h.services ?? {}).map(([name, s]) => ({
    name,
    port: s.port,
    url: s.url && shownUrl(s.url),
    login: loginLabel(s) + (s.override ? " (own login)" : s.auth || s.user ? " (host default)" : ""),
    open: webUrl(s.url),
  }));
}

/** A URL as the panel shows it: a password written into it (`https://user:secret@…`) is never
 * drawn. */
export function shownUrl(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/[^/?#@:]*):[^/?#@]*@/i, "$1:•••@");
}

/** The URL if it's one to hand the default browser: http or https, a host, nothing odd in it,
 * and no user or password in it (never pass a secret in a URL). Else null. */
export function webUrl(url: string | null | undefined): string | null {
  // Whitespace or a control character: not a URL roster would write (config.py refuses them).
  if (!url || [...url].some((c) => /\s/.test(c) || c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname || u.username || u.password) return null;
  return url;
}

/** The names of the Host's services that open in a browser, in roster.yml order. */
export function webServices(h: Host): string[] {
  return serviceRows(h)
    .filter((r) => r.open !== null)
    .map((r) => r.name);
}

export type OpenTarget =
  | { kind: "host"; host: string }
  | { kind: "web"; host: string; service: string; url: string }
  | { kind: "error"; message: string };

/** What `:open ARG` means (decision Q71): a Host's name opens the Host (or goes to its Session), as
 * it always has; `HOST SERVICE` opens that Host's web service; a service's name alone opens it on
 * `current` (the Host details' Host, else the selected one). A Host's name wins over a service. */
export function resolveOpen(arg: string, hosts: ReadonlyMap<string, Host>, current: string | null): OpenTarget {
  const [first = "", second] = arg.trim().split(/\s+/);
  if (second === undefined && hosts.has(first)) return { kind: "host", host: first };
  const host = second === undefined ? current : first;
  const name = second ?? first;
  const h = host === null ? undefined : hosts.get(host);
  if (!h) return { kind: "error", message: `No Host named ${second === undefined ? first : host}` };
  const service = h.services?.[name];
  const url = webUrl(service?.url);
  if (service && url) return { kind: "web", host: h.name, service: name, url };
  if (service) return { kind: "error", message: `${h.name}'s ${name} isn't a web service: it has no http or https URL` };
  if (second !== undefined) return { kind: "error", message: `${h.name} has no service ${name}` };
  const web = webServices(h);
  return {
    kind: "error",
    message: `No Host named ${first}, and ${h.name} has ${web.length ? `no web service ${first} (${web.join(", ")})` : "no web services"}`,
  };
}
