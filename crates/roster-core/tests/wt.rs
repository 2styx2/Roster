//! `:config import-terminal` (ticket 33): Windows Terminal's settings.json (JSON with comments)
//! → its default profile's font, size, weight, cell height, cursor and colour scheme → a block of
//! `roster.set` calls and a Theme in init.lua, shown as a diff before anything is written.

use roster_core::config::{self, FontSize};
use roster_core::wt::{self, DiffKind};
use std::path::{Path, PathBuf};

fn fixture(name: &str) -> String {
    std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/wt")
            .join(name),
    )
    .unwrap()
}

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("roster-core-wt-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn the_default_profile_takes_the_defaults_font_and_campbell() {
    let p = wt::parse(&fixture("defaults-font.json")).unwrap();
    assert_eq!(p.name, "Windows PowerShell");
    assert_eq!(p.font, Some(vec!["Iosevka Nerd Font".to_string()]));
    assert_eq!(p.size_pt, Some(16.0));
    assert_eq!(p.weight, None);
    assert_eq!(p.cell_height, None);
    assert_eq!(p.cursor, Some(config::CursorStyle::Block));
    // Windows Terminal's default intenseTextStyle, "bright": bold text is brighter, not heavier.
    assert_eq!(p.intense, "bright");
    // No colorScheme anywhere: Windows Terminal's default, Campbell, from its built-in schemes.
    let s = p.scheme.unwrap();
    assert_eq!(s.name, "Campbell");
    assert_eq!(s.background, "#0C0C0C");
    assert_eq!(s.ansi["magenta"], "#881798");
    assert_eq!(s.ansi["bright_white"], "#F2F2F2");
}

#[test]
fn comments_trailing_commas_flat_keys_custom_schemes_and_profile_colours() {
    let p = wt::parse(&fixture("legacy-custom-scheme.json")).unwrap();
    assert_eq!(p.name, "Ubuntu");
    assert_eq!(
        p.font,
        Some(vec![
            "JetBrainsMono Nerd Font".to_string(),
            "Segoe UI Emoji".to_string()
        ])
    );
    assert_eq!(p.size_pt, Some(12.5));
    assert_eq!(p.weight, Some(600));
    assert_eq!(p.cell_height, Some(1.25));
    assert_eq!(p.cursor, Some(config::CursorStyle::Bar));
    let s = p.scheme.unwrap();
    assert_eq!(s.name, "My Night");
    // The profile's own background wins over the scheme's.
    assert_eq!(s.background, "#101010");
    assert_eq!(s.cursor.as_deref(), Some("#C0CAF5"));
    assert_eq!(s.ansi["magenta"], "#BB9AF7");
}

#[test]
fn profiles_as_a_list_a_light_and_dark_scheme_and_no_default_profile() {
    let p = wt::parse(&fixture("array-profiles.json")).unwrap();
    assert_eq!(p.name, "First");
    assert_eq!(p.weight, Some(300));
    assert_eq!(p.scheme.unwrap().name, "One Half Dark");
    assert!(wt::parse("{ not json").unwrap_err().contains("settings.json"));
}

#[test]
fn the_block_loads_as_the_profile_and_defines_a_theme_for_its_scheme() {
    let p = wt::parse(&fixture("legacy-custom-scheme.json")).unwrap();
    let block = wt::lua_block(&p, r"C:\Users\me\settings.json", "2026-10-30");
    assert!(block.starts_with(wt::BEGIN), "{block}");
    assert!(block.trim_end().ends_with(wt::END), "{block}");
    let dir = temp_dir("block");
    std::fs::write(dir.join("init.lua"), &block).unwrap();
    let c = config::load(&dir).unwrap_or_else(|e| panic!("{e}\n{block}"));
    assert_eq!(c.terminal.font.0, ["JetBrainsMono Nerd Font", "Segoe UI Emoji"]);
    assert_eq!(c.terminal.size, FontSize::Pt(12.5));
    assert_eq!(c.terminal.weight, 600);
    assert_eq!(c.terminal.cell_height, Some(1.25));
    assert_eq!(c.terminal.cursor_style, config::CursorStyle::Bar);
    // intenseTextStyle "bright" (the default): bold text keeps the normal weight, and is bright.
    assert_eq!(c.terminal.bold_weight, 600);
    assert!(c.terminal.bold_is_bright);
    assert_eq!(c.theme, "wt-my-night");
    let theme = &c.themes["wt-my-night"];
    assert_eq!(theme.label.as_deref(), Some("My Night (Windows Terminal)"));
    assert_eq!(theme.appearance, Some(config::Appearance::Dark));
    assert_eq!(theme.terminal.background.as_deref(), Some("#101010"));
}

#[test]
fn intense_text_maps_to_the_bold_weight_and_bright_colours() {
    let block = |style: &str| {
        let text = format!(
            r#"{{ "profiles": {{ "defaults": {{ "intenseTextStyle": "{style}" }}, "list": [{{ "name": "P" }}] }} }}"#
        );
        let p = wt::parse(&text).unwrap();
        let dir = temp_dir(&format!("intense-{style}"));
        std::fs::write(dir.join("init.lua"), wt::lua_block(&p, "s.json", "d")).unwrap();
        let t = config::load(&dir).unwrap().terminal;
        (t.bold_weight, t.bold_is_bright)
    };
    // Without a weight, the app's own (500, Iosevka's Medium).
    assert_eq!(block("bright"), (500, true));
    assert_eq!(block("bold"), (700, false));
    assert_eq!(block("all"), (700, true));
    assert_eq!(block("none"), (500, false));
}

