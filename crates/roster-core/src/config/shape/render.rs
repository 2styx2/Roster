//! What the shape is written out as: the option reference (docs/app/options.md, `:help options`),
//! the LuaCATS stubs (`:config types`) and the frontend's data (`:options`, the help topics).
//! `cargo run -p roster-core --example gen_config_options` writes the committed copies;
//! tests/config_shape.rs fails when one is stale.

use super::{ApiItem, Kind, NEOVIM_STYLE, Opt, api, children, options};
use crate::plugin::api::slug;
use serde_json::json;
use std::fmt::Write as _;

pub const DOC_PATH: &str = "docs/app/options.md";
pub const STUBS_PATH: &str = "examples/types/roster-config.lua";
pub const JSON_PATH: &str = "crates/roster-core/tests/fixtures/config-options.json";
pub const COMMAND: &str = "cargo run -p roster-core --example gen_config_options";
/// The root class of the stubs: every option.
const ROOT: &str = "roster.config.Options";

/// `themes.*.label` → `themes.<id>.label`; `folders[].name` → `folders[n].name`.
fn shown(path: &str) -> String {
    let key = if path.starts_with("keys.") { "<keys>" } else { "<id>" };
    path.replace(".*", &format!(".{key}")).replace("[]", "[n]")
}

/// An entry's heading: the option's path, or an item type's class name.
fn heading(o: &Opt) -> String {
    if o.is_item() {
        o.class.unwrap_or_default().to_string()
    } else {
        o.path.clone()
    }
}

fn anchor(o: &Opt) -> String {
    slug(&format!("`{}`", heading(o)))
}

fn api_anchor(a: &ApiItem) -> String {
    slug(&format!("`{}`", a.signature()))
}

/// The line init.lua would write: `roster.o.terminal.size = "16pt"`, or `roster.set(…)`.
fn example_line(path: &str, value: &str) -> String {
    if NEOVIM_STYLE {
        format!("roster.o.{path} = {value}")
    } else {
        format!("roster.set(\"{path}\", {value})")
    }
}

/// Prose for Markdown: each Lua string in it (`"16pt"`, `"<C-b>"`) as code, so it reads as Lua and
/// an angle bracket in it isn't taken for HTML.
fn prose(text: &str) -> String {
    let mut out = String::new();
    let mut parts = text.split('"');
    if let Some(first) = parts.next() {
        out.push_str(first);
    }
    let rest: Vec<&str> = parts.collect();
    let mut i = 0;
    while i < rest.len() {
        if i + 1 < rest.len() {
            out.push_str(&format!("`\"{}\"`{}", rest[i], rest[i + 1]));
            i += 2;
        } else {
            out.push('"');
            out.push_str(rest[i]);
            i += 1;
        }
    }
    out
}

fn cell(text: &str) -> String {
    text.replace('\n', " ").replace('|', "\\|")
}

fn default_text(o: &Opt) -> String {
    match o.default.as_str() {
        "unset" | "required" => o.default.clone(),
        d => format!("`{d}`"),
    }
}

/// A colour object's names, for its entry or its row.
fn names_of(o: &Opt) -> Option<String> {
    let names: Vec<String> = children(o)
        .filter(|c| c.brief)
        .map(|c| format!("`{}`", c.segments().last().copied().unwrap_or_default()))
        .collect();
    (!names.is_empty()).then(|| names.join(", "))
}

/// The item type an entry's values are (a map's `*`, a list's `[]`), when it has one.
fn item_of(o: &Opt) -> Option<&'static Opt> {
    if !matches!(o.kind, Kind::Map | Kind::List) {
        return None;
    }
    children(o).find(|c| c.is_item() && c.class.is_some())
}

/// An entry's rows: its fields that have no entry of their own.
fn rows(o: &Opt) -> Vec<&'static Opt> {
    children(o)
        .filter(|c| !c.brief && !c.is_entry() && !c.is_item())
        .collect()
}

