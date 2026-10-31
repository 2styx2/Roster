//! Plugins (ADR 0006, decisions Q81 and Q82; docs/plugins.md): Lua code in a folder of its own,
//! run in the same sandbox as `init.lua`, that adds to the app's registries through the versioned
//! `roster` module. A Plugin is a folder with `roster-plugin.lua` (the manifest: name, version,
//! permissions) and `init.lua` (the code, which may `require` its own modules).
//!
//! [`PluginHost`] is the whole interface: [`PluginHost::load`] a folder with the permissions the
//! user granted, then [`PluginHost::call`] a function it handed over, or send every Plugin an
//! [`Event`]. Each answer is a [`Reply`]: what the call returned, and the UI changes it asked for
//! (ops: plain data the frontend draws with its own primitives, never HTML).
//!
//! Isolation: every Plugin has its own Lua state on its own thread, a memory limit, and a time
//! budget for each call. An error comes back naming the Plugin, file and line; an error while
//! loading disables the Plugin, and so does the third error after it loaded (repeat offenders).
//! A Plugin stuck in one long C call is abandoned after the wall-clock limit and disabled, so a
//! slow Plugin delays nothing but itself.
//!
//! Secrets: the Rust core never holds one, and a Plugin reaches roster only through [`Serve`],
//! for the methods its permissions name ([`permission`]); none of those touches a password, a
//! vault session or an askpass token.
//!
//! Where a folder comes from is the caller's business: a local folder (`:plugins install PATH`),
//! or a Package's clone (ticket 24, [`crate::package`]), which loads through
//! [`PluginHost::load_with`] to get its settings from init.lua.

pub mod permission;
mod runtime;

use crate::config::lua;
pub use permission::Permission;
pub use runtime::EVENTS;
use serde::Serialize;
use serde_json::Value as Json;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// The version of the `roster` Lua module (`roster.api_version`), shared with `init.lua`'s.
pub const API_VERSION: u32 = crate::config::API_VERSION;

/// Where a Plugin's code comes from. A Package (ticket 24) is a [`Source::Dir`] too: its clone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Source {
    /// A folder on this machine with `roster-plugin.lua` and `init.lua`.
    Dir(PathBuf),
    /// A built-in feature written as a Plugin, by name ([`BUNDLED`]).
    Bundled(String),
}

/// A built-in feature written on the public API, compiled into the app.
pub struct Bundled {
    pub name: &'static str,
    manifest: &'static str,
    init: &'static str,
}

/// The built-in Plugins: the status bar's Host count, so far (decision Q82).
pub const BUNDLED: &[Bundled] = &[Bundled {
    name: "hosts",
    manifest: include_str!("../../plugins/hosts/roster-plugin.lua"),
    init: include_str!("../../plugins/hosts/init.lua"),
}];

/// The manifest's file name, in the Plugin's folder.
pub const MANIFEST: &str = "roster-plugin.lua";
/// The Plugin's code, in its folder.
pub const ENTRY: &str = "init.lua";

/// How a Plugin reaches `roster serve`. The Tauri shell's adapter calls the running Backend;
/// tests use a fake. The host only ever asks for the methods a Plugin was granted.
pub trait Serve: Send + Sync {
    fn call(&self, method: &str, params: Json) -> Result<Json, String>;
}

/// Something that happened in the app, for the Plugins that listen ([`EVENTS`]).
#[derive(Debug, Clone)]
pub struct Event {
    pub name: String,
    pub payload: Json,
}

/// What went wrong in a Plugin: shown as `recent-alerts: init.lua:12: message`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PluginError {
    pub plugin: String,
    pub file: Option<String>,
    pub line: Option<u32>,
    pub message: String,
}

impl PluginError {
    pub fn new(plugin: &str, file: Option<String>, line: Option<u32>, message: String) -> Self {
        PluginError {
            plugin: plugin.to_string(),
            file,
            line,
            message,
        }
    }
}

