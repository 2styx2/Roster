// Syntax highlighting for help pages, the docs website and its PDF (ticket 71, decision Q90): one
// small hand-written tokenizer per language the docs use (Lua, shell, YAML, JSON, TOML), no
// library. It only has to colour short examples well, so each language is a few rules, never a
// grammar: the text always comes back whole, an unclosed string or comment runs to the end, and
// anything else (`text`, an untagged block, a language it doesn't know) stays plain. The colours
// are the Theme's syntax tokens (`--syntax-keyword`, …, theme.ts), never the accent.

/** What a run of code is. Each is a Theme token (`syntax_keyword` in init.lua). */
export type TokenKind = "keyword" | "string" | "number" | "comment" | "function" | "punctuation" | "key" | "command";

export interface Token {
  /** `null` is plain text, in the code's own colour. */
  kind: TokenKind | null;
  text: string;
}

const LANGS: Record<string, (code: string) => Token[]> = {};

/** `code` as coloured runs for `lang` (a fenced block's tag: `lua`, `sh`, `bash`, `yaml`, …). */
export function highlight(code: string, lang: string | undefined): Token[] {
  const tokenize = LANGS[ALIASES[lang?.toLowerCase() ?? ""] ?? ""];
  return merge(tokenize ? tokenize(code) : [{ kind: null, text: code }]);
}

const ALIASES: Record<string, string> = {
  lua: "lua",
  sh: "sh",
  bash: "sh",
  shell: "sh",
  console: "sh",
  zsh: "sh",
  yaml: "yaml",
  yml: "yaml",
  json: "json",
  jsonc: "json",
  toml: "toml",
};

/** Inline code that's a shell command line (`roster sync`, `ssh esx-02`), so it's coloured as one. */
export function shellCommand(code: string): boolean {
  return /^(?:roster|ssh|scp|git|gh|npm|npx|uv|cargo|wsl|bw|sudo|curl|cd)\s+\S/.test(code);
}

/** Adjacent runs of one kind as one run. */
function merge(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (const t of tokens) {
    if (!t.text) continue;
    const last = out[out.length - 1];
    if (last && last.kind === t.kind) last.text += t.text;
    else out.push({ ...t });
  }
  return out;
}

/** A tiny scanner: try each rule at the cursor (sticky regexes), else take one character plain. */
class Scanner {
  i = 0;
  out: Token[] = [];
  constructor(readonly src: string) {}
  get done() {
    return this.i >= this.src.length;
  }
  /** The match of `re` at the cursor, without moving. */
  peek(re: RegExp): RegExpExecArray | null {
    const sticky = new RegExp(re.source, re.flags.includes("y") ? re.flags : `${re.flags}y`);
    sticky.lastIndex = this.i;
    return sticky.exec(this.src);
  }
  /** Takes the match of `re` as `kind`; the text taken, or null. */
  take(re: RegExp, kind: TokenKind | null): string | null {
    const m = this.peek(re);
    if (!m || !m[0]) return null;
    this.push(kind, m[0]);
    return m[0];
  }
  push(kind: TokenKind | null, text: string) {
    this.out.push({ kind, text });
    this.i += text.length;
  }
  /** The last run that isn't whitespace or a comment. */
  lastSignificant(): Token | undefined {
    for (let k = this.out.length - 1; k >= 0; k--) {
      const t = this.out[k] as Token;
      if (t.kind === "comment") continue;
      if (/\n/.test(t.text) && !t.text.trim()) return undefined;
      if (t.text.trim()) return t;
    }
    return undefined;
  }
}

// --- Lua -----------------------------------------------------------------------------------

const LUA_KEYWORDS = new Set(
  "and break do else elseif end false for function goto if in local nil not or repeat return then true until while".split(" "),
);

