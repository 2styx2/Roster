//! Sessions: the command `session.prepare` hands back, run in a PTY on the Backend's target.
//!
//! [`session_command`] turns a [`Prepared`] into a runnable command line (through `wsl.exe --exec`
//! on WSL, with the env on wsl.exe's process and named in `WSLENV`). [`SessionManager`] owns the running Sessions: it spawns each in a PTY,
//! streams its output to a sink, takes input and resizes, and reports how it ended. Session ids
//! belong to the manager.
//!
//! The env can hold an askpass token (ticket 06), so nothing here prints env values: the Debug
//! impls show variable names only, and no value ever goes in an argv (a process's command line is
//! readable by other processes and logged by process auditing for its whole life).

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
/// Forced on every Session: xterm.js draws 24-bit colour, and vim, bat, delta and friends only
/// use it when this says so.
pub const COLORTERM: &str = "truecolor";

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
    /// Never holds an env value.
    pub argv: Vec<String>,
    /// Set on the process itself. On WSL this includes `WSLENV`, which carries the rest into Linux.
    pub env: Vec<(String, String)>,
    /// How the Session logs in, as `session.prepare` said: "key" or "password" (shown on the tab).
    pub auth: String,
}

impl SessionCommand {
    /// A key-login command (tests, stub commands).
    pub fn new(argv: Vec<String>, env: Vec<(String, String)>) -> Self {
        SessionCommand {
            argv,
            env,
            auth: "key".into(),
        }
    }

    /// `text` (an error about this command) with every env value replaced by `…`, so a message
    /// that quotes the command or its environment can't show an askpass token.
    pub fn redact(&self, text: &str) -> String {
        let mut out = text.to_string();
        for (k, v) in &self.env {
            out = out.replace(&format!("{k}={v}"), &format!("{k}=…"));
        }
        for (_, v) in &self.env {
            if v.len() >= 6 {
                out = out.replace(v.as_str(), "…");
            }
        }
        out
    }
}

impl std::fmt::Debug for SessionCommand {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let env: Vec<String> = self.env.iter().map(|(k, _)| format!("{k}=…")).collect();
        f.debug_struct("SessionCommand")
            .field("argv", &self.argv)
            .field("env", &env)
            .field("auth", &self.auth)
            .finish()
    }
}

/// `WSLENV` that passes `names` from wsl.exe into Linux as they are (`/u`: Windows to WSL only, no
/// `/p`, so `/run/...` paths aren't translated), after the entries already in `existing` (minus any
/// for those names, which ours replace).
pub fn wslenv<'a>(existing: Option<&str>, names: impl IntoIterator<Item = &'a str>) -> String {
    let names: Vec<&str> = names.into_iter().collect();
    let kept = existing.unwrap_or("").split(':').filter(|e| {
        let name = e.split('/').next().unwrap_or("");
        !name.is_empty() && !names.iter().any(|n| n.eq_ignore_ascii_case(name))
    });
    let ours = names.iter().map(|n| format!("{n}/u"));
    kept.map(String::from).chain(ours).collect::<Vec<_>>().join(":")
}

