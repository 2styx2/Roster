//! The Plugin API's version 3 (tickets 74 and 60): `inventory.host()` gives `nil` for an unknown
//! name, `inventory.groups()`, Login references that say how a secret is fetched kept from
//! Plugins, errors that name the function, `coroutine`, removals that check their ids, and
//! handlers that hear which thing ran them. Driven through `PluginHost`, as the Tauri shell does.

use roster_core::plugin::{Limits, Permission, PluginHost, Serve, Source};
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::Arc;

struct FakeServe;

impl Serve for FakeServe {
    fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let esx = json!({
            "name": "esx-02", "ip": "10.0.0.5", "group": "lab",
            "ssh": { "user": "root", "port": 22, "auth": "cmd:pass show lab/esx-02 --hunter2" },
            "auth": "cmd:pass show lab/esx-02 --hunter2",
            "login": { "user": "admin", "auth": "env:ESX_PASSWORD" },
            "services": { "web": { "port": 443, "auth": "bw:esx-02 web" } }
        });
        match method {
            "hosts.list" => Ok(json!({
                "hosts": [esx],
                "groups": { "lab": { "title": "The lab", "description": "" } }
            })),
            "host.get" if params["name"] == "esx-02" => Ok(esx),
            "host.get" => Err(format!(
                "unknown host '{}' (code 2)",
                params["name"].as_str().unwrap_or("")
            )),
            other => Err(format!("unknown method {other} (code -32601)")),
        }
    }
}

