//! What only the user's call may do, and the runtime's bounds (the iteration 8 review). Every serve
//! method a Plugin may call that changes something on the network or in the Inventory (the ones
//! the install prompt flags) runs only while the user runs one of its actions, commands or finder
//! items (decision Q100); a finder's `items` and a `:check` section's `check` run as the app asks,
//! never as the user's call; serve's errors reach a Plugin cut as its answers do (Q92); a failed
//! call leaves nothing behind in the core; and one call can't keep roster serve busy for ever.

use roster_core::plugin::{Event, Limits, Permission, PluginHost, Reply, Serve, Source};
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::mpsc::{Receiver, channel};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// A stand-in `roster serve` that answers every method, and remembers what it was asked.
#[derive(Default)]
struct Recorded {
    calls: Mutex<Vec<String>>,
    /// How long each call takes.
    slow: Option<Duration>,
}

impl Serve for Recorded {
    fn call(&self, method: &str, _params: Value) -> Result<Value, String> {
        self.calls.lock().unwrap().push(method.to_string());
        if let Some(d) = self.slow {
            std::thread::sleep(d);
        }
        match method {
            "host.get" => Err("no Login for esx-02: cmd:pass show esx-02/root failed (code 5)".into()),
            _ => Ok(json!({ "ok": true, "job": "job-1" })),
        }
    }
}

impl Recorded {
    fn methods(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }
}

fn plugin_dir(test: &str, permissions: &[&str], init: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("roster-core-plugin-user-calls-{}-{test}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let list: Vec<String> = permissions.iter().map(|p| format!("{p:?}")).collect();
    std::fs::write(
        dir.join("roster-plugin.lua"),
        format!(
            "return {{ name = \"guarded\", version = \"1.0.0\", api = 3, permissions = {{ {} }} }}",
            list.join(", ")
        ),
    )
    .unwrap();
    std::fs::write(dir.join("init.lua"), init).unwrap();
    dir
}

fn listening(serve: &Arc<Recorded>, limits: Limits) -> (PluginHost, Receiver<Reply>) {
    let host = PluginHost::new(Arc::clone(serve) as Arc<dyn Serve>, limits);
    let (tx, rx) = channel();
    let tx = Mutex::new(tx);
    host.set_listener(Arc::new(move |r: Reply| {
        let _ = tx.lock().unwrap().send(r);
    }));
    (host, rx)
}

fn load(host: &PluginHost, test: &str, permissions: &[&str], init: &str) -> Reply {
    let grants: Vec<Permission> = permissions.iter().map(|p| Permission::parse(p).unwrap()).collect();
    let (_, reply) = host
        .load(&Source::Dir(plugin_dir(test, permissions, init)), &grants)
        .unwrap();
    ok(&reply);
    reply
}

fn ok(r: &Reply) {
    assert!(r.error.is_none(), "{:?}", r.error);
    assert!(r.disabled.is_none(), "{:?}", r.disabled);
}

fn handler(v: &Value) -> u64 {
    v["handler"].as_u64().unwrap_or_else(|| panic!("no handler in {v}"))
}

/// The handler of the command `name` among `ops`.
fn command(ops: &[Value], name: &str) -> u64 {
    let op = ops
        .iter()
        .find(|o| o["op"] == "command" && o["name"] == name)
        .unwrap_or_else(|| panic!("no command {name} in {ops:?}"));
    handler(&op["run"])
}

/// The first op `kind` among `ops`.
fn op<'a>(ops: &'a [Value], kind: &str) -> &'a Value {
    ops.iter()
        .find(|o| o["op"] == kind)
        .unwrap_or_else(|| panic!("no {kind} op in {ops:?}"))
}

fn notices(ops: &[Value]) -> Vec<String> {
    ops.iter()
        .filter(|o| o["op"] == "notify")
        .map(|o| o["text"].as_str().unwrap().to_string())
        .collect()
}

/// The notices in the replies the Plugin sends on its own, until `want` of them or 3 s.
fn later(rx: &Receiver<Reply>, want: usize) -> Vec<String> {
    let mut out = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(3);
    while out.len() < want {
        let Ok(r) = rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) else {
            break;
        };
        ok(&r);
        out.extend(notices(&r.ops));
    }
    out
}

const ARGS: fn() -> Value = || json!({ "args": "", "words": [] });

