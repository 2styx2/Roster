// What a help page is made of (ticket 37): a few kinds of block and inline, as plain data. The
// generated pages build these from the registries, the guides get them from docs/app's Markdown
// (markdown.ts), and a Plugin (ticket 23) will hand over the same data, never HTML, so every
// page renders with the app's own type, keycaps and Theme (taste: "Plugins look native").

export type Inline =
  | { t: "text"; text: string }
  /** Iosevka: something you could paste into a shell or init.lua. */
  | { t: "code"; text: string }
  | { t: "strong"; children: Inline[] }
  | { t: "em"; children: Inline[] }
  /** `href` is a help topic (`terminal.size`, `:connect`, `config#the-sandbox`) or a Markdown
   * file's link as written (`keyboard.md#two-modes`), which the page resolves. */
  | { t: "link"; href: string; children: Inline[] }
  /** A key sequence in keymap notation ("␣ f", "Ctrl+Shift+c"), drawn as keycaps. */
  | { t: "keys"; keys: string };

export type Block =
  | { t: "h"; level: 1 | 2 | 3 | 4; text: Inline[]; anchor: string }
  | { t: "p"; text: Inline[] }
  | { t: "quote"; text: Inline[] }
  | { t: "list"; ordered: boolean; items: Inline[][] }
  | {
      t: "table";
      head: Inline[][];
      rows: Inline[][][];
      /** A help topic per row (`terminal.size`), so `:help terminal.size` lands on it. */
      anchors?: (string | undefined)[];
    }
  | { t: "pre"; text: string; lang?: string }
  /** Entries like Neovim's option and command docs: the name on the left, what it is now on
   * the right, what it does below. */
  | { t: "defs"; items: Def[] };

export interface Def {
  /** The help topic that lands on this entry (`terminal.size`, `:connect`, `E13`). */
  anchor?: string;
  term: Inline[];
  /** Right of the term: the value in effect, the keys, where it came from. */
  meta: Inline[];
  body: Inline[];
}

export const text = (s: string): Inline => ({ t: "text", text: s });
export const code = (s: string): Inline => ({ t: "code", text: s });
export const keys = (k: string): Inline => ({ t: "keys", keys: k });
export const link = (href: string, label: string | Inline[]): Inline => ({
  t: "link",
  href,
  children: typeof label === "string" ? [text(label)] : label,
});
export const p = (...parts: (Inline | string)[]): Block => ({ t: "p", text: parts.map((x) => (typeof x === "string" ? text(x) : x)) });
export const h = (level: 1 | 2 | 3, title: string, anchor: string): Block => ({ t: "h", level, text: [text(title)], anchor });

/** A heading's anchor: lower case, words joined by "-", as GitHub makes them (so a Markdown link
 * to `config.md#the-sandbox` finds it). */
export function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[`*]/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

/** An inline's plain text (for search, and a heading's name in the topic finder). */
export function plain(inlines: readonly Inline[]): string {
  return inlines
    .map((i) => {
      switch (i.t) {
        case "text":
        case "code":
          return i.text;
        case "keys":
          return i.keys;
        default:
          return plain(i.children);
      }
    })
    .join("");
}
