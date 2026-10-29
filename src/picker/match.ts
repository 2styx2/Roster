// The Picker's fuzzy match over `hosts.list` (spec stories 11, 12, 19). Pure, so it's tested on
// its own and stays fast: one pass over the Hosts per keystroke, no allocation per character.
import type { Host, HostList } from "../backend/types";

export interface Ranked {
  host: Host;
  score: number;
}

/** How much a match in each field counts: what you're likeliest to remember counts most. */
const FIELDS: readonly [weight: number, get: (h: Host, l: HostList) => string | undefined][] = [
  [3, (h) => h.name],
  [2, (h) => h.ip],
  [1.5, (h) => h.type],
  [1.5, (h) => h.product],
  [1.5, (h) => h.group],
  [1, (h) => h.title],
  [1, (h, l) => l.groups[h.group]?.title],
];

const EXACT = 1000, PREFIX = 800, WORD = 600, INSIDE = 400, SCATTERED = 100;

function isWordChar(c: string | undefined): boolean {
  return c !== undefined && /[a-z0-9]/.test(c);
}

/** How well `term` (lower case) matches `value`: 0 for no match, higher is better. */
export function fieldScore(term: string, value: string): number {
  const v = value.toLowerCase();
  if (v === term) return EXACT;
  if (v.startsWith(term)) return PREFIX;
  let at = v.indexOf(term);
  if (at >= 0) {
    for (let i = at; i >= 0; i = v.indexOf(term, i + 1)) {
      if (!isWordChar(v[i - 1])) return WORD;
    }
    return INSIDE;
  }
  // letters in order, scattered: the tighter the better, but always below a real substring
  at = -1;
  let first = -1;
  for (const ch of term) {
    at = v.indexOf(ch, at + 1);
    if (at < 0) return 0;
    if (first < 0) first = at;
  }
  const gaps = at - first + 1 - term.length;
  return SCATTERED + Math.max(0, 200 - gaps * 20);
}

/**
 * The Hosts matching `query`, best first. Every whitespace-separated word must match some field;
 * a word's score is its best field's, and the words' scores add up. Ties go to the Host used most
 * recently (`recent`, most recent first), then to Inventory order. An empty query lists all Hosts.
 */
export function searchHosts(list: HostList, query: string, recent: readonly string[]): Ranked[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const recency = new Map(recent.map((name, i) => [name, i]));
  const out: (Ranked & { order: number; recent: number })[] = [];
  list.hosts.forEach((host, order) => {
    let score = 0;
    for (const term of terms) {
      let best = 0;
      for (const [weight, get] of FIELDS) {
        const value = get(host, list);
        if (value) best = Math.max(best, fieldScore(term, value) * weight);
      }
      if (best === 0) return;
      score += best;
    }
    out.push({ host, score, order, recent: recency.get(host.name) ?? Infinity });
  });
  out.sort((a, b) => b.score - a.score || a.recent - b.recent || a.order - b.order);
  return out.map(({ host, score }) => ({ host, score }));
}
