//! The Lua Config (GLOSSARY: Config, ADR 0002): `init.lua` in the user config dir, run in a
//! sandboxed Lua 5.4, checked against a schema, layered over the defaults. These tests drive the
//! public loader the Tauri shell uses, with real files in a temp dir.

use desk_core::config::{self, Config, Loader};
use std::path::PathBuf;

/// A fresh, empty config dir for one test.
fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("desk-core-config-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn with_init(name: &str, lua: &str) -> PathBuf {
    let dir = temp_dir(name);
    std::fs::write(dir.join("init.lua"), lua).unwrap();
    dir
}

#[test]
fn no_file_gives_the_defaults() {
    let dir = temp_dir("none");
    let config = config::load(&dir).unwrap();
    assert_eq!(config, Config::default());
    assert_eq!(config.leader, "Ctrl+Space");
    assert!(config.vim);
    assert_eq!(config.terminal.font, "Iosevka");
    assert_eq!(config.terminal.weight, 500);
    assert_eq!(config.terminal.bold_weight, 700);
    assert_eq!(config.theme, "auto");
}

#[test]
fn a_partial_table_merges_over_the_defaults() {
    let dir = with_init("partial", r#"return { vim = false, terminal = { size = 16 } }"#);
    let config = config::load(&dir).unwrap();
    assert!(!config.vim);
    assert_eq!(config.terminal.size, 16);
    // Everything else stays the default, including the rest of `terminal`.
    assert_eq!(config.terminal.font, "Iosevka");
    assert_eq!(config.leader, "Ctrl+Space");
    let _ = Loader::new(&dir);
}

fn load_as(dir: &std::path::Path, os: config::Os) -> Result<Config, config::ConfigError> {
    config::load_with(
        dir,
        &config::Env {
            os,
            ..config::Env::default()
        },
    )
}

#[test]
fn lua_logic_can_branch_on_the_os() {
    let dir = with_init(
        "os",
        r#"
        local font = "Iosevka"
        if roster.os == "windows" then font = "Cascadia Mono" end
        return { terminal = { font = font } }
        "#,
    );
    assert_eq!(
        load_as(&dir, config::Os::Windows).unwrap().terminal.font,
        "Cascadia Mono"
    );
    assert_eq!(load_as(&dir, config::Os::Linux).unwrap().terminal.font, "Iosevka");
}

#[test]
fn a_syntax_error_reports_file_and_line() {
    let dir = with_init("syntax", "return {\n  vim = false,\n  leader = ,\n}\n");
    let e = config::load(&dir).unwrap_err();
    assert_eq!(e.file, "init.lua");
    assert_eq!(e.line, Some(3));
    assert!(e.to_string().starts_with("init.lua:3: "), "{e}");
}

#[test]
fn a_runtime_error_reports_file_and_line() {
    let dir = with_init("runtime", "local t = nil\n\nreturn { vim = t.x }\n");
    let e = config::load(&dir).unwrap_err();
    assert_eq!((e.file.as_str(), e.line), ("init.lua", Some(3)), "{e}");
}

#[test]
fn a_schema_error_reports_file_line_and_the_field() {
    let dir = with_init(
        "schema",
        "return {\n  vim = false,\n  terminal = {\n    font = \"Iosevka\",\n    size = \"big\",\n  },\n}\n",
    );
    let e = config::load(&dir).unwrap_err();
    assert_eq!((e.file.as_str(), e.line), ("init.lua", Some(5)), "{e}");
    assert!(e.message.contains("terminal.size"), "{e}");
}

#[test]
fn a_misspelt_name_is_an_error_on_its_line() {
    let dir = with_init("typo", "return {\n  colors = {\n    acent = \"#ff0000\",\n  },\n}\n");
    let e = config::load(&dir).unwrap_err();
    assert_eq!(e.line, Some(3), "{e}");
    assert!(e.message.contains("acent"), "{e}");
}

#[test]
fn an_out_of_range_value_is_an_error_on_its_line() {
    let dir = with_init("range", "return {\n  terminal = { size = 400 },\n}\n");
    let e = config::load(&dir).unwrap_err();
    assert_eq!(e.line, Some(2), "{e}");
    assert!(e.message.contains("terminal.size"), "{e}");
}

#[test]
fn returning_something_other_than_a_table_is_an_error() {
    let dir = with_init("notable", "return 42\n");
    assert!(config::load(&dir).unwrap_err().message.contains("must return a table"));
}

#[test]
fn reload_keeps_the_last_good_config_on_error() {
    let dir = with_init("reload", "return { vim = false }");
    let mut loader = Loader::new(&dir);
    let first = loader.reload();
    assert!(first.error.is_none());
    assert!(!first.config.vim);

    std::fs::write(dir.join("init.lua"), "return { vim = false, leader = }").unwrap();
    let broken = loader.reload();
    assert_eq!(broken.error.as_ref().map(|e| e.line), Some(Some(1)));
    assert!(!broken.config.vim, "the last good Config stays");
    assert!(!loader.current().vim);

    std::fs::write(dir.join("init.lua"), "return { leader = \"Ctrl+b\" }").unwrap();
    let fixed = loader.reload();
    assert!(fixed.error.is_none());
    assert_eq!(fixed.config.leader, "Ctrl+b");
    assert!(
        fixed.config.vim,
        "back to the default once the file no longer says otherwise"
    );
}

/// Runs `expr` in init.lua and returns what it evaluated to, as the Config's `leader` string.
fn probe(name: &str, expr: &str) -> String {
    let dir = with_init(name, &format!("return {{ leader = tostring({expr}) }}"));
    config::load(&dir).unwrap().leader
}

#[test]
fn lua_gets_only_safe_libraries() {
    for (name, expr) in [
        ("io", "io"),
        ("execute", "os.execute"),
        ("getenv", "os.getenv"),
        ("remove", "os.remove"),
        ("exit", "os.exit"),
        ("debug", "debug"),
        ("package", "package"),
        ("dofile", "dofile"),
        ("loadfile", "loadfile"),
        ("dump", "string.dump"),
    ] {
        assert_eq!(probe(name, expr), "nil", "{expr} must not be there");
    }
    // What a Config needs is there.
    assert_eq!(probe("fmt", "string.format('%d', 7)"), "7");
    assert_eq!(probe("date", "type(os.date('%Y'))"), "string");
    assert_eq!(probe("floor", "math.floor(2.5)"), "2");
}

#[test]
fn load_refuses_bytecode() {
    // "\27Lua" starts a precompiled chunk.
    let v = probe("bytecode", r#"select(2, load("\27Lua\84\0"))"#);
    assert!(v.contains("binary") || v.contains("attempt to load"), "{v}");
    assert_eq!(probe("text", r#"load("return 1 + 1")()"#), "2");
}

#[test]
fn require_loads_modules_from_the_config_dir_only() {
    let dir = with_init(
        "require",
        r#"
        local keys = require("keys")
        local theme = require("themes.mine")
        return { leader = keys.leader, theme = theme }
        "#,
    );
    std::fs::write(dir.join("keys.lua"), r#"return { leader = "Ctrl+b" }"#).unwrap();
    std::fs::create_dir_all(dir.join("lua/themes")).unwrap();
    std::fs::write(dir.join("lua/themes/mine.lua"), r#"return "nord""#).unwrap();
    let config = config::load(&dir).unwrap();
    assert_eq!(config.leader, "Ctrl+b");
    assert_eq!(config.theme, "nord");

    for (name, module) in [
        ("escape", "../escape"),
        ("abs", "/etc/passwd"),
        ("os", "os"),
        ("dots", "a..b"),
    ] {
        let dir = with_init(&format!("req-{name}"), &format!("return require({module:?})"));
        let e = config::load(&dir).unwrap_err();
        assert_eq!(e.line, Some(1), "{e}");
    }
}

#[cfg(unix)]
#[test]
fn require_refuses_a_symlink_out_of_the_config_dir() {
    let outside = temp_dir("outside");
    std::fs::write(outside.join("secret.lua"), "return { leader = 'stolen' }").unwrap();
    let dir = with_init("symlink", "return require('secret')");
    std::os::unix::fs::symlink(outside.join("secret.lua"), dir.join("secret.lua")).unwrap();
    let e = config::load(&dir).unwrap_err();
    assert!(e.message.contains("outside the config dir"), "{e}");
}

#[test]
fn an_error_in_a_required_module_names_that_file() {
    let dir = with_init("req-err", "local k = require('keys')\nreturn {}\n");
    std::fs::write(dir.join("keys.lua"), "\n\nreturn { = }\n").unwrap();
    let e = config::load(&dir).unwrap_err();
    assert_eq!((e.file.as_str(), e.line), ("keys.lua", Some(3)), "{e}");
}

#[test]
fn an_endless_loop_runs_out_of_time() {
    let dir = with_init("loop", "local n = 0\nwhile true do n = n + 1 end\n");
    let env = config::Env {
        limits: config::Limits {
            time: std::time::Duration::from_millis(100),
            ..config::Limits::default()
        },
        ..config::Env::default()
    };
    let started = std::time::Instant::now();
    let e = config::load_with(&dir, &env).unwrap_err();
    assert!(started.elapsed() < std::time::Duration::from_secs(2));
    assert_eq!(e.line, Some(2), "{e}");
    assert!(e.message.contains("took longer"), "{e}");
}

#[test]
fn a_runaway_table_runs_out_of_memory() {
    let dir = with_init(
        "memory",
        "local t = {}\nfor i = 1, 1e9 do t[i] = string.rep('x', 1000) .. i end\n",
    );
    let env = config::Env {
        limits: config::Limits {
            memory: 8 * 1024 * 1024,
            ..config::Limits::default()
        },
        ..config::Env::default()
    };
    let e = config::load_with(&dir, &env).unwrap_err();
    assert!(e.message.contains("memory"), "{e}");
}

#[test]
fn the_roster_api_registers_keys_and_themes_with_their_lines() {
    let dir = with_init(
        "api",
        r##"local roster = require("roster")
roster.keymap.set("leader", "x", "close")
roster.keymap.set("global", "F12", "keys")
roster.themes.define("mine", { base = "nord", colors = { accent = "#ff8800" } })
return { theme = "mine" }
"##,
    );
    let config = config::load(&dir).unwrap();
    let keys: Vec<_> = config
        .keys
        .0
        .iter()
        .map(|b| (b.context, b.keys.as_str(), b.action.clone()))
        .collect();
    assert!(keys.contains(&(config::KeyContext::Leader, "x", config::KeyAction::Run("close".into()))));
    assert!(keys.contains(&(config::KeyContext::Global, "F12", config::KeyAction::Run("keys".into()))));
    assert_eq!(config.themes["mine"].colors.accent.as_deref(), Some("#ff8800"));
    assert_eq!(config.lines["keys.leader.x"].line, 2);
    assert_eq!(config.lines["themes.mine"].line, 4);
}

#[test]
fn a_bad_value_given_to_the_api_is_an_error_on_the_call_line() {
    let dir = with_init(
        "api-bad",
        "\nroster.themes.define('x', { colors = { nope = 'red' } })\nreturn {}\n",
    );
    let e = config::load(&dir).unwrap_err();
    assert_eq!(e.line, Some(2), "{e}");
    let dir = with_init("api-ctx", "roster.keymap.set('nowhere', 'x', 'close')\nreturn {}\n");
    assert_eq!(config::load(&dir).unwrap_err().line, Some(1));
}

#[test]
fn layouts_take_shorthands_and_keep_each_modes_defaults() {
    let dir = with_init(
        "modes",
        r#"return { modes = {
            standard = { sidebar = { side = "right", sections = { "folders", "sessions" } }, statusbar = { "backend", "hosts" } },
            focus = { sessionbar = "bottom" },
        } }"#,
    );
    let m = config::load(&dir).unwrap().modes;
    assert_eq!(m.standard.sidebar.side, config::Side::Right);
    assert_eq!(
        m.standard.sidebar.sections.as_deref(),
        Some(&["folders".to_string(), "sessions".to_string()][..])
    );
    assert_eq!(m.standard.statusbar.segments.as_ref().map(Vec::len), Some(2));
    assert!(m.standard.titlebar, "unset pieces keep the mode's default");
    assert!(m.focus.sessionbar.shown);
    assert_eq!(m.focus.sessionbar.at, config::Edge::Bottom);
    assert!(m.focus.fullscreen, "Focus stays fullscreen");
    assert!(!m.focus.statusbar.shown);

    let dir = with_init(
        "modes-off",
        "return { modes = { standard = { sidebar = false, statusbar = false, titlebar = false } } }",
    );
    let m = config::load(&dir).unwrap().modes;
    assert!(!m.standard.sidebar.shown && !m.standard.statusbar.shown && !m.standard.titlebar);
}

#[test]
fn folders_backend_and_roster_command() {
    let dir = with_init(
        "misc",
        r#"return {
            folders = { { name = "Lab ESXi", hosts = { "esxi-02", "esxi-03" } }, { name = "Empty", hosts = {} } },
            backend = "wsl:Ubuntu",
            roster_command = "uv run --project /home/me/roster roster",
        }"#,
    );
    let c = config::load(&dir).unwrap();
    assert_eq!(c.folders.len(), 2);
    assert_eq!(c.folders[0].hosts, ["esxi-02", "esxi-03"]);
    assert_eq!(c.lines["folders.Lab ESXi"].line, 2);
    assert_eq!(c.backend, config::BackendChoice::Wsl(Some("Ubuntu".into())));
    assert_eq!(c.roster_command.unwrap().0[..2], ["uv".to_string(), "run".to_string()]);
}

#[test]
fn the_config_dir_follows_the_platform() {
    use config::{Os, dir_for};
    use std::path::PathBuf;
    let env = |k: &str| match k {
        "APPDATA" => Some(PathBuf::from(r"C:\Users\me\AppData\Roaming")),
        "HOME" => Some(PathBuf::from("/home/me")),
        _ => None,
    };
    assert_eq!(
        dir_for(Os::Windows, env),
        Some(PathBuf::from(r"C:\Users\me\AppData\Roaming").join("roster-desk"))
    );
    assert_eq!(
        dir_for(Os::Linux, env),
        Some(PathBuf::from("/home/me/.config/roster-desk"))
    );
    let xdg = |k: &str| (k == "XDG_CONFIG_HOME").then(|| PathBuf::from("/x"));
    assert_eq!(dir_for(Os::Linux, xdg), Some(PathBuf::from("/x/roster-desk")));
}

#[test]
fn saving_calls_the_watcher_back_once_for_a_write_or_a_rename() {
    use std::sync::mpsc;
    use std::time::Duration;
    let dir = temp_dir("watch");
    let (tx, rx) = mpsc::channel();
    let _w = config::watch(&dir, move || {
        let _ = tx.send(());
    })
    .unwrap();
    // A first file appears.
    std::fs::write(dir.join("init.lua"), "return {}").unwrap();
    rx.recv_timeout(Duration::from_secs(3)).expect("a new init.lua is seen");
    // Vim-style: write a temp file, rename it over.
    std::fs::write(dir.join("init.lua.tmp"), "return { vim = false }").unwrap();
    std::fs::rename(dir.join("init.lua.tmp"), dir.join("init.lua")).unwrap();
    rx.recv_timeout(Duration::from_secs(3))
        .expect("a rename over init.lua is seen");
    // One save, one call.
    assert!(rx.recv_timeout(Duration::from_millis(400)).is_err());
    // Something else in the dir is ignored.
    std::fs::write(dir.join("notes.txt"), "hi").unwrap();
    assert!(rx.recv_timeout(Duration::from_millis(400)).is_err());
}

/// The defaults as the frontend gets them, kept in a file that src/config tests read, so the
/// Rust defaults and the TypeScript ones (src/keymap.ts, theme.ts, …) can't drift apart.
/// `UPDATE_FIXTURES=1 cargo test` rewrites it.
#[test]
fn the_defaults_fixture_is_current() {
    let names = serde_json::json!({
        "config": Config::default(),
        "themeColors": config::ThemeColors::NAMES,
        "themeTerminal": config::ThemeTerminalColors::NAMES,
        "ansi": config::Ansi::NAMES,
        "terminalColors": config::TerminalColors::NAMES,
    });
    let text = serde_json::to_string_pretty(&names).unwrap() + "\n";
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/config-defaults.json");
    if std::env::var_os("UPDATE_FIXTURES").is_some() {
        std::fs::write(&path, &text).unwrap();
    }
    let on_disk = std::fs::read_to_string(&path).unwrap_or_default();
    assert_eq!(
        on_disk,
        text,
        "run UPDATE_FIXTURES=1 cargo test to update {}",
        path.display()
    );
}

#[test]
fn the_env_vars_win_over_the_configs_backend_and_roster_command() {
    use config::{BackendChoice, RosterCommand, backend_plan};
    use desk_core::detect::Platform;
    let c = Config {
        roster_command: Some(RosterCommand(vec!["uv".into(), "run".into(), "roster".into()])),
        backend: BackendChoice::Wsl(Some("Ubuntu".into())),
        ..Config::default()
    };
    let plan = backend_plan(&c, Platform::Windows, None, None).unwrap();
    assert_eq!(plan.command, ["uv", "run", "roster"]);
    assert_eq!(plan.distro.as_deref(), Some("Ubuntu"));

    let plan = backend_plan(&c, Platform::Windows, Some("roster-dev serve-stack"), Some("Debian")).unwrap();
    assert_eq!(plan.command, ["roster-dev", "serve-stack"]);
    assert_eq!(plan.distro.as_deref(), Some("Debian"));

    // Blank env vars don't count.
    let plan = backend_plan(&Config::default(), Platform::Windows, Some("  "), Some("")).unwrap();
    assert_eq!(plan.command, ["roster"]);
    assert_eq!(plan.distro, None);

    // Native Windows roster is ticket 19.
    let local = Config {
        backend: BackendChoice::Local,
        ..Config::default()
    };
    assert!(
        backend_plan(&local, Platform::Windows, None, None)
            .unwrap_err()
            .contains("ticket 19")
    );
    assert!(backend_plan(&local, Platform::Linux, None, None).is_ok());
}

/// examples/init.lua documents every option with its default value, so loading it gives the
/// defaults (apart from the Themes it defines as examples).
#[test]
fn the_example_init_lua_loads_and_is_the_defaults() {
    let example = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/init.lua");
    let dir = with_init("example", &std::fs::read_to_string(example).unwrap());
    let mut config = config::load(&dir).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(config.themes.keys().collect::<Vec<_>>(), ["paper", "roster-ember"]);
    config.themes.clear();
    config.lines.clear();
    assert_eq!(config, Config::default());
}
