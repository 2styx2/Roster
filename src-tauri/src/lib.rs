//! The Tauri shell: window setup and thin `#[tauri::command]` wrappers over desk-core (Backend
//! calls, Sessions).
//! All logic lives in desk-core so it can be tested without Tauri (docs/dev/testing.md).

use desk_core::backend::{Backend, BackendInfo};
use desk_core::detect::{BackendError, DISTRO_VAR, OVERRIDE_VAR, Platform, SystemRunner, detect, roster_command};
use desk_core::rpc::CallError;
use desk_core::session::{SessionError, SessionEvent, SessionId, SessionManager, Size};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};

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
        let distro = std::env::var(DISTRO_VAR).ok();
        let candidate = detect(&SystemRunner, Platform::current(), &cmd, distro.as_deref())?;
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

fn session_error(e: SessionError) -> CallError {
    CallError::Io { message: e.to_string() }
}

/// A Session that's started: its id and how it logs in ("key" or "password").
#[derive(serde::Serialize)]
struct OpenedSession {
    id: SessionId,
    auth: String,
}

/// Open a Session to `host`: `session.prepare`, then the command in a PTY of `cols`×`rows`.
/// `events` gets the output as raw bytes, then one JSON message `{"exit": {code, closed}}`.
/// Refusals keep roster's code (2 unknown, 20 not reviewed, 21 box not set up, 11/12/14 the
/// password Host's vault). prepare runs right before the spawn: a password Session's askpass
/// token lives 60 s, so every open (and every reconnect) gets a fresh one.
#[tauri::command]
async fn session_open(
    state: tauri::State<'_, Arc<BackendState>>,
    sessions: tauri::State<'_, Arc<SessionManager>>,
    host: String,
    cols: u16,
    rows: u16,
    events: Channel<InvokeResponseBody>,
) -> Result<OpenedSession, CallError> {
    let backend = state.get()?;
    let sessions = Arc::clone(&sessions);
    blocking(move || {
        let cmd = backend.session_command(&host)?;
        let id = sessions
            .open(&cmd, Size { cols, rows }, move |event| {
                let body = match event {
                    SessionEvent::Output(bytes) => InvokeResponseBody::Raw(bytes),
                    SessionEvent::Exit(exit) => InvokeResponseBody::Json(json!({ "exit": exit }).to_string()),
                };
                let _ = events.send(body);
            })
            .map_err(session_error)?;
        Ok(OpenedSession { id, auth: cmd.auth })
    })
    .await
}

/// Keystrokes or pasted text for a Session.
#[tauri::command]
fn session_write(
    sessions: tauri::State<'_, Arc<SessionManager>>,
    id: SessionId,
    data: String,
) -> Result<(), CallError> {
    sessions.write(id, data.as_bytes()).map_err(session_error)
}

#[tauri::command]
fn session_resize(
    sessions: tauri::State<'_, Arc<SessionManager>>,
    id: SessionId,
    cols: u16,
    rows: u16,
) -> Result<(), CallError> {
    sessions.resize(id, Size { cols, rows }).map_err(session_error)
}

/// Ends a Session (kills ssh); its exit message still arrives, with `closed: true`.
#[tauri::command]
fn session_close(sessions: tauri::State<'_, Arc<SessionManager>>, id: SessionId) -> Result<(), CallError> {
    sessions.close(id).map_err(session_error)
}

/// WebView2's own shortcuts (Ctrl+F find, Ctrl+R reload, Ctrl+P print, F12…) would take keys
/// meant for the shell; tauri doesn't expose wry's switch, so set it on the WebView2 settings.
#[cfg(windows)]
fn disable_browser_accelerators(window: &tauri::WebviewWindow) {
    let _ = window.with_webview(|w| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
        use windows::core::Interface;
        let Ok(core) = w.controller().CoreWebView2() else {
            return;
        };
        let Ok(settings) = core.Settings() else { return };
        if let Ok(s3) = settings.cast::<ICoreWebView2Settings3>() {
            let _ = s3.SetAreBrowserAcceleratorKeysEnabled(false);
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let sessions = Arc::new(SessionManager::new());
    tauri::Builder::default()
        .manage(Arc::new(BackendState::default()))
        .manage(Arc::clone(&sessions))
        .setup(|_app| {
            #[cfg(windows)]
            if let Some(w) = tauri::Manager::get_webview_window(_app, "main") {
                disable_browser_accelerators(&w);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backend_connect,
            hosts_list,
            host_get,
            session_open,
            session_write,
            session_resize,
            session_close,
            vault_status,
            vault_unlock,
            vault_lock
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app, event| {
            if let tauri::RunEvent::Exit = event {
                sessions.close_all();
            }
        });
}
