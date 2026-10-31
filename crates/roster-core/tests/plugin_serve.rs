//! A Plugin and a busy `roster serve` (ticket 90, #159, decision Q103). serve answers one request
//! at a time, so a Plugin's quick call can wait behind the app's long one (a Publish, a minute or
//! two). That wait is serve's, never the Plugin's: it doesn't count toward the Plugin's time, and
//! `roster.serve.request` doesn't wait at all.

use roster_core::plugin::{Limits, Permission, PluginHost, Reply, Serve, Source};
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::mpsc::{Receiver, channel};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// A stand-in `roster serve` that, like the real one, answers one request at a time: a slow call
/// holds every other behind it.
#[derive(Default)]
struct SerialServe {
    one_at_a_time: Mutex<()>,
    calls: Mutex<Vec<(String, Value)>>,
}

impl Serve for SerialServe {
    fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let _turn = self.one_at_a_time.lock().unwrap();
        self.calls.lock().unwrap().push((method.to_string(), params.clone()));
        match method {
            // The app's own long call.
            "changes.publish" => {
                std::thread::sleep(Duration::from_millis(params["ms"].as_u64().unwrap_or(1500)));
                Ok(json!({ "published": true }))
            }
            "hosts.list" => Ok(json!({
                "hosts": [{ "name": "esx-02", "ip": "10.0.0.5", "group": "lab",
                            "ssh": { "user": "root", "auth": "cmd:pass show esx-02" } }],
                "groups": { "lab": {} }
            })),
            "discover.status" => Ok(json!({ "state": "running" })),
            "discover.start" => Ok(json!({ "scan": "scan-1", "state": "running" })),
            "mesh.status" => Err("no Mesh here (code 110)".into()),
            other => Err(format!("unknown method '{other}' (code -32601)")),
        }
    }
}

impl SerialServe {
    fn methods(&self) -> Vec<String> {
        self.calls.lock().unwrap().iter().map(|(m, _)| m.clone()).collect()
    }

    /// The app's own long call, on a thread of its own, holding serve for `ms`. Returns once serve
    /// has taken it.
    fn busy(self: &Arc<Self>, ms: u64) -> std::thread::JoinHandle<()> {
        let me = Arc::clone(self);
        let t = std::thread::spawn(move || {
            me.call("changes.publish", json!({ "ms": ms })).unwrap();
        });
        let started = Instant::now();
        while !self.methods().contains(&"changes.publish".to_string()) {
            assert!(started.elapsed() < Duration::from_secs(2));
            std::thread::sleep(Duration::from_millis(5));
        }
        t
    }
}

fn plugin_dir(test: &str, permissions: &[&str], init: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("roster-core-plugin-serve-{}-{test}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let list: Vec<String> = permissions.iter().map(|p| format!("{p:?}")).collect();
    std::fs::write(
        dir.join("roster-plugin.lua"),
        format!(
            "return {{ name = \"waiter\", version = \"1.0.0\", api = 3, permissions = {{ {} }} }}",
            list.join(", ")
        ),
    )
    .unwrap();
    std::fs::write(dir.join("init.lua"), init).unwrap();
    dir
}

/// A host whose calls get their budget plus 300 ms, so a test that waits 1.5 s on serve would be
/// well past it.
fn host(serve: &Arc<SerialServe>) -> PluginHost {
    PluginHost::new(
        Arc::clone(serve) as Arc<dyn Serve>,
        Limits {
            grace: Duration::from_millis(300),
            ..Limits::default()
        },
    )
}

/// [`host`], with a listener: the replies the Plugin sends on its own come out of the receiver.
fn listening(serve: &Arc<SerialServe>) -> (PluginHost, Receiver<Reply>) {
    let host = host(serve);
    let (tx, rx) = channel();
    let tx = Mutex::new(tx);
    host.set_listener(Arc::new(move |r: Reply| {
        let _ = tx.lock().unwrap().send(r);
    }));
    (host, rx)
}

/// The notices in the next replies, until `want` of them or 3 s.
fn notices(rx: &Receiver<Reply>, want: usize) -> Vec<String> {
    let mut out = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(3);
    while out.len() < want {
        let Ok(r) = rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) else {
            break;
        };
        ok(&r);
        for op in r.ops {
            if op["op"] == "notify" {
                out.push(op["text"].as_str().unwrap().to_string());
            }
        }
    }
    out
}

