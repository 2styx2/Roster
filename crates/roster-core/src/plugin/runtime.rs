//! One Plugin's Lua: the sandbox `init.lua` runs in (config/lua.rs), with the `roster` module
//! built from what the Plugin was granted. It lives on the Plugin's own thread (mod.rs) and is
//! driven by three calls: [`Runtime::load`], [`Runtime::call`] and [`Runtime::event`]. Whatever
//! the Plugin asks of the UI during a call comes back as that call's ops (data, never HTML); a
//! Lua function inside them is kept here and sent as `{ "handler": N }`.

use super::{Event, Outcome, PluginError, Serve, permission::Permission};
use crate::config::lua::{self, Budget, Clock};
use crate::config::{Os, ThemeDef};
use mlua::chunk::ChunkMode;
use mlua::{Function, Lua, Table, Value, Variadic};
use serde_json::{Map, Value as Json, json};
use std::cell::{Cell, RefCell};
use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

const HANDLERS: &str = "roster.plugin.handlers";
const LISTENERS: &str = "roster.plugin.listeners";
/// The most UI ops one call may produce.
pub(crate) const MAX_OPS: usize = 1000;
/// The most text `roster.clipboard.copy` takes.
const MAX_COPY: usize = 64 * 1024;
/// The most Lua functions a Plugin may have handed over at once.
const MAX_HANDLERS: usize = 10_000;

/// The events a Plugin can subscribe to, and the permissions that let it (any one of them; none
/// listed means every Plugin may).
pub const EVENTS: &[(&str, &[Permission])] = &[
    ("lock", &[]),
    ("unlock", &[]),
    ("host_selected", &[Permission::InventoryRead, Permission::TerminalRead]),
    ("session_open", &[Permission::InventoryRead, Permission::TerminalRead]),
    ("session_exit", &[Permission::InventoryRead, Permission::TerminalRead]),
    ("inventory_changed", &[Permission::InventoryRead]),
    ("terminal_output", &[Permission::TerminalRead]),
];

/// Whether a Plugin with `grants` may get `event`.
pub(crate) fn may_hear(event: &str, grants: &BTreeSet<Permission>) -> Result<(), String> {
    match EVENTS.iter().find(|(name, _)| *name == event) {
        None => Err(format!(
            "there's no event {event:?} (there's {})",
            EVENTS.iter().map(|(n, _)| *n).collect::<Vec<_>>().join(", ")
        )),
        Some((_, [])) => Ok(()),
        Some((_, needs)) if needs.iter().any(|p| grants.contains(p)) => Ok(()),
        Some((_, needs)) => Err(format!(
            "the {event} event needs the {} permission",
            needs.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(" or ")
        )),
    }
}

/// The Inventory write methods `inventory.write` gives, by their Lua name: every one of them
/// lands as a Pending change; Publish is never one of them.
const WRITES: &[(&str, &str, &[&str])] = &[
    ("update", "host.update", &["host", "changes"]),
    ("rename", "host.rename", &["host", "to"]),
    ("move", "host.move", &["host", "group"]),
    ("review", "host.review", &["host", "reviewed"]),
];

struct Shared {
    plugin: String,
    grants: BTreeSet<Permission>,
    serve: Arc<dyn Serve>,
    clock: Rc<Clock>,
    ops: RefCell<Vec<Json>>,
    budget: Cell<Budget>,
    handlers: RefCell<Handlers>,
    /// Whether the run is a call the user started (an action, a command, a finder item): only
    /// then may the Plugin put text on the clipboard.
    user_call: Cell<bool>,
}

#[derive(Default)]
struct Handlers {
    next: u64,
    /// Which handlers each owner (a section, a command, a call's result) handed over, so setting
    /// the owner again drops the old ones.
    owners: HashMap<String, Vec<u64>>,
    count: usize,
}

pub(crate) struct Runtime {
    lua: Lua,
    shared: Rc<Shared>,
    budget: Duration,
}