impl std::fmt::Display for PluginError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: ", self.plugin)?;
        match (&self.file, self.line) {
            (Some(file), Some(line)) => write!(f, "{file}:{line}: ")?,
            (Some(file), None) => write!(f, "{file}: ")?,
            _ => {}
        }
        f.write_str(&self.message)
    }
}

impl std::error::Error for PluginError {}

/// One call's result inside the Plugin's thread.
pub(crate) struct Outcome {
    pub result: Json,
    pub ops: Vec<Json>,
    pub error: Option<PluginError>,
    /// The function called was already replaced: not the Plugin's fault.
    pub stale: bool,
}

/// The answer to a load, a call or an event, for one Plugin.
#[derive(Debug, Clone, Serialize)]
pub struct Reply {
    pub plugin: String,
    /// What the function returned, as data (a finder's items, say).
    pub result: Json,
    /// The UI changes the Plugin asked for, in order (docs/plugins.md, "Ops").
    pub ops: Vec<Json>,
    pub error: Option<PluginError>,
    /// Set when the Plugin is now disabled, with why: the frontend takes its UI away.
    pub disabled: Option<String>,
}

impl Reply {
    fn failed(plugin: &str, error: PluginError, disabled: Option<String>) -> Self {
        Reply {
            plugin: plugin.to_string(),
            result: Json::Null,
            ops: Vec::new(),
            error: Some(error),
            disabled,
        }
    }
}

/// What a Plugin's manifest says about it: shown in the install prompt before any of its code runs.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Manifest {
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: Option<String>,
    /// The `roster.api_version` it was written for.
    pub api: u32,
    #[serde(serialize_with = "described")]
    pub permissions: Vec<Permission>,
}

#[derive(Serialize)]
struct Described {
    name: String,
    summary: String,
    risk: Option<String>,
}

fn described<S: serde::Serializer>(ps: &[Permission], s: S) -> Result<S::Ok, S::Error> {
    s.collect_seq(ps.iter().map(|p| Described {
        name: p.to_string(),
        summary: p.summary(),
        risk: p.risk(),
    }))
}

/// How much a Plugin may use.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub memory: usize,
    /// Lua run time for `init.lua`.
    pub load: Duration,
    /// Lua run time for each call or event (a hook's budget).
    pub call: Duration,
    /// How much longer than its budget a call may take in all (a long C call, a slow serve call)
    /// before the Plugin is given up on and disabled.
    pub grace: Duration,
    /// Errors after loading that disable it.
    pub strikes: u32,
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            memory: 32 * 1024 * 1024,
            load: Duration::from_secs(1),
            call: Duration::from_millis(250),
            grace: Duration::from_secs(2),
            strikes: 3,
        }
    }
}

/// A Plugin as `:plugins` lists it.
#[derive(Debug, Clone, Serialize)]
pub struct Status {
    pub manifest: Manifest,
    pub dir: PathBuf,
    /// What it runs with: what it asked for and was granted.
    pub granted: Vec<Permission>,
    pub errors: u32,
    pub disabled: Option<String>,
}

enum Job {
    Load(String),
    Call(u64, Json),
    Event(Event),
}

type Answer = (Outcome, Vec<String>);
/// Where a Plugin's thread takes its work from.
type Jobs = Sender<(Job, Sender<Answer>)>;

struct Slot {
    manifest: Manifest,
    dir: PathBuf,
    grants: BTreeSet<Permission>,
    jobs: Option<Jobs>,
    listens: Vec<String>,
    errors: u32,
    disabled: Option<String>,
}

/// Every loaded Plugin. Cheap to share: calls into different Plugins run at the same time.
pub struct PluginHost {
    serve: Arc<dyn Serve>,
    limits: Limits,
    slots: Mutex<BTreeMap<String, Slot>>,
}

impl PluginHost {
    pub fn new(serve: Arc<dyn Serve>, limits: Limits) -> Self {
        PluginHost {
            serve,
            limits,
            slots: Mutex::default(),
        }
    }

