//! The Tauri shell: window setup and thin `#[tauri::command]` wrappers over desk-core.
//! All logic lives in desk-core so it can be tested without Tauri (docs/dev/testing.md).

use desk_core::backend::{Backend, BackendInfo};
use desk_core::detect::{BackendError, OVERRIDE_VAR, Platform, SystemRunner, detect, roster_command};
use desk_core::rpc::CallError;
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};

/// The one `roster serve` for this app launch, once started.
#[derive(Default)]
struct BackendState(Mutex<Option<Arc<Backend>>>);

impl BackendState {
    /// The running Backend, starting one if there's none (or the last one died).
    fn connect(&self, restart: bool) -> Result<BackendInfo, BackendError> {
        let mut slot = self.0.lock().unwrap();
        if restart {
            slot.take();
        }
        if let Some(b) = slot.as_ref().filter(|b| b.is_alive()) {
            return Ok(b.info.clone());
        }
        slot.take();
        let cmd = roster_command(std::env::var(OVERRIDE_VAR).ok().as_deref());
        let candidate = detect(&SystemRunner, Platform::current(), &cmd)?;
        let backend = Backend::start(&candidate)?;
        let info = backend.info.clone();
        *slot = Some(Arc::new(backend));
        Ok(info)
    }

    fn get(&self) -> Result<Arc<Backend>, CallError> {
        self.0.lock().unwrap().clone().ok_or(CallError::Io {
            message: "the backend isn't running".into(),
        })
    }
}

async fn blocking<T: Send + 'static, E: Send + 'static>(
    f: impl FnOnce() -> Result<T, E> + Send + 'static,
) -> Result<T, E> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .expect("backend task panicked")
}

/// Find and start the Backend (or return the running one). Errors explain what to fix.
#[tauri::command]
async fn backend_connect(
    state: tauri::State<'_, Arc<BackendState>>,
    restart: bool,
) -> Result<BackendInfo, BackendError> {
    let s = Arc::clone(&state);
    blocking(move || s.connect(restart)).await
}

async fn call(state: &Arc<BackendState>, method: &'static str, params: Value) -> Result<Value, CallError> {
    let backend = state.get()?;
    blocking(move || backend.call(method, params)).await
}

#[tauri::command]
async fn hosts_list(state: tauri::State<'_, Arc<BackendState>>) -> Result<Value, CallError> {
    call(&state, "hosts.list", json!({})).await
}

#[tauri::command]
async fn host_get(state: tauri::State<'_, Arc<BackendState>>, name: String) -> Result<Value, CallError> {
    call(&state, "host.get", json!({ "name": name })).await
}

#[tauri::command]
async fn vault_status(state: tauri::State<'_, Arc<BackendState>>) -> Result<Value, CallError> {
    call(&state, "vault.status", json!({})).await
}

/// The master password passes through here once, on its way to serve's stdin. It's moved into the
/// request and dropped with it: never logged, stored or put in an error.
#[tauri::command]
async fn vault_unlock(state: tauri::State<'_, Arc<BackendState>>, password: String) -> Result<Value, CallError> {
    call(&state, "vault.unlock", json!({ "password": password })).await
}

#[tauri::command]
async fn vault_lock(state: tauri::State<'_, Arc<BackendState>>) -> Result<Value, CallError> {
    call(&state, "vault.lock", json!({})).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(BackendState::default()))
        .invoke_handler(tauri::generate_handler![
            backend_connect,
            hosts_list,
            host_get,
            vault_status,
            vault_unlock,
            vault_lock
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