#[test]
fn the_block_goes_before_the_return_replaces_an_earlier_import_or_goes_at_the_end() {
    let block = format!("{}\nroster.set(\"terminal.size\", \"16pt\")\n{}\n", wt::BEGIN, wt::END);
    let with_return = "-- mine\nlocal x = 1\n\nreturn {\n  vim = false,\n}\n";
    let once = wt::insert_block(with_return, &block);
    assert_eq!(
        once,
        format!("-- mine\nlocal x = 1\n\n{block}\nreturn {{\n  vim = false,\n}}\n")
    );
    let newer = block.replace("16pt", "18pt");
    let twice = wt::insert_block(&once, &newer);
    assert_eq!(
        twice,
        once.replace("16pt", "18pt"),
        "replaced in place, not added again"
    );
    let starter = config::starter();
    assert_eq!(wt::insert_block(&starter, &block), format!("{starter}\n{block}"));
}

#[test]
fn the_preview_diffs_the_file_names_what_init_lua_overrides_and_writes_only_unchanged() {
    let settings = fixture("defaults-font.json");
    let dir = temp_dir("preview");
    let init = "return {\n  terminal = { size = 14 },\n}\n";
    std::fs::write(dir.join("init.lua"), init).unwrap();
    let pre = wt::preview(&dir, &settings, "settings.json", "2026-10-30").unwrap();
    assert!(!pre.created);
    assert!(
        pre.diff
            .iter()
            .any(|l| l.kind == DiffKind::Add && l.text.contains("roster.set(\"terminal.size\", \"16pt\")"))
    );
    assert!(pre.diff.iter().all(|l| l.kind != DiffKind::Remove));
    assert!(
        pre.diff
            .iter()
            .any(|l| l.kind == DiffKind::Same && l.text == "return {")
    );
    // init.lua's own size wins over the import: the preview says so.
    assert_eq!(pre.overridden, ["terminal.size"]);
    assert!(pre.summary.iter().any(|s| s.contains("Iosevka Nerd Font")));

    // Nothing is written by the preview.
    assert_eq!(std::fs::read_to_string(dir.join("init.lua")).unwrap(), init);
    // A file changed since the preview is never overwritten.
    std::fs::write(dir.join("init.lua"), "return { vim = false }\n").unwrap();
    assert!(
        wt::apply(&dir, &settings, "settings.json", &pre.applied())
            .unwrap_err()
            .contains("changed")
    );
    // An unchanged one is.
    let pre = wt::preview(&dir, &settings, "settings.json", "2026-10-30").unwrap();
    wt::apply(&dir, &settings, "settings.json", &pre.applied()).unwrap();
    let c = config::load(&dir).unwrap();
    assert_eq!(c.terminal.size, FontSize::Pt(16.0));
    assert!(!c.vim);
}

#[test]
fn with_no_init_lua_the_preview_starts_from_the_commented_out_example() {
    let dir = temp_dir("none");
    let settings = fixture("defaults-font.json");
    let pre = wt::preview(&dir, &settings, "settings.json", "2026-10-30").unwrap();
    assert!(pre.created);
    assert!(!dir.join("init.lua").exists());
    wt::apply(&dir, &settings, "settings.json", &pre.applied()).unwrap();
    assert!(
        std::fs::read_to_string(dir.join("init.lua"))
            .unwrap()
            .starts_with(&config::starter())
    );
    assert_eq!(config::load(&dir).unwrap().theme, "wt-campbell");
}

#[test]
fn where_windows_terminal_keeps_its_settings() {
    let paths = wt::settings_paths(Path::new(r"C:\Users\me\AppData\Local"));
    let shown: Vec<String> = paths.iter().map(|p| p.display().to_string()).collect();
    assert!(
        shown[0].contains("Microsoft.WindowsTerminal_8wekyb3d8bbwe"),
        "{shown:?}"
    );
    assert!(shown.iter().any(|p| p.contains("WindowsTerminalPreview")));
    assert!(shown.iter().all(|p| p.ends_with("settings.json")));
}

#[test]
fn apply_writes_exactly_what_the_preview_showed_or_nothing() {
    let dir = temp_dir("exactly");
    let settings = fixture("defaults-font.json");
    let pre = wt::preview(&dir, &settings, "settings.json", "2026-10-30").unwrap();
    // Windows Terminal's settings changed since the preview: refused, nothing written.
    let changed = settings.replace("Iosevka Nerd Font", "Cascadia Code");
    assert_ne!(changed, settings);
    let e = wt::apply(&dir, &changed, "settings.json", &pre.applied()).unwrap_err();
    assert!(
        e.contains("Windows Terminal's settings changed since the preview"),
        "{e}"
    );
    assert!(e.contains("import-terminal again"), "{e}");
    assert!(!dir.join("init.lua").exists());
    // Applied the next day, it still writes the previewed block (its date included).
    wt::apply(&dir, &settings, "settings.json", &pre.applied()).unwrap();
    let written = std::fs::read_to_string(dir.join("init.lua")).unwrap();
    let added: String = pre
        .diff
        .iter()
        .filter(|l| l.kind != DiffKind::Remove)
        .map(|l| format!("{}\n", l.text))
        .collect();
    assert_eq!(written, added);
    assert!(written.contains("2026-10-30"));
}

#[test]
fn apply_refuses_a_date_that_isnt_one() {
    let dir = temp_dir("date");
    let settings = fixture("defaults-font.json");
    let pre = wt::preview(&dir, &settings, "settings.json", "2026-10-30").unwrap();
    let mut forged = pre.applied();
    forged.date = "2026-10-30\nos.exit()".into();
    assert!(wt::apply(&dir, &settings, "settings.json", &forged).is_err());
    assert!(!dir.join("init.lua").exists());
}
