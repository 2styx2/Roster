//! The user's Plugins inside `:tutor`'s demo (ticket 66, decision Q123): a [`PluginHost`] of its
//! own, beside the real one, so a Plugin's tutorial can teach the Plugin itself. Its Plugins run
//! with the grants they have in the app, but nothing they do reaches the real Inventory, roster
//! serve, the network or their real files:
//!
//! - **roster serve** is [`DemoServe`]: the demo Inventory's Hosts the app hands over answer
//!   `hosts.list` and `host.get` (so `roster.inventory` reads the demo's Hosts); every other method
//!   is refused, saying it isn't on the demo Inventory.
//! - **The network** is never reached ([`PluginHost::offline`]): a request is checked against the
//!   grants as ever, then answers "not sent".
//! - **Files** are a throwaway folder: each demo gets a fresh, empty data folder under `scratch`
//!   (the temp dir), removed with the demo. A Plugin's real `plugin-data` is never read or written.

use super::{Limits, PluginHost, Serve};
use serde_json::Value as Json;
use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

/// roster serve, as the demo has it: the demo Inventory's Hosts, and nothing else.
pub struct DemoServe {
    /// `{hosts: [...], groups: {...}}`, as `hosts.list` answers.
    hosts: Json,
}

impl DemoServe {
    pub fn new(hosts: Json) -> Self {
        DemoServe { hosts }
    }
}

impl Serve for DemoServe {
    fn call(&self, method: &str, params: Json) -> Result<Json, String> {
        match method {
            "hosts.list" => Ok(self.hosts.clone()),
            "host.get" => {
                let name = params["name"].as_str().unwrap_or_default();
                self.hosts["hosts"]
                    .as_array()
                    .and_then(|hs| hs.iter().find(|h| h["name"] == name))
                    .cloned()
                    .ok_or_else(|| format!("No Host named '{name}' on the demo Inventory (code 2)"))
            }
            other => Err(format!(
                "{other} isn't on the demo Inventory: the tutorial's demo answers only hosts.list and host.get (code 3)"
            )),
        }
    }
}

/// A Plugin host for `:tutor`'s demo: [`DemoServe`], offline, and a throwaway data folder that
/// goes when this is dropped. Derefs to the [`PluginHost`] it is.
pub struct DemoHost {
    host: PluginHost,
    data: PathBuf,
}

static DEMOS: AtomicU64 = AtomicU64::new(0);

impl DemoHost {
    /// A demo over `hosts` (`hosts.list`'s answer), with its data folder made fresh in `scratch`.
    pub fn new(hosts: Json, limits: Limits, scratch: &Path) -> Result<Self, String> {
        let n = DEMOS.fetch_add(1, Ordering::SeqCst);
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos());
        let data = scratch.join(format!("roster-demo-{}-{stamp}-{n}", std::process::id()));
        std::fs::create_dir_all(&data)
            .map_err(|e| format!("couldn't make the demo's folder {}: {e}", data.display()))?;
        let host = PluginHost::new(Arc::new(DemoServe::new(hosts)), limits)
            .offline()
            .with_data(&data);
        Ok(DemoHost { host, data })
    }

    /// The demo's throwaway data folder (each Plugin's files are in `plugin-data/NAME` there).
    pub fn data(&self) -> &Path {
        &self.data
    }
}

impl Deref for DemoHost {
    type Target = PluginHost;
    fn deref(&self) -> &PluginHost {
        &self.host
    }
}

impl Drop for DemoHost {
    fn drop(&mut self) {
        // Each Plugin's thread ends with its slot, so none outlives the demo.
        for status in self.host.list() {
            self.host.unload(&status.manifest.name);
        }
        let _ = std::fs::remove_dir_all(&self.data);
    }
}
