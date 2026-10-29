//! Sessions: the command `session.prepare` hands back, run in a PTY on the Backend's target.
//!
//! [`session_command`] turns a [`Prepared`] into a runnable command line (through `wsl.exe --exec
//! env K=V …` on WSL). [`SessionManager`] owns the running Sessions: it spawns each in a PTY,
//! streams its output to a sink, takes input and resizes, and reports how it ended. Session ids
//! belong to the manager.
//!
//! The env can hold an askpass token (ticket 06), so nothing here prints env values: the Debug
//! impls show variable names only.

use crate::detect::Target;
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;

/// Forced on every Session: xterm.js is a 256-colour xterm.
pub const TERM: &str = "xterm-256color";

/// `session.prepare`'s result (roster README, "Sessions: `session.prepare`").
#[derive(Clone, Deserialize)]
pub struct Prepared {
    /// What to run, as given; `argv[0]` is an absolute path.
    pub argv: Vec<String>,
    /// Variables to add. May carry a one-time askpass token: never log the values.
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    pub host: String,
    /// "key" or "password".
    pub auth: String,
}

impl std::fmt::Debug for Prepared {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Prepared")
            .field("argv", &self.argv)
            .field("env", &self.env.keys().collect::<Vec<_>>())
            .field("host", &self.host)
            .field("auth", &self.auth)
            .finish()
    }
}

/// A command line ready to start in a PTY.
#[derive(Clone, PartialEq, Eq)]
pub struct SessionCommand {
    pub argv: Vec<String>,
    /// Set on the process itself (only on the Local target; on WSL it's inside `argv`).
    pub env: Vec<(String, String)>,
    /// How the Session logs in, as `session.prepare` said: "key" or "password" (shown on the tab).
    pub auth: String,
    /// Names of the variables carried in `argv` as `K=V`, so Debug can hide their values.
    hidden: Vec<String>,
}

impl SessionCommand {
    /// A command with no env to hide (tests, stub commands).
    pub fn new(argv: Vec<String>, env: Vec<(String, String)>) -> Self {
        SessionCommand {
            argv,
            env,
            auth: "key".into(),
            hidden: Vec::new(),
        }
    }

    /// The env this command adds, wherever it travels (on the process, or as `K=V` in `argv`).
    fn env_pairs(&self) -> impl Iterator<Item = (&str, &str)> {
        let in_argv = self
            .argv
            .iter()
            .filter_map(|a| a.split_once('=').filter(|(k, _)| self.hidden.iter().any(|h| h == k)));
        let on_process = self.env.iter().map(|(k, v)| (k.as_str(), v.as_str()));
        in_argv.chain(on_process)
    }

    /// `text` (an error about this command) with every env value replaced by `…`, so a message
    /// that quotes the command line (ConPTY's spawn failure does) can't show an askpass token.
    pub fn redact(&self, text: &str) -> String {
        let mut out = text.to_string();
        for (k, v) in self.env_pairs() {
            out = out.replace(&format!("{k}={v}"), &format!("{k}=…"));
        }
        for (_, v) in self.env_pairs() {
            if v.len() >= 6 {
                out = out.replace(v, "…");
            }
        }
        out
    }
}

impl std::fmt::Debug for SessionCommand {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let argv: Vec<String> = self
            .argv
            .iter()
            .map(|a| match a.split_once('=') {
                Some((k, _)) if self.hidden.iter().any(|h| h == k) => format!("{k}=…"),
                _ => a.clone(),
            })
            .collect();
        let env: Vec<String> = self.env.iter().map(|(k, _)| format!("{k}=…")).collect();
        f.debug_struct("SessionCommand")
            .field("argv", &argv)
            .field("env", &env)
            .field("auth", &self.auth)
            .finish()
    }
}

/// The command that opens `prepared` on `target`, with `TERM` forced to [`TERM`].
pub fn session_command(target: &Target, prepared: &Prepared) -> SessionCommand {
    let mut env = vec![("TERM".to_string(), TERM.to_string())];
    env.extend(prepared.env.iter().map(|(k, v)| (k.clone(), v.clone())));
    match target {
        Target::Local => SessionCommand {
            argv: prepared.argv.clone(),
            env,
            auth: prepared.auth.clone(),
            hidden: Vec::new(),
        },
        Target::Wsl { .. } => {
            let mut inner = vec!["env".to_string()];
            inner.extend(env.iter().map(|(k, v)| format!("{k}={v}")));
            inner.extend(prepared.argv.iter().cloned());
            SessionCommand {
                argv: target.wrap(&inner),
                env: Vec::new(),
                auth: prepared.auth.clone(),
                hidden: env.into_iter().map(|(k, _)| k).collect(),
            }
        }
    }
}

/// The core's own name for a Session.
pub type SessionId = u32;

/// A terminal size in character cells.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub struct Size {
    pub cols: u16,
    pub rows: u16,
}

impl From<Size> for PtySize {
    fn from(s: Size) -> PtySize {
        PtySize {
            rows: s.rows.max(1),
            cols: s.cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        }
    }
}

/// How a Session ended.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Exit {
    /// The exit code; `None` when a signal ended it.
    pub code: Option<u32>,
    /// True when the app closed it ([`SessionManager::close`]): the code is then meaningless
    /// (on Windows, closing gives `0xC000013A`).
    pub closed: bool,
}

/// What a Session's sink receives: output in order, then exactly one Exit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionEvent {
    Output(Vec<u8>),
    Exit(Exit),
}

#[derive(Debug)]
pub enum SessionError {
    /// No open Session has this id (it ended, or never existed).
    NotFound(SessionId),
    /// The PTY or the process failed.
    Io(String),
}