/// Tries `method` through both `roster.serve.call` and `roster.serve.request`, and says how each
/// went: "call ok"/"call refused", "request ok"/"request refused".
const TRY: &str = r#"
local function try(method)
  local said = {}
  local ok, err = pcall(roster.serve.call, method, {})
  said[#said + 1] = ok and "call ok" or (tostring(err):find("only while the user runs", 1, true) and "call refused" or ("call failed: " .. tostring(err)))
  ok, err = pcall(roster.serve.request, method, {}, function() end)
  said[#said + 1] = ok and "request ok" or (tostring(err):find("only while the user runs", 1, true) and "request refused" or ("request failed: " .. tostring(err)))
  return method .. ": " .. table.concat(said, ", ")
end
"#;

#[test]
fn every_flagged_serve_method_waits_for_the_users_call_and_the_reads_dont() {
    let serve = Arc::new(Recorded::default());
    let (host, _rx) = listening(&serve, Limits::default());
    let methods = [
        "mesh.apply",
        "mesh.cut",
        "host.check",
        "discover.start",
        "mesh.status",
        "mesh.job",
    ];
    let permissions: Vec<String> = methods.iter().map(|m| format!("serve:{m}")).collect();
    let mut permissions: Vec<&str> = permissions.iter().map(String::as_str).collect();
    permissions.push("inventory.read");
    let init = format!(
        r#"{TRY}
local methods = {{ "mesh.apply", "mesh.cut", "host.check", "discover.start", "mesh.status", "mesh.job" }}
local function all(where)
  for _, m in ipairs(methods) do roster.notify(where .. " " .. try(m)) end
end
all("load")
roster.on("host_selected", function() all("event") end)
roster.defer(50, function() all("timer") end)
roster.commands.add("go", {{ run = function() all("user") end }})
"#
    );
    let loaded = load(&host, "flagged", &permissions, &init);
    let mut said = notices(&loaded.ops);
    let timer = handler(&op(&loaded.ops, "timer")["run"]);
    let fired = host.call("guarded", timer, json!({}));
    ok(&fired);
    said.extend(notices(&fired.ops));
    let heard = host.event(Event {
        name: "host_selected".into(),
        payload: json!({ "host": "esx-02" }),
    });
    said.extend(heard.iter().flat_map(|r| notices(&r.ops)));
    let user = host.call("guarded", command(&loaded.ops, "go"), ARGS());
    ok(&user);
    said.extend(notices(&user.ops));
    let mut want = Vec::new();
    for when in ["load", "timer", "event"] {
        for m in ["mesh.apply", "mesh.cut", "host.check", "discover.start"] {
            want.push(format!("{when} {m}: call refused, request refused"));
        }
        for m in ["mesh.status", "mesh.job"] {
            want.push(format!("{when} {m}: call ok, request ok"));
        }
    }
    for m in methods {
        want.push(format!("user {m}: call ok, request ok"));
    }
    let order = |s: &String| s.clone();
    let (mut said, mut want) = (said, want);
    said.sort_by_key(order);
    want.sort_by_key(order);
    assert_eq!(said, want);
}

#[test]
fn an_inventory_write_waits_for_the_users_call() {
    let serve = Arc::new(Recorded::default());
    let (host, _rx) = listening(&serve, Limits::default());
    let loaded = load(
        &host,
        "write",
        &["inventory.write"],
        r#"
local ok, err = pcall(roster.inventory.update, "esx-02", { ip = "10.0.0.6" })
roster.notify(ok and "load wrote" or tostring(err))
roster.commands.add("go", { run = function()
  roster.inventory.review("esx-02", true)
  roster.notify("user wrote")
end })
"#,
    );
    assert_eq!(
        notices(&loaded.ops),
        ["roster.inventory.update: only while the user runs one of your actions, commands or finder items"]
    );
    assert!(serve.methods().is_empty(), "{:?}", serve.methods());
    let user = host.call("guarded", command(&loaded.ops, "go"), ARGS());
    ok(&user);
    assert_eq!(notices(&user.ops), ["user wrote"]);
    assert_eq!(serve.methods(), ["host.review"]);
}

/// What only the user's call may do, tried in turn: a copy, a question, a command line, a scan.
const USER_THINGS: &str = r#"
local function tried()
  local said = {}
  local function try(name, f, ...)
    local ok = pcall(f, ...)
    said[#said + 1] = name .. (ok and " ok" or " refused")
  end
  try("copy", roster.clipboard.copy, "10.0.0.5")
  try("confirm", roster.confirm, { title = "Sure?", run = function() end })
  try("cmd", roster.cmd, "finder hosts")
  try("scan", roster.serve.request, "discover.start", {}, function() end)
  return table.concat(said, ", ")
end
"#;

#[test]
fn a_finders_items_and_a_checks_lines_are_never_the_users_call() {
    let serve = Arc::new(Recorded::default());
    let (host, _rx) = listening(&serve, Limits::default());
    let init = format!(
        r#"{USER_THINGS}
roster.finders.set("picks", {{ title = "Picks", items = function()
  return {{ {{ id = "a", label = tried(), run = function() roster.notify("item: " .. tried()) end }} }}
end }})
roster.health.set("lab", {{ title = "Lab", check = function()
  return {{ {{ level = "ok", message = tried() }} }}
end }})
roster.commands.add("go", {{ run = function() roster.notify("command: " .. tried()) end }})
"#
    );
    let loaded = load(&host, "app-calls", &["serve:discover.start"], &init);
    let finder = op(&loaded.ops, "finder");
    let items = host.call("guarded", handler(&finder["spec"]["items"]), json!({}));
    ok(&items);
    let refused = "copy refused, confirm refused, cmd refused, scan refused";
    let allowed = "copy ok, confirm ok, cmd ok, scan ok";
    // Listing the finder's items runs as the finder opens, whoever opened it: not the user's choice.
    assert_eq!(items.result[0]["label"], refused);
    assert!(items.ops.is_empty(), "{:?}", items.ops);
    let check = op(&loaded.ops, "health");
    let lines = host.call("guarded", handler(&check["spec"]["check"]), json!({ "health": "lab" }));
    ok(&lines);
    assert_eq!(lines.result[0]["message"], refused);
    // Choosing an item is the user's call, as a command is.
    let item = host.call(
        "guarded",
        handler(&items.result[0]["run"]),
        json!({ "finder": "picks", "item": "a" }),
    );
    ok(&item);
    assert_eq!(notices(&item.ops), [format!("item: {allowed}")]);
    let go = host.call("guarded", command(&loaded.ops, "go"), ARGS());
    assert_eq!(notices(&go.ops), [format!("command: {allowed}")]);
    // The app calling a handler on its own (another Plugin's question took this one's place, so
    // its `cancel` runs) isn't the user's call either, whatever handler it is.
    let unasked = host.call_by_app("guarded", command(&loaded.ops, "go"), ARGS());
    ok(&unasked);
    assert_eq!(notices(&unasked.ops), [format!("command: {refused}")]);
}
