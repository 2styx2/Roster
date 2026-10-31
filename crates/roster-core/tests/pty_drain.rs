//! A Session whose command leaves a background process holding the PTY: the sink still gets
//! exactly one Exit, last, and the Session's reader thread ends instead of pumping forever.
//! Its own test binary, so no other test's `session-1-read` thread is in the process.
#![cfg(target_os = "linux")]

use roster_core::session::{SessionCommand, SessionEvent, SessionManager, Size};
use std::sync::mpsc::channel;
use std::time::{Duration, Instant};

/// Names of this process's threads (Linux keeps them in /proc/self/task/*/comm).
fn thread_names() -> Vec<String> {
    std::fs::read_dir("/proc/self/task")
        .unwrap()
        .filter_map(|t| std::fs::read_to_string(t.ok()?.path().join("comm")).ok())
        .map(|s| s.trim().to_string())
        .collect()
}

#[test]
fn a_background_process_holding_the_pty_gets_no_output_past_the_exit_and_no_reader_left() {
    let m = SessionManager::new();
    // The background job ignores the SIGHUP the shell's exit sends (the trap is set before the
    // fork, so it's inherited), keeps the PTY open, prints again well after the drain timeout
    // (2 s), then holds the PTY past the end of the test.
    let script = "trap '' HUP; (sleep 4; echo late-output; exec sleep 30) & echo bg:$!; exit 0";
    let cmd = SessionCommand::new(vec!["sh".into(), "-c".into(), script.into()], vec![]);
    let (tx, rx) = channel();
    let id = m
        .open(&cmd, Size { cols: 80, rows: 24 }, move |e| {
            let _ = tx.send(e);
        })
        .unwrap();

    let mut events = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(6);
    while Instant::now() < deadline {
        if let Ok(e) = rx.recv_timeout(Duration::from_millis(100)) {
            events.push(e);
        }
    }
    let out: String = events
        .iter()
        .filter_map(|e| match e {
            SessionEvent::Output(b) => Some(String::from_utf8_lossy(b).into_owned()),
            _ => None,
        })
        .collect();
    let bg = out.split("bg:").nth(1).and_then(|r| r.split_whitespace().next());
    let reader = format!("session-{id}-read");
    let threads = thread_names();
    if let Some(pid) = bg {
        let _ = std::process::Command::new("kill").arg(pid).status();
    }
    let exits = events.iter().filter(|e| matches!(e, SessionEvent::Exit(_))).count();
    assert_eq!(exits, 1, "{events:?}");
    assert!(matches!(events.last(), Some(SessionEvent::Exit(_))), "{events:?}");
    assert!(!threads.contains(&reader), "{reader} still running: {threads:?}");
}
