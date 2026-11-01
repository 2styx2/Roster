//! The Config (GLOSSARY: Config, ADR 0004): the user's `init.lua`, in the user config dir
//! (`%APPDATA%\roster` on Windows, `$XDG_CONFIG_HOME/roster` or `~/.config/roster` elsewhere;
//! a Config left in the old `roster-desk` dir is copied over once, see [`crate::migrate`]). It runs in a sandboxed Lua 5.4 (lua.rs), returns a
//! table that's checked against the schema (schema.rs) and layered over the defaults, and the
//! result goes to the frontend as one typed object. The frontend never runs Lua.
//!
//! Errors, Lua or schema, come back with the file and line. [`Loader`] keeps the last good
//! Config, so a typo while editing never takes the app's keys or colours away. [`watch`] calls
//! back when a `.lua` file in the dir changes, for live reload.

pub(crate) mod editor;
pub mod folders;
mod locate;
pub(crate) mod lua;
pub mod schema;
mod watch;

pub use editor::{Ensured, OpenWith, WindowsOpen, ensure_file, open, open_with, starter, windows_open};
pub use schema::*;
pub use watch::{Watcher, watch};

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// The file the app runs.
pub const FILE_NAME: &str = "init.lua";
/// The version of the `roster` Lua table (`roster.api_version`), raised when it changes.
pub const API_VERSION: u32 = 3;

/// What went wrong: where, and what. Shown as `init.lua:12: message`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ConfigError {
    /// Relative to the config dir: `init.lua`, `lua/keys.lua`.
    pub file: String,
    pub line: Option<u32>,
    pub message: String,
    /// The schema path of a value that's wrong (`terminal.size`), for finding its line.
    #[serde(skip)]
    pub path: Vec<String>,
}

impl ConfigError {
    fn new(line: Option<u32>, message: String) -> Self {
        ConfigError {
            file: FILE_NAME.into(),
            line,
            message,
            path: Vec::new(),
        }
    }
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.line {
            Some(line) => write!(f, "{}:{line}: {}", self.file, self.message),
            None => write!(f, "{}: {}", self.file, self.message),
        }
    }
}

impl std::error::Error for ConfigError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Windows,
    Linux,
    Macos,
}

impl Os {
    pub fn current() -> Self {
        if cfg!(windows) {
            Os::Windows
        } else if cfg!(target_os = "macos") {
            Os::Macos
        } else {
            Os::Linux
        }
    }

    /// `roster.os` in Lua.
    pub fn as_str(self) -> &'static str {
        match self {
            Os::Windows => "windows",
            Os::Linux => "linux",
            Os::Macos => "macos",
        }
    }
}

/// How long `init.lua` (with everything it requires) may run, and how much memory it may use.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// Lua run time, checked between instructions.
    pub time: Duration,
    /// Wall-clock time for the whole load, checked by a watchdog: it also covers one long C call
    /// (a pattern that backtracks), which the instruction check can't interrupt.
    pub wall: Duration,
    pub memory: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            time: Duration::from_secs(1),
            wall: Duration::from_secs(2),
            memory: 64 * 1024 * 1024,
        }
    }
}

/// What the Lua code can see of the machine, and its limits.
#[derive(Debug, Clone, Copy)]
pub struct Env {
    pub os: Os,
    pub limits: Limits,
}

impl Default for Env {
    fn default() -> Self {
        Env {
            os: Os::current(),
            limits: Limits::default(),
        }
    }
}

/// The config dir's name inside the user config dir.
pub const DIR_NAME: &str = "roster";

/// The config dir's name from when the app was roster-desk ([`crate::migrate`]).
pub const LEGACY_DIR_NAME: &str = "roster-desk";

/// The config dir: `%APPDATA%\roster` on Windows; `$XDG_CONFIG_HOME/roster`, else
/// `~/.config/roster`. None when the environment names no home at all.
pub fn dir() -> Option<PathBuf> {
    dir_for(Os::current(), system_var)
}

/// [`dir`] for any OS and environment (testable).
pub fn dir_for(os: Os, var: impl Fn(&str) -> Option<PathBuf>) -> Option<PathBuf> {
    Some(base_for(os, var)?.join(DIR_NAME))
}

/// Where roster-desk kept its Config: `roster-desk` next to [`dir`].
pub fn legacy_dir() -> Option<PathBuf> {
    legacy_dir_for(Os::current(), system_var)
}