impl Runtime {
    #[allow(clippy::too_many_arguments)] // each is one fact about the Plugin, from its own place
    pub(crate) fn new(
        plugin: &str,
        version: &str,
        dir: &Path,
        config: &Json,
        grants: BTreeSet<Permission>,
        serve: Arc<dyn Serve>,
        memory: usize,
        budget: Duration,
    ) -> Result<Runtime, PluginError> {
        let fail = |e: mlua::Error| PluginError::new(plugin, None, None, format!("couldn't start Lua: {e}"));
        let (lua, clock) =
            lua::sandboxed(memory, (!dir.as_os_str().is_empty()).then_some(dir), plugin.to_string()).map_err(fail)?;
        let shared = Rc::new(Shared {
            plugin: plugin.to_string(),
            grants,
            serve,
            clock,
            ops: RefCell::default(),
            budget: Cell::new(Budget::default()),
            handlers: RefCell::default(),
            user_call: Cell::new(false),
        });
        lua.set_named_registry_value(HANDLERS, lua.create_table().map_err(fail)?)
            .map_err(fail)?;
        lua.set_named_registry_value(LISTENERS, lua.create_table().map_err(fail)?)
            .map_err(fail)?;
        let roster = api(&lua, &shared, version, config).map_err(fail)?;
        lua::set_api(&lua, roster).map_err(fail)?;
        Ok(Runtime { lua, shared, budget })
    }

    /// Runs the Plugin's `init.lua`, within `budget`.
    pub(crate) fn load(&self, source: &str, budget: Duration) -> Outcome {
        self.run(budget, |lua| {
            lua.load(source)
                .set_name("@init.lua")
                .set_mode(ChunkMode::Text)
                .exec()
                .map(|()| Json::Null)
        })
    }

    /// Calls a function the Plugin handed over, with `args`; its return value comes back as data.
    pub(crate) fn call(&self, handler: u64, args: &Json) -> Outcome {
        let shared = Rc::clone(&self.shared);
        self.shared.user_call.set(true);
        let outcome = self.run(self.budget, move |lua| {
            let handlers: Table = lua.named_registry_value(HANDLERS)?;
            let f: Option<Function> = handlers.raw_get(handler)?;
            let Some(f) = f else {
                return Err(mlua::Error::runtime(format!(
                    "\0stale:handler {handler} is gone (the Plugin replaced it)"
                )));
            };
            let value: Value = f.call(to_lua(lua, args)?)?;
            data(lua, &shared, &value, &format!("call:{handler}"))
        });
        self.shared.user_call.set(false);
        outcome
    }

    /// Runs each listener for `event` (the caller has checked the Plugin may hear it).
    pub(crate) fn event(&self, event: &Event) -> Outcome {
        self.run(self.budget, |lua| {
            let listeners: Table = lua.named_registry_value(LISTENERS)?;
            let Some(list) = listeners.raw_get::<Option<Table>>(event.name.as_str())? else {
                return Ok(Json::Null);
            };
            let payload = to_lua(lua, &event.payload)?;
            for f in list.sequence_values::<Function>() {
                f?.call::<()>(payload.clone())?;
            }
            Ok(Json::Null)
        })
    }

    /// Whether the Plugin listens for `event`.
    pub(crate) fn listens(&self, event: &str) -> bool {
        self.lua
            .named_registry_value::<Table>(LISTENERS)
            .and_then(|t| t.raw_get::<Option<Table>>(event))
            .is_ok_and(|l| l.is_some_and(|l| l.raw_len() > 0))
    }

    pub(crate) fn grants(&self) -> &BTreeSet<Permission> {
        &self.shared.grants
    }