LANGS.lua = (code) => {
  const s = new Scanner(code);
  while (!s.done) {
    const long = s.peek(/--\[(=*)\[/);
    if (long) {
      s.push("comment", upTo(code, s.i, `]${long[1]}]`));
      continue;
    }
    if (s.take(/--[^\n]*/, "comment")) continue;
    const str = s.peek(/\[(=*)\[/);
    if (str) {
      s.push("string", upTo(code, s.i, `]${str[1]}]`));
      continue;
    }
    if (s.take(/"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?/, "string")) continue;
    if (s.take(/0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/, "number")) continue;
    const word = s.peek(/[A-Za-z_][A-Za-z0-9_]*/)?.[0];
    if (word) {
      if (LUA_KEYWORDS.has(word)) s.push("keyword", word);
      else if (s.peek(new RegExp(`${word}\\s*(?:\\(|"|')`))) s.push("function", word);
      else if (s.peek(new RegExp(`${word}\\s*=(?!=)`)) && keyPosition(s.lastSignificant())) s.push("key", word);
      else s.push(null, word);
      continue;
    }
    if (s.take(/[{}()[\],;:.=+\-*/%^#<>~]+/, "punctuation")) continue;
    s.push(null, code[s.i] as string);
  }
  return s.out;
};

/** A name before `=` is a table key (or a top-level setting) after `{`, `,`, `;` or a line's start. */
const keyPosition = (prev: Token | undefined) => !prev || /[{,;]$/.test(prev.text);

/** From `from` to just past `close`, or to the end if it never closes. */
function upTo(code: string, from: number, close: string): string {
  const end = code.indexOf(close, from + 2);
  return end < 0 ? code.slice(from) : code.slice(from, end + close.length);
}

// --- Shell ---------------------------------------------------------------------------------

LANGS.sh = (code) => {
  const s = new Scanner(code);
  let command = true;
  let lineStart = true;
  while (!s.done) {
    if (lineStart) {
      lineStart = false;
      s.take(/[ \t]+/, null);
      // A prompt (`$ roster sync`) isn't part of the command.
      if (command && s.take(/[$>](?= \S)/, "punctuation")) continue;
    }
    const c = code[s.i] as string;
    if (c === "\n") {
      const prev = code.slice(0, s.i).trimEnd();
      s.push(null, "\n");
      lineStart = true;
      // A line ending in a backslash goes on: its next line isn't a new command.
      command = !prev.endsWith("\\");
      continue;
    }
    if (s.take(/[ \t]+/, null)) continue;
    if (c === "#" && (s.i === 0 || /\s/.test(code[s.i - 1] as string))) {
      s.take(/#[^\n]*/, "comment");
      continue;
    }
    if (s.take(/"(?:\\.|[^"\\])*"?|'[^']*'?/, "string")) {
      command = false;
      continue;
    }
    if (s.take(/\$\(|`/, "punctuation")) {
      command = true;
      continue;
    }
    if (s.take(/\|\||&&|[|;&]/, "punctuation")) {
      command = true;
      continue;
    }
    if (s.take(/\d*>>?|<|[()]/, "punctuation")) continue;
    if (s.take(/\$\{[^}\n]*\}?|\$[A-Za-z_][A-Za-z0-9_]*|\$[0-9@#?$!*-]/, "key")) continue;
    if (command) {
      const assign = s.peek(/([A-Za-z_][A-Za-z0-9_]*)(=)([^\s|;&]*)/);
      if (assign) {
        s.push("key", assign[1] as string);
        s.push("punctuation", "=");
        s.push(null, assign[3] as string);
        continue;
      }
    }
    if (s.take(/--?[A-Za-z][\w-]*/, "keyword")) {
      command = false;
      continue;
    }
    if (!command && s.take(/\d+(?:\.\d+)?(?=[\s|;&)]|$)/, "number")) continue;
    const word = s.peek(/(?:\\.|[^\s|;&()<>"'`$])+/)?.[0];
    if (word) {
      s.push(command ? "command" : null, word);
      // `sudo roster …`: what follows is the command too.
      command = command && /^(?:sudo|env|time|exec|nohup)$/.test(word);
      continue;
    }
    s.push(null, c);
  }
  return s.out;
};

// --- YAML ----------------------------------------------------------------------------------

LANGS.yaml = (code) => {
  const s = new Scanner(code);
  for (const [n, line] of code.split("\n").entries()) {
    if (n > 0) s.push(null, "\n");
    const end = s.i + line.length;
    s.take(/[ \t]+/, null);
    while (s.take(/-(?=\s|$)/, "punctuation")) s.take(/[ \t]+/, null);
    if (s.take(/#.*/, "comment")) continue;
    const key = s.peek(/("[^"\n]*"|'[^'\n]*'|[^\s#:'"][^\n:#]*?)(\s*)(:)(?=\s|$)/);
    if (key) {
      s.push("key", key[1] as string);
      s.push(null, key[2] as string);
      s.push("punctuation", ":");
    }
    yamlValue(s, end);
  }
  return s.out;
};

/** A YAML value, to the end of its line: a quoted or plain scalar, then any comment. */
function yamlValue(s: Scanner, end: number) {
  s.take(/[ \t]+/, null);
  if (s.i >= end) return;
  const quoted = s.peek(/"(?:\\.|[^"\\\n])*"?|'(?:''|[^'\n])*'?/)?.[0];
  if (quoted) s.push("string", quoted);
  else {
    const rest = s.src.slice(s.i, end);
    const hash = rest.search(/(?:^|\s)#/);
    const value = (hash < 0 ? rest : rest.slice(0, hash)).trimEnd();
    if (/^[[{]/.test(value)) yamlFlow(s, value);
    else if (value) s.push(/^[|>][-+]?$/.test(value) ? "punctuation" : yamlScalar(value), value);
  }
  s.take(/[ \t]+/, null);
  if (s.i < end) s.take(/#.*/, "comment");
  if (s.i < end) s.push(null, s.src.slice(s.i, end));
}

const yamlScalar = (value: string): TokenKind =>
  /^(?:true|false|yes|no|on|off|null|~)$/i.test(value)
    ? "keyword"
    : /^[-+]?(?:\d[\d_]*(?:\.\d+)?(?:[eE][-+]?\d+)?|0x[0-9a-fA-F]+)$/.test(value)
      ? "number"
      : "string";

/** A flow collection on one line: `{ ip: 10.0.0.12, user: root }`, `[a, b]`. */
function yamlFlow(s: Scanner, value: string) {
  for (const part of value.split(/("(?:\\.|[^"\\])*"?|'[^']*'?|[[\]{},]|:(?=\s|$)|\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) s.push(null, part);
    else if (/^["']/.test(part)) s.push("string", part);
    else if (/^(?:[[\]{},]|:)$/.test(part)) s.push("punctuation", part);
    else {
      const rest = s.src.slice(s.i + part.length);
      s.push(/^:(?:\s|$)/.test(rest) ? "key" : yamlScalar(part), part);
    }
  }
}

// --- JSON ----------------------------------------------------------------------------------

LANGS.json = (code) => {
  const s = new Scanner(code);
  while (!s.done) {
    const str = s.peek(/"(?:\\.|[^"\\\n])*"?/)?.[0];
    if (str) {
      s.push(s.peek(new RegExp(`${escapeRe(str)}\\s*:`)) ? "key" : "string", str);
      continue;
    }
    if (s.take(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, "number")) continue;
    if (s.take(/\b(?:true|false|null)\b/, "keyword")) continue;
    if (s.take(/\/\/[^\n]*/, "comment")) continue;
    if (s.take(/[{}[\],:]+/, "punctuation")) continue;
    s.push(null, code[s.i] as string);
  }
  return s.out;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

// --- TOML ----------------------------------------------------------------------------------

LANGS.toml = (code) => {
  const s = new Scanner(code);
  let lineStart = true;
  while (!s.done) {
    if (lineStart) {
      lineStart = false;
      s.take(/[ \t]+/, null);
      if (s.take(/\[\[?[^\]\n]*\]?\]?/, "keyword")) continue;
      const key = s.peek(/((?:[A-Za-z0-9_-]+|"[^"\n]*"|'[^'\n]*')(?:\s*\.\s*(?:[A-Za-z0-9_-]+|"[^"\n]*"|'[^'\n]*'))*)(?=\s*=)/);
      if (key) s.push("key", key[1] as string);
    }
    if (code[s.i] === "\n") {
      s.push(null, "\n");
      lineStart = true;
      continue;
    }
    if (s.take(/#[^\n]*/, "comment")) continue;
    const multi = s.peek(/"""|'''/)?.[0];
    if (multi) {
      s.push("string", upTo(code, s.i + 1, multi));
      continue;
    }
    if (s.take(/"(?:\\.|[^"\\\n])*"?|'[^'\n]*'?/, "string")) continue;
    if (s.take(/\b(?:true|false)\b/, "keyword")) continue;
    if (s.take(/\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?|[+-]?(?:0x[0-9a-fA-F_]+|0o[0-7_]+|0b[01_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?|inf|nan)/, "number")) continue;
    if (s.take(/[=[\]{},.]+/, "punctuation")) continue;
    s.push(null, code[s.i] as string);
  }
  return s.out;
};
