//! A running Backend: `roster serve` started from a detected [`Candidate`], checked once at start
//! (`inventory.info` answers and its `api_version` is new enough), then used for calls.

use crate::detect::{Candidate, OVERRIDE_VAR, Target};
use crate::error::{BackendError, ErrorKind};
use crate::rpc::{CallError, Notify, RpcClient};
use crate::session::{Prepared, SessionCommand, session_command};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::process::Command;

/// The oldest `roster serve` API this app understands.
pub const REQUIRED_API_VERSION: i64 = 1;

/// roster's own error codes (roster/src/roster/serve.py).
pub const INVENTORY_ERROR: i64 = 1;
/// `session.prepare` (API 11, ticket 36): roster has no host key recorded for the Host (`data`: its
/// address and port). The app asks the user ([`Backend::scan_host_key`], then [`Backend::trust_host_key`]).
pub const HOST_KEY_UNKNOWN: i64 = 44;
const METHOD_NOT_FOUND: i64 = -32601;

/// Where a Quick Connect goes (ticket 14): `user@address:port`, a box that isn't in the Inventory,
/// and the SHA256 fingerprint of the host key the user was shown (`host.scan_key {address, port}`).
#[derive(Debug, Clone, Deserialize)]
pub struct QuickTarget {
    pub user: String,
    pub address: String,
    pub port: u16,
    pub fingerprint: String,
}

/// A Quick Connect's Session command, serve's id for the Quick Connect, and, when "Save to vault"
/// was ticked (ticket 15), the id serve holds the typed password under (`quick.save` refers to it).
#[derive(Debug)]
pub struct QuickSession {
    pub command: SessionCommand,
    pub quick: String,
    pub held: Option<String>,
}

/// A Session to an `auth: prompt` Host with a typed password (ticket 16): its command, and the id
/// serve holds the password under for "Save to vault", when asked.
#[derive(Debug)]
pub struct HostSession {
    pub command: SessionCommand,
    pub held: Option<String>,
}

/// Is `fingerprint` shaped like `SHA256:<base64>`? Only that is ever sent to be trusted.
fn sha256_shaped(fingerprint: &str) -> bool {
    let b64 = fingerprint.strip_prefix("SHA256:").unwrap_or("");
    !b64.is_empty()
        && b64.len() <= 64
        && b64
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'+' || c == b'/' || c == b'=')
}

/// How long the app waits for a method's answer, in seconds, where that isn't [`DEFAULT_TIMEOUT`].
/// Each is longer than `roster serve`'s own deadline for the method plus what serve may still run
/// once that's past (serve.py's `DEADLINES` and `AFTER_DEADLINE`; a roster test checks the two
/// tables agree), so serve always answers before the app gives up, and its answer says what
/// actually happened. `vault.login` has no serve deadline: each bw step is held to 40 s, and a
/// wrong code runs bw once more.
///
/// [`DEFAULT_TIMEOUT`]: crate::rpc::DEFAULT_TIMEOUT
pub const CALL_SECS: &[(&str, u64)] = &[
    ("host.add", 180),
    ("changes.publish", 180),
    ("inventory.pull", 90),
    ("host.check", 90),
    ("box.check", 90),
    ("host.verify_login", 90),
    ("vault.create_item", 90),
    ("quick.save", 90),
    ("host.save_login", 90),
    ("vault.login", 100),
];

/// How long the app waits for `method` (see [`CALL_SECS`]).
pub fn timeout_for(method: &str) -> std::time::Duration {
    CALL_SECS
        .iter()
        .find(|(m, _)| *m == method)
        .map_or(crate::rpc::DEFAULT_TIMEOUT, |(_, s)| std::time::Duration::from_secs(*s))
}

/// What the UI learns about the Backend once it's up.
#[derive(Debug, Clone, Serialize)]
pub struct BackendInfo {
    /// "Local" or "WSL: <distro>".
    pub backend: String,
    /// The command line that runs serve.
    pub command: Vec<String>,
    /// The `inventory.info` result as roster sent it.
    pub inventory: Value,
}

pub struct Backend {
    client: RpcClient,
    /// Where serve (and so every Session) runs.
    pub target: Target,
    pub info: BackendInfo,
}

impl Backend {
    pub fn start(c: &Candidate) -> Result<Backend, BackendError> {
        Self::start_with(c, None)
    }