    /// Loads (or reloads) the Plugin from `source` with what the user granted. It runs with only
    /// the permissions its manifest asks for and `grants` contains. An error in the manifest
    /// loads nothing; an error in its code leaves it listed, disabled.
    pub fn load(&self, source: &Source, grants: &[Permission]) -> Result<(Manifest, Reply), PluginError> {
        self.load_with(source, grants, &Json::Null)
    }

    /// [`PluginHost::load`], handing the Plugin `config` as `roster.plugin.config` (a Package's
    /// settings from init.lua; `null` gives an empty table).
    pub fn load_with(
        &self,
        source: &Source,
        grants: &[Permission],
        config: &Json,
    ) -> Result<(Manifest, Reply), PluginError> {
        let (manifest, dir, code) = match source {
            Source::Dir(dir) => {
                let manifest = read_manifest(dir)?;
                if BUNDLED.iter().any(|b| b.name == manifest.name) {
                    return Err(PluginError::new(
                        &manifest.name,
                        Some(MANIFEST.into()),
                        None,
                        format!(
                            "{:?} is the name of a Plugin built into roster: choose another",
                            manifest.name
                        ),
                    ));
                }
                let code = std::fs::read_to_string(dir.join(ENTRY)).map_err(|e| {
                    PluginError::new(&manifest.name, Some(ENTRY.into()), None, format!("can't read it: {e}"))
                })?;
                (manifest, dir.clone(), code)
            }
            Source::Bundled(name) => {
                let b = BUNDLED.iter().find(|b| b.name == name).ok_or_else(|| {
                    PluginError::new(name, None, None, "roster has no built-in Plugin by that name".into())
                })?;
                // No folder: a built-in Plugin is one file, with nothing to `require`.
                (manifest_from(b.manifest, name)?, PathBuf::new(), b.init.to_string())
            }
        };
        let source = code;
        let name = manifest.name.clone();
        self.unload(&name);
        let grants: BTreeSet<Permission> = manifest
            .permissions
            .iter()
            .filter(|p| grants.contains(p))
            .cloned()
            .collect();
        let jobs = self.spawn(&manifest, &dir, grants.clone(), config.clone());
        let mut slot = Slot {
            manifest: manifest.clone(),
            dir: dir.clone(),
            grants,
            jobs: Some(jobs),
            listens: Vec::new(),
            errors: 0,
            disabled: None,
        };
        let reply = match ask(&slot, Job::Load(source), self.limits.load + self.limits.grace) {
            Some((outcome, listens)) => {
                slot.listens = listens;
                match outcome.error {
                    Some(error) => {
                        let why = format!("it failed to load: {error}");
                        disable(&mut slot, &why);
                        Reply::failed(&name, error, Some(why))
                    }
                    None => Reply {
                        plugin: name.clone(),
                        result: Json::Null,
                        ops: outcome.ops,
                        error: None,
                        disabled: None,
                    },
                }
            }
            None => {
                let why = format!("it took longer than {} ms to load", self.limits.load.as_millis());
                disable(&mut slot, &why);
                Reply::failed(
                    &name,
                    PluginError::new(&name, Some(ENTRY.into()), None, why.clone()),
                    Some(why),
                )
            }
        };
        self.slots.lock().expect("plugin slots").insert(name, slot);
        Ok((manifest, reply))
    }

    /// Takes a Plugin out: its thread ends and nothing more reaches it. False if it wasn't loaded.
    pub fn unload(&self, plugin: &str) -> bool {
        self.slots.lock().expect("plugin slots").remove(plugin).is_some()
    }

    /// Calls a function the Plugin handed over (`{ "handler": N }` in its ops) with `args`.
    pub fn call(&self, plugin: &str, handler: u64, args: Json) -> Reply {
        let wall = self.limits.call + self.limits.grace;
        let Some(sender) = self.sender(plugin) else {
            let why = self.why_not(plugin);
            return Reply::failed(plugin, PluginError::new(plugin, None, None, why), None);
        };
        let answer = send(&sender, Job::Call(handler, args)).and_then(|rx| wait(&rx, Instant::now() + wall));
        self.settle(plugin, answer)
    }