/// docs/app/options.md.
pub fn markdown() -> String {
    let mut s = String::new();
    s.push_str("# Option reference\n\n");
    let _ = writeln!(
        s,
        "<!-- Generated from crates/roster-core/src/config/shape by `{COMMAND}`: edit that, then run it. -->\n"
    );
    s.push_str(
        "Every option `init.lua` takes, and every name of its `roster` table, one entry each, the way Neovim's `:help 'option'` lists its options: how it's written, its type, its default, the values it can have, what it does and an example. Each entry is a help topic: `:help terminal.size`, `:help roster.keymap.set`, `:help roster.config.Theme`. [The Config guide](config.md) says how `init.lua` works and what each option does in more words; `:options` lists every option with its value now and where it was set; `:config types` writes all of this as types for your editor ([Editor support](#editor-support)).\n\n",
    );
    s.push_str(
        "Types are written as [LuaCATS](https://luals.github.io/wiki/annotations/) writes them: `string[]` is a list of strings, `table<string, X>` a table of X by name, `\"webgl\"|\"dom\"` one of those strings, `roster.config.Theme` a table described under [Types](#types). An object (a table of named options, such as `terminal`) needs no setup: give only the options you change. A default of unset means nothing is set and the app, or a choice it keeps, decides; required is a field a spec can't leave out.\n\n",
    );

    s.push_str("## The `roster` table\n\n");
    s.push_str("A global in `init.lua` and its modules, and also `require(\"roster\")`. A Plugin gets a bigger one ([The Plugin API](../plugin-api.md)).\n\n");
    for a in api() {
        let _ = writeln!(s, "### `{}`\n", a.signature());
        if !a.is_function() {
            let _ = writeln!(s, "`{}`\n", a.ty);
        }
        let _ = writeln!(
            s,
            "{}{}{}\n",
            prose(a.about),
            if a.more.is_empty() { "" } else { " " },
            prose(a.more)
        );
        if let Some(params) = a.params {
            s.push_str("| Parameter | Type | |\n|---|---|---|\n");
            for p in params {
                let _ = writeln!(s, "| `{}` | `{}` | {} |", p.name, cell(p.ty), cell(&prose(p.about)));
            }
            s.push('\n');
        }
        let _ = writeln!(s, "```lua\n{}\n```\n", a.example);
    }

    let mut section = "";
    for o in options().iter().filter(|o| o.is_entry() && !o.is_item()) {
        if o.section != section {
            section = o.section;
            let _ = writeln!(s, "## {section}\n");
        }
        entry(&mut s, o);
    }

    s.push_str("## Types\n\n");
    s.push_str("The tables some options hold, by the name `:config types` gives them.\n\n");
    for o in options().iter().filter(|o| o.is_entry() && o.is_item()) {
        entry(&mut s, o);
    }

    s.push_str("## Editor support\n\n");
    let _ = writeln!(
        s,
        "`:config types` writes all of the above as [LuaCATS](https://luals.github.io/wiki/annotations/) annotations into `types/roster-config.lua` in the config folder ([`{STUBS_PATH}`](../../{STUBS_PATH}) is the same file), so [lua-language-server](https://luals.github.io/) completes option names and shows these descriptions as you type. Point it at the folder with a `.luarc.json` next to `init.lua`:\n"
    );
    s.push_str("```json\n{\n  \"runtime.version\": \"Lua 5.4\",\n  \"workspace.library\": [\"types\"],\n  \"diagnostics.globals\": [\"roster\"]\n}\n```\n\n");
    let _ = writeln!(
        s,
        "Then `---@type {ROOT}` on the table `init.lua` returns checks every name and value in it. The file is the copy this app was built with; run `:config types` again after an update.\n"
    );
    s
}