fn plugin_dir(test: &str, permissions: &[&str], init: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("roster-core-plugin-v3-{}-{test}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let list: Vec<String> = permissions.iter().map(|p| format!("{p:?}")).collect();
    let manifest = format!(
        "return {{ name = \"t\", version = \"1.0.0\", api = 3, permissions = {{ {} }} }}",
        list.join(", ")
    );
    std::fs::write(dir.join("roster-plugin.lua"), manifest).unwrap();
    std::fs::write(dir.join("init.lua"), init).unwrap();
    dir
}

/// Loads `init` with `permissions` granted; gives the host and the load's ops.
fn load(test: &str, permissions: &[&str], init: &str) -> (PluginHost, Vec<Value>, Option<String>) {
    let host = PluginHost::new(Arc::new(FakeServe), Limits::default());
    let grants: Vec<Permission> = permissions.iter().map(|p| Permission::parse(p).unwrap()).collect();
    let (_, reply) = host
        .load(&Source::Dir(plugin_dir(test, permissions, init)), &grants)
        .unwrap();
    (host, reply.ops, reply.error.map(|e| e.to_string()))
}

/// The text of the status segment `id` the ops set.
fn said(ops: &[Value], id: &str) -> String {
    ops.iter()
        .find(|o| o["op"] == "status" && o["id"] == id)
        .and_then(|o| o["spec"]["text"].as_str())
        .unwrap_or_else(|| panic!("no status {id} in {ops:?}"))
        .to_string()
}

#[test]
fn the_api_version_is_3() {
    let (_, ops, error) = load(
        "version",
        &[],
        r#"roster.status.set("v", { text = tostring(roster.api_version) })"#,
    );
    assert_eq!(error, None);
    assert_eq!(said(&ops, "v"), "3");
}

#[test]
fn an_unknown_host_is_nil_and_a_known_one_a_table() {
    let (_, ops, error) = load(
        "host-nil",
        &["inventory.read"],
        r#"
        local none = roster.inventory.host("web-9")
        local one = roster.inventory.host("esx-02")
        roster.status.set("v", { text = tostring(none) .. " " .. one.ip })
        "#,
    );
    assert_eq!(error, None);
    assert_eq!(said(&ops, "v"), "nil 10.0.0.5");
}

#[test]
fn a_plugin_with_inventory_read_gets_the_groups() {
    let (_, ops, error) = load(
        "groups",
        &["inventory.read"],
        r#"
        local groups = roster.inventory.groups()
        roster.status.set("v", { text = groups.lab.title })
        "#,
    );
    assert_eq!(error, None);
    assert_eq!(said(&ops, "v"), "The lab");
}

/// A `cmd:` or `env:` reference says how a secret is fetched (and a secret pasted into a `cmd:`
/// line would show): a Plugin sees only which kind it is (decision Q92).
#[test]
fn cmd_and_env_references_reach_a_plugin_without_their_text() {
    let (_, ops, error) = load(
        "redact",
        &["inventory.read", "serve:hosts.list"],
        r#"
        local h = roster.inventory.host("esx-02")
        local l = roster.inventory.hosts()[1]
        local s = roster.serve.call("hosts.list").hosts[1]
        roster.status.set("v", { text = table.concat({ h.ssh.auth, h.auth, h.login.auth, h.services.web.auth,
          l.ssh.auth, l.login.auth, s.ssh.auth, s.auth }, "|") })
        "#,
    );
    assert_eq!(error, None);
    assert_eq!(said(&ops, "v"), "cmd:|cmd:|env:|bw:esx-02 web|cmd:|env:|cmd:|cmd:");
}

/// What `pcall(f, …)` said, as the status segment `v`.
fn error_of(test: &str, call: &str) -> String {
    let init = format!(
        "local ok, err = pcall(function() {call} end)\nroster.status.set(\"v\", {{ text = tostring(ok) .. \" \" .. tostring(err) }})"
    );
    let (_, ops, error) = load(test, &[], &init);
    assert_eq!(error, None);
    said(&ops, "v")
}

#[test]
fn data_that_cant_be_handed_over_names_the_function_and_says_plugin_value() {
    let text = error_of(
        "data-error",
        r#"roster.sidebar.set("x", { rows = { { label = coroutine.create(function() end) } } })"#,
    );
    assert_eq!(
        text,
        "false roster.sidebar.set: rows.1.label: a thread can't be a Plugin value"
    );
    let text = error_of(
        "data-error-float",
        r#"roster.float.open({ title = {}, lines = { true, 1, { 2 } }, x = 1 / 0 })"#,
    );
    assert!(text.starts_with("false roster.float.open: "), "{text}");
}

#[test]
fn removing_checks_the_id_like_setting_does() {
    for (call, what) in [
        ("roster.sidebar.remove(\"Bad Id\")", "roster.sidebar.remove"),
        ("roster.commands.remove(\"no spaces\")", "roster.commands.remove"),
        ("roster.themes.remove(\"\")", "roster.themes.remove"),
    ] {
        let text = error_of("remove-id", call);
        assert!(
            text.starts_with(&format!("false {what}: ")) && text.contains("isn't a name like"),
            "{call}: {text}"
        );
    }
}

#[test]
fn a_plugin_takes_away_its_theme_and_key_binding() {
    let (_, ops, error) = load(
        "removals",
        &[],
        r#"
        roster.themes.remove("dusk")
        roster.keymap.del("leader", "w w")
        roster.keymap.set("leader", "w x", false)
        "#,
    );
    assert_eq!(error, None);
    assert_eq!(
        ops,
        [
            json!({ "op": "remove", "kind": "theme", "id": "dusk" }),
            json!({ "op": "key", "context": "leader", "keys": "w w", "action": false }),
            json!({ "op": "key", "context": "leader", "keys": "w x", "action": false }),
        ]
    );
}

#[test]
fn coroutines_work_and_cant_outrun_the_budget() {
    let (_, ops, error) = load(
        "coroutine",
        &[],
        r#"
        local gen = coroutine.wrap(function() for i = 1, 3 do coroutine.yield(i) end end)
        roster.status.set("v", { text = gen() .. gen() .. gen() })
        "#,
    );
    assert_eq!(error, None);
    assert_eq!(said(&ops, "v"), "123");
    // An endless loop inside a coroutine is stopped, and resume can't swallow that.
    let (_, _, error) = load(
        "coroutine-loop",
        &[],
        r#"
        local co = coroutine.create(function() while true do end end)
        local ok = coroutine.resume(co)
        roster.status.set("v", { text = "carried on" })
        "#,
    );
    let error = error.expect("it ran out of time");
    assert!(error.contains("an endless loop?"), "{error}");
}