    fn run(&self, budget: Duration, body: impl FnOnce(&Lua) -> mlua::Result<Json>) -> Outcome {
        self.shared.clock.start(budget);
        self.shared.budget.set(Budget::default());
        self.shared.ops.borrow_mut().clear();
        let result = body(&self.lua);
        let ops = std::mem::take(&mut *self.shared.ops.borrow_mut());
        match result {
            Ok(result) => Outcome {
                result,
                ops,
                error: None,
                stale: false,
            },
            Err(e) => {
                let text = e.to_string();
                let stale = text.contains("\0stale:");
                let error = if stale {
                    PluginError::new(
                        &self.shared.plugin,
                        None,
                        None,
                        "that action is gone: the Plugin replaced it".into(),
                    )
                } else {
                    plugin_error(&self.shared.plugin, &e)
                };
                // A failed call's UI changes are dropped: half an update is worse than none.
                Outcome {
                    result: Json::Null,
                    ops: Vec::new(),
                    error: Some(error),
                    stale,
                }
            }
        }
    }
}

fn plugin_error(plugin: &str, e: &mlua::Error) -> PluginError {
    if matches!(root_cause(e), mlua::Error::MemoryError(_)) {
        return PluginError::new(plugin, None, None, "used too much memory".into());
    }
    let c = lua::from_lua_error(e);
    let file = if c.file.is_empty() { None } else { Some(c.file) };
    PluginError::new(plugin, file, c.line, c.message)
}

fn root_cause(e: &mlua::Error) -> &mlua::Error {
    match e {
        mlua::Error::CallbackError { cause, .. } | mlua::Error::WithContext { cause, .. } => root_cause(cause),
        other => other,
    }
}

/// A Lua value as UI data: functions become `{ "handler": N }`, owned by `owner` (handing over
/// data for the same owner again drops its earlier functions).
fn data(lua: &Lua, shared: &Shared, value: &Value, owner: &str) -> mlua::Result<Json> {
    let handlers: Table = lua.named_registry_value(HANDLERS)?;
    let old = shared.handlers.borrow_mut().owners.remove(owner).unwrap_or_default();
    for id in &old {
        handlers.raw_set(*id, Value::Nil)?;
    }
    shared.handlers.borrow_mut().count -= old.len();
    let mut ids = Vec::new();
    let mut keep = |f: &Function| -> Result<Json, String> {
        let mut h = shared.handlers.borrow_mut();
        if h.count >= MAX_HANDLERS {
            return Err(format!("more than {MAX_HANDLERS} functions handed to roster at once"));
        }
        h.next += 1;
        h.count += 1;
        let id = h.next;
        handlers.raw_set(id, f.clone()).map_err(|e| e.to_string())?;
        ids.push(id);
        Ok(json!({ "handler": id }))
    };
    let out = lua::to_json_with(value, &shared.budget, &mut Some(&mut keep));
    shared.handlers.borrow_mut().owners.insert(owner.to_string(), ids);
    out.map_err(|e| {
        let at = if e.path.is_empty() {
            String::new()
        } else {
            format!("{}: ", e.path.join("."))
        };
        mlua::Error::runtime(format!("{at}{}", e.message))
    })
}

/// A Lua value as data for roster serve: no functions.
fn plain(shared: &Shared, v: &Value) -> mlua::Result<Json> {
    lua::to_json(v, &shared.budget).map_err(|e| mlua::Error::runtime(e.message))
}

fn push(shared: &Shared, op: Json) -> mlua::Result<()> {
    let mut ops = shared.ops.borrow_mut();
    if ops.len() >= MAX_OPS {
        return Err(mlua::Error::runtime(format!(
            "more than {MAX_OPS} UI changes in one go"
        )));
    }
    ops.push(op);
    Ok(())
}

fn check_id(what: &str, id: &str) -> mlua::Result<()> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '_' | '.'));
    if ok {
        Ok(())
    } else {
        Err(mlua::Error::runtime(format!(
            "{what}: {id:?} isn't a name like \"recent-alerts\" (lower case letters, digits, - _ .; at most 64)"
        )))
    }
}

fn need(shared: &Shared, p: &Permission, what: &str) -> mlua::Result<()> {
    if shared.grants.contains(p) {
        Ok(())
    } else {
        Err(mlua::Error::runtime(format!("{what}: not granted ({p})")))
    }
}