/// [`legacy_dir`] for any OS and environment (testable).
pub fn legacy_dir_for(os: Os, var: impl Fn(&str) -> Option<PathBuf>) -> Option<PathBuf> {
    Some(base_for(os, var)?.join(LEGACY_DIR_NAME))
}

fn base_for(os: Os, var: impl Fn(&str) -> Option<PathBuf>) -> Option<PathBuf> {
    match os {
        Os::Windows => var("APPDATA"),
        Os::Linux | Os::Macos => var("XDG_CONFIG_HOME").or_else(|| var("HOME").map(|h| h.join(".config"))),
    }
}

fn system_var(k: &str) -> Option<PathBuf> {
    std::env::var_os(k).filter(|v| !v.is_empty()).map(PathBuf::from)
}

/// The Config in `dir`: the defaults if there's no `init.lua`.
pub fn load(dir: &Path) -> Result<Config, ConfigError> {
    load_with(dir, &Env::default())
}

pub fn load_with(dir: &Path, env: &Env) -> Result<Config, ConfigError> {
    let path = dir.join(FILE_NAME);
    let source = match std::fs::read(&path) {
        Ok(bytes) => {
            String::from_utf8(bytes).map_err(|_| ConfigError::new(None, "init.lua isn't UTF-8 text".into()))?
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Config::default()),
        Err(e) => return Err(ConfigError::new(None, format!("can't read {}: {e}", path.display()))),
    };
    load_source(dir, &source, env)
}

/// The table `source` (as `dir`'s init.lua) returns itself, without what its `roster.*` calls
/// registered: which options the file sets in its own table (they win over `roster.set`).
pub fn returned_table(dir: &Path, source: &str) -> Result<serde_json::Value, ConfigError> {
    lua::run(dir, source, &Env::default())
        .map(|o| o.value)
        .map_err(|e| place(e, source, &[]))
}

/// The Config `source` gives as `dir`'s init.lua, without reading the file.
pub fn load_source(dir: &Path, source: &str, env: &Env) -> Result<Config, ConfigError> {
    load_source_renaming(dir, source, env, DEPRECATED_OPTIONS)
}

/// [`load_source`], with `renamed` as the deprecated options (tests pass their own).
pub fn load_source_renaming(dir: &Path, source: &str, env: &Env, renamed: &[Renamed]) -> Result<Config, ConfigError> {
    let source = source.to_string();
    let out = lua::run(dir, &source, env).map_err(|e| place(e, &source, &[]))?;

    // The API's registrations, under what the returned table sets itself (the table wins).
    let mut value = out.value;
    for entry in &out.api {
        set_if_absent(&mut value, &entry.path, entry.value.clone());
    }
    // A deprecated option moves to its new name (which wins when both are set), before the schema
    // check would call it unknown.
    let used = rename_deprecated(&mut value, renamed);
    let api_lines: Vec<(Vec<String>, Location)> = out
        .api
        .iter()
        .filter_map(|e| e.at.clone().map(|at| (e.path.clone(), at)))
        .collect();

    let mut config: Config = serde_path_to_error::deserialize(&value).map_err(|e| {
        let mut path: Vec<String> = e.path().iter().filter_map(segment).collect();
        let inner = e.inner().to_string();
        // "unknown field `acent`": point at that field.
        if let Some(name) = inner.strip_prefix("unknown field `").and_then(|r| r.split('`').next())
            && path.last().map(String::as_str) != Some(name)
        {
            path.push(name.to_string());
        }
        let message = located_message(&path, &shorten(&inner));
        place(
            ConfigError {
                file: FILE_NAME.into(),
                line: None,
                message,
                path,
            },
            &source,
            &api_lines,
        )
    })?;
    if let Err((path, message)) = validate(&config) {
        let message = located_message(&path, &message);
        return Err(place(
            ConfigError {
                file: FILE_NAME.into(),
                line: None,
                message,
                path,
            },
            &source,
            &api_lines,
        ));
    }
    config.set = set_paths(&value);
    config.lines = lines(&config, &source, &api_lines);
    for r in used {
        let path: Vec<String> = r.old.split('.').map(str::to_string).collect();
        if let Some(line) = locate::line_of(&source, &path) {
            config.lines.insert(
                r.old.to_string(),
                Location {
                    file: FILE_NAME.into(),
                    line,
                },
            );
        }
        config.deprecated.push(DeprecatedUse {
            old: r.old.into(),
            new: r.new.into(),
            topic: format!("deprecated#{}", anchor(r.old)),
        });
    }
    Ok(config)
}

