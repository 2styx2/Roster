//! roster-desk's core, with no Tauri dependency: finding a Backend, talking to `roster serve`, and
//! running Sessions in PTYs.

pub mod backend;
pub mod detect;
pub mod error;
pub mod rpc;
pub mod session;
