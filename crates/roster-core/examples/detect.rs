//! Detect and start the Backend on this machine, then print what it reports:
//! `cargo run --example detect [-- <roster command>]`. Without arguments it uses
//! ROSTER_DESK_ROSTER, then `roster`; ROSTER_DESK_WSL_DISTRO picks the WSL distro.
use roster_core::backend::Backend;
use roster_core::detect::{DISTRO_VAR, OVERRIDE_VAR, Platform, SystemRunner, detect, roster_command};
use serde_json::json;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = if args.is_empty() {
        roster_command(std::env::var(OVERRIDE_VAR).ok().as_deref())
    } else {
        args
    };
    let distro = std::env::var(DISTRO_VAR).ok();
    let started = detect(&SystemRunner, Platform::current(), &cmd, distro.as_deref()).and_then(|c| {
        println!("{} -> {:?}", c.target.label(), c.serve_argv);
        Backend::start(&c)
    });
    match started {
        Ok(b) => {
            let hosts = b
                .call("hosts.list", json!({}))
                .map(|r| r["hosts"].as_array().map_or(0, Vec::len));
            println!("inventory: {}\nhosts.list: {hosts:?}", b.info.inventory);
        }
        Err(e) => println!("error: {e:#?}"),
    }
}