/// Moves each deprecated option `value` sets to its new name, unless that's set too; returns the
/// ones it set.
fn rename_deprecated(value: &mut serde_json::Value, renamed: &[Renamed]) -> Vec<Renamed> {
    let mut used = Vec::new();
    for r in renamed {
        let path: Vec<&str> = r.old.split('.').collect();
        let Some((last, parents)) = path.split_last() else {
            continue;
        };
        let parent: String = parents.iter().map(|k| format!("/{k}")).collect();
        let taken = value
            .pointer_mut(&parent)
            .and_then(serde_json::Value::as_object_mut)
            .and_then(|m| m.remove(*last));
        if let Some(v) = taken {
            let new: Vec<String> = r.new.split('.').map(str::to_string).collect();
            set_if_absent(value, &new, v);
            used.push(*r);
        }
    }
    used
}

/// A docs/deprecated.md row's anchor for an old name, as the app's help makes it (doc.ts `slug`):
/// lower case, only letters, digits, `_` and `-`.
fn anchor(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
        .collect()
}

/// Every value's path in what the file returned (with its `roster.*` calls), sorted: a table is
/// followed down, anything else (a list included) is one value.
fn set_paths(value: &serde_json::Value) -> Vec<String> {
    fn walk(v: &serde_json::Value, path: &mut Vec<String>, out: &mut Vec<String>) {
        match v {
            serde_json::Value::Object(map) if !map.is_empty() => {
                for (k, child) in map {
                    path.push(k.clone());
                    walk(child, path, out);
                    path.pop();
                }
            }
            _ if !path.is_empty() => out.push(path.join(".")),
            _ => {}
        }
    }
    let mut out = Vec::new();
    walk(value, &mut Vec::new(), &mut out);
    out.sort();
    out
}

/// `terminal.size: message`, or just the message when there's no path.
pub(crate) fn located_message(path: &[String], message: &str) -> String {
    if path.is_empty() {
        message.to_string()
    } else {
        format!("{}: {message}", path.join("."))
    }
}

/// serde's "expected one of `a`, `b`, …" lists every name; the docs have them, so keep it short.
fn shorten(message: &str) -> String {
    let m = match message.split_once(", expected one of") {
        Some((head, _)) => format!("{head} (see docs/app/config.md for the names)"),
        None => message.to_string(),
    };
    m.replace("expected u32", "expected a whole number")
        .replace("expected f64", "expected a number")
        .replace("integer `", "number `")
        .replace("floating point `", "number `")
}

fn segment(s: &serde_path_to_error::Segment) -> Option<String> {
    match s {
        serde_path_to_error::Segment::Map { key } => Some(key.clone()),
        serde_path_to_error::Segment::Seq { index } => Some((index + 1).to_string()),
        _ => None,
    }
}

/// Gives a schema error its line: from the API call that set the value, else by finding the
/// key in `init.lua`.
fn place(mut e: ConfigError, source: &str, api: &[(Vec<String>, Location)]) -> ConfigError {
    if e.line.is_some() || e.path.is_empty() {
        return e;
    }
    // The call that set the value, or set something under the bad key (an unknown context).
    let related = |p: &Vec<String>| e.path.starts_with(p) || p.starts_with(&e.path);
    if let Some((_, at)) = api.iter().filter(|(p, _)| related(p)).max_by_key(|(p, _)| p.len()) {
        e.file = at.file.clone();
        e.line = Some(at.line);
        return e;
    }
    e.line = locate::line_of(source, &e.path);
    e
}

fn set_if_absent(root: &mut serde_json::Value, path: &[String], value: serde_json::Value) {
    let mut node = root;
    for (i, key) in path.iter().enumerate() {
        let serde_json::Value::Object(map) = node else { return };
        if i == path.len() - 1 {
            map.entry(key.clone()).or_insert(value);
            return;
        }
        node = map
            .entry(key.clone())
            .or_insert_with(|| serde_json::Value::Object(Default::default()));
    }
}

type Invalid = (Vec<String>, String);

fn at(path: &[&str], message: impl Into<String>) -> Invalid {
    (path.iter().map(|s| s.to_string()).collect(), message.into())
}

