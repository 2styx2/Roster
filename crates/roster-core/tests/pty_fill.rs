//! Filling a password prompt (ticket 119, decision Q129): `SessionManager::fill` types a Host
//! Session's secret into its PTY only after a probe shows the prompt doesn't echo, and never
//! into a Session with no Host. Real PTYs with `sh` standing in for the Host's prompt. Unix
//! only, as pty.rs.
#![cfg(unix)]

use roster_core::session::{FillError, Secret, SessionCommand, SessionEvent, SessionManager, Size};
use std::sync::mpsc::{Receiver, channel};
use std::time::{Duration, Instant};

const SIZE: Size = Size { cols: 80, rows: 24 };
const WAIT: Duration = Duration::from_millis(300);
const SECRET: &str = "s3cret-pw";

fn host_sh(script: &str) -> SessionCommand {
    let mut cmd = SessionCommand::new(vec!["sh".into(), "-c".into(), script.into()], vec![]);
    cmd.host = Some("esx".into());
    cmd
}

fn open(m: &SessionManager, cmd: SessionCommand) -> (u32, Receiver<SessionEvent>) {
    let (tx, rx) = channel();
    let id = m
        .open(&cmd, SIZE, move |e| {
            let _ = tx.send(e);
        })
        .expect("spawn");
    (id, rx)
}

/// Everything printed until `needle` (panics after 10 s).
fn until(rx: &Receiver<SessionEvent>, needle: &str) -> String {
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut seen = Vec::new();
    while Instant::now() < deadline {
        if let Ok(SessionEvent::Output(b)) = rx.recv_timeout(Duration::from_millis(50)) {
            seen.extend_from_slice(&b);
            let s = String::from_utf8_lossy(&seen).into_owned();
            if s.contains(needle) {
                return s;
            }
        }
    }
    panic!("no {needle:?} within 10 s; saw {:?}", String::from_utf8_lossy(&seen));
}

/// What's printed in the next `d`.
fn quiet_for(rx: &Receiver<SessionEvent>, d: Duration) -> String {
    let deadline = Instant::now() + d;
    let mut seen = Vec::new();
    while Instant::now() < deadline {
        if let Ok(SessionEvent::Output(b)) = rx.recv_timeout(Duration::from_millis(20)) {
            seen.extend_from_slice(&b);
        }
    }
    String::from_utf8_lossy(&seen).into_owned()
}

fn secret() -> Result<Secret, String> {
    Ok(Secret::new(SECRET.to_string()))
}

/// A prompt that turns echo off, as sudo's does, and reports what it read.
const NO_ECHO: &str = "stty -echo; printf 'Password: '; read -r pw; stty echo; echo; echo \"got:[$pw]\"; sleep 5";

#[test]
fn a_no_echo_prompt_gets_the_secret_and_enter() {
    let m = SessionManager::new();
    let (id, rx) = open(&m, host_sh(NO_ECHO));
    until(&rx, "Password: ");
    let mut asked = None;
    let host = m
        .fill(id, WAIT, |h| {
            asked = Some(h.to_string());
            secret()
        })
        .expect("filled");
    assert_eq!((host.as_str(), asked.as_deref()), ("esx", Some("esx")));
    let out = until(&rx, "got:");
    let out = out + &quiet_for(&rx, Duration::from_millis(200));
    assert!(out.contains(&format!("got:[{SECRET}]")), "{out:?}");
    // The secret came back only in the stand-in's own report, never as an echo of the fill.
    assert_eq!(out.matches(SECRET).count(), 1, "{out:?}");
    m.close(id).unwrap();
}

#[test]
fn what_was_typed_at_the_prompt_before_is_cleared_first() {
    let m = SessionManager::new();
    let (id, rx) = open(&m, host_sh(NO_ECHO));
    until(&rx, "Password: ");
    m.write(id, b"half-typ").unwrap();
    std::thread::sleep(Duration::from_millis(100));
    m.fill(id, WAIT, |_| secret()).expect("filled");
    let out = until(&rx, "got:") + &quiet_for(&rx, Duration::from_millis(200));
    assert!(out.contains(&format!("got:[{SECRET}]")), "{out:?}");
    m.close(id).unwrap();
}

