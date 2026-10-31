//! What a Plugin may be granted (decision Q81). A Plugin's sandbox only has the functions for the
//! permissions it was granted, and each of those functions checks the grant again when called.
//! None of them reaches a secret: vault passwords, askpass and the master password live only in
//! `roster serve`, and the serve methods that touch them can't be granted at all.

use serde::{Serialize, Serializer};
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Permission {
    /// Hosts and Login references through serve's read methods (`hosts.list`, `host.get`), and
    /// the events that name a Host.
    InventoryRead,
    /// Inventory edits through serve's write methods; they land as Pending changes, never Published.
    InventoryWrite,
    /// Opening a Session on a Host, as `:open HOST` does.
    SessionsOpen,
    /// The text open Sessions print (`terminal_output` events).
    TerminalRead,
    /// Typing into an open Session.
    TerminalWrite,
    /// One `roster serve` method by name, from [`SERVE_METHODS`] or under [`SERVE_PREFIXES`].
    Serve(String),
}

/// The serve methods a Plugin may be granted by name: none of them touches a secret.
pub const SERVE_METHODS: &[&str] = &["inventory.info", "hosts.list", "host.get", "host.check", "changes.diff"];
/// The grantable methods that only read: every other one is flagged in the install prompt.
const READS: &[&str] = &[
    "inventory.info",
    "hosts.list",
    "host.get",
    "changes.diff",
    "mesh.status",
    "mesh.plan",
];
/// Families a Plugin may be granted methods of (the mesh and discover Plugins, decision Q80).
pub const SERVE_PREFIXES: &[&str] = &["mesh.", "discover."];

/// Whether a Plugin may ever call `method` (vault, session, Quick Connect, Publish and the
/// methods that carry a password never are).
pub fn serve_method_allowed(method: &str) -> bool {
    SERVE_METHODS.contains(&method)
        || SERVE_PREFIXES
            .iter()
            .any(|p| method.len() > p.len() && method.starts_with(p) && is_name(&method[p.len()..]))
}

fn is_name(s: &str) -> bool {
    s.chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '.')
}

impl Permission {
    /// `"inventory.read"`, `"serve:mesh.status"`, … as a manifest writes it.
    pub fn parse(text: &str) -> Result<Permission, String> {
        Ok(match text {
            "inventory.read" => Permission::InventoryRead,
            "inventory.write" => Permission::InventoryWrite,
            "sessions.open" => Permission::SessionsOpen,
            "terminal.read" => Permission::TerminalRead,
            "terminal.write" => Permission::TerminalWrite,
            "network" => {
                return Err("\"network\" isn't available yet: this roster has no network functions for Plugins".into());
            }
            _ => match text.strip_prefix("serve:") {
                Some(method) if serve_method_allowed(method) => Permission::Serve(method.to_string()),
                Some(method) => {
                    return Err(format!(
                        "\"serve:{method}\" can't be granted: a Plugin may call only {} and the mesh.* and discover.* methods, never one that reaches a secret",
                        SERVE_METHODS.join(", ")
                    ));
                }
                None => {
                    return Err(format!(
                        "{text:?} isn't a permission (there's inventory.read, inventory.write, sessions.open, terminal.read, terminal.write and serve:<method>)"
                    ));
                }
            },
        })
    }

    /// Whether the install prompt flags it, and why (shown under it).
    pub fn risk(&self) -> Option<String> {
        Some(match self {
            Permission::InventoryWrite => {
                "Can change Hosts. The changes stay Pending until you review and Publish them.".into()
            }
            Permission::SessionsOpen => "Can open Sessions on your Hosts.".into(),
            Permission::TerminalRead => "Sees everything your Sessions print, including anything a server echoes back. A password you type at a prompt that echoes it would be visible too.".into(),
            Permission::TerminalWrite => {
                "Can type into your open Sessions, as if you typed it: it can run commands on your servers.".into()
            }
            Permission::Serve(m) if !READS.contains(&m.as_str()) => {
                format!("Can run roster's {m}, which can change things on your Hosts or in the Inventory.")
            }
            _ => return None,
        })
    }

    /// One line on what it allows.
    pub fn summary(&self) -> String {
        match self {
            Permission::InventoryRead => "Read your Hosts and their Login references (never a password)".into(),
            Permission::InventoryWrite => "Change Hosts, as Pending changes".into(),
            Permission::SessionsOpen => "Open Sessions".into(),
            Permission::TerminalRead => "Read what your Sessions print".into(),
            Permission::TerminalWrite => "Type into your Sessions".into(),
            Permission::Serve(m) => format!("Call roster's {m}"),
        }
    }
}

impl fmt::Display for Permission {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Permission::InventoryRead => f.write_str("inventory.read"),
            Permission::InventoryWrite => f.write_str("inventory.write"),
            Permission::SessionsOpen => f.write_str("sessions.open"),
            Permission::TerminalRead => f.write_str("terminal.read"),
            Permission::TerminalWrite => f.write_str("terminal.write"),
            Permission::Serve(m) => write!(f, "serve:{m}"),
        }
    }
}

impl Serialize for Permission {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(self)
    }
}
