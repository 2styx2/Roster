//! Loads a config dir and prints the Config as the frontend gets it, or the error:
//! `cargo run --example config -- <dir>` (default: the user config dir).
fn main() {
    let dir = std::env::args()
        .nth(1)
        .map(std::path::PathBuf::from)
        .or_else(desk_core::config::dir)
        .expect("no config dir");
    let report = desk_core::config::Loader::new(&dir).reload();
    match &report.error {
        Some(e) => println!("error: {e}"),
        None => println!("{}", serde_json::to_string_pretty(&report.config).unwrap()),
    }
}