#[test]
fn an_echoing_prompt_is_refused_and_the_secret_never_typed() {
    let m = SessionManager::new();
    let (id, rx) = open(
        &m,
        host_sh("printf 'Password: '; read -r pw; echo \"got:[$pw]\"; sleep 5"),
    );
    until(&rx, "Password: ");
    let err = m.fill(id, WAIT, |_| secret()).unwrap_err();
    assert!(matches!(err, FillError::Echoes), "{err:?}");
    // The probe's letter was echoed and taken back; nothing else reached the prompt.
    m.write(id, b"\r").unwrap();
    let out = until(&rx, "got:") + &quiet_for(&rx, Duration::from_millis(200));
    assert!(out.contains("got:[]"), "{out:?}");
    assert!(!out.contains(SECRET), "{out:?}");
    m.close(id).unwrap();
}

#[test]
fn output_while_it_checks_refuses_too() {
    let m = SessionManager::new();
    let script =
        "stty -echo; printf 'Password: '; (sleep 0.1; echo late output) & read -r pw; echo \"got:[$pw]\"; sleep 5";
    let (id, rx) = open(&m, host_sh(script));
    until(&rx, "Password: ");
    let err = m.fill(id, WAIT, |_| secret()).unwrap_err();
    assert!(matches!(err, FillError::Echoes), "{err:?}");
    m.close(id).unwrap();
}

#[test]
fn keys_typed_while_it_checks_refuse() {
    let m = std::sync::Arc::new(SessionManager::new());
    let (id, rx) = open(&m, host_sh(NO_ECHO));
    until(&rx, "Password: ");
    let typer = {
        let m = std::sync::Arc::clone(&m);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            m.write(id, b"a").unwrap();
        })
    };
    let err = m.fill(id, WAIT, |_| secret()).unwrap_err();
    typer.join().unwrap();
    assert!(matches!(err, FillError::Typed), "{err:?}");
    m.close(id).unwrap();
}

#[test]
fn a_refused_lookup_types_nothing() {
    let m = SessionManager::new();
    let (id, rx) = open(
        &m,
        host_sh("printf 'Password: '; read -r pw; echo \"got:[$pw]\"; sleep 5"),
    );
    until(&rx, "Password: ");
    let err = m
        .fill(id, WAIT, |_| Err::<Secret, _>("locked".to_string()))
        .unwrap_err();
    assert!(matches!(&err, FillError::Lookup(e) if e == "locked"), "{err:?}");
    // Not even the probe: an echoing prompt shows nothing.
    assert_eq!(quiet_for(&rx, Duration::from_millis(200)), "");
    m.close(id).unwrap();
}

#[test]
fn a_session_with_no_host_is_never_filled() {
    let m = SessionManager::new();
    let cmd = SessionCommand::new(vec!["sh".into(), "-c".into(), NO_ECHO.into()], vec![]);
    let (id, rx) = open(&m, cmd);
    until(&rx, "Password: ");
    let mut asked = false;
    let err = m
        .fill(id, WAIT, |_| {
            asked = true;
            secret()
        })
        .unwrap_err();
    assert!(matches!(err, FillError::NoHost) && !asked, "{err:?}");
    m.close(id).unwrap();
}

#[test]
fn an_ended_session_is_not_found() {
    let m = SessionManager::new();
    let err = m.fill(42, WAIT, |_| secret()).unwrap_err();
    assert!(matches!(err, FillError::NotFound(42)), "{err:?}");
}

#[test]
fn a_secret_never_prints() {
    let s = Secret::new(SECRET.to_string());
    assert!(!format!("{s:?}").contains(SECRET));
    let e: FillError<String> = FillError::Echoes;
    assert!(!format!("{e} {e:?}").contains(SECRET));
}
