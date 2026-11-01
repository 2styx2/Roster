//! The JSON-RPC client against a stub `roster serve` (tests/fake_serve.py).

use roster_core::rpc::{CallError, RpcClient};
use serde_json::json;
use std::process::Command;

fn fake(mode: &str) -> RpcClient {
    let mut c = Command::new("python3");
    c.arg(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fake_serve.py"))
        .arg(mode);
    RpcClient::spawn(c).expect("spawn fake serve")
}

#[test]
fn a_call_returns_the_result_object() {
    let client = fake("ok");
    let info = client.call("inventory.info", json!({})).unwrap();
    assert_eq!(info["box"], "box1");
    assert_eq!(info["api_version"], 1);
}

#[test]
fn an_error_object_comes_back_with_its_code_and_message() {
    let client = fake("ok");
    let err = client.call("host.get", json!({"name": "nope"})).unwrap_err();
    assert_eq!(
        err,
        CallError::Rpc {
            code: 2,
            message: "unknown host 'nope'".into(),
            data: None
        }
    );
}

#[test]
fn answers_in_another_order_reach_the_right_caller() {
    let client = std::sync::Arc::new(fake("reverse"));
    let c2 = std::sync::Arc::clone(&client);
    let first = std::thread::spawn(move || c2.call("host.get", json!({"name": "esxi-02"})));
    std::thread::sleep(std::time::Duration::from_millis(200));
    let second = client.call("host.get", json!({"name": "scan-1"})).unwrap();
    assert_eq!(second["name"], "scan-1");
    assert_eq!(first.join().unwrap().unwrap()["name"], "esxi-02");
}

#[test]
fn a_child_that_exits_mid_call_fails_the_call_with_its_exit_code() {
    let client = fake("die-on-hosts");
    assert!(client.call("inventory.info", json!({})).is_ok());
    let err = client.call("hosts.list", json!({})).unwrap_err();
    assert!(matches!(err, CallError::Exited { code: Some(5), .. }), "{err:?}");
    // and every later call fails at once the same way
    assert!(matches!(
        client.call("inventory.info", json!({})),
        Err(CallError::Exited { .. })
    ));
}

#[test]
fn a_child_that_exits_at_once_reports_its_stderr() {
    let client = fake("unknown-command");
    let err = client.call("inventory.info", json!({})).unwrap_err();
    match err {
        CallError::Exited { code, stderr } => {
            assert_eq!(code, Some(2));
            assert!(stderr.contains("invalid choice: 'serve'"), "{stderr}");
        }
        other => panic!("expected Exited, got {other:?}"),
    }
}

#[test]
fn notifications_go_to_the_notify_callback_and_answers_still_reach_their_caller() {
    let (tx, rx) = std::sync::mpsc::channel();
    let tx = std::sync::Mutex::new(tx);
    let mut c = Command::new("python3");
    c.arg(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fake_serve.py"))
        .arg("notify");
    let notify: roster_core::rpc::Notify = std::sync::Arc::new(move |method: &str, params| {
        let _ = tx.lock().unwrap().send((method.to_string(), params));
    });
    let client = RpcClient::spawn_with(c, Some(notify)).expect("spawn fake serve");
    assert_eq!(client.call("inventory.watch", json!({})).unwrap()["watching"], true);
    let (method, params) = rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
    assert_eq!(method, "inventory.changed");
    assert_eq!(params["applied"], true);
}

/// Closing the client closes serve's stdin and waits for it to exit on its own before killing it:
/// serve stops a running background Mesh job then and records what it didn't finish (decision
/// Q101), which takes it a moment, so the wait is longer than that.
#[test]
fn dropping_the_client_gives_serve_time_to_wind_down_on_its_own() {
    let marker = std::env::temp_dir().join(format!("roster-core-rpc-slow-exit-{}", std::process::id()));
    let _ = std::fs::remove_file(&marker);
    let mut c = Command::new("python3");
    c.arg(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fake_serve.py"))
        .arg("slow-exit")
        .arg(&marker);
    let client = RpcClient::spawn(c).expect("spawn fake serve");
    drop(client);
    assert!(marker.exists(), "serve was killed before it could finish winding down");
    let _ = std::fs::remove_file(&marker);
}