    /// Sends `event` to every Plugin that listens and may hear it, all at once; the slow ones
    /// are given up on together. Only Plugins that changed something or failed answer.
    pub fn event(&self, event: Event) -> Vec<Reply> {
        let targets: Vec<(String, Jobs)> = {
            let slots = self.slots.lock().expect("plugin slots");
            slots
                .iter()
                .filter(|(_, s)| s.disabled.is_none() && s.listens.contains(&event.name))
                .filter(|(_, s)| runtime::may_hear(&event.name, &s.grants).is_ok())
                .filter_map(|(n, s)| s.jobs.clone().map(|j| (n.clone(), j)))
                .collect()
        };
        let pending: Vec<(String, Option<Receiver<Answer>>)> = targets
            .into_iter()
            .map(|(n, tx)| (n, send(&tx, Job::Event(event.clone()))))
            .collect();
        let deadline = Instant::now() + self.limits.call + self.limits.grace;
        pending
            .into_iter()
            .map(|(n, rx)| {
                let answer = rx.and_then(|rx| wait(&rx, deadline));
                self.settle(&n, answer)
            })
            .filter(|r| !r.ops.is_empty() || r.error.is_some())
            .collect()
    }

    /// Every Plugin loaded, in name order.
    pub fn list(&self) -> Vec<Status> {
        self.slots
            .lock()
            .expect("plugin slots")
            .values()
            .map(|s| Status {
                manifest: s.manifest.clone(),
                dir: s.dir.clone(),
                granted: s.grants.iter().cloned().collect(),
                errors: s.errors,
                disabled: s.disabled.clone(),
            })
            .collect()
    }

    fn sender(&self, plugin: &str) -> Option<Jobs> {
        let slots = self.slots.lock().expect("plugin slots");
        let slot = slots.get(plugin)?;
        if slot.disabled.is_some() {
            return None;
        }
        slot.jobs.clone()
    }

    fn why_not(&self, plugin: &str) -> String {
        match self.slots.lock().expect("plugin slots").get(plugin) {
            Some(Slot {
                disabled: Some(why), ..
            }) => format!("it's disabled: {why}"),
            _ => "it isn't loaded".into(),
        }
    }

    /// Records how a call went: errors count toward disabling, and a call that never came back
    /// disables at once.
    fn settle(&self, plugin: &str, answer: Option<Answer>) -> Reply {
        let mut slots = self.slots.lock().expect("plugin slots");
        let Some(slot) = slots.get_mut(plugin) else {
            return Reply::failed(
                plugin,
                PluginError::new(plugin, None, None, "it isn't loaded".into()),
                None,
            );
        };
        let Some((outcome, listens)) = answer else {
            let why = format!(
                "it didn't answer within {} ms",
                (self.limits.call + self.limits.grace).as_millis()
            );
            disable(slot, &why);
            return Reply::failed(plugin, PluginError::new(plugin, None, None, why.clone()), Some(why));
        };
        slot.listens = listens;
        let mut disabled = None;
        if outcome.error.is_some() && !outcome.stale {
            slot.errors += 1;
            if slot.errors >= self.limits.strikes {
                let why = format!("it failed {} times", slot.errors);
                disable(slot, &why);
                disabled = Some(why);
            }
        }
        Reply {
            plugin: plugin.to_string(),
            result: outcome.result,
            ops: outcome.ops,
            error: outcome.error,
            disabled,
        }
    }

