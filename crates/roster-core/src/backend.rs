//! A running Backend: `roster serve` started from a detected [`Candidate`], checked once at start
//! (`inventory.info` answers and its `api_version` is new enough), then used for calls.

use crate::detect::{Candidate, OVERRIDE_VAR, Target};
use crate::error::{BackendError, ErrorKind};
use crate::rpc::{CallError, RpcClient};
use crate::session::{Prepared, SessionCommand, session_command};
use serde::Serialize;
use serde_json::{Value, json};
use std::process::Command;

/// The oldest `roster serve` API this app understands.
pub const REQUIRED_API_VERSION: i64 = 1;

/// roster's own error codes (roster/src/roster/serve.py).
pub const INVENTORY_ERROR: i64 = 1;
const METHOD_NOT_FOUND: i64 = -32601;

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
        let shown = c.serve_argv.join(" ");
        let mut cmd = Command::new(&c.serve_argv[0]);
        cmd.args(&c.serve_argv[1..]);
        let client = RpcClient::spawn(cmd).map_err(|e| {
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

    pub fn call(&self, method: &str, params: Value) -> Result<Value, CallError> {
        self.client.call(method, params)
    }

    /// A call that may take longer than the default (`vault.login`: a sign-in step runs bw's
    /// login, and after a wrong code roster runs it again before answering).
    pub fn call_timeout(&self, method: &str, params: Value, timeout: std::time::Duration) -> Result<Value, CallError> {
        self.client.call_timeout(method, params, timeout)
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

    /// False once serve has exited; the app then has to start a new one.
    pub fn is_alive(&self) -> bool {
        !self.client.is_dead()
    }
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
