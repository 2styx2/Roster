// A Plugin's tutorial (`roster.tutor.set`, ticket 55): the checked op (plugins/ops.ts) as a
// TutorialDef, its Markdown parsed once, as a Plugin's help page is.
import { inline, parseMarkdown } from "../help/markdown";
import type { PluginOp } from "../plugins/ops";
import type { TutorialDef } from "./tutor";

export function pluginTutorial(plugin: string, op: Extract<PluginOp, { op: "tutor" }>): TutorialDef {
  const intro = parseMarkdown(op.intro);
  const outro = parseMarkdown(op.outro);
  return {
    id: op.id,
    source: plugin,
    title: op.title,
    summary: op.summary,
    intro: () => intro,
    outro: () => outro,
    lessons: op.lessons.map((l) => {
      const about = parseMarkdown(l.text);
      return {
        title: l.title,
        about: () => about,
        steps: l.steps.map((st) => {
          const text = inline(st.text);
          return { id: st.id, text: () => text, on: st.on };
        }),
      };
    }),
  };
}
