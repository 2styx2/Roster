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
