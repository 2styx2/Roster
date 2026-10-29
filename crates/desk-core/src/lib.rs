//! roster-desk's core, with no Tauri dependency: finding a Backend and talking to `roster serve`.

pub mod backend;
pub mod detect;
pub mod error;
pub mod rpc;