/// What the schema's types can't say: ranges, non-empty names, unique Folders.
fn validate(c: &Config) -> Result<(), Invalid> {
    // A Windows path for the KeePassXC files is right only for roster running natively on Windows.
    if c.backend != BackendChoice::Local {
        let kp = &c.vault.kp;
        for (field, value) in [("database", &kp.database), ("key_file", &kp.key_file)] {
            if let Some(hint) = value.as_deref().and_then(schema::windows_path) {
                return Err(at(
                    &["vault", "kp", field],
                    format!(
                        "{value:?} is a Windows path, but roster runs in WSL (or on Linux): {hint}. With \
                         backend = \"local\" (roster on Windows itself) a Windows path is the one to give",
                        value = value.as_deref().unwrap_or_default()
                    ),
                ));
            }
        }
    }
    if !(11..=20).contains(&c.fonts.ui_size) {
        return Err(at(
            &["fonts", "ui_size"],
            format!("{} is out of range (11 to 20)", c.fonts.ui_size),
        ));
    }
    let t = &c.terminal;
    let px = t.size.px();
    if !(6.0..=72.0).contains(&px) {
        let shown = match t.size {
            FontSize::Px(v) => format!("{v}"),
            FontSize::Pt(v) => format!("{v}pt"),
        };
        return Err(at(
            &["terminal", "size"],
            format!("{shown} is out of range (6 to 72 px, 4.5 to 54 pt)"),
        ));
    }
    if t.font.0.is_empty() || t.font.0.iter().any(|f| f.is_empty()) {
        return Err(at(&["terminal", "font"], "needs at least one font name"));
    }
    if let Some(h) = t.cell_height
        && !(0.5..=3.0).contains(&h)
    {
        return Err(at(
            &["terminal", "cell_height"],
            format!("{h} is out of range (0.5 to 3)"),
        ));
    }
    for (name, w) in [("weight", t.weight), ("bold_weight", t.bold_weight)] {
        if !(100..=900).contains(&w) {
            return Err(at(&["terminal", name], format!("{w} is out of range (100 to 900)")));
        }
    }
    if !(0.5..=3.0).contains(&t.line_height) {
        return Err(at(
            &["terminal", "line_height"],
            format!("{} is out of range (0.5 to 3)", t.line_height),
        ));
    }
    if t.scrollback > 1_000_000 {
        return Err(at(&["terminal", "scrollback"], "at most 1000000 lines"));
    }
    if !(1..=1440).contains(&c.idle_lock_minutes) {
        return Err(at(
            &["idle_lock_minutes"],
            format!("{} is out of range (1 to 1440)", c.idle_lock_minutes),
        ));
    }
    if let Some(w) = c.panel.width
        && !(10..=95).contains(&w)
    {
        return Err(at(
            &["panel", "width"],
            format!("{w} is out of range (10 to 95, percent of the window)"),
        ));
    }
    for (id, v) in &c.views {
        if id.is_empty() || id.len() > 64 || !id.chars().all(|ch| ch.is_ascii_alphanumeric() || "-_".contains(ch)) {
            return Err(at(
                &["views", id],
                format!("{id:?} isn't a panel or view id (letters, digits, - and _)"),
            ));
        }
        if let Some(w) = v.width
            && !(10..=95).contains(&w)
        {
            return Err(at(
                &["views", id, "width"],
                format!("{w} is out of range (10 to 95, percent of the window)"),
            ));
        }
    }
    if c.pull_fresh_minutes > 1440 {
        return Err(at(
            &["pull_fresh_minutes"],
            format!("{} is out of range (0 to 1440)", c.pull_fresh_minutes),
        ));
    }
    for (path, v) in [
        (&["leader"][..], &c.leader),
        (&["theme"][..], &c.theme),
        (&["dark_theme"][..], &c.dark_theme),
        (&["light_theme"][..], &c.light_theme),
        (&["fonts", "ui"][..], &c.fonts.ui),
        (&["fonts", "mono"][..], &c.fonts.mono),
    ] {
        if v.trim().is_empty() {
            return Err(at(path, "can't be empty"));
        }
    }
    for id in c.themes.keys() {
        if id.trim().is_empty() || id == "auto" {
            return Err(at(&["themes", id], "a Theme needs an id other than \"auto\""));
        }
    }
    if let Some(command) = &c.roster_command {
        command.check().map_err(|m| at(&["roster_command"], m))?;
    }
    crate::package::check_specs(&c.packages)?;
    let mut seen = std::collections::HashSet::new();
    for (i, f) in c.folders.iter().enumerate() {
        let n = (i + 1).to_string();
        if f.name.trim().is_empty() {
            return Err(at(&["folders", &n, "name"], "a Folder needs a name"));
        }
        if f.name.contains('"') {
            return Err(at(
                &["folders", &n, "name"],
                "a Folder name can't contain a double quote",
            ));
        }
        if !seen.insert(f.name.trim().to_lowercase()) {
            return Err(at(
                &["folders", &n, "name"],
                format!("there's already a Folder named {}", f.name),
            ));
        }
    }
    Ok(())
}

