//! Runs a command in a Session PTY and prints what the sink gets, like the app would see it:
//! `cargo run --example session -- wsl.exe -d FedoraLinux-44 --exec sh -c 'stty size; exit 3'`.
//! Answers ConPTY's cursor-position request (`ESC[6n`) the way xterm.js does.

use roster_core::session::{SessionCommand, SessionEvent, SessionManager, Size};
use std::sync::mpsc::channel;
use std::time::Duration;

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    if argv.is_empty() {
        eprintln!("usage: session <command> [args...]");
        std::process::exit(2);
    }
    let m = SessionManager::new();
    let (tx, rx) = channel();
    let id = m
        .open(
            &SessionCommand::new(argv, vec![]),
            Size { cols: 80, rows: 24 },
            move |e| {
                let _ = tx.send(e);
            },
        )
        .expect("spawn");
    loop {
        match rx.recv_timeout(Duration::from_secs(20)) {
            Ok(SessionEvent::Output(b)) => {
                println!("output {:?}", String::from_utf8_lossy(&b));
                if b.windows(4).any(|w| w == b"\x1b[6n") {
                    m.write(id, b"\x1b[1;1R").unwrap();
                }
            }
            Ok(SessionEvent::Exit(e)) => {
                println!("exit {e:?}");
                break;
            }
            Err(_) => {
                println!("nothing for 20 s; closing");
                m.close(id).unwrap();
            }
        }
    }
}