    /// As [`Backend::start`], handing serve's notifications (`inventory.changed`) to `notify`.
    pub fn start_with(c: &Candidate, notify: Option<Notify>) -> Result<Backend, BackendError> {
        let shown = c.serve_argv.join(" ");
        let mut cmd = Command::new(&c.serve_argv[0]);
        cmd.args(&c.serve_argv[1..]);
        let client = RpcClient::spawn_with(cmd, notify).map_err(|e| {
            BackendError::new(
                ErrorKind::Failed,
                "The backend couldn't be started.",
                "Check that the command exists.",
            )
            .with_detail(format!("{shown}: {e}"))
        })?;
        let inventory = client
            .call("inventory.info", json!({}))
            .map_err(|e| classify(e, &shown))?;
        let api = inventory.get("api_version").and_then(Value::as_i64).unwrap_or(0);
        if api < REQUIRED_API_VERSION {
            return Err(too_old(format!(
                "roster speaks API version {api}; the roster app needs {REQUIRED_API_VERSION} or newer."
            ))
            .with_detail(shown));
        }
        Ok(Backend {
            client,
            target: c.target.clone(),
            info: BackendInfo {
                backend: c.target.label(),
                command: c.serve_argv.clone(),
                inventory,
            },
        })
    }

    /// A call, waiting as long as [`timeout_for`] says for that method.
    pub fn call(&self, method: &str, params: Value) -> Result<Value, CallError> {
        self.client.call_timeout(method, params, timeout_for(method))
    }

    /// The command that opens a Session to `host` on this Backend (`session.prepare`). Refusals
    /// keep roster's code and wording: 2 unknown Host, 20 not reviewed, 21 this box isn't set up.
    pub fn session_command(&self, host: &str) -> Result<SessionCommand, CallError> {
        let v = self.call("session.prepare", json!({ "host": host }))?;
        // serde's message quotes the bad value, and `env` holds the askpass token: name the field
        // and the expected shape only.
        let prepared: Prepared = serde_json::from_value(v.clone()).map_err(|_| CallError::Io {
            message: format!(
                "session.prepare answered something unexpected: {}",
                prepare_shape_error(&v)
            ),
        })?;
        Ok(session_command(&self.target, &prepared))
    }

    /// The command for a Session to an `auth: prompt` Host (ticket 16) with the password the user
    /// typed: `session.prepare {host, password, save?}`. Like a Quick Connect's, the password is
    /// moved into the request and dropped with it; it comes back only as an askpass token. With
    /// `save`, serve holds it for "Save to vault" and only its id comes back, as `held`.
    pub fn typed_session_command(&self, host: &str, password: String, save: bool) -> Result<HostSession, CallError> {
        let mut params = json!({ "host": host, "password": password });
        if save {
            params["save"] = Value::Bool(true);
        }
        let v = self.call("session.prepare", params)?;
        let prepared: Prepared = serde_json::from_value(v.clone()).map_err(|_| CallError::Io {
            message: format!(
                "session.prepare answered something unexpected: {}",
                prepare_shape_error(&v)
            ),
        })?;
        Ok(HostSession {
            command: session_command(&self.target, &prepared),
            held: held_id(&v),
        })
    }

    /// The host key a Host offers, to ask the user about before its first Session (`host.scan_key
    /// {host}`): `{host, address, port, key_type, fingerprint, recorded: none|match|changed}`.
    /// One connection, key exchange only; nothing is recorded.
    pub fn scan_host_key(&self, host: &str) -> Result<Value, CallError> {
        self.call("host.scan_key", json!({ "host": host }))
    }

    /// Records the key the user was shown and trusted (`host.trust_key`). serve fetches it again
    /// and refuses (23) if the Host now offers another one. Only a `SHA256:` fingerprint is sent,
    /// never a key or anything else the frontend might pass.
    pub fn trust_host_key(&self, host: &str, fingerprint: &str) -> Result<Value, CallError> {
        if !sha256_shaped(fingerprint) {
            return Err(CallError::Io {
                message: "host.trust_key needs the SHA256:... fingerprint the user was shown".into(),
            });
        }
        self.call("host.trust_key", json!({ "host": host, "fingerprint": fingerprint }))
    }