fn load(host: &PluginHost, test: &str, permissions: &[&str], init: &str) -> Reply {
    let grants: Vec<Permission> = permissions.iter().map(|p| Permission::parse(p).unwrap()).collect();
    let (_, reply) = host
        .load(&Source::Dir(plugin_dir(test, permissions, init)), &grants)
        .unwrap();
    assert!(reply.error.is_none(), "{:?}", reply.error);
    reply
}

/// The handler of the command `name` among `ops`.
fn command(ops: &[Value], name: &str) -> u64 {
    ops.iter()
        .find(|o| o["op"] == "command" && o["name"] == name)
        .and_then(|o| o["run"]["handler"].as_u64())
        .unwrap_or_else(|| panic!("no command {name} in {ops:?}"))
}

fn ok(r: &Reply) {
    assert!(r.error.is_none(), "{:?}", r.error);
    assert!(r.disabled.is_none(), "{:?}", r.disabled);
}

#[test]
fn a_call_queued_behind_a_slow_serve_call_doesnt_disable_the_plugin() {
    let serve = Arc::new(SerialServe::default());
    let host = Arc::new(host(&serve));
    let loaded = load(
        &host,
        "queued",
        &["inventory.read"],
        r#"
roster.commands.add("count", { run = function() return #roster.inventory.hosts() end })
roster.commands.add("quick", { run = function() return "here" end })
"#,
    );
    let (count, quick) = (command(&loaded.ops, "count"), command(&loaded.ops, "quick"));
    // The app publishes: serve is taken for 1.5 s.
    let publish = serve.busy(1500);
    // The Plugin's call into serve waits behind it, and the user's next call into the Plugin
    // waits behind that one, on the Plugin's own thread.
    let waiting = {
        let host = Arc::clone(&host);
        std::thread::spawn(move || host.call("waiter", count, json!({ "args": "", "words": [] })))
    };
    std::thread::sleep(Duration::from_millis(50));
    let next = host.call("waiter", quick, json!({ "args": "", "words": [] }));
    ok(&next);
    assert_eq!(next.result, "here");
    let counted = waiting.join().unwrap();
    ok(&counted);
    assert_eq!(counted.result, 1);
    publish.join().unwrap();
    assert!(host.list()[0].disabled.is_none());
}

#[test]
fn a_request_returns_at_once_and_its_answer_comes_later() {
    let serve = Arc::new(SerialServe::default());
    let (host, rx) = listening(&serve);
    let loaded = load(
        &host,
        "request",
        &["serve:hosts.list", "serve:mesh.status"],
        r#"
roster.commands.add("ask", { run = function()
  roster.serve.request("hosts.list", {}, function(r, err)
    roster.notify(r and ("hosts: " .. #r.hosts .. " " .. r.hosts[1].ssh.auth) or ("failed: " .. err))
  end)
  roster.serve.request("mesh.status", nil, function(r, err)
    roster.notify(r and "mesh" or ("failed: " .. err))
  end)
  return "asked"
end })
"#,
    );
    let publish = serve.busy(1500);
    let started = Instant::now();
    let asked = host.call("waiter", command(&loaded.ops, "ask"), json!({ "args": "", "words": [] }));
    ok(&asked);
    assert_eq!(asked.result, "asked");
    assert!(started.elapsed() < Duration::from_millis(200), "{:?}", started.elapsed());
    publish.join().unwrap();
    let mut said = notices(&rx, 2);
    said.sort();
    // Login references that say how a secret is fetched come cut, as the sync call's do (Q92).
    assert_eq!(
        said,
        ["failed: roster.serve.request mesh.status: no Mesh here (code 110)", "hosts: 1 cmd:"]
    );
    settled(&host);
}

/// Waits until every request the Plugin made has answered and run.
fn settled(host: &PluginHost) {
    let started = Instant::now();
    while host.requests("waiter") > 0 {
        assert!(started.elapsed() < Duration::from_secs(3), "requests still waiting");
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn a_request_needs_its_method_granted_and_plain_params() {
    let serve = Arc::new(SerialServe::default());
    let (host, _rx) = listening(&serve);
    load(
        &host,
        "grants",
        &["serve:hosts.list"],
        r#"
local function refused(f, want)
  local ok, err = pcall(f)
  assert(not ok and err:find(want, 1, true), tostring(err))
end
refused(function() roster.serve.request("mesh.status", {}, function() end) end, "roster.serve.request: not granted (serve:mesh.status)")
refused(function() roster.serve.request("hosts.list", { f = print }, function() end) end, "roster.serve.request: f: a Lua function can't go to roster serve")
refused(function() roster.serve.request("hosts.list", {}) end, "bad argument #3")
"#,
    );
    assert!(serve.methods().is_empty());
}

#[test]
fn a_scan_is_asked_for_only_in_a_call_the_user_started_and_its_answer_is_part_of_it() {
    let serve = Arc::new(SerialServe::default());
    let (host, rx) = listening(&serve);
    let loaded = load(
        &host,
        "user",
        &["serve:discover.start", "serve:discover.status"],
        r#"
-- Never at load, or from a timer.
local ok, err = pcall(roster.serve.request, "discover.start", {}, function() end)
assert(not ok and err:find("roster.serve.request discover.start: only while the user runs", 1, true), tostring(err))
roster.defer(50, function()
  local ok2 = pcall(roster.serve.request, "discover.start", {}, function() end)
  roster.notify(ok2 and "timer started" or "timer refused")
end)
roster.commands.add("scan", { run = function()
  roster.serve.request("discover.status", {}, function(r)
    -- The answer to a request the user's call made is part of that call: it may ask a question.
    roster.confirm({ title = "Scan?", run = function() end })
    -- A request made here may scan too, but its own answer isn't the user's call any more.
    roster.serve.request("discover.start", {}, function(s)
      local ok3 = pcall(roster.confirm, { title = "Again?", run = function() end })
      roster.notify(s.scan .. (ok3 and " asked again" or " didn't ask again"))
    end)
  end)
end })
roster.commands.add("poll", { run = function()
  roster.defer(50, function()
    roster.serve.request("discover.status", {}, function()
      local ok4 = pcall(roster.confirm, { title = "From a timer?", run = function() end })
      roster.notify(ok4 and "timer asked" or "timer didn't ask")
    end)
  end)
end })
"#,
    );
    let timer = loaded.ops.iter().find(|o| o["op"] == "timer").unwrap()["run"]["handler"]
        .as_u64()
        .unwrap();
    let fired = host.call("waiter", timer, json!({}));
    ok(&fired);
    assert_eq!(fired.ops[0]["text"], "timer refused");

    ok(&host.call("waiter", command(&loaded.ops, "scan"), json!({ "args": "", "words": [] })));
    let first = rx.recv_timeout(Duration::from_secs(3)).unwrap();
    ok(&first);
    assert_eq!(first.ops[0]["op"], "confirm");
    assert_eq!(notices(&rx, 1), ["scan-1 didn't ask again"]);
    assert_eq!(serve.methods(), ["discover.status", "discover.start"]);

    let polled = host.call("waiter", command(&loaded.ops, "poll"), json!({ "args": "", "words": [] }));
    let timer = polled.ops[0]["run"]["handler"].as_u64().unwrap();
    ok(&host.call("waiter", timer, json!({})));
    assert_eq!(notices(&rx, 1), ["timer didn't ask"]);
    settled(&host);
}

#[test]
fn a_plugin_may_have_only_so_many_requests_waiting() {
    let serve = Arc::new(SerialServe::default());
    let (host, rx) = listening(&serve);
    let publish = serve.busy(800);
    load(
        &host,
        "cap",
        &["serve:hosts.list"],
        r#"
local answered = 0
for i = 1, 8 do
  roster.serve.request("hosts.list", {}, function()
    answered = answered + 1
    if answered == 8 then roster.notify("all 8") end
  end)
end
local ok, err = pcall(roster.serve.request, "hosts.list", {}, function() end)
assert(not ok and err:find("8 requests are waiting for roster serve already", 1, true), tostring(err))
"#,
    );
    publish.join().unwrap();
    assert_eq!(notices(&rx, 1), ["all 8"]);
    settled(&host);
}

#[test]
fn an_answer_after_an_unload_or_a_reload_is_dropped() {
    let serve = Arc::new(SerialServe::default());
    let (host, rx) = listening(&serve);
    let init = r#"
roster.serve.request("hosts.list", {}, function() roster.notify("answered " .. roster.plugin.version) end)
"#;
    let publish = serve.busy(400);
    load(&host, "reload", &["serve:hosts.list"], init);
    // Reloaded while its first request waits: only the second load's answer arrives.
    load(&host, "reload", &["serve:hosts.list"], init);
    publish.join().unwrap();
    assert_eq!(notices(&rx, 2), ["answered 1.0.0"]);

    let publish = serve.busy(400);
    load(&host, "reload", &["serve:hosts.list"], init);
    assert!(host.unload("waiter"));
    publish.join().unwrap();
    assert!(notices(&rx, 1).is_empty());
}