/// Calls roster serve, giving the time spent waiting back to the Plugin's run.
fn serve(lua: &Lua, shared: &Shared, what: &str, method: &str, params: Json) -> mlua::Result<Value> {
    let started = Instant::now();
    let result = shared.serve.call(method, params);
    shared.clock.extend(started.elapsed());
    match result {
        Ok(v) => to_lua(lua, &v),
        Err(message) => Err(mlua::Error::runtime(format!("{what}: {message}"))),
    }
}

/// The `roster` module for one Plugin: everything every Plugin gets, then what its grants add.
fn api(lua: &Lua, shared: &Rc<Shared>, version: &str, config: &Json) -> mlua::Result<Table> {
    let roster = lua.create_table()?;
    roster.raw_set("api_version", super::API_VERSION)?;
    roster.raw_set("os", Os::current().as_str())?;
    let me = lua.create_table()?;
    me.raw_set("name", shared.plugin.as_str())?;
    me.raw_set("version", version)?;
    let granted = lua.create_table()?;
    for (i, p) in shared.grants.iter().enumerate() {
        granted.raw_set(i + 1, p.to_string())?;
    }
    me.raw_set("permissions", granted)?;
    // A Package's settings from init.lua (ticket 24): always a table.
    let config = match config {
        Json::Object(_) => to_lua(lua, config)?,
        _ => Value::Table(lua.create_table()?),
    };
    me.raw_set("config", config)?;
    roster.raw_set("plugin", me)?;

    // A function `f(lua, shared, args)` in the module.
    macro_rules! func {
        ($table:expr, $name:expr, |$lua:ident, $s:ident, $args:tt : $ty:ty| $body:block) => {{
            let $s = Rc::clone(shared);
            $table.raw_set(
                $name,
                lua.create_function(move |$lua, $args: $ty| {
                    let $s: &Shared = &$s;
                    $body
                })?,
            )?;
        }};
    }

    // Commands: `:NAME ARGS` runs `run({ args = "ARGS", words = {…} })`, or a command line.
    let commands = lua.create_table()?;
    func!(commands, "add", |lua, s, (name, spec): (String, Table)| {
        check_id("roster.commands.add", &name)?;
        let spec = data(lua, s, &Value::Table(spec), &format!("command:{name}"))?;
        let desc = spec.get("desc").and_then(Json::as_str).unwrap_or("").to_string();
        let Some(run) = spec.get("run").filter(|r| r.is_string() || r.get("handler").is_some()) else {
            return Err(mlua::Error::runtime(
                "roster.commands.add: `run` must be a function or a command line",
            ));
        };
        push(s, json!({ "op": "command", "name": name, "desc": desc, "run": run }))
    });
    func!(commands, "remove", |_lua, s, name: String| {
        push(s, json!({ "op": "remove", "kind": "command", "id": name }))
    });
    roster.raw_set("commands", commands)?;

    // Key bindings, as init.lua's: the action is a command line (one of the Plugin's commands).
    let keymap = lua.create_table()?;
    func!(
        keymap,
        "set",
        |_lua, s, (context, keys, action): (String, String, Value)| {
            let action = match action {
                Value::String(a) => Json::String(a.to_str()?.to_string()),
                Value::Boolean(false) => Json::Bool(false),
                _ => {
                    return Err(mlua::Error::runtime(
                        "roster.keymap.set: the action is a command line such as \"alerts\" (add a command for a function)",
                    ));
                }
            };
            push(
                s,
                json!({ "op": "key", "context": context, "keys": keys, "action": action }),
            )
        }
    );
    roster.raw_set("keymap", keymap)?;

    // Themes, checked as init.lua's `themes` are.
    let themes = lua.create_table()?;
    func!(themes, "define", |lua, s, (id, theme): (String, Table)| {
        check_id("roster.themes.define", &id)?;
        let value = data(lua, s, &Value::Table(theme), "theme")?;
        let def: ThemeDef = serde_json::from_value(value)
            .map_err(|e| mlua::Error::runtime(format!("roster.themes.define {id:?}: {e}")))?;
        let def = serde_json::to_value(def).map_err(mlua::Error::external)?;
        push(s, json!({ "op": "theme", "id": id, "theme": def }))
    });
    roster.raw_set("themes", themes)?;

    // UI pieces the core draws: a Sidebar section, a status segment, a finder source, a help
    // page, a `:check` section, a tutorial (`:tutor`). `set` adds or replaces one; `remove` takes it away.
    for (module, kind) in [
        ("sidebar", "section"),
        ("status", "status"),
        ("finders", "finder"),
        ("help", "help"),
        ("health", "health"),
        ("tutor", "tutor"),
    ] {
        let t = lua.create_table()?;
        let what = format!("roster.{module}.set");
        func!(t, "set", |lua, s, (id, spec): (String, Table)| {
            check_id(&what, &id)?;
            let spec = data(lua, s, &Value::Table(spec), &format!("{kind}:{id}"))?;
            let mut op = Map::new();
            op.insert("op".into(), kind.into());
            op.insert("id".into(), id.into());
            op.insert("spec".into(), spec);
            push(s, Json::Object(op))
        });
        func!(t, "remove", |_lua, s, id: String| {
            push(s, json!({ "op": "remove", "kind": kind, "id": id }))
        });
        roster.raw_set(module, t)?;
    }

    // A badge on a Host's rows ("2 alerts"); nil takes it off.
    let badges = lua.create_table()?;
    func!(badges, "set", |_lua, s, (host, text): (String, Option<String>)| {
        push(s, json!({ "op": "badge", "host": host, "text": text }))
    });
    roster.raw_set("badges", badges)?;

    // A floating window over the terminal: a title and lines of text; `close` hides it.
    let float = lua.create_table()?;
    func!(float, "open", |lua, s, spec: Table| {
        let spec = data(lua, s, &Value::Table(spec), "float")?;
        push(s, json!({ "op": "float", "spec": spec }))
    });
    func!(float, "close", |_lua, s, (): ()| {
        push(s, json!({ "op": "float", "spec": null }))
    });
    roster.raw_set("float", float)?;

    // The clipboard: only while the user runs one of the Plugin's actions, commands or finder
    // items, never on its own (at load, on an event), so it can't swap what you copied.
    let clipboard = lua.create_table()?;
    func!(clipboard, "copy", |_lua, s, text: String| {
        if !s.user_call.get() {
            return Err(mlua::Error::runtime(
                "roster.clipboard.copy: only while the user runs one of your actions, commands or finder items",
            ));
        }
        if text.len() > MAX_COPY {
            return Err(mlua::Error::runtime(format!(
                "roster.clipboard.copy: the text is over {MAX_COPY} bytes"
            )));
        }
        push(s, json!({ "op": "copy", "text": text }))
    });
    roster.raw_set("clipboard", clipboard)?;

    func!(roster, "notify", |_lua, s, (text, level): (String, Option<String>)| {
        let level = level.unwrap_or_else(|| "info".into());
        if !matches!(level.as_str(), "info" | "warn" | "error") {
            return Err(mlua::Error::runtime(
                "roster.notify: the level is \"info\", \"warn\" or \"error\"",
            ));
        }
        push(s, json!({ "op": "notify", "text": text, "level": level }))
    });

    // Events: `roster.on("session_open", function(e) … end)`.
    func!(roster, "on", |lua, s, (event, f): (String, Function)| {
        may_hear(&event, &s.grants).map_err(|m| mlua::Error::runtime(format!("roster.on: {m}")))?;
        let listeners: Table = lua.named_registry_value(LISTENERS)?;
        let list = match listeners.raw_get::<Option<Table>>(event.as_str())? {
            Some(l) => l,
            None => {
                let l = lua.create_table()?;
                listeners.raw_set(event.as_str(), l.clone())?;
                l
            }
        };
        list.raw_push(f)
    });

    // What the grants add. Without a grant the function isn't there at all (decision Q81).
    let g = &shared.grants;
    if g.contains(&Permission::InventoryRead) || g.contains(&Permission::InventoryWrite) {
        let inventory = lua.create_table()?;
        if g.contains(&Permission::InventoryRead) {
            func!(inventory, "hosts", |lua, s, (): ()| {
                need(s, &Permission::InventoryRead, "roster.inventory.hosts")?;
                let list: Table = match serve(lua, s, "roster.inventory.hosts", "hosts.list", json!({}))? {
                    Value::Table(t) => t,
                    _ => return Err(mlua::Error::runtime("roster.inventory.hosts: roster sent no list")),
                };
                list.raw_get::<Value>("hosts")
            });
            func!(inventory, "host", |lua, s, name: String| {
                need(s, &Permission::InventoryRead, "roster.inventory.host")?;
                serve(lua, s, "roster.inventory.host", "host.get", json!({ "name": name }))
            });
        }
        if g.contains(&Permission::InventoryWrite) {
            for (name, method, params) in WRITES {
                let what = format!("roster.inventory.{name}");
                func!(inventory, *name, |lua, s, args: Variadic<Value>| {
                    need(s, &Permission::InventoryWrite, &what)?;
                    let mut p = Map::new();
                    for (key, v) in params.iter().zip(args.iter()) {
                        p.insert((*key).into(), plain(s, v)?);
                    }
                    serve(lua, s, &what, method, Json::Object(p))
                });
            }
        }
        roster.raw_set("inventory", inventory)?;
    }
    if g.contains(&Permission::SessionsOpen) {
        let sessions = lua.create_table()?;
        func!(sessions, "open", |_lua, s, host: String| {
            need(s, &Permission::SessionsOpen, "roster.sessions.open")?;
            push(s, json!({ "op": "open", "host": host }))
        });
        roster.raw_set("sessions", sessions)?;
    }
    if g.contains(&Permission::TerminalWrite) {
        let terminal = lua.create_table()?;
        func!(terminal, "send", |_lua, s, (session, text): (u64, String)| {
            need(s, &Permission::TerminalWrite, "roster.terminal.send")?;
            push(s, json!({ "op": "send", "session": session, "text": text }))
        });
        roster.raw_set("terminal", terminal)?;
    }
    if g.iter().any(|p| matches!(p, Permission::Serve(_))) {
        let t = lua.create_table()?;
        func!(t, "call", |lua, s, (method, params): (String, Option<Value>)| {
            need(s, &Permission::Serve(method.clone()), "roster.serve.call")?;
            let params = match params {
                Some(v) => plain(s, &v)?,
                None => json!({}),
            };
            serve(lua, s, &format!("roster.serve.call {method}"), &method, params)
        });
        roster.raw_set("serve", t)?;
    }
    Ok(roster)
}

/// JSON as a Lua value: objects and arrays become tables, null becomes nil.
pub(crate) fn to_lua(lua: &Lua, v: &Json) -> mlua::Result<Value> {
    Ok(match v {
        Json::Null => Value::Nil,
        Json::Bool(b) => Value::Boolean(*b),
        Json::Number(n) => match n.as_i64() {
            Some(i) => Value::Integer(i),
            None => Value::Number(n.as_f64().unwrap_or(0.0)),
        },
        Json::String(s) => Value::String(lua.create_string(s)?),
        Json::Array(items) => {
            let t = lua.create_table_with_capacity(items.len(), 0)?;
            for (i, item) in items.iter().enumerate() {
                t.raw_set(i + 1, to_lua(lua, item)?)?;
            }
            Value::Table(t)
        }
        Json::Object(map) => {
            let t = lua.create_table_with_capacity(0, map.len())?;
            for (k, item) in map {
                t.raw_set(k.as_str(), to_lua(lua, item)?)?;
            }
            Value::Table(t)
        }
    })
}
