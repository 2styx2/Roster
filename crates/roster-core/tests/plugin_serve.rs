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
