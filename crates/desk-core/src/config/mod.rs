//! The Config (GLOSSARY: Config, ADR 0002): the user's `init.lua`, in the user config dir
//! (`%APPDATA%\roster-desk` on Windows, `$XDG_CONFIG_HOME/roster-desk` or
//! `~/.config/roster-desk` elsewhere). It runs in a sandboxed Lua 5.4 (lua.rs), returns a
//! table that's checked against the schema (schema.rs) and layered over the defaults, and the
//! result goes to the frontend as one typed object. The frontend never runs Lua.
//!
//! Errors, Lua or schema, come back with the file and line. [`Loader`] keeps the last good
//! Config, so a typo while editing never takes the app's keys or colours away. [`watch`] calls
//! back when a `.lua` file in the dir changes, for live reload.

mod locate;
mod lua;
pub mod schema;
mod watch;

pub use schema::*;
pub use watch::{Watcher, watch};

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// The file the app runs.
pub const FILE_NAME: &str = "init.lua";
/// The version of the `roster` Lua table (`roster.api_version`), raised when it changes.
pub const API_VERSION: u32 = 1;

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
    pub time: Duration,
    pub memory: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            time: Duration::from_secs(1),
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

/// The config dir: `%APPDATA%\roster-desk` on Windows; `$XDG_CONFIG_HOME/roster-desk`, else
/// `~/.config/roster-desk`. None when the environment names no home at all.
pub fn dir() -> Option<PathBuf> {
    dir_for(Os::current(), |k| {
        std::env::var_os(k).filter(|v| !v.is_empty()).map(PathBuf::from)
    })
}

/// [`dir`] for any OS and environment (testable).
pub fn dir_for(os: Os, var: impl Fn(&str) -> Option<PathBuf>) -> Option<PathBuf> {
    let base = match os {
        Os::Windows => var("APPDATA")?,
        Os::Linux | Os::Macos => var("XDG_CONFIG_HOME").or_else(|| var("HOME").map(|h| h.join(".config")))?,
    };
    Some(base.join("roster-desk"))
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
    let out = lua::run(dir, &source, env).map_err(|e| place(e, &source, &[]))?;

    // The API's registrations, under what the returned table sets itself (the table wins).
    let mut value = out.value;
    for entry in &out.api {
        set_if_absent(&mut value, &entry.path, entry.value.clone());
    }
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
    config.lines = lines(&config, &source, &api_lines);
    Ok(config)
}

fn located_message(path: &[String], message: &str) -> String {
    if path.is_empty() {
        message.to_string()
    } else {
        format!("{}: {message}", path.join("."))
    }
}

/// serde's "expected one of `a`, `b`, …" lists every name; the docs have them, so keep it short.
fn shorten(message: &str) -> String {
    let m = match message.split_once(", expected one of") {
        Some((head, _)) => format!("{head} (see docs/config.md for the names)"),
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
    let t = &c.terminal;
    if !(6..=40).contains(&t.size) {
        return Err(at(
            &["terminal", "size"],
            format!("{} is out of range (6 to 40)", t.size),
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
    for (path, v) in [
        (&["leader"][..], &c.leader),
        (&["theme"][..], &c.theme),
        (&["dark_theme"][..], &c.dark_theme),
        (&["light_theme"][..], &c.light_theme),
        (&["fonts", "ui"][..], &c.fonts.ui),
        (&["fonts", "mono"][..], &c.fonts.mono),
        (&["terminal", "font"][..], &t.font),
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

/// Where each key binding, Theme and Folder was set, for the frontend's warnings.
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
}

/// Loads and reloads the Config in one dir, keeping the last good one.
pub struct Loader {
    dir: PathBuf,
    env: Env,
    current: Config,
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
            current: Config::default(),
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// The Config in effect.
    pub fn current(&self) -> &Config {
        &self.current
    }

    /// Reads the file again. On an error the last good Config stays in effect.
    pub fn reload(&mut self) -> Report {
        let error = match load_with(&self.dir, &self.env) {
            Ok(config) => {
                self.current = config;
                None
            }
            Err(e) => Some(e),
        };
        Report {
            config: self.current.clone(),
            error,
            path: self.dir.join(FILE_NAME).display().to_string(),
        }
    }
}

/// Which roster to start, from the Config and the development env vars.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendPlan {
    pub command: Vec<String>,
    /// The one WSL distro to use (Windows), or None to detect.
    pub distro: Option<String>,
}

/// The roster command and WSL distro: `ROSTER_DESK_ROSTER` and `ROSTER_DESK_WSL_DISTRO` win
/// (they're for development), then `roster_command` and `backend` from init.lua, then
/// detection. Blank env vars don't count.
pub fn backend_plan(
    config: &Config,
    platform: crate::detect::Platform,
    env_command: Option<&str>,
    env_distro: Option<&str>,
) -> Result<BackendPlan, String> {
    let env_command = env_command.filter(|v| !v.trim().is_empty());
    let command = match (env_command, &config.roster_command) {
        (None, Some(RosterCommand(words))) => words.clone(),
        (given, _) => crate::detect::roster_command(given),
    };
    if platform == crate::detect::Platform::Windows && config.backend == BackendChoice::Local {
        return Err(
            "backend = \"local\" needs roster running natively on Windows, which comes with \
                    ticket 19. Use \"auto\" or \"wsl:<distro>\" in init.lua for now."
                .into(),
        );
    }
    let distro = env_distro
        .map(str::trim)
        .filter(|d| !d.is_empty())
        .or(config.backend.distro())
        .map(String::from);
    Ok(BackendPlan { command, distro })
}