/// The command that opens `prepared` on `target`, with `TERM` and `COLORTERM` forced to [`TERM`]
/// and [`COLORTERM`]. That is all the app adds (decision Q37: the user's terminal config wins, so
/// no PS1, no sourced files); any other variable is `session.prepare`'s. On WSL the variables are
/// set on wsl.exe and listed in `WSLENV` (appended to the app's own), never put in the argv.
pub fn session_command(target: &Target, prepared: &Prepared) -> SessionCommand {
    let mut env = vec![
        ("TERM".to_string(), TERM.to_string()),
        ("COLORTERM".to_string(), COLORTERM.to_string()),
    ];
    env.extend(prepared.env.iter().map(|(k, v)| (k.clone(), v.clone())));
    let argv = match target {
        Target::Local => prepared.argv.clone(),
        Target::Wsl { .. } => {
            let existing = std::env::var("WSLENV").ok();
            let list = wslenv(existing.as_deref(), env.iter().map(|(k, _)| k.as_str()));
            env.push(("WSLENV".into(), list));
            target.wrap(&prepared.argv)
        }
    };
    SessionCommand {
        argv,
        env,
        auth: prepared.auth.clone(),
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
/// How often a reader that's waiting for output checks whether it should stop (Unix).
#[cfg(unix)]
const STOP_POLL: Duration = Duration::from_millis(100);

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

/// The one way into a Session's sink, keeping its contract: output in order, then exactly one
/// Exit, and nothing after it. The reader and the waiter both go through here, under one lock,
/// so output a background process writes after the Exit is dropped.
struct Gate<S> {
    exited: Mutex<bool>,
    sink: S,
}

impl<S: Fn(SessionEvent)> Gate<S> {
    fn output(&self, chunk: Vec<u8>) {
        let exited = self.exited.lock().unwrap();
        if !*exited {
            (self.sink)(SessionEvent::Output(chunk));
        }
    }

    fn exit(&self, exit: Exit) {
        let mut exited = self.exited.lock().unwrap();
        if !*exited {
            *exited = true;
            (self.sink)(SessionEvent::Exit(exit));
        }
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
    /// from the Session's own threads. Both threads end once the Exit is out (the reader within
    /// [`STOP_POLL`] on Unix, even if a background process still holds the PTY; on Windows,
    /// closing the pseudo console ends it).
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
        let reader = Reader::new(pair.master.as_ref())?;
        let writer = pair.master.take_writer().map_err(io)?;
        let running = Arc::new(Running {
            killer: Mutex::new(child.clone_killer()),
            master: Mutex::new(Some(pair.master)),
            writer: Mutex::new(Some(writer)),
            closed: AtomicBool::new(false),
        });
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        self.sessions.lock().unwrap().insert(id, Arc::clone(&running));

        let gate = Arc::new(Gate {
            exited: Mutex::new(false),
            sink,
        });
        let stop = Arc::new(AtomicBool::new(false));
        let (drained_tx, drained) = mpsc::channel::<()>();
        let out = Arc::clone(&gate);
        let reader_stop = Arc::clone(&stop);
        std::thread::Builder::new()
            .name(format!("session-{id}-read"))
            .spawn(move || {
                reader.pump(&reader_stop, |chunk| out.output(chunk));
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
                stop.store(true, Ordering::SeqCst);
                sessions.lock().unwrap().remove(&id);
                let code = match &status {
                    Ok(s) if s.signal().is_none() => Some(s.exit_code()),
                    _ => None,
                };
                gate.exit(Exit {
                    code,
                    closed: running.closed.load(Ordering::SeqCst),
                });
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

/// A Session's output side of the PTY.
#[cfg(unix)]
struct Reader(std::fs::File);

#[cfg(unix)]
impl Reader {
    /// Its own descriptor for the master, so it can be polled (and outlive the master's drop).
    fn new(master: &(dyn MasterPty + Send)) -> Result<Self, SessionError> {
        use std::os::fd::FromRawFd;
        let fd = master
            .as_raw_fd()
            .ok_or_else(|| SessionError::Io("the PTY has no descriptor".into()))?;
        // SAFETY: dup returns a new descriptor (or -1) that nothing else owns.
        let dup = unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, 0) };
        if dup < 0 {
            return Err(io(std::io::Error::last_os_error()));
        }
        // SAFETY: `dup` is a valid descriptor owned only by this File.
        Ok(Reader(unsafe { std::fs::File::from_raw_fd(dup) }))
    }

    /// Copies the output to `emit` in chunks until EOF, an error (EIO once the PTY closes), or
    /// `stop` is set: it waits for output at most [`STOP_POLL`] at a time, so a background
    /// process holding the PTY open can't keep it running.
    fn pump(mut self, stop: &AtomicBool, emit: impl Fn(Vec<u8>)) {
        use std::os::fd::AsRawFd;
        let mut buf = vec![0u8; READ_CHUNK];
        while !stop.load(Ordering::SeqCst) {
            let mut fds = libc::pollfd {
                fd: self.0.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            };
            // SAFETY: one valid pollfd, for the length given.
            let ready = unsafe { libc::poll(&mut fds, 1, STOP_POLL.as_millis() as libc::c_int) };
            if ready < 0 {
                if std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted {
                    continue;
                }
                return;
            }
            if ready == 0 {
                continue;
            }
            match self.0.read(&mut buf) {
                Ok(0) => return,
                Ok(n) => emit(buf[..n].to_vec()),
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
                Err(_) => return,
            }
        }
    }
}

/// A Session's output side of the PTY. ConPTY's pipe can't be polled, but it ends once the
/// pseudo console is closed, which the waiter does when the process exits.
#[cfg(not(unix))]
struct Reader(Box<dyn Read + Send>);

#[cfg(not(unix))]
impl Reader {
    fn new(master: &(dyn MasterPty + Send)) -> Result<Self, SessionError> {
        master.try_clone_reader().map(Reader).map_err(io)
    }

    /// Copies the output to `emit` in chunks until EOF or an error. `stop` isn't needed: the
    /// read fails once the pseudo console is closed.
    fn pump(mut self, _stop: &AtomicBool, emit: impl Fn(Vec<u8>)) {
        let mut buf = vec![0u8; READ_CHUNK];
        loop {
            match self.0.read(&mut buf) {
                Ok(0) => return,
                Ok(n) => emit(buf[..n].to_vec()),
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
                Err(_) => return,
            }
        }
    }
}
