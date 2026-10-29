//! Why the Backend couldn't start, in words the error screen shows as they are.

use serde::Serialize;

/// The env var that overrides the roster command line (until the Lua Config, ticket 21).
pub const OVERRIDE_VAR: &str = "ROSTER_DESK_ROSTER";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ErrorKind {
    /// Windows without WSL, or WSL with no distro.
    NoWsl,
    /// roster isn't on the PATH of any distro (or the local machine).
    RosterMissing,
    /// roster has no `serve`, or its API is older than this app needs.
    RosterTooOld,
    /// roster runs but finds no `roster.yml`, or it doesn't load.
    InventoryNotFound,
    /// Anything else: serve crashed, didn't answer, couldn't be started.
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct BackendError {
    pub kind: ErrorKind,
    /// What went wrong, one sentence.
    pub message: String,
    /// What to do about it.
    pub hint: String,
    /// Raw detail for the curious: roster's stderr, the command that ran.
    pub detail: Option<String>,
}

impl BackendError {
    pub fn new(kind: ErrorKind, message: impl Into<String>, hint: impl Into<String>) -> Self {
        BackendError {
            kind,
            message: message.into(),
            hint: hint.into(),
            detail: None,
        }
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        let d = detail.into();
        self.detail = if d.trim().is_empty() { None } else { Some(d) };
        self
    }
}

impl std::fmt::Display for BackendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} {}", self.message, self.hint)
    }
}

impl std::error::Error for BackendError {}