impl std::fmt::Display for SessionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SessionError::NotFound(id) => write!(f, "session {id} isn't open"),
            SessionError::Io(m) => f.write_str(m),
        }
    }
}

impl std::error::Error for SessionError {}

fn io(e: impl std::fmt::Display) -> SessionError {
    SessionError::Io(e.to_string())
}

/// Output is read in chunks of up to this many bytes (each becomes one sink call).
const READ_CHUNK: usize = 16 * 1024;
/// After the process exits, how long to wait for the PTY's last output before reporting Exit
/// anyway (a background child can hold the PTY open).
const DRAIN_TIMEOUT: Duration = Duration::from_secs(2);

struct Running {
    /// Dropped (closing the PTY) once the process ends or the Session is closed.
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    closed: AtomicBool,
}

impl Running {
    fn release_pty(&self) {
        self.writer.lock().unwrap().take();
        self.master.lock().unwrap().take();
    }
}

/// Every running Session. Cheap to share: clone the `Arc` it lives in.
#[derive(Default)]
pub struct SessionManager {
    next_id: AtomicU32,
    sessions: Arc<Mutex<HashMap<SessionId, Arc<Running>>>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Starts `cmd` in a new PTY of `size`. `sink` gets the output as it comes, then one Exit,
    /// from the Session's own threads.
    pub fn open(
        &self,
        cmd: &SessionCommand,
        size: Size,
        sink: impl Fn(SessionEvent) + Send + Sync + 'static,
    ) -> Result<SessionId, SessionError> {
        let (program, args) = cmd
            .argv
            .split_first()
            .ok_or_else(|| SessionError::Io("empty command".into()))?;
        let pair = native_pty_system().openpty(size.into()).map_err(io)?;
        let mut builder = CommandBuilder::new(program);
        builder.args(args);
        for (k, v) in &cmd.env {
            builder.env(k, v);
        }
        let mut child = pair
            .slave
            .spawn_command(builder)
            .map_err(|e| SessionError::Io(cmd.redact(&e.to_string())))?;
        drop(pair.slave);
        let reader = pair.master.try_clone_reader().map_err(io)?;
        let writer = pair.master.take_writer().map_err(io)?;
        let running = Arc::new(Running {
            killer: Mutex::new(child.clone_killer()),
            master: Mutex::new(Some(pair.master)),
            writer: Mutex::new(Some(writer)),
            closed: AtomicBool::new(false),
        });
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        self.sessions.lock().unwrap().insert(id, Arc::clone(&running));

        let sink = Arc::new(sink);
        let (drained_tx, drained) = mpsc::channel::<()>();
        let out = Arc::clone(&sink);
        std::thread::Builder::new()
            .name(format!("session-{id}-read"))
            .spawn(move || {
                pump(reader, |chunk| out(SessionEvent::Output(chunk)));
                let _ = drained_tx.send(());
            })
            .map_err(io)?;

        let sessions = Arc::clone(&self.sessions);
        std::thread::Builder::new()
            .name(format!("session-{id}-wait"))
            .spawn(move || {
                let status = child.wait();
                // On Windows the reader only ends once the pseudo console is closed.
                running.release_pty();
                let _ = drained.recv_timeout(DRAIN_TIMEOUT);
                sessions.lock().unwrap().remove(&id);
                let code = match &status {
                    Ok(s) if s.signal().is_none() => Some(s.exit_code()),
                    _ => None,
                };
                sink(SessionEvent::Exit(Exit {
                    code,
                    closed: running.closed.load(Ordering::SeqCst),
                }));
            })
            .map_err(io)?;
        Ok(id)
    }

    fn get(&self, id: SessionId) -> Result<Arc<Running>, SessionError> {
        self.sessions
            .lock()
            .unwrap()
            .get(&id)
            .cloned()
            .ok_or(SessionError::NotFound(id))
    }

    /// Sends keystrokes (or pasted text) to the Session.
    pub fn write(&self, id: SessionId, data: &[u8]) -> Result<(), SessionError> {
        let running = self.get(id)?;
        let mut w = running.writer.lock().unwrap();
        let w = w.as_mut().ok_or(SessionError::NotFound(id))?;
        w.write_all(data).and_then(|_| w.flush()).map_err(io)
    }

    pub fn resize(&self, id: SessionId, size: Size) -> Result<(), SessionError> {
        let running = self.get(id)?;
        let m = running.master.lock().unwrap();
        m.as_ref()
            .ok_or(SessionError::NotFound(id))?
            .resize(size.into())
            .map_err(io)
    }

    /// Ends the Session: kills the process (SIGHUP on Unix, TerminateProcess on Windows) and
    /// closes the PTY. Its Exit still arrives, with `closed: true`. Closing a Session that has
    /// already ended does nothing.
    pub fn close(&self, id: SessionId) -> Result<(), SessionError> {
        let Ok(running) = self.get(id) else {
            return Ok(());
        };
        running.closed.store(true, Ordering::SeqCst);
        let _ = running.killer.lock().unwrap().kill();
        running.release_pty();
        Ok(())
    }

    /// Closes every Session (the app is quitting).
    pub fn close_all(&self) {
        let ids: Vec<SessionId> = self.sessions.lock().unwrap().keys().copied().collect();
        for id in ids {
            let _ = self.close(id);
        }
    }

    /// How many Sessions are running.
    pub fn len(&self) -> usize {
        self.sessions.lock().unwrap().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// Copies `reader` to `emit` in chunks until EOF or an error (EIO once the PTY closes on Linux).
fn pump(mut reader: Box<dyn Read + Send>, emit: impl Fn(Vec<u8>)) {
    let mut buf = vec![0u8; READ_CHUNK];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => return,
            Ok(n) => emit(buf[..n].to_vec()),
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(_) => return,
        }
    }
}
