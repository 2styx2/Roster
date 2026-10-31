// The edit form's logic (ticket 10), apart from React: a draft of a Host's editable fields as
// typed, what it changes, whether that needs a test login first (decision Q43), and what's wrong
// with it. roster checks everything again (`host.update`); this only saves a round trip.
import { LOGIN_FIELDS, type Host, type HostChanges, type HostFields } from "../backend/types";

export type FieldName = keyof HostFields;

/** The draft: every field as text, as typed. */
export type Draft = Record<FieldName, string>;

export interface FieldDef {
  name: FieldName;
  label: string;
  /** Data you could paste into a shell: Iosevka (taste.md). */
  mono: boolean;
  placeholder?: string;
}

/** The form's fields, in order: what the Host is, then how to reach it. */
export const FIELDS: readonly FieldDef[] = [
  { name: "title", label: "Title", mono: false },
  { name: "description", label: "Description", mono: false },
  { name: "type", label: "Type", mono: true, placeholder: "esxi, switch, linux…" },
  { name: "ip", label: "Address", mono: true },
  { name: "port", label: "Port", mono: true },
  { name: "user", label: "User", mono: true },
  { name: "auth", label: "Login", mono: true, placeholder: "bw:<host> ssh" },
];

export function draftOf(h: Host): Draft {
  return {
    title: h.title,
    description: h.description,
    type: h.type,
    ip: h.ip,
    port: String(h.ssh.port),
    user: h.ssh.user,
    auth: h.ssh.auth ?? "",
  };
}

/** One line, whitespace collapsed, as roster reads text fields. */
const oneLine = (s: string) => s.split(/\s+/).filter(Boolean).join(" ");

/** What's wrong with a field's text, or null. */
export function fieldProblem(name: FieldName, text: string): string | null {
  const t = text.trim();
  if (name === "port") return /^\d+$/.test(t) && Number(t) >= 1 && Number(t) <= 65535 ? null : "A number from 1 to 65535";
  if ((name === "ip" || name === "user") && (t === "" || /\s/.test(t))) {
    return t === "" ? "Can't be empty" : "Can't contain spaces";
  }
  return null;
}

/** The fields the draft changes, as `host.update` takes them (null while a field is invalid). */
export function changesOf(h: Host, draft: Draft): HostChanges | null {
  const original = draftOf(h);
  const out: HostChanges = {};
  for (const { name } of FIELDS) {
    if (fieldProblem(name, draft[name])) return null;
    if (name === "port") {
      const port = Number(draft.port.trim());
      if (port !== h.ssh.port) out.port = port;
      continue;
    }
    const value = name === "title" || name === "description" || name === "type" ? oneLine(draft[name]) : draft[name].trim();
    if (value !== original[name]) out[name] = value;
  }
  return out;
}

/** True when the change touches the address, user or Login: roster tests the login first. */
export function needsVerify(changes: HostChanges): boolean {
  return LOGIN_FIELDS.some((k) => k in changes);
}

/** True when the draft's address, port, user or Login differ from the Host's, valid or not. */
export function touchesLogin(h: Host, draft: Draft): boolean {
  const original = draftOf(h);
  return LOGIN_FIELDS.some((k) => draft[k].trim() !== original[k]);
}

/** After a pull changed the Host under an open form (decision Q88): the fields you hadn't touched
 * take the pulled values, the ones you had keep yours. `theirs`: fields the pull changed and the
 * form now shows; `both`: fields it changed that you had changed too (yours kept). */
export function rebaseDraft(before: Host, after: Host, draft: Draft): { draft: Draft; theirs: FieldName[]; both: FieldName[] } {
  const was = draftOf(before);
  const now = draftOf(after);
  const next = { ...draft };
  const theirs: FieldName[] = [];
  const both: FieldName[] = [];
  for (const { name } of FIELDS) {
    if (was[name] === now[name]) continue;
    const mine = draft[name].trim();
    if (mine === was[name]) {
      next[name] = now[name];
      theirs.push(name);
    } else if (mine !== now[name]) both.push(name);
  }
  return { draft: next, theirs, both };
}