    /// The command for a Quick Connect (`quick.prepare`, ticket 14). serve fetches the host key
    /// again and refuses (23) if it isn't the one the user was shown, or (43) if it differs from
    /// one roster recorded. A typed `password` is moved into the request and dropped with it: it
    /// goes to serve's stdin once and comes back only as an askpass token in the env. Never
    /// logged, stored or put in an error. Without one, the Session logs in with the Box's keys.
    /// `save` ("Save to vault", ticket 15): serve holds the password until the Session has logged
    /// in and `quick.save` saves it (or it's forgotten); only its id comes back, as `held`.
    pub fn quick_session_command(
        &self,
        to: &QuickTarget,
        password: Option<String>,
        save: bool,
    ) -> Result<QuickSession, CallError> {
        if !sha256_shaped(&to.fingerprint) {
            return Err(CallError::Io {
                message: "quick.prepare needs the SHA256:... fingerprint the user was shown".into(),
            });
        }
        let mut params = json!({
            "user": to.user,
            "address": to.address,
            "port": to.port,
            "fingerprint": to.fingerprint,
        });
        if let Some(password) = password {
            params["password"] = Value::String(password);
            if save {
                params["save"] = Value::Bool(true);
            }
        }
        let v = self.call("quick.prepare", params)?;
        let prepared: Prepared = serde_json::from_value(v.clone()).map_err(|_| CallError::Io {
            message: format!(
                "quick.prepare answered something unexpected: {}",
                prepare_shape_error(&v)
            ),
        })?;
        let quick = v
            .get("quick")
            .and_then(Value::as_str)
            .ok_or_else(|| CallError::Io {
                message: "quick.prepare answered something unexpected: `quick` isn't a string".into(),
            })?
            .to_owned();
        Ok(QuickSession {
            command: session_command(&self.target, &prepared),
            quick,
            held: held_id(&v),
        })
    }

    /// False once serve has exited; the app then has to start a new one.
    pub fn is_alive(&self) -> bool {
        !self.client.is_dead()
    }
}

/// The id serve holds a typed password under for "Save to vault" (`held`), if it does.
fn held_id(v: &Value) -> Option<String> {
    v.get("held").and_then(Value::as_str).map(str::to_owned)
}

/// Which part of a `session.prepare` result has the wrong shape, by name only (never a value).
fn prepare_shape_error(v: &Value) -> String {
    let Some(obj) = v.as_object() else {
        return "the result isn't an object".into();
    };
    let argv_ok = obj
        .get("argv")
        .and_then(Value::as_array)
        .is_some_and(|a| a.iter().all(Value::is_string));
    if !argv_ok {
        return "`argv` isn't a list of strings".into();
    }
    match obj.get("env") {
        None | Some(Value::Null) => {}
        Some(Value::Object(env)) => {
            if let Some(k) = env.iter().find(|(_, v)| !v.is_string()).map(|(k, _)| k) {
                return format!("`env.{k}` isn't a string");
            }
        }
        Some(_) => return "`env` isn't an object of strings".into(),
    }
    for field in ["host", "auth"] {
        if !obj.get(field).is_some_and(Value::is_string) {
            return format!("`{field}` isn't a string");
        }
    }
    "it doesn't match {argv, env, host, auth}".into()
}

fn too_old(message: String) -> BackendError {
    BackendError::new(
        ErrorKind::RosterTooOld,
        message,
        format!(
            "Upgrade roster (`uv tool install --force --reinstall .` in the roster repo), or point \
             {OVERRIDE_VAR} at a newer one, e.g. `uv run --project /home/you/work/roster roster`."
        ),
    )
}

/// A failure of the first call, as the error the user sees.
fn classify(e: CallError, shown: &str) -> BackendError {
    match e {
        CallError::Exited { stderr, code } => {
            if stderr.contains("invalid choice") && stderr.contains("serve") {
                too_old("This roster has no `serve` command (it predates the roster app).".into()).with_detail(stderr)
            } else {
                BackendError::new(
                    ErrorKind::Failed,
                    format!(
                        "roster serve exited before answering (exit code {}).",
                        code.map_or("?".into(), |c| c.to_string())
                    ),
                    "Run the command below in a terminal to see what's wrong.",
                )
                .with_detail(format!("{shown}\n{stderr}"))
            }
        }
        CallError::Rpc {
            code: INVENTORY_ERROR,
            message,
            ..
        } => BackendError::new(
            ErrorKind::InventoryNotFound,
            format!("roster couldn't load the Inventory: {message}"),
            "Clone the infra repo to ~/infra (or set ROSTER_CONFIG in ~/.profile), then retry.",
        )
        .with_detail(shown),
        CallError::Rpc {
            code: METHOD_NOT_FOUND,
            message,
            ..
        } => too_old(format!("This roster doesn't know inventory.info ({message}).")).with_detail(shown),
        other => BackendError::new(
            ErrorKind::Failed,
            format!("The backend didn't start properly: {other}"),
            "Run the command below in a terminal to see what's wrong.",
        )
        .with_detail(shown),
    }
}
