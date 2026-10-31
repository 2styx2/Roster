// How a help page draws code (ticket 71): the same HelpDoc renders `:help`, the docs website and
// its PDF, so these read its static HTML.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { code, type Block } from "./doc";
import { HelpDoc, type RenderEnv } from "./HelpPanel";

const env = (over: Partial<RenderEnv> = {}): RenderEnv => ({ query: "", leader: "␣", tags: new Set([":connect"]), here: undefined, open: () => {}, ...over });
const html = (blocks: Block[], over?: Partial<RenderEnv>) => renderToStaticMarkup(<HelpDoc blocks={blocks} env={env(over)} />);

describe("code in a help page", () => {
  it("colours a fenced block by its language, and says which it is", () => {
    const out = html([{ t: "pre", lang: "lua", text: 'theme = "nord" -- yours' }]);
    expect(out).toContain('<pre data-lang="lua"><code>');
    expect(out).toContain('<span class="hl-key">theme</span>');
    expect(out).toContain('<span class="hl-string">&quot;nord&quot;</span>');
    expect(out).toContain('<span class="hl-comment">-- yours</span>');
  });

  it("leaves a text block plain", () => {
    expect(html([{ t: "pre", lang: "text", text: "a = 1" }])).toContain("<code>a = 1</code>");
  });

  it("marks a search match that crosses coloured runs once, around them", () => {
    const out = html([{ t: "pre", lang: "sh", text: "roster sync --dry-run" }], { query: "roster sync" });
    expect(out.match(/<mark/g)).toHaveLength(1);
    expect(out).toContain('<mark class="help-hit"><span class="hl-command">roster</span> sync</mark>');
  });

  it("draws a :command in prose in the command style, and a shell line coloured", () => {
    const out = html([{ t: "p", text: [code(":connect esx-02"), code("roster sync --dry-run")] }]);
    expect(out).toContain('<code class="help-cmd">:connect esx-02</code>');
    expect(out).toContain('<code class="help-shell"><span class="hl-command">roster</span> sync <span class="hl-keyword">--dry-run</span></code>');
  });
});
