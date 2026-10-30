//! The app's one running Backend (or anything slow to start that callers share): starting it
//! happens outside the lock that readers take, so a read never waits for a start.
//!
//! Tauri runs async commands on its async runtime's workers; a command that blocked there on a
//! lock held through detection and serve's first answer (up to a minute) would stall them.

use std::sync::{Arc, Mutex};

pub struct Slot<T> {
    /// The current value. Held only to clone or swap the `Arc`, never across a start.
    current: Mutex<Option<Arc<T>>>,
    /// Held by `connect` for a whole start, so concurrent connects start one value. Only
    /// `connect` takes it, and it runs on a blocking thread.
    starting: Mutex<()>,
}

impl<T> Default for Slot<T> {
    fn default() -> Self {
        Slot {
            current: Mutex::new(None),
            starting: Mutex::new(()),
        }
    }
}

impl<T> Slot<T> {
    /// The current value, if one has started. Never waits for a start in progress.
    pub fn get(&self) -> Option<Arc<T>> {
        self.current.lock().unwrap().clone()
    }

    /// The current value if `alive` says it still is (and `restart` is false), else a new one
    /// from `start`, which then replaces it. A failed start leaves the slot empty. Blocks for
    /// the length of `start`: call it from a blocking thread.
    pub fn connect<E>(
        &self,
        restart: bool,
        alive: impl Fn(&T) -> bool,
        start: impl FnOnce() -> Result<T, E>,
    ) -> Result<Arc<T>, E> {
        let _starting = self.starting.lock().unwrap();
        if !restart && let Some(v) = self.get().filter(|v| alive(v)) {
            return Ok(v);
        }
        // Dropped after the lock is released: dropping a Backend stops its serve.
        let old = self.current.lock().unwrap().take();
        drop(old);
        let v = Arc::new(start()?);
        *self.current.lock().unwrap() = Some(Arc::clone(&v));
        Ok(v)
    }
}