    fn spawn(&self, manifest: &Manifest, dir: &Path, grants: BTreeSet<Permission>, config: Json) -> Jobs {
        let (tx, rx) = channel::<(Job, Sender<Answer>)>();
        let (name, version, dir) = (manifest.name.clone(), manifest.version.clone(), dir.to_path_buf());
        let (serve, limits) = (Arc::clone(&self.serve), self.limits);
        let spawned = std::thread::Builder::new()
            .name(format!("plugin:{name}"))
            .spawn(move || {
                let runtime = runtime::Runtime::new(
                    &name,
                    &version,
                    &dir,
                    &config,
                    grants,
                    serve,
                    limits.memory,
                    limits.call,
                );
                // Ends when the host drops the Plugin's sender (unload, disable).
                for (job, reply) in rx {
                    let outcome = match &runtime {
                        Err(e) => Outcome {
                            result: Json::Null,
                            ops: Vec::new(),
                            error: Some(e.clone()),
                            stale: false,
                        },
                        Ok(rt) => match job {
                            Job::Load(source) => rt.load(&source, limits.load),
                            Job::Call(handler, args) => rt.call(handler, &args),
                            Job::Event(event) => {
                                if runtime::may_hear(&event.name, rt.grants()).is_ok() {
                                    rt.event(&event)
                                } else {
                                    Outcome {
                                        result: Json::Null,
                                        ops: Vec::new(),
                                        error: None,
                                        stale: false,
                                    }
                                }
                            }
                        },
                    };
                    let listens = match &runtime {
                        Ok(rt) => EVENTS
                            .iter()
                            .map(|(n, _)| *n)
                            .filter(|n| rt.listens(n))
                            .map(String::from)
                            .collect(),
                        Err(_) => Vec::new(),
                    };
                    let _ = reply.send((outcome, listens));
                }
            });
        if let Err(e) = spawned {
            eprintln!("plugin {}: couldn't start its thread: {e}", manifest.name);
        }
        tx
    }
}

fn disable(slot: &mut Slot, why: &str) {
    slot.disabled = Some(why.to_string());
    // Dropping the sender ends the thread once it's done (or, stuck in C, when that call ends).
    slot.jobs = None;
}

fn send(tx: &Jobs, job: Job) -> Option<Receiver<Answer>> {
    let (reply, rx) = channel();
    tx.send((job, reply)).ok()?;
    Some(rx)
}

fn wait(rx: &Receiver<Answer>, deadline: Instant) -> Option<Answer> {
    rx.recv_timeout(deadline.saturating_duration_since(Instant::now())).ok()
}

fn ask(slot: &Slot, job: Job, wall: Duration) -> Option<Answer> {
    let rx = send(slot.jobs.as_ref()?, job)?;
    wait(&rx, Instant::now() + wall)
}

/// Reads the manifest in `dir` (`roster-plugin.lua`): a Lua file that returns a table, run in
/// the sandbox with no `roster` module, so reading it can't do anything.
pub fn read_manifest(dir: &Path) -> Result<Manifest, PluginError> {
    let shown = dir
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| dir.display().to_string());
    let source = std::fs::read_to_string(dir.join(MANIFEST)).map_err(|e| {
        PluginError::new(
            &shown,
            Some(MANIFEST.into()),
            None,
            if e.kind() == std::io::ErrorKind::NotFound {
                format!("{} has no {MANIFEST}: is it a roster Plugin?", dir.display())
            } else {
                format!("can't read it: {e}")
            },
        )
    })?;
    manifest_from(&source, &shown)
}

/// The manifest `source` gives (a `roster-plugin.lua`'s text, read before any of the Plugin's
/// code runs); errors name the Plugin as `shown` (its folder's name). Packages read a new
/// version's this way, before moving to it.
pub fn manifest_from(source: &str, shown: &str) -> Result<Manifest, PluginError> {
    let fail = |line: Option<u32>, message: String| PluginError::new(shown, Some(MANIFEST.into()), line, message);
    let source = source.to_string();
    let (tx, rx) = channel();
    std::thread::Builder::new()
        .name("plugin manifest".into())
        .spawn(move || {
            let run = || -> Result<Json, crate::config::ConfigError> {
                let internal = |e: mlua::Error| crate::config::ConfigError {
                    file: MANIFEST.into(),
                    line: None,
                    message: format!("couldn't start Lua: {e}"),
                    path: Vec::new(),
                };
                let (l, clock) = lua::sandboxed(4 * 1024 * 1024, None, MANIFEST.into()).map_err(internal)?;
                clock.start(Duration::from_millis(200));
                let value: mlua::Value = l
                    .load(&source)
                    .set_name(format!("@{MANIFEST}"))
                    .set_mode(mlua::chunk::ChunkMode::Text)
                    .eval()
                    .map_err(|e| lua::from_lua_error(&e))?;
                lua::to_json(&value, &std::cell::Cell::new(lua::Budget::default())).map_err(|e| {
                    crate::config::ConfigError {
                        file: MANIFEST.into(),
                        line: None,
                        message: crate::config::located_message(&e.path, &e.message),
                        path: Vec::new(),
                    }
                })
            };
            let _ = tx.send(run());
        })
        .map_err(|e| fail(None, format!("couldn't start Lua: {e}")))?;
    let value = match rx.recv_timeout(Duration::from_secs(1)) {
        Ok(Ok(v)) => v,
        Ok(Err(e)) => return Err(fail(e.line, e.message)),
        Err(_) => return Err(fail(None, "took too long to read".into())),
    };
    parse_manifest(&value).map_err(|m| fail(None, m))
}