fn entry(s: &mut String, o: &Opt) {
    let _ = writeln!(s, "### `{}`\n", heading(o));
    let mut line = Vec::new();
    if o.is_item() {
        line.push(format!("`{}`", shown(&o.path)));
    } else if NEOVIM_STYLE {
        line.push(format!("`{}`", o.lua_name()));
    }
    line.push(format!("`{}`", o.ty));
    if !o.is_item() {
        line.push(format!("default {}", default_text(o)));
    }
    let _ = writeln!(s, "{}\n", line.join(" · "));
    let _ = writeln!(s, "{}\n", prose(&o.about));
    let allowed = o.allowed.text();
    if !allowed.is_empty() {
        let _ = writeln!(s, "Takes {}.\n", prose(&allowed));
    }
    if let Some(names) = names_of(o) {
        let _ = writeln!(s, "Names: {names}.\n");
    }
    if let Some(item) = item_of(o) {
        let what = if o.kind == Kind::Map { "Each value" } else { "Each item" };
        let class = item.class.unwrap_or_default();
        let _ = writeln!(s, "{what} is a [`{class}`](#{}).\n", slug(&format!("`{class}`")));
    }
    let fields: Vec<String> = children(o)
        .filter(|c| c.is_entry() && !c.is_item())
        .map(|c| {
            format!(
                "[`{}`](#{})",
                c.segments().last().copied().unwrap_or_default(),
                anchor(c)
            )
        })
        .collect();
    if !fields.is_empty() {
        let _ = writeln!(s, "Options in it: {}.\n", fields.join(", "));
    }
    let rows = rows(o);
    if !rows.is_empty() {
        s.push_str("| Field | Type | Default | |\n|---|---|---|---|\n");
        for r in rows {
            let mut about = prose(&r.about);
            let allowed = r.allowed.text();
            if !allowed.is_empty() && !matches!(r.allowed, super::Allowed::OneOf(_)) {
                let _ = write!(about, " Takes {}.", prose(&allowed));
            }
            if let Some(names) = names_of(r) {
                let _ = write!(about, " Names: {names}.");
            }
            let _ = writeln!(
                s,
                "| `{}` | `{}` | {} | {} |",
                r.segments().last().copied().unwrap_or_default(),
                cell(&r.ty),
                cell(&default_text(r)),
                cell(&about)
            );
        }
        s.push('\n');
    }
    let example = if o.is_item() {
        options()
            .iter()
            .find(|p| item_of(p).is_some_and(|i| i.path == o.path))
            .map(|p| example_line(&p.path, &p.example))
    } else if o.example.is_empty() {
        None
    } else {
        Some(example_line(&o.path, &o.example))
    };
    if let Some(example) = example {
        let _ = writeln!(s, "```lua\n{example}\n```\n");
    }
}

// ---------------------------------------------------------------- the stubs

/// One line of a doc comment: the description, then the default.
fn hover(o: &Opt) -> String {
    let mut out = o.about.clone();
    if !matches!(o.default.as_str(), "unset" | "required" | "{}") {
        let _ = write!(out, " Default: `{}`.", o.default);
    }
    let allowed = o.allowed.text();
    if !allowed.is_empty() && !matches!(o.allowed, super::Allowed::OneOf(_)) {
        let _ = write!(out, " Takes {allowed}.");
    }
    out.replace('\n', " ")
}

fn field(o: &Opt) -> String {
    let name = o.segments().last().copied().unwrap_or_default().to_string();
    let optional = if o.default == "required" { "" } else { "?" };
    format!("---@field {name}{optional} {} {}\n", o.ty, hover(o))
}

