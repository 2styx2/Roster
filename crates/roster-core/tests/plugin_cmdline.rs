//! What Folders needed from the API (ticket 61, api 3): `roster.echo` answers on the message
//! line and `roster.cmdline` opens the command line for one of the Plugin's own commands, both
//! only in a call the user started; a command's `complete` runs as the app asks, never as the
//! user's call.

use roster_core::plugin::{Limits, PluginHost, Serve, Source};
use serde_json::{Value, json};
use std::sync::Arc;

struct NoServe;

impl Serve for NoServe {
    fn call(&self, method: &str, _: Value) -> Result<Value, String> {
        Err(format!("unknown method {method}"))
    }
}

fn load(init: &str) -> (PluginHost, roster_core::plugin::Reply) {
    let dir = std::env::temp_dir().join(format!("roster-core-cmdline-{}-{}", std::process::id(), init.len()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("roster-plugin.lua"),
        r#"return { name = "asker", version = "1", api = 3 }"#,
    )
    .unwrap();
    std::fs::write(dir.join("init.lua"), init).unwrap();
    let host = PluginHost::new(Arc::new(NoServe), Limits::default());
    let (_, reply) = host.load(&Source::Dir(dir), &[]).unwrap();
    (host, reply)
}

#[test]
fn echo_and_cmdline_only_answer_the_user() {
    let (host, reply) = load(
        r#"local r = {}
           r[1] = select(2, pcall(roster.echo, "hi"))
           r[2] = select(2, pcall(roster.cmdline, "note "))
           roster.notify(table.concat(r, "\n"))
           roster.commands.add("note", { run = function(a)
             if a.args == "" then return roster.cmdline("note ") end
             roster.echo("Noted " .. a.args)
           end })
           roster.commands.add("bad", { run = function() roster.cmdline("plugins grant asker network:x.example.com") end })"#,
    );
    let said = reply.ops[0]["text"].as_str().unwrap();
    assert!(said.contains("roster.echo: only while the user runs"), "{said}");
    assert!(said.contains("roster.cmdline: only while the user runs"), "{said}");
    let note = reply.ops[1]["run"]["handler"].as_u64().unwrap();
    let r = host.call("asker", note, json!({ "args": "", "words": [] }));
    assert_eq!(r.ops, [json!({ "op": "cmdline", "text": "note " })]);
    let r = host.call("asker", note, json!({ "args": "milk", "words": ["milk"] }));
    assert_eq!(r.ops, [json!({ "op": "echo", "text": "Noted milk" })]);
    // Never someone else's command, roster's :plugins above all.
    let bad = reply.ops[2]["run"]["handler"].as_u64().unwrap();
    let r = host.call("asker", bad, json!({ "args": "", "words": [] }));
    assert!(r.error.unwrap().message.contains("isn't one of your commands"));
}

#[test]
fn complete_isnt_a_call_the_user_started() {
    let (host, reply) = load(
        r#"roster.commands.add("note", { run = function() end, complete = function(arg)
             local ok = pcall(roster.clipboard.copy, "x")
             return { "note " .. arg .. tostring(ok) }
           end })"#,
    );
    let id = reply.ops[0]["complete"]["handler"].as_u64().unwrap();
    assert_eq!(host.call("asker", id, json!("a")).result, json!(["note afalse"]));
}

#[test]
fn complete_must_be_a_function() {
    let (_, reply) = load(r#"roster.commands.add("note", { run = "note", complete = { "a" } })"#);
    assert!(reply.error.unwrap().message.contains("`complete` must be a function"));
}