/// Where each key binding, Theme, Folder and other value was set, for the frontend's warnings
/// and `:help options`.
fn lines(c: &Config, source: &str, api: &[(Vec<String>, Location)]) -> std::collections::BTreeMap<String, Location> {
    let mut out = std::collections::BTreeMap::new();
    let mut put = |path: Vec<String>, found: Option<u32>| {
        let key = path.join(".");
        if let Some((_, at)) = api.iter().find(|(p, _)| *p == path) {
            out.insert(key, at.clone());
        } else if let Some(line) = found {
            out.insert(
                key,
                Location {
                    file: FILE_NAME.into(),
                    line,
                },
            );
        }
    };
    for b in &c.keys.0 {
        let path = vec!["keys".to_string(), b.context.lua_name().to_string(), b.keys.clone()];
        let found = locate::line_of(source, &path);
        put(path, found);
    }
    for id in c.themes.keys() {
        let path = vec!["themes".to_string(), id.clone()];
        let found = locate::line_of(source, &path);
        put(path, found);
    }
    // Every other value the file set (`:help options` names its line, ticket 37).
    for p in &c.set {
        // Key bindings, Themes and Folders have their own lines, by name (below and above).
        if p == "folders" || p.starts_with("keys.") || p.starts_with("themes.") {
            continue;
        }
        let path: Vec<String> = p.split('.').map(str::to_string).collect();
        let found = locate::line_of(source, &path);
        put(path, found);
    }
    for f in &c.folders {
        let found = locate::line_of_text(source, &format!("\"{}\"", f.name))
            .or_else(|| locate::line_of_text(source, &format!("'{}'", f.name)));
        put(vec!["folders".to_string(), f.name.clone()], found);
    }
    out
}

/// What a load gave: the Config in effect, and the error if the file couldn't be used.
#[derive(Debug, Clone, Serialize)]
pub struct Report {
    pub config: Config,
    pub error: Option<ConfigError>,
    /// The file's full path, for messages ("edit C:\Users\…\init.lua").
    pub path: String,
    /// Counts the reloads, from 1: the frontend keeps the highest it has seen, so a report that
    /// arrives late (a startup load after a save's event) never replaces a newer one.
    pub version: u64,
}

/// Loads and reloads the Config in one dir, keeping the last good one. Shared between threads:
/// reading ([`Loader::current`], [`Loader::last`]) never waits for a reload, because Lua runs
/// outside the locks that reading takes; the result is swapped in when it's done. Reloads run
/// one at a time, so they finish in the order they started.
pub struct Loader {
    dir: PathBuf,
    env: Env,
    /// The Config in effect and the last report. Held only to clone or swap, never across Lua.
    current: Mutex<(Arc<Config>, Option<Report>)>,
    /// Held for a whole reload: only reloads and [`Loader::settled`] take it.
    loading: Mutex<()>,
}

impl Loader {
    /// Starts with the defaults; call [`Loader::reload`] to read the file.
    pub fn new(dir: &Path) -> Self {
        Self::with_env(dir, Env::default())
    }

