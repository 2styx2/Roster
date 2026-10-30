//! The Tauri shell: window setup and thin `#[tauri::command]` wrappers over desk-core (Backend
//! calls, Sessions).
//! All logic lives in desk-core so it can be tested without Tauri (docs/dev/testing.md).

use desk_core::backend::{Backend, BackendInfo};
use desk_core::config::{self, Config, Loader, Report};
use desk_core::detect::{BackendError, DISTRO_VAR, ErrorKind, OVERRIDE_VAR, Platform, SystemRunner, detect};
use desk_core::rpc::CallError;
use desk_core::session::{SessionError, SessionEvent, SessionId, SessionManager, Size};
use desk_core::slot::Slot;
use desk_core::state::StateFile;
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};

/// The one `roster serve` for this app launch, once started. Starting happens outside the lock
/// that `get` takes (desk-core's Slot), so commands on the async workers never wait for a start.
#[derive(Default)]
struct BackendState(Slot<Backend>);

impl BackendState {
    /// The running Backend, starting one if there's none (or the last one died). Blocks for the
    /// whole detection and start: run it on a blocking thread.
    /// Which roster runs comes from the Config (`roster_command`, `backend`), with the
    /// development env vars winning; a change takes effect at the next (re)start.
    fn connect(&self, restart: bool, config: &Config) -> Result<BackendInfo, BackendError> {
        let backend = self.0.connect(restart, Backend::is_alive, || {
            let env_cmd = std::env::var(OVERRIDE_VAR).ok();
            let env_distro = std::env::var(DISTRO_VAR).ok();
            let plan = config::backend_plan(config, Platform::current(), env_cmd.as_deref(), env_distro.as_deref())
                .map_err(|m| BackendError::new(ErrorKind::Failed, m, "Change `backend` in init.lua, then Retry."))?;
            let candidate = detect(
                &SystemRunner,
                Platform::current(),
                &plan.command,
                plan.distro.as_deref(),
            )?;
            Backend::start(&candidate)
        })?;
        Ok(backend.info.clone())
    }

    /// The running Backend. Never waits for one that's starting.
    fn get(&self) -> Result<Arc<Backend>, CallError> {
        self.0.get().ok_or(CallError::Io {
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
    config: tauri::State<'_, Arc<ConfigState>>,
    restart: bool,
) -> Result<BackendInfo, BackendError> {
    let s = Arc::clone(&state);
    let config = config.current();
    blocking(move || s.connect(restart, &config)).await
}

/// The Config (`init.lua`, desk-core config.rs): the loader with the last good Config, and the
/// last report (with its error, if the file is broken). None when there's no config dir.
#[derive(Default)]
struct ConfigState {
    loader: Mutex<Option<Loader>>,
    last: Mutex<Option<Report>>,
}

impl ConfigState {
    fn reload(&self) -> Option<Report> {
        let report = self.loader.lock().ok()?.as_mut()?.reload();
        if let Ok(mut last) = self.last.lock() {
            *last = Some(report.clone());
        }
        Some(report)
    }

    fn current(&self) -> Config {
        self.loader
            .lock()
            .ok()
            .and_then(|l| l.as_ref().map(|l| l.current().clone()))
            .unwrap_or_default()
    }
}

/// The Config as the app starts with it, and the error if init.lua couldn't be used. Later
/// changes arrive as `config-changed` events with the same shape.
#[tauri::command]
fn config_load(config: tauri::State<'_, Arc<ConfigState>>) -> Option<Report> {
    config.last.lock().ok()?.clone()
}

/// Reads init.lua once, then watches its dir and emits `config-changed` after every save.
fn start_config(app: &tauri::App, state: &Arc<ConfigState>) -> Option<config::Watcher> {
    use tauri::Emitter;
    let dir = config::dir()?;
    if let Ok(mut l) = state.loader.lock() {
        *l = Some(Loader::new(&dir));
    }
    if let Some(Report { error: Some(e), .. }) = state.reload() {
        eprintln!("roster-desk: {e}");
    }
    let handle = app.handle().clone();
    let s = Arc::clone(state);
    match config::watch(&dir, move || {
        if let Some(report) = s.reload() {
            let _ = handle.emit("config-changed", report);
        }
    }) {
        Ok(w) => Some(w),
        Err(e) => {
            eprintln!("roster-desk: can't watch {} for changes: {e}", dir.display());
            None
        }
    }
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

/// roster's diagnostics for one Host (`host.check`, api 2): its steps in order, stopping at the
/// first failure. roster makes at most one connection and one login, so this is safe on 10.19.
#[tauri::command]
async fn host_check(state: tauri::State<'_, Arc<BackendState>>, host: String) -> Result<Value, CallError> {
    call(&state, "host.check", json!({ "host": host })).await
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

/// The State file (GLOSSARY: State) in the OS local app-data dir: per Box, never roamed.
fn state_file(app: &tauri::AppHandle) -> Result<StateFile, String> {
    use tauri::Manager;
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    Ok(StateFile::in_dir(&dir))
}

/// What the app remembered last time (`{}` the first time).
#[tauri::command]
fn state_load(app: tauri::AppHandle) -> Result<Value, String> {
    Ok(state_file(&app)?.load())
}

/// Replaces the remembered State (a JSON object; the frontend owns its shape).
#[tauri::command]
fn state_save(app: tauri::AppHandle, state: Value) -> Result<(), String> {
    state_file(&app)?.save(&state).map_err(|e| e.to_string())
}

/// Facts about this machine the terminal needs: the Windows build, for xterm's `windowsPty`.
#[tauri::command]
fn platform_info() -> Value {
    json!({ "windowsBuild": desk_core::platform::windows_build() })
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

/// Puts the window where the State says it was (desk-core window.rs), then shows it. The window
/// starts hidden (tauri.conf.json `visible: false`) so it never jumps; it's shown whatever happens.
fn restore_and_show(app: &tauri::App, window: &tauri::WebviewWindow) {
    use desk_core::window::{Rect, placement};
    use tauri::{PhysicalPosition, PhysicalSize};
    let state = state_file(app.handle()).map(|f| f.load()).unwrap_or(Value::Null);
    let monitors: Vec<Rect> = window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| Rect {
            x: m.position().x,
            y: m.position().y,
            width: m.size().width,
            height: m.size().height,
        })
        .collect();
    if let Some(p) = placement(&state, &monitors) {
        let _ = window.set_size(PhysicalSize::new(p.rect.width, p.rect.height));
        let _ = window.set_position(PhysicalPosition::new(p.rect.x, p.rect.y));
        if p.maximized {
            let _ = window.maximize();
        }
    }
    let _ = window.show();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let sessions = Arc::new(SessionManager::new());
    let config_state = Arc::new(ConfigState::default());
    let setup_config = Arc::clone(&config_state);
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(Arc::new(BackendState::default()))
        .manage(Arc::clone(&sessions))
        .manage(config_state)
        .setup(move |app| {
            // The watcher lives as long as the app.
            if let Some(w) = start_config(app, &setup_config) {
                tauri::Manager::manage(app, Mutex::new(w));
            }
            if let Some(w) = tauri::Manager::get_webview_window(app, "main") {
                #[cfg(windows)]
                disable_browser_accelerators(&w);
                restore_and_show(app, &w);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backend_connect,
            hosts_list,
            host_get,
            host_check,
            session_open,
            session_write,
            session_resize,
            session_close,
            state_load,
            state_save,
            platform_info,
            vault_status,
            vault_unlock,
            vault_lock,
            config_load
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app, event| {
            if let tauri::RunEvent::Exit = event {
                sessions.close_all();
            }
        });
}
