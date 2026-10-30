//! The Tauri shell: window setup and thin `#[tauri::command]` wrappers over roster-core (Backend
//! calls, Sessions).
//! All logic lives in roster-core so it can be tested without Tauri (docs/app/dev/testing.md).

use roster_core::backend::{Backend, BackendInfo};
use roster_core::config::{self, Config, Loader, Report};
use roster_core::detect::{BackendError, ErrorKind, Platform, SystemRunner, detect};
use roster_core::rpc::CallError;
use roster_core::session::{SessionError, SessionEvent, SessionId, SessionManager, Size};
use roster_core::slot::Slot;
use roster_core::state::StateFile;
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};

/// The one `roster serve` for this app launch, once started. Starting happens outside the lock
/// that `get` takes (roster-core's Slot), so commands on the async workers never wait for a start.
#[derive(Default)]
struct BackendState(Slot<Backend>);

impl BackendState {
    /// The running Backend, starting one if there's none (or the last one died). Blocks for the
    /// whole detection and start: run it on a blocking thread.
    /// Which roster runs comes from the Config (`roster_command`, `backend`), with the
    /// development env vars winning; a change takes effect at the next (re)start.
    fn connect(&self, restart: bool, config: &Config) -> Result<BackendInfo, BackendError> {
        let backend = self.0.connect(restart, Backend::is_alive, || {
            let env_cmd = roster_core::env::roster_override();
            let env_distro = roster_core::env::wsl_distro();
            let plan = config::backend_plan(config, Platform::current(), env_cmd.as_deref(), env_distro.as_deref())
                .map_err(|m| {
                    BackendError::new(
                        ErrorKind::Failed,
                        m,
                        "Fix it in init.lua (docs/app/config.md), then Retry.",
                    )
                })?;
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
/// It reads the Config on the blocking thread: at startup that waits for init.lua's first load
/// (at most the Lua wall-clock limit) rather than starting the default roster.
#[tauri::command]
async fn backend_connect(
    state: tauri::State<'_, Arc<BackendState>>,
    config: tauri::State<'_, ConfigState>,
    restart: bool,
) -> Result<BackendInfo, BackendError> {
    let s = Arc::clone(&state);
    let loader = config.0.clone();
    blocking(move || {
        let config = loader.map(|l| l.settled()).unwrap_or_default();
        s.connect(restart, &config)
    })
    .await
}

/// The Config (`init.lua`, roster-core config/): None when there's no config dir. roster-core's
/// Loader runs Lua outside the locks its readers take, so nothing here waits on Lua except
/// on a blocking thread.
struct ConfigState(Option<Arc<Loader>>);

/// The Config as the app starts with it, and the error if init.lua couldn't be used. Waits for
/// the first load if it's still running (on a blocking thread). Later changes arrive as
/// `config-changed` events with the same shape.
#[tauri::command]
async fn config_load(config: tauri::State<'_, ConfigState>) -> Result<Option<Report>, ()> {
    let Some(loader) = config.0.clone() else {
        return Ok(None);
    };
    blocking(move || Ok(loader.settled_report())).await
}

/// What `:config` did: the file's path, and whether it was just made (ticket 32).
#[derive(serde::Serialize)]
struct ConfigOpened {
    path: String,
    created: bool,
}

/// `:config`: makes init.lua from the commented-out example if there's none (never overwriting
/// one), then opens it with the Config's `editor`. `$EDITOR` runs in the Backend's WSL distro.
#[tauri::command]
async fn config_open(
    config: tauri::State<'_, ConfigState>,
    state: tauri::State<'_, Arc<BackendState>>,
) -> Result<ConfigOpened, String> {
    let Some(loader) = config.0.clone() else {
        return Err("there's no config folder: the environment names no home".into());
    };
    let distro = state.get().ok().and_then(|b| match &b.target {
        roster_core::detect::Target::Wsl { distro } => Some(distro.clone()),
        roster_core::detect::Target::Local => None,
    });
    blocking(move || {
        let ensured =
            config::ensure_file(loader.dir()).map_err(|e| format!("can't create {}: {e}", loader.dir().display()))?;
        let how = config::open_with(
            loader.current().editor,
            config::Os::current(),
            &ensured.path,
            distro.as_deref(),
        )?;
        config::open(&how).map_err(|e| format!("can't open {}: {e}", ensured.path.display()))?;
        Ok(ConfigOpened {
            path: ensured.path.display().to_string(),
            created: ensured.created,
        })
    })
    .await
}

/// `:source` (and `:config reload`): reads init.lua again now, and tells every listener.
#[tauri::command]
async fn config_reload(app: tauri::AppHandle, config: tauri::State<'_, ConfigState>) -> Result<Option<Report>, ()> {
    use tauri::Emitter;
    let Some(loader) = config.0.clone() else {
        return Ok(None);
    };
    let report = blocking(move || Ok::<_, ()>(loader.reload())).await?;
    let _ = app.emit("config-changed", &report);
    Ok(Some(report))
}

/// How long the window waits for init.lua before it shows. A slower Config arrives as a
/// `config-changed` event.
const CONFIG_STARTUP_WAIT: std::time::Duration = std::time::Duration::from_millis(300);

/// Reads init.lua (waiting at most CONFIG_STARTUP_WAIT), then watches its dir: after a save it
/// emits `config-changed` (with `auto_reload = true`) or `config-stale`. `config-changed` also
/// comes once the first load is done.
fn start_config(app: &tauri::App, loader: &Arc<Loader>) -> Option<config::Watcher> {
    use tauri::Emitter;
    let handle = app.handle().clone();
    loader.reload_within(CONFIG_STARTUP_WAIT, move |report| {
        if let Some(e) = &report.error {
            eprintln!("roster: {e}");
        }
        let _ = handle.emit("config-changed", report);
    });
    let handle = app.handle().clone();
    let l = Arc::clone(loader);
    // A save reloads only with `auto_reload = true` (decision Q58); otherwise the frontend
    // hears that the file changed, and `:source` applies it.
    match config::watch(loader.dir(), move || match l.on_save() {
        Some(report) => {
            let _ = handle.emit("config-changed", report);
        }
        None => {
            let _ = handle.emit("config-stale", ());
        }
    }) {
        Ok(w) => Some(w),
        Err(e) => {
            eprintln!("roster: can't watch {} for changes: {e}", loader.dir().display());
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

/// One step of signing the vault CLI in (`vault.login`, ticket 31): start, answer or cancel.
/// The params can hold a master password, a two-step code or an API secret on their way to
/// serve's stdin. Like `vault_unlock`, they're moved into the request and dropped with it:
/// never logged, stored or put in an error.
#[tauri::command]
async fn vault_login(
    state: tauri::State<'_, Arc<BackendState>>,
    params: serde_json::Map<String, Value>,
) -> Result<Value, CallError> {
    let backend = state.get()?;
    blocking(move || backend.call_timeout("vault.login", Value::Object(params), VAULT_LOGIN_TIMEOUT)).await
}

/// roster waits up to 40 s for bw per step, and after a wrong code runs bw again (another 40 s).
const VAULT_LOGIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(100);

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

/// Fast-forward the infra repo before an edit (`inventory.pull`, api 4, ticket 10). A fetch can take
/// a while on a slow link; roster gives git 60 s.
#[tauri::command]
async fn inventory_pull(state: tauri::State<'_, Arc<BackendState>>) -> Result<Value, CallError> {
    let backend = state.get()?;
    blocking(move || backend.call_timeout("inventory.pull", json!({}), EDIT_TIMEOUT)).await
}

/// One test login with a Host's new address, user or Login (`host.verify_login`, decision Q43):
/// one connection, one attempt. The password stays in roster.
#[tauri::command]
async fn host_verify_login(
    state: tauri::State<'_, Arc<BackendState>>,
    host: String,
    changes: serde_json::Map<String, Value>,
) -> Result<Value, CallError> {
    call(&state, "host.verify_login", json!({ "host": host, "changes": changes })).await
}

/// The edit, written into roster.yml as a Pending change (`host.update`).
#[tauri::command]
async fn host_update(
    state: tauri::State<'_, Arc<BackendState>>,
    host: String,
    changes: serde_json::Map<String, Value>,
) -> Result<Value, CallError> {
    call(&state, "host.update", json!({ "host": host, "changes": changes })).await
}

/// The Pending changes: roster.yml's uncommitted diff (`changes.diff`).
#[tauri::command]
async fn changes_diff(state: tauri::State<'_, Arc<BackendState>>) -> Result<Value, CallError> {
    call(&state, "changes.diff", json!({})).await
}

/// roster.yml back as the last commit has it (`changes.discard`).
#[tauri::command]
async fn changes_discard(state: tauri::State<'_, Arc<BackendState>>) -> Result<Value, CallError> {
    call(&state, "changes.discard", json!({})).await
}

/// Commit and push the Pending changes, then `roster sync` (`changes.publish`, ticket 12): never
/// forced. `message` is the commit message as the user left it.
#[tauri::command]
async fn changes_publish(state: tauri::State<'_, Arc<BackendState>>, message: String) -> Result<Value, CallError> {
    let backend = state.get()?;
    blocking(move || backend.call_timeout("changes.publish", json!({ "message": message }), PUBLISH_TIMEOUT)).await
}

/// roster's publish waits up to 60 s for each of git's fetch and push, and the sync after.
const PUBLISH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(180);
/// The host key an address offers (`host.scan_key`, ticket 11): key exchange only, never a login.
#[tauri::command]
async fn host_scan_key(
    state: tauri::State<'_, Arc<BackendState>>,
    address: String,
    port: u16,
) -> Result<Value, CallError> {
    call(&state, "host.scan_key", json!({ "address": address, "port": port })).await
}

/// Add a Host (`host.add`, decision Q43): test login, then the Vault item, then the Pending change.
/// The params can hold a typed password on its way to serve's stdin. Like `vault_unlock`'s, it's
/// moved into the request and dropped with it: never logged, stored or put in an error.
#[tauri::command]
async fn host_add(
    state: tauri::State<'_, Arc<BackendState>>,
    params: serde_json::Map<String, Value>,
) -> Result<Value, CallError> {
    let backend = state.get()?;
    blocking(move || backend.call_timeout("host.add", Value::Object(params), ADD_TIMEOUT)).await
}

/// One connection with a 10 s login, then bw's sync and create (each up to 40 s).
const ADD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

/// Mark a Host reviewed (`host.review`): only that flag changes, as a Pending change.
#[tauri::command]
async fn host_review(state: tauri::State<'_, Arc<BackendState>>, host: String) -> Result<Value, CallError> {
    call(&state, "host.review", json!({ "host": host })).await
}

/// roster waits up to 60 s for git's fetch.
const EDIT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(90);

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

/// The one-time copy of roster-desk's State into this identifier's app-data dir (roster-core
/// migrate.rs). Never stops the app: State is only a convenience.
fn migrate_state(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Ok(dir) = app.path().app_local_data_dir() else {
        return;
    };
    let Some(old) = roster_core::migrate::legacy_state_dir(&dir) else {
        return;
    };
    match roster_core::migrate::state(&old, &dir) {
        Ok(true) => eprintln!("roster: copied the State from {}", old.display()),
        Ok(false) => {}
        Err(e) => eprintln!("roster: can't copy the State from {}: {e}", old.display()),
    }
}

/// The one-time copy of roster-desk's Config dir into roster's (roster-core migrate.rs).
fn migrate_config(dir: &std::path::Path) {
    let Some(old) = config::legacy_dir() else {
        return;
    };
    match roster_core::migrate::config(&old, dir) {
        Ok(copied) if !copied.is_empty() => {
            eprintln!(
                "roster: copied {} file(s) of the Config from {}",
                copied.len(),
                old.display()
            )
        }
        Ok(_) => {}
        Err(e) => eprintln!("roster: can't copy the Config from {}: {e}", old.display()),
    }
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
    json!({ "windowsBuild": roster_core::platform::windows_build() })
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

/// Puts the window where the State says it was (roster-core window.rs), then shows it. The window
/// starts hidden (tauri.conf.json `visible: false`) so it never jumps; it's shown whatever happens.
fn restore_and_show(app: &tauri::App, window: &tauri::WebviewWindow) {
    use roster_core::window::{Rect, placement};
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
    let loader = config::dir().map(|dir| {
        migrate_config(&dir);
        Arc::new(Loader::new(&dir))
    });
    let setup_loader = loader.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(Arc::new(BackendState::default()))
        .manage(Arc::clone(&sessions))
        .manage(ConfigState(loader))
        .setup(move |app| {
            migrate_state(app.handle());
            // The watcher lives as long as the app.
            if let Some(w) = setup_loader.as_ref().and_then(|l| start_config(app, l)) {
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
            inventory_pull,
            host_verify_login,
            host_update,
            host_scan_key,
            host_add,
            host_review,
            changes_diff,
            changes_discard,
            changes_publish,
            session_open,
            session_write,
            session_resize,
            session_close,
            state_load,
            state_save,
            platform_info,
            vault_status,
            vault_unlock,
            vault_login,
            vault_lock,
            config_load,
            config_open,
            config_reload
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app, event| {
            if let tauri::RunEvent::Exit = event {
                sessions.close_all();
            }
        });
}
