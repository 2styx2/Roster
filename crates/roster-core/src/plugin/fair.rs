//! Fair shares of `roster serve` for Plugins (ticket 101, decision Q112g). serve answers several
//! requests at once (API 20) but can't tell a Plugin's from the app's, so the core holds each
//! Plugin to [`PLUGIN_AT_ONCE`] calls into serve at a time and all Plugins together to
//! [`PLUGINS_AT_ONCE`]: one Plugin looping calls can't take every one of serve's workers, and
//! the app always has some. A call waiting here is waiting for serve (the caller's `ServeWait`
//! counts it), so no Plugin is given up on or disabled while it's queued.

use super::Serve;
use serde_json::Value as Json;
use std::sync::{Arc, Condvar, Mutex};

/// How many calls into roster serve one Plugin may have running at once.
pub const PLUGIN_AT_ONCE: usize = 2;
/// How many all Plugins together may: serve has 8 workers (and 2 more for quick reads), so the
/// app keeps at least 4.
pub const PLUGINS_AT_ONCE: usize = 4;

/// A counting semaphore: at most `max` holders at once, the rest wait in turn.
pub(crate) struct Gate {
    held: Mutex<usize>,
    freed: Condvar,
    max: usize,
}

impl Gate {
    pub(crate) fn new(max: usize) -> Arc<Gate> {
        Arc::new(Gate {
            held: Mutex::new(0),
            freed: Condvar::new(),
            max,
        })
    }

    fn enter(&self) -> Pass<'_> {
        let mut held = self.held.lock().expect("gate");
        while *held >= self.max {
            held = self.freed.wait(held).expect("gate");
        }
        *held += 1;
        Pass(self)
    }
}

struct Pass<'a>(&'a Gate);

impl Drop for Pass<'_> {
    fn drop(&mut self) {
        *self.0.held.lock().expect("gate") -= 1;
        self.0.freed.notify_one();
    }
}

/// One Plugin's way into serve: its own gate first, then the one all Plugins share, so a
/// Plugin waiting for its own turn never holds a shared place.
pub(crate) struct Fair {
    pub(crate) inner: Arc<dyn Serve>,
    pub(crate) mine: Arc<Gate>,
    pub(crate) all: Arc<Gate>,
}

impl Serve for Fair {
    fn call(&self, method: &str, params: Json) -> Result<Json, String> {
        let _mine = self.mine.enter();
        let _all = self.all.enter();
        self.inner.call(method, params)
    }
}