    pub fn with_env(dir: &Path, env: Env) -> Self {
        Loader {
            dir: dir.to_path_buf(),
            env,
            current: Mutex::new((Arc::new(Config::default()), None)),
            loading: Mutex::new(()),
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// The Config in effect (the defaults before the first load). Never waits.
    pub fn current(&self) -> Arc<Config> {
        Arc::clone(&lock(&self.current).0)
    }

    /// The last reload's report, None before the first one is done. Never waits.
    pub fn last(&self) -> Option<Report> {
        lock(&self.current).1.clone()
    }

    /// The Config in effect once any reload in progress is done. Waits for it (at most the
    /// Lua wall-clock limit): call it from a blocking thread.
    pub fn settled(&self) -> Arc<Config> {
        let _done = lock(&self.loading);
        self.current()
    }

    /// The last report once any reload in progress is done; see [`Loader::settled`].
    pub fn settled_report(&self) -> Option<Report> {
        let _done = lock(&self.loading);
        self.last()
    }

    /// Reads the file again. On an error the last good Config stays in effect. Blocks for the
    /// Lua run (at most the wall-clock limit), without holding up readers.
    pub fn reload(&self) -> Report {
        let _loading = lock(&self.loading);
        let result = load_with(&self.dir, &self.env);
        let mut current = lock(&self.current);
        let error = match result {
            Ok(config) => {
                current.0 = Arc::new(config);
                None
            }
            Err(e) => Some(e),
        };
        let report = Report {
            config: (*current.0).clone(),
            error,
            path: self.dir.join(FILE_NAME).display().to_string(),
            version: current.1.as_ref().map_or(1, |r| r.version + 1),
        };
        current.1 = Some(report.clone());
        report
    }

    /// A `.lua` file of the Config was saved: reloads only if the Config in effect says
    /// `auto_reload = true` (decision Q58), else None and nothing changes (`:source` reloads).
    /// Turning auto_reload on therefore takes one `:source`.
    pub fn on_save(&self) -> Option<Report> {
        self.current().auto_reload.then(|| self.reload())
    }

    /// Reloads on a thread of its own and waits at most `wait` for it: the report if it was
    /// done by then, else None. `then` gets the report when it's done, either way (at startup:
    /// the window shows without waiting long, and a slow Config arrives as a change).
    pub fn reload_within(
        self: &Arc<Self>,
        wait: Duration,
        then: impl FnOnce(Report) + Send + 'static,
    ) -> Option<Report> {
        let (tx, rx) = std::sync::mpsc::channel();
        let me = Arc::clone(self);
        std::thread::spawn(move || {
            let report = me.reload();
            let _ = tx.send(report.clone());
            then(report);
        });
        rx.recv_timeout(wait).ok()
    }
}

/// A poisoned lock still holds a usable value here (a Config or a report).
fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Which roster to start, from the Config and the development env vars.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendPlan {
    pub command: Vec<String>,
    /// Where to look for it (detect.rs): init.lua's `backend`, or the one WSL distro the env var names.
    pub choice: crate::detect::Choice,
}

impl BackendPlan {
    /// The one WSL distro to use, if the plan names one.
    pub fn distro(&self) -> Option<&str> {
        match &self.choice {
            crate::detect::Choice::Wsl(Some(d)) => Some(d),
            _ => None,
        }
    }
}

/// The roster command and where to look for it: `ROSTER_APP_ROSTER` and `ROSTER_APP_WSL_DISTRO`
/// win (they're for development, and set by the user outside the Config), then `roster_command`
/// and `backend` from init.lua, then detection. Blank env vars don't count. A `roster_command`
/// that isn't roster itself is refused ([`RosterCommand::check`]); only the env var may wrap it.
/// The plan is what the app compares after a `:source`: a different one restarts `roster serve`.
pub fn backend_plan(
    config: &Config,
    _platform: crate::detect::Platform,
    env_command: Option<&str>,
    env_distro: Option<&str>,
) -> Result<BackendPlan, String> {
    use crate::detect::Choice;
    let env_command = env_command.filter(|v| !v.trim().is_empty());
    let command = match (env_command, &config.roster_command) {
        (None, Some(command)) => {
            command
                .check()
                .map_err(|m| format!("roster_command in init.lua: {m}."))?;
            command.0.clone()
        }
        (given, _) => crate::detect::roster_command(given),
    };
    let choice = match env_distro.map(str::trim).filter(|d| !d.is_empty()) {
        Some(d) => Choice::Wsl(Some(d.to_string())),
        None => match &config.backend {
            BackendChoice::Auto => Choice::Auto,
            BackendChoice::Local => Choice::Local,
            BackendChoice::Wsl(d) => Choice::Wsl(d.clone()),
        },
    };
    Ok(BackendPlan { command, choice })
}

/// Replaces `path` with `text` all at once: a temporary file in the same folder, given the old
/// file's permissions, then renamed over it. A reader (or the Config watcher) sees the old file
/// or the new one, never half of it, and a failed write leaves the old one.
pub fn write_atomic(path: &Path, text: &str) -> std::io::Result<()> {
    let dir = path.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir)?;
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let tmp = dir.join(format!(".{name}.{}.tmp", std::process::id()));
    let written = std::fs::write(&tmp, text).and_then(|()| {
        if let Ok(meta) = std::fs::metadata(path) {
            std::fs::set_permissions(&tmp, meta.permissions())?;
        }
        std::fs::rename(&tmp, path)
    });
    if written.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    written
}
