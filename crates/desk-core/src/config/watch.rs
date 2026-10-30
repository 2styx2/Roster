//! Live reload: calls back when a `.lua` file in the config dir changes. Editors save in
//! different ways (write in place, or write a temp file and rename it over), so any event that
//! touches a `.lua` path counts, and a burst of them (one save) is one call after a short quiet.

use notify::{RecursiveMode, Watcher as _};
use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

/// Stops watching when dropped.
pub struct Watcher {
    _inner: notify::RecommendedWatcher,
}

/// How long a save's events may keep coming before the reload.
const QUIET: Duration = Duration::from_millis(150);

/// Watches `dir` (created if missing, so a first `init.lua` is seen) and calls `on_change` on
/// its own thread after each save.
pub fn watch(dir: &Path, on_change: impl Fn() + Send + 'static) -> notify::Result<Watcher> {
    std::fs::create_dir_all(dir).map_err(notify::Error::io)?;
    let (tx, rx) = mpsc::channel::<()>();
    let mut inner = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res
            && !event.kind.is_access()
            && event.paths.iter().any(|p| p.extension().is_some_and(|e| e == "lua"))
        {
            let _ = tx.send(());
        }
    })?;
    inner.watch(dir, RecursiveMode::Recursive)?;
    std::thread::spawn(move || {
        // Ends when the watcher (and with it the sender) is dropped.
        while rx.recv().is_ok() {
            while rx.recv_timeout(QUIET).is_ok() {}
            on_change();
        }
    });
    Ok(Watcher { _inner: inner })
}
