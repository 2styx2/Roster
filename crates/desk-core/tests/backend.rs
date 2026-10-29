//! Starting `roster serve` and checking it: a stub serve (tests/fake_serve.py) in each failure mode
//! must come out as the error the error screen explains.

use desk_core::backend::Backend;
use desk_core::detect::{Candidate, ErrorKind, Target};

fn fake(mode: &str) -> Candidate {
    let script = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fake_serve.py");
    Candidate {
        target: Target::Local,
        serve_argv: vec!["python3".into(), script.into(), mode.into()],
        has_inventory: true,
    }
}

#[test]
fn a_current_roster_starts_and_reports_its_inventory() {
    let b = Backend::start(&fake("ok")).unwrap();
    assert_eq!(b.info.backend, "Local");
    assert_eq!(b.info.inventory["host_count"], 2);
    assert_eq!(
        b.call("hosts.list", serde_json::json!({})).unwrap()["hosts"][1]["name"],
        "scan-1"
    );
}

#[test]
fn an_api_older_than_required_is_too_old() {
    let e = Backend::start(&fake("old-api")).err().unwrap();
    assert_eq!(e.kind, ErrorKind::RosterTooOld);
    assert!(e.message.contains("API version 0"), "{}", e.message);
}

#[test]
fn a_roster_without_serve_is_too_old_and_points_at_the_override() {
    let e = Backend::start(&fake("unknown-command")).err().unwrap();
    assert_eq!(e.kind, ErrorKind::RosterTooOld);
    assert!(e.hint.contains("ROSTER_DESK_ROSTER"), "{}", e.hint);
    assert!(e.detail.unwrap().contains("invalid choice"));
}

#[test]
fn no_inventory_is_inventory_not_found_with_roster_wording() {
    let e = Backend::start(&fake("no-inventory")).err().unwrap();
    assert_eq!(e.kind, ErrorKind::InventoryNotFound);
    assert!(e.message.contains("no roster.yml found"), "{}", e.message);
}

#[test]
fn a_command_that_cannot_start_is_a_failure_naming_it() {
    let c = Candidate {
        target: Target::Local,
        serve_argv: vec!["/nonexistent/roster".into(), "serve".into()],
        has_inventory: true,
    };
    let e = Backend::start(&c).err().unwrap();
    assert_eq!(e.kind, ErrorKind::Failed);
    assert!(e.detail.unwrap().contains("/nonexistent/roster"));
}