/// examples/types/roster-config.lua: init.lua's options and `roster` table, for lua-language-server.
pub fn stubs() -> String {
    let mut s = String::new();
    s.push_str("---@meta\n");
    let _ = writeln!(
        s,
        "-- Generated from crates/roster-core/src/config/shape by `{COMMAND}`.\n-- The types of init.lua's options and its `roster` table, for lua-language-server: `:config types`\n-- writes this file as types/roster-config.lua in the config folder. `:help options` has the same text.\n"
    );

    let _ = writeln!(
        s,
        "--- Every option init.lua takes. `---@type {ROOT}` on the table it returns checks it."
    );
    let _ = writeln!(s, "---@class {ROOT}");
    for o in options().iter().filter(|o| o.segments().len() == 1) {
        s.push_str(&field(o));
    }
    s.push('\n');

    let mut done: Vec<&str> = Vec::new();
    for o in options() {
        let Some(class) = o.class else { continue };
        if done.contains(&class) {
            continue;
        }
        done.push(class);
        let _ = writeln!(s, "--- {}", o.about);
        if o.kind == Kind::Leaf {
            let _ = writeln!(s, "---@alias {class} {}\n", o.ty);
            continue;
        }
        let _ = writeln!(s, "---@class {class}");
        for c in children(o).filter(|c| !c.is_item()) {
            s.push_str(&field(c));
        }
        s.push('\n');
    }

    s.push_str("--- An option's dotted name, for roster.set.\n---@alias roster.config.OptionName\n");
    for o in options().iter().filter(|o| !o.in_item()) {
        let _ = writeln!(s, "---| \"{}\"", o.path);
    }
    s.push('\n');

    s.push_str("--- init.lua's `roster` table. A Plugin's is another one (types/roster.lua).\nroster = {}\n\n");
    let mut tables: Vec<String> = Vec::new();
    for a in api() {
        let parts: Vec<&str> = a.path.split('.').collect();
        for depth in 2..parts.len() {
            let t = parts[..depth].join(".");
            if !tables.contains(&t) {
                let _ = writeln!(s, "{t} = {{}}\n");
                tables.push(t);
            }
        }
        let _ = writeln!(s, "--- {}", a.about);
        if !a.more.is_empty() {
            let _ = writeln!(s, "--- {}", a.more);
        }
        s.push_str("---\n--- ```lua\n");
        for line in a.example.lines() {
            let _ = writeln!(s, "--- {line}");
        }
        s.push_str("--- ```\n");
        match a.params {
            Some(params) => {
                for p in params {
                    let _ = writeln!(s, "---@param {} {} {}", p.name, p.ty, p.about);
                }
                let names: Vec<&str> = params.iter().map(|p| p.name).collect();
                let _ = writeln!(s, "function {}({}) end\n", a.path, names.join(", "));
            }
            None => {
                let _ = writeln!(s, "---@type {}\n{} = nil\n", a.ty, a.path);
            }
        }
    }
    s.push_str("return roster\n");
    s
}

/// `:config types`: writes [`stubs`] as `types/roster-config.lua` in the config folder `dir`,
/// over an older copy, and gives where. `dir` must exist; never writes through a link.
pub fn write_types(dir: &std::path::Path) -> Result<std::path::PathBuf, String> {
    if !dir.is_dir() {
        return Err(format!("{} isn't a folder", dir.display()));
    }
    let types = dir.join("types");
    let file = types.join("roster-config.lua");
    for p in [&types, &file] {
        if std::fs::symlink_metadata(p).is_ok_and(|m| crate::plugin::folder::is_link(&m)) {
            return Err(format!("{} is a link: roster won't write through it", p.display()));
        }
    }
    std::fs::create_dir_all(&types).map_err(|e| format!("{}: {e}", types.display()))?;
    std::fs::write(&file, stubs()).map_err(|e| format!("{}: {e}", file.display()))?;
    Ok(file)
}

// ---------------------------------------------------------------- the data

/// crates/roster-core/tests/fixtures/config-options.json: the entries as data, for `:options`,
/// and every help topic with the place on options.md it opens.
pub fn json_text() -> String {
    let page = "options";
    let mut tags = serde_json::Map::new();
    let mut entries = Vec::new();
    for o in options().iter().filter(|o| o.is_entry()) {
        let at = format!("{page}#{}", anchor(o));
        tags.insert(heading(o), json!(at));
        if NEOVIM_STYLE && !o.is_item() {
            tags.insert(o.lua_name(), json!(at));
        }
        if o.is_item() {
            continue;
        }
        // `:options` lists what holds a value: not an object made only of other entries.
        let listed = !(o.kind == Kind::Object && children(o).all(|c| c.is_entry()) && children(o).next().is_some());
        entries.push(json!({
            "path": o.path,
            "kind": o.kind.as_str(),
            "type": o.ty,
            "default": o.default,
            "allowed": o.allowed.text(),
            "about": o.about,
            "example": o.example,
            "section": o.section,
            "topic": at,
            "listed": listed,
        }));
    }
    for a in api() {
        let at = format!("{page}#{}", api_anchor(a));
        tags.insert(a.path.to_string(), json!(at.clone()));
        if a.is_function() {
            tags.insert(format!("{}()", a.path), json!(at));
        }
    }
    let data = json!({
        "generated": format!("from crates/roster-core/src/config/shape by `{COMMAND}`"),
        "neovimStyle": NEOVIM_STYLE,
        "options": entries,
        "tags": tags,
    });
    let mut text = serde_json::to_string_pretty(&data).expect("JSON");
    text.push('\n');
    text
}