fn parse_manifest(v: &Json) -> Result<Manifest, String> {
    let Json::Object(m) = v else {
        return Err("it must return a table: { name = …, version = …, permissions = { … } }".into());
    };
    for key in m.keys() {
        if !["name", "version", "description", "author", "api", "permissions"].contains(&key.as_str()) {
            return Err(format!(
                "{key}: not a manifest field (there's name, version, description, author, api, permissions)"
            ));
        }
    }
    let text = |key: &str| m.get(key).and_then(Json::as_str).map(str::to_string);
    let name = text("name").ok_or("name: missing (a name like \"recent-alerts\")")?;
    let valid = !name.is_empty()
        && name.len() <= 40
        && name.starts_with(|c: char| c.is_ascii_lowercase())
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if ["builtin", "init", "roster"].contains(&name.as_str()) {
        return Err(format!("name: {name:?} is kept for roster's own use"));
    }
    if !valid {
        return Err(format!(
            "name: {name:?} isn't a Plugin name (lower case letters, digits and -, starting with a letter; at most 40)"
        ));
    }
    let version = text("version").ok_or("version: missing (\"1.0.0\")")?;
    let api = m
        .get("api")
        .and_then(Json::as_u64)
        .ok_or("api: missing (the roster.api_version it was written for)")?;
    if api > u64::from(API_VERSION) {
        return Err(format!(
            "api: it needs roster's Plugin API {api}, and this app has {API_VERSION}: update the app"
        ));
    }
    let mut permissions = Vec::new();
    match m.get("permissions") {
        None => {}
        Some(Json::Array(list)) => {
            for p in list {
                let p = p
                    .as_str()
                    .ok_or("permissions: a list of names such as \"inventory.read\"")?;
                let p = Permission::parse(p).map_err(|e| format!("permissions: {e}"))?;
                if !permissions.contains(&p) {
                    permissions.push(p);
                }
            }
        }
        Some(Json::Object(o)) if o.is_empty() => {}
        Some(_) => return Err("permissions: a list of names such as \"inventory.read\"".into()),
    }
    Ok(Manifest {
        name,
        version,
        description: text("description").unwrap_or_default(),
        author: text("author"),
        api: api as u32,
        permissions,
    })
}

/// The folder `:plugins install PATH` means: `~/…` under `home`, an absolute path as it is, and
/// anything else under the config dir (`plugins/recent-alerts`).
pub fn resolve_dir(text: &str, config_dir: Option<&Path>, home: Option<&Path>) -> Result<PathBuf, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("which folder? :plugins install PATH".into());
    }
    let path = if let Some(rest) = text.strip_prefix("~/").or_else(|| text.strip_prefix("~\\")) {
        home.ok_or("there's no home folder to put ~ in")?.join(rest)
    } else if Path::new(text).is_absolute() {
        PathBuf::from(text)
    } else {
        config_dir
            .ok_or("there's no config folder: give a full path")?
            .join(text)
    };
    if !path.is_dir() {
        return Err(format!("{} isn't a folder", path.display()));
    }
    path.canonicalize().map_err(|e| format!("{}: {e}", path.display()))
}
