mod backup_crypto;
mod http_delivery;
mod mobile;
mod net_policy;
mod secure_store;
#[cfg(any(not(target_os = "android"), test))]
mod startup;
#[cfg(not(target_os = "android"))]
use auto_launch::{AutoLaunch, AutoLaunchBuilder};
use base64::{engine::general_purpose, Engine as _};
use futures_util::StreamExt;
#[cfg(not(target_os = "android"))]
use image::codecs::png::PngEncoder;
#[cfg(not(target_os = "android"))]
use image::{ColorType, ImageEncoder};
use reqwest::header::{HeaderName, HeaderValue, CONTENT_LENGTH, CONTENT_TYPE, USER_AGENT};
use reqwest::{Client, Method};
use roxmltree::Document;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[cfg(not(any(target_os = "macos", target_os = "android")))]
use startup::LOGIN_STARTUP_ARG;
#[cfg(not(target_os = "android"))]
use startup::{RestoredWindowMode, ShowReason, StartupVisibility};
use std::cmp::Ordering as CmpOrdering;
use std::collections::HashMap;
use std::ffi::OsStr;
use std::fs;
use std::fs::File;
use std::io::{BufReader, BufWriter, Cursor, Read, Seek, Write};
use std::path::{Component, Path, PathBuf};
use std::process::Command as StdCommand;
#[cfg(not(target_os = "android"))]
use std::sync::atomic::AtomicU64;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime};
#[cfg(not(target_os = "android"))]
use tauri::image::Image;
#[cfg(not(target_os = "android"))]
use tauri::menu::{Menu, MenuItem};
#[cfg(not(target_os = "android"))]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
#[cfg(not(target_os = "android"))]
use tauri::Monitor;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, RunEvent, Size,
    WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window, WindowEvent,
};
use tauri_plugin_notification::NotificationExt;
#[cfg(not(target_os = "android"))]
use tokio::process::Command;
use url::Url;
use uuid::Uuid;
use walkdir::WalkDir;
#[cfg(not(target_os = "android"))]
use xcap::Window as CaptureWindow;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "android")]
use mobile::*;

const APP_NAME: &str = "lich13studio";
const BUNDLE_ID: &str = "com.lich13.studio";
const DEFAULT_STATE_FILE: &str = "state.json";
const WINDOW_STATE_KEY: &str = "windowState";
const MINI_WINDOW_LABEL: &str = "mini";
const MINI_WINDOW_SHOW_EVENT: &str = "show-mini-window";
const MINI_WINDOW_HIDE_EVENT: &str = "hide-mini-window";
const MINI_WINDOW_WIDTH: u32 = 420;
const MINI_WINDOW_HEIGHT: u32 = 620;
const GITHUB_LATEST_RELEASE_API_URL: &str =
    "https://api.github.com/repos/lich13/lich13studio/releases/latest";
const GITHUB_RELEASES_URL: &str = "https://github.com/lich13/lich13studio/releases";
#[cfg(any(target_os = "macos", test))]
const MACOS_LOGIN_ITEM_ARG: &str = "--hidden";
const RUNTIME_SETTINGS_KEY: &str = "runtimeSettings";
const SETTING_LAUNCH_TO_TRAY: &str = "launchToTray";
const SETTING_TRAY: &str = "tray";
const SETTING_TRAY_ON_CLOSE: &str = "trayOnClose";
const TRAY_SHOW_MENU_ID: &str = "show";
const TRAY_CHECK_UPDATE_MENU_ID: &str = "check_update";
const TRAY_QUIT_MENU_ID: &str = "quit";
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(not(target_os = "android"))]
static APP_EXITING: AtomicBool = AtomicBool::new(false);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: &'static str,
    is_packaged: bool,
    app_path: String,
    config_path: String,
    app_data_path: String,
    resources_path: String,
    files_path: String,
    notes_path: String,
    logs_path: String,
    arch: &'static str,
    is_portable: bool,
    install_path: String,
    bundle_id: &'static str,
    runtime: &'static str,
    platform: &'static str,
    state_path: String,
}

#[derive(Debug, Clone, Deserialize)]
struct GitHubReleaseAsset {
    name: Option<String>,
    browser_download_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct GitHubLatestRelease {
    tag_name: Option<String>,
    html_url: Option<String>,
    body: Option<String>,
    #[serde(default)]
    assets: Vec<GitHubReleaseAsset>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AppUpdateAsset {
    name: String,
    url: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AppUpdateInfo {
    has_update: bool,
    current_version: String,
    latest_version: Option<String>,
    release_url: String,
    release_notes: String,
    asset: Option<AppUpdateAsset>,
}

#[derive(Debug)]
struct DecodedBase64ImagePayload {
    bytes: Vec<u8>,
    extension: String,
}

#[derive(Serialize)]
struct TauriFileMetadata {
    id: String,
    name: String,
    origin_name: String,
    path: String,
    size: u64,
    ext: String,
    #[serde(rename = "type")]
    file_type: String,
    created_at: String,
    count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeHttpHeader {
    name: String,
    value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeHttpRequest {
    request_id: String,
    url: String,
    method: String,
    headers: Vec<NativeHttpHeader>,
    body: Option<Vec<u8>>,
    #[serde(default)]
    body_text: Option<String>,
    #[serde(default)]
    task_epoch: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeHttpResponseStart {
    request_id: String,
    status: u16,
    status_text: String,
    headers: Vec<NativeHttpHeader>,
}

fn serialize_bytes_as_base64<S>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    if bytes.is_empty() {
        serializer.serialize_str("")
    } else {
        serializer.serialize_str(&general_purpose::STANDARD.encode(bytes))
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeHttpChunkEvent {
    pub(crate) sequence: Option<u64>,
    pub(crate) request_id: String,
    #[serde(serialize_with = "serialize_bytes_as_base64")]
    pub(crate) chunk: Vec<u8>,
    pub(crate) done: bool,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupWebDavConfig {
    url: String,
    username: String,
    password: String,
    file_name: Option<String>,
    skip_backup_file: Option<bool>,
    user_agent: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalBackupFileInfo {
    file_name: String,
    file_path: String,
    size: u64,
    modified_time: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteBackupFileInfo {
    file_name: String,
    modified_time: String,
    size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ObsidianVaultInfo {
    path: String,
    name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ObsidianFileInfo {
    path: String,
    r#type: String,
    name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureWindowInfo {
    id: u32,
    app_name: String,
    title: String,
    width: u32,
    height: u32,
    is_focused: bool,
}

#[cfg(not(target_os = "android"))]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PersistedWindowState {
    x: Option<i32>,
    y: Option<i32>,
    width: Option<u32>,
    height: Option<u32>,
    maximized: bool,
    fullscreen: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
struct RuntimeSettings {
    launch_to_tray: bool,
    tray: bool,
    tray_on_close: bool,
}

impl Default for RuntimeSettings {
    fn default() -> Self {
        Self {
            launch_to_tray: false,
            tray: true,
            tray_on_close: true,
        }
    }
}

#[cfg(any(not(target_os = "android"), test))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MainWindowCloseAction {
    KeepBackground,
    Quit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DockVisibility {
    Visible,
    Hidden,
}

#[cfg(any(target_os = "macos", test))]
#[derive(Debug, Clone, PartialEq, Eq)]
struct MacOSLoginItemConfig {
    app_name: String,
    app_path: String,
    use_launch_agent: bool,
    args: Vec<String>,
}

#[cfg(not(any(target_os = "macos", target_os = "android")))]
#[derive(Debug, Clone, PartialEq, Eq)]
struct AutoLaunchConfig {
    app_name: String,
    app_path: String,
    use_launch_agent: bool,
    args: Vec<String>,
}

const NATIVE_HTTP_CHUNK_EVENT: &str = "native_http_chunk";
const FOCUS_CHAT_INPUT_EVENT: &str = "focus_chat_input";

pub(crate) struct HttpAbortHandle {
    flag: AtomicBool,
    notify: tokio::sync::Notify,
}

impl HttpAbortHandle {
    pub(crate) fn new() -> Self {
        Self {
            flag: AtomicBool::new(false),
            notify: tokio::sync::Notify::new(),
        }
    }

    pub(crate) fn is_aborted(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }

    pub(crate) fn cancel(&self) {
        self.flag.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    pub(crate) async fn cancelled(&self) {
        loop {
            let notified = self.notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.is_aborted() {
                return;
            }
            notified.await;
        }
    }
}

static HTTP_REQUEST_ABORTS: OnceLock<Mutex<HashMap<String, Arc<HttpAbortHandle>>>> =
    OnceLock::new();
#[cfg(not(target_os = "android"))]
static STARTUP_VISIBILITY: OnceLock<Mutex<StartupVisibility>> = OnceLock::new();
#[cfg(not(target_os = "android"))]
static DEFERRED_MAIN_WINDOW_MODE: OnceLock<Mutex<RestoredWindowMode>> = OnceLock::new();
#[cfg(not(target_os = "android"))]
static PENDING_WINDOW_STATES: OnceLock<Mutex<HashMap<String, PersistedWindowState>>> =
    OnceLock::new();
#[cfg(not(target_os = "android"))]
static WINDOW_STATE_SAVE_EPOCH: AtomicU64 = AtomicU64::new(0);
static MINI_WINDOW_PINNED: AtomicBool = AtomicBool::new(false);
static STARTED_SILENTLY: AtomicBool = AtomicBool::new(false);
static RUNTIME_SETTINGS: OnceLock<Mutex<RuntimeSettings>> = OnceLock::new();
static AUTO_LAUNCH_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[cfg(target_os = "windows")]
fn hidden_std_command<S: AsRef<OsStr>>(program: S) -> StdCommand {
    let mut command = StdCommand::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(not(target_os = "windows"))]
fn hidden_std_command<S: AsRef<OsStr>>(program: S) -> StdCommand {
    StdCommand::new(program)
}

#[cfg(target_os = "windows")]
fn hidden_command<S: AsRef<OsStr>>(program: S) -> Command {
    let mut command = Command::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(all(not(target_os = "windows"), not(target_os = "android")))]
fn hidden_command<S: AsRef<OsStr>>(program: S) -> Command {
    Command::new(program)
}

fn native_http_abort_registry() -> &'static Mutex<HashMap<String, Arc<HttpAbortHandle>>> {
    HTTP_REQUEST_ABORTS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg_attr(not(any(target_os = "android", test)), allow(dead_code))]
pub(crate) fn cancel_all_http_requests() {
    let ids: Vec<String> = if let Ok(registry) = native_http_abort_registry().lock() {
        registry
            .iter()
            .map(|(id, handle)| {
                handle.cancel();
                id.clone()
            })
            .collect()
    } else {
        Vec::new()
    };
    for id in &ids {
        http_delivery::remove(id);
    }
    #[cfg(target_os = "android")]
    http_delivery::clear();
}

fn runtime_settings_lock() -> &'static Mutex<RuntimeSettings> {
    RUNTIME_SETTINGS.get_or_init(|| Mutex::new(RuntimeSettings::default()))
}

fn current_runtime_settings() -> RuntimeSettings {
    runtime_settings_lock()
        .lock()
        .map(|settings| *settings)
        .unwrap_or_default()
}

fn replace_runtime_settings(settings: RuntimeSettings) {
    if let Ok(mut current) = runtime_settings_lock().lock() {
        *current = settings;
    }
}

fn load_runtime_settings_from_state() -> Result<RuntimeSettings, String> {
    let state = load_state_file()?;
    state
        .get(RUNTIME_SETTINGS_KEY)
        .cloned()
        .map(serde_json::from_value)
        .transpose()
        .map_err(|error| error.to_string())
        .map(|settings| settings.unwrap_or_default())
}

fn save_runtime_settings_to_state(settings: RuntimeSettings) -> Result<(), String> {
    let mut state = load_state_file().unwrap_or_else(|_| json!({}));

    if !state.is_object() {
        state = json!({});
    }

    let root = state
        .as_object_mut()
        .ok_or_else(|| String::from("Invalid state payload: root must be an object"))?;

    root.insert(
        RUNTIME_SETTINGS_KEY.to_string(),
        serde_json::to_value(settings).map_err(|error| error.to_string())?,
    );
    save_state_file(&state)?;
    Ok(())
}

fn apply_runtime_setting(
    settings: &mut RuntimeSettings,
    key: &str,
    value: bool,
) -> Result<(), String> {
    match key {
        SETTING_LAUNCH_TO_TRAY => {
            settings.launch_to_tray = value;
            if value {
                settings.tray = true;
            }
        }
        SETTING_TRAY => {
            settings.tray = value;
        }
        SETTING_TRAY_ON_CLOSE => {
            settings.tray_on_close = value;
            if value {
                settings.tray = true;
            }
        }
        _ => return Err(format!("Unsupported runtime setting: {key}")),
    }

    Ok(())
}

#[cfg(any(not(target_os = "android"), test))]
fn main_window_close_action(settings: RuntimeSettings) -> MainWindowCloseAction {
    if settings.tray && settings.tray_on_close {
        MainWindowCloseAction::KeepBackground
    } else {
        MainWindowCloseAction::Quit
    }
}

#[cfg(any(not(target_os = "android"), test))]
fn should_prevent_implicit_exit(
    exit_code_present: bool,
    app_exiting: bool,
    settings: RuntimeSettings,
) -> bool {
    !exit_code_present
        && !app_exiting
        && matches!(
            main_window_close_action(settings),
            MainWindowCloseAction::KeepBackground
        )
}

#[cfg(target_os = "macos")]
fn unhide_current_macos_app() {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSApplication;

    if let Some(marker) = MainThreadMarker::new() {
        NSApplication::sharedApplication(marker).unhide(None);
    }
}

fn dock_visibility_for_main_window_show() -> DockVisibility {
    DockVisibility::Visible
}

fn dock_visibility_for_background_keepalive() -> DockVisibility {
    DockVisibility::Hidden
}

fn apply_dock_visibility(_app: &AppHandle, _visibility: DockVisibility) {
    #[cfg(target_os = "macos")]
    {
        use tauri::ActivationPolicy;

        let (dock_visible, activation_policy) = match _visibility {
            DockVisibility::Visible => (true, ActivationPolicy::Regular),
            DockVisibility::Hidden => (false, ActivationPolicy::Accessory),
        };

        let _ = _app.set_dock_visibility(dock_visible);
        let _ = _app.set_activation_policy(activation_policy);
        if matches!(_visibility, DockVisibility::Visible) {
            unhide_current_macos_app();
        }
    }
}

#[cfg(target_os = "macos")]
fn macos_app_bundle_path(executable_path: &Path) -> Option<PathBuf> {
    let path = executable_path.to_string_lossy();
    path.find(".app/Contents/MacOS/")
        .map(|index| PathBuf::from(&path[..index + ".app".len()]))
}

#[cfg(not(target_os = "android"))]
fn current_auto_launch_path() -> Result<PathBuf, String> {
    let executable_path = std::env::current_exe()
        .map_err(|error| format!("Unable to resolve current exe: {error}"))?;

    #[cfg(target_os = "macos")]
    {
        Ok(macos_app_bundle_path(&executable_path).unwrap_or(executable_path))
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(executable_path)
    }
}

#[cfg(not(target_os = "android"))]
fn app_name_for_auto_launch(app_path: &Path) -> String {
    app_path
        .file_stem()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or(APP_NAME)
        .to_string()
}

#[cfg(not(target_os = "android"))]
fn with_auto_launch_lock<T>(operation: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let _guard = AUTO_LAUNCH_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| String::from("auto-launch lock poisoned"))?;
    operation()
}

#[cfg(any(target_os = "macos", test))]
fn macos_legacy_launch_agent_file(home: &Path) -> PathBuf {
    home.join("Library")
        .join("LaunchAgents")
        .join(format!("{BUNDLE_ID}.plist"))
}

#[cfg(target_os = "macos")]
fn current_macos_legacy_launch_agent_file() -> Result<PathBuf, String> {
    dirs::home_dir()
        .ok_or_else(|| String::from("Unable to resolve home directory"))
        .map(|home| macos_legacy_launch_agent_file(&home))
}

#[cfg(any(target_os = "macos", test))]
fn macos_login_item_config_for_path(app_path: &Path) -> MacOSLoginItemConfig {
    MacOSLoginItemConfig {
        app_name: app_name_for_auto_launch(app_path),
        app_path: app_path.to_string_lossy().to_string(),
        use_launch_agent: false,
        args: vec![MACOS_LOGIN_ITEM_ARG.to_string()],
    }
}

#[cfg(not(target_os = "macos"))]
#[cfg(not(target_os = "android"))]
fn auto_launch_config_for_path(app_path: &Path) -> AutoLaunchConfig {
    AutoLaunchConfig {
        app_name: app_name_for_auto_launch(app_path),
        app_path: app_path.to_string_lossy().to_string(),
        use_launch_agent: false,
        args: vec![LOGIN_STARTUP_ARG.to_string()],
    }
}

#[cfg(target_os = "macos")]
fn remove_macos_legacy_launch_agent() -> Result<(), String> {
    let file = current_macos_legacy_launch_agent_file()?;
    match fs::remove_file(&file) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Failed to remove legacy LaunchAgent {}: {error}",
            file.display()
        )),
    }
}

#[cfg(not(target_os = "android"))]
fn build_auto_launch(app_path: &Path) -> Result<AutoLaunch, String> {
    #[cfg(target_os = "macos")]
    let config = macos_login_item_config_for_path(app_path);

    #[cfg(not(target_os = "macos"))]
    let config = auto_launch_config_for_path(app_path);

    AutoLaunchBuilder::new()
        .set_app_name(&config.app_name)
        .set_app_path(&config.app_path)
        .set_use_launch_agent(config.use_launch_agent)
        .set_args(&config.args)
        .build()
        .map_err(|error| format!("Failed to create auto-launch config: {error}"))
}

#[cfg(not(target_os = "android"))]
fn enable_auto_launch() -> Result<(), String> {
    with_auto_launch_lock(|| {
        let app_path = current_auto_launch_path()?;

        #[cfg(target_os = "macos")]
        {
            let auto_launch = build_auto_launch(&app_path)?;
            let _ = auto_launch.disable();
            auto_launch
                .enable()
                .map_err(|error| format!("Failed to enable macOS login item: {error}"))?;
            remove_macos_legacy_launch_agent()
        }

        #[cfg(not(target_os = "macos"))]
        {
            build_auto_launch(&app_path)?
                .enable()
                .map_err(|error| format!("Failed to enable auto launch: {error}"))
        }
    })
}

#[cfg(not(target_os = "android"))]
fn disable_auto_launch() -> Result<(), String> {
    with_auto_launch_lock(|| {
        let app_path = current_auto_launch_path()?;

        #[cfg(target_os = "macos")]
        {
            build_auto_launch(&app_path)?
                .disable()
                .map_err(|error| format!("Failed to disable macOS login item: {error}"))?;
            remove_macos_legacy_launch_agent()
        }

        #[cfg(not(target_os = "macos"))]
        {
            build_auto_launch(&app_path)?
                .disable()
                .map_err(|error| format!("Failed to disable auto launch: {error}"))
        }
    })
}

#[cfg(not(target_os = "android"))]
fn show_and_focus_main_window(app: &AppHandle) -> Result<(), String> {
    request_main_window(app, ShowReason::User)
}

#[cfg(not(target_os = "android"))]
fn request_main_window(app: &AppHandle, reason: ShowReason) -> Result<(), String> {
    // The single-instance callback runs off the main thread. Both AppKit's
    // activation and the deferred window mode must be applied on the UI thread.
    let app_handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = present_main_window(&app_handle, reason);
    })
    .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "android"))]
fn present_main_window(app: &AppHandle, reason: ShowReason) -> Result<(), String> {
    let Some(visibility) = STARTUP_VISIBILITY.get() else {
        return Ok(());
    };
    if !visibility
        .lock()
        .map_err(|_| String::from("startup visibility lock poisoned"))?
        .request_show(reason, current_runtime_settings().launch_to_tray)
    {
        return Ok(());
    }
    let main_window = app
        .get_webview_window("main")
        .ok_or_else(|| String::from("Main window not found"))?;

    apply_dock_visibility(app, dock_visibility_for_main_window_show());
    main_window.show().map_err(|error| error.to_string())?;
    let _ = main_window.unminimize();
    let mode = DEFERRED_MAIN_WINDOW_MODE
        .get()
        .and_then(|mode| mode.lock().ok().map(|mut mode| std::mem::take(&mut *mode)))
        .unwrap_or_default();
    match mode {
        RestoredWindowMode::Fullscreen => {
            let _ = main_window.set_fullscreen(true);
        }
        RestoredWindowMode::Maximized => {
            let _ = main_window.maximize();
        }
        RestoredWindowMode::Normal => {}
    }
    let _ = main_window.set_focus();
    let _ = main_window.emit(FOCUS_CHAT_INPUT_EVENT, ());
    Ok(())
}

fn clamp_i32(value: i32, min: i32, max: i32) -> i32 {
    if max < min {
        return min;
    }
    value.max(min).min(max)
}

#[cfg(not(target_os = "android"))]
fn monitor_contains_point(monitor: &Monitor, point: PhysicalPosition<f64>) -> bool {
    let work_area = monitor.work_area();
    let x = point.x.round() as i32;
    let y = point.y.round() as i32;
    x >= work_area.position.x
        && y >= work_area.position.y
        && x <= work_area.position.x + work_area.size.width as i32
        && y <= work_area.position.y + work_area.size.height as i32
}

#[cfg(not(target_os = "android"))]
fn position_mini_window(
    window: &WebviewWindow,
    anchor: Option<PhysicalPosition<f64>>,
) -> Result<(), String> {
    let size = window
        .inner_size()
        .unwrap_or_else(|_| PhysicalSize::new(MINI_WINDOW_WIDTH, MINI_WINDOW_HEIGHT));
    let monitors = window
        .available_monitors()
        .map_err(|error| error.to_string())?;
    let monitor = anchor
        .and_then(|point| {
            monitors
                .iter()
                .find(|monitor| monitor_contains_point(monitor, point))
                .cloned()
        })
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| monitors.first().cloned());

    let Some(monitor) = monitor else {
        if anchor.is_none() {
            let _ = window.center();
        }
        return Ok(());
    };

    let work_area = monitor.work_area();
    let margin = 10;
    let max_x = work_area.position.x + work_area.size.width as i32 - size.width as i32 - margin;
    let max_y = work_area.position.y + work_area.size.height as i32 - size.height as i32 - margin;

    let (target_x, target_y) = if let Some(point) = anchor {
        (
            clamp_i32(
                point.x.round() as i32 - size.width as i32 + 14,
                work_area.position.x + margin,
                max_x,
            ),
            clamp_i32(
                point.y.round() as i32 + 10,
                work_area.position.y + margin,
                max_y,
            ),
        )
    } else {
        (
            clamp_i32(
                work_area.position.x + work_area.size.width as i32 - size.width as i32 - 24,
                work_area.position.x + margin,
                max_x,
            ),
            clamp_i32(
                work_area.position.y + 24,
                work_area.position.y + margin,
                max_y,
            ),
        )
    };

    window
        .set_position(Position::Physical(PhysicalPosition::new(
            target_x, target_y,
        )))
        .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "android"))]
fn get_or_create_mini_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(MINI_WINDOW_LABEL) {
        return Ok(window);
    }

    WebviewWindowBuilder::new(
        app,
        MINI_WINDOW_LABEL,
        WebviewUrl::App("miniWindow.html".into()),
    )
    .title("lich13studio")
    .inner_size(MINI_WINDOW_WIDTH as f64, MINI_WINDOW_HEIGHT as f64)
    .min_inner_size(360.0, 480.0)
    .max_inner_size(720.0, 860.0)
    .decorations(false)
    .resizable(true)
    .visible(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .build()
    .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "android"))]
fn show_mini_window_at(
    app: &AppHandle,
    anchor: Option<PhysicalPosition<f64>>,
) -> Result<(), String> {
    let mini_window = get_or_create_mini_window(app)?;
    position_mini_window(&mini_window, anchor)?;
    mini_window.show().map_err(|error| error.to_string())?;
    let _ = mini_window.set_focus();
    let _ = mini_window.emit(MINI_WINDOW_SHOW_EVENT, ());
    Ok(())
}

#[cfg(not(target_os = "android"))]
fn hide_mini_window_for_app(app: &AppHandle) -> Result<(), String> {
    if let Some(mini_window) = app.get_webview_window(MINI_WINDOW_LABEL) {
        mini_window.hide().map_err(|error| error.to_string())?;
        let _ = mini_window.emit(MINI_WINDOW_HIDE_EVENT, ());
    }
    Ok(())
}

#[cfg(not(target_os = "android"))]
fn close_auxiliary_windows(app: &AppHandle) {
    if let Some(mini_window) = app.get_webview_window(MINI_WINDOW_LABEL) {
        let _ = mini_window.destroy();
    }
}

#[cfg(not(target_os = "android"))]
fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let [show_id, check_update_id, quit_id] = tray_menu_item_ids();
    let show_item = MenuItem::with_id(app, show_id, "打开主界面", true, None::<&str>)?;
    let check_update_item =
        MenuItem::with_id(app, check_update_id, "检测更新", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, quit_id, "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &check_update_item, &quit_item])?;

    let decoded_icon =
        image::load_from_memory(include_bytes!("../../build/tray_icon.png"))?.into_rgba8();
    let (icon_width, icon_height) = decoded_icon.dimensions();
    let icon = Image::new_owned(decoded_icon.into_raw(), icon_width, icon_height);
    let app_handle = app.handle().clone();

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .icon_as_template(false)
        .tooltip("lich13studio")
        .show_menu_on_left_click(false)
        .menu(&menu)
        .on_tray_icon_event(move |_tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                position,
                ..
            } = event
            {
                let _ = show_mini_window_at(&app_handle, Some(position));
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_SHOW_MENU_ID => {
                let _ = show_and_focus_main_window(app);
            }
            TRAY_CHECK_UPDATE_MENU_ID => {
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    match fetch_latest_update_info(env!("CARGO_PKG_VERSION"), std::env::consts::OS)
                        .await
                    {
                        Ok(update_info) if update_info.has_update => {
                            let version = update_info.latest_version.as_deref().unwrap_or("latest");
                            let _ = notify_update_result(
                                &app_handle,
                                "发现新版本",
                                &format!("lich13studio {version} 已发布，正在打开发布页面。"),
                            );
                            let _ = open_update_url(&update_info).await;
                        }
                        Ok(_) => {
                            let _ = notify_update_result(
                                &app_handle,
                                "已是最新版本",
                                "当前 lich13studio 已是最新版本。",
                            );
                        }
                        Err(error) => {
                            let _ = notify_update_result(
                                &app_handle,
                                "检查更新失败",
                                &format!("无法检查更新：{error}"),
                            );
                        }
                    }
                });
            }
            TRAY_QUIT_MENU_ID => {
                APP_EXITING.store(true, Ordering::Relaxed);
                close_auxiliary_windows(app);
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

fn register_native_http_abort(request_id: &str) -> Arc<HttpAbortHandle> {
    let handle = Arc::new(HttpAbortHandle::new());
    if let Ok(mut registry) = native_http_abort_registry().lock() {
        registry.insert(request_id.to_string(), handle.clone());
    }
    handle
}

fn remove_native_http_abort(request_id: &str) {
    if let Ok(mut registry) = native_http_abort_registry().lock() {
        registry.remove(request_id);
    }
}

async fn emit_native_http_chunk(
    window: &Window,
    request_id: &str,
    chunk: Vec<u8>,
    done: bool,
    error: Option<String>,
) {
    let payload = NativeHttpChunkEvent {
        sequence: None,
        request_id: request_id.to_string(),
        chunk,
        done,
        error,
    };
    #[cfg(target_os = "android")]
    {
        let abort = native_http_abort_registry()
            .lock()
            .unwrap()
            .get(request_id)
            .cloned();
        if let Some(abort) = abort {
            http_delivery::emit(window, payload, &abort).await;
        }
    }
    #[cfg(not(target_os = "android"))]
    let _ = window.emit(NATIVE_HTTP_CHUNK_EVENT, payload);
}

static MOBILE_DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

fn app_data_dir() -> Result<PathBuf, String> {
    if let Some(path) = MOBILE_DATA_DIR.get() {
        return Ok(path.clone());
    }
    let path = dirs::data_dir()
        .ok_or_else(|| String::from("Unable to resolve data directory"))?
        .join(APP_NAME);
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn state_path() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join(DEFAULT_STATE_FILE))
}

fn load_state_file() -> Result<Value, String> {
    let path = state_path()?;
    if !path.exists() {
        return Ok(json!({}));
    }

    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&raw).map_err(|error| error.to_string())
}

fn save_state_file(state: &Value) -> Result<String, String> {
    let path = state_path()?;
    let payload = serde_json::to_vec_pretty(state).map_err(|error| error.to_string())?;
    fs::write(&path, payload).map_err(|error| error.to_string())?;
    Ok(path.display().to_string())
}

#[cfg(not(target_os = "android"))]
fn load_window_state(label: &str) -> Result<Option<PersistedWindowState>, String> {
    let state = load_state_file()?;
    let Some(window_state) = state.get(WINDOW_STATE_KEY) else {
        return Ok(None);
    };

    let Some(serialized_window_state) = window_state.get(label) else {
        return Ok(None);
    };

    serde_json::from_value(serialized_window_state.clone())
        .map(Some)
        .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "android"))]
fn pending_window_states() -> &'static Mutex<HashMap<String, PersistedWindowState>> {
    PENDING_WINDOW_STATES.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(not(target_os = "android"))]
fn flush_pending_window_states() -> Result<(), String> {
    let pending_entries = {
        let mut guard = pending_window_states()
            .lock()
            .map_err(|_| String::from("window state cache lock poisoned"))?;
        if guard.is_empty() {
            return Ok(());
        }
        std::mem::take(&mut *guard)
    };

    let mut state = load_state_file().unwrap_or_else(|_| json!({}));
    if !state.is_object() {
        state = json!({});
    }

    let root = state
        .as_object_mut()
        .ok_or_else(|| String::from("Invalid state payload: root must be an object"))?;

    let window_state_value = root
        .entry(WINDOW_STATE_KEY.to_string())
        .or_insert_with(|| json!({}));

    if !window_state_value.is_object() {
        *window_state_value = json!({});
    }

    let window_state_map = window_state_value
        .as_object_mut()
        .ok_or_else(|| String::from("Invalid state payload: windowState must be an object"))?;

    for (label, persisted_state) in pending_entries {
        window_state_map.insert(
            label,
            serde_json::to_value(persisted_state).map_err(|error| error.to_string())?,
        );
    }

    save_state_file(&state)?;
    Ok(())
}

#[cfg(not(target_os = "android"))]
fn persist_window_state(window: &Window, immediate: bool) -> Result<(), String> {
    // Geometry changes during hidden startup must not overwrite the saved
    // fullscreen/maximized mode that is waiting for the first explicit show.
    if window.label() == "main"
        && !STARTUP_VISIBILITY
            .get()
            .and_then(|visibility| {
                visibility
                    .lock()
                    .ok()
                    .map(|visibility| visibility.has_presented())
            })
            .unwrap_or(false)
    {
        return Ok(());
    }
    let label = window.label().to_string();
    let mut persisted_state = pending_window_states()
        .lock()
        .ok()
        .and_then(|guard| guard.get(&label).cloned())
        .or_else(|| load_window_state(&label).ok().flatten())
        .unwrap_or_default();
    let is_maximized = window.is_maximized().map_err(|error| error.to_string())?;
    let is_fullscreen = window.is_fullscreen().map_err(|error| error.to_string())?;

    persisted_state.maximized = is_maximized;
    persisted_state.fullscreen = is_fullscreen;

    if !is_maximized && !is_fullscreen {
        if let Ok(position) = window.outer_position() {
            persisted_state.x = Some(position.x);
            persisted_state.y = Some(position.y);
        }

        if let Ok(size) = window.outer_size() {
            persisted_state.width = Some(size.width);
            persisted_state.height = Some(size.height);
        }
    }

    if let Ok(mut guard) = pending_window_states().lock() {
        guard.insert(label, persisted_state);
    }

    let epoch = WINDOW_STATE_SAVE_EPOCH.fetch_add(1, Ordering::SeqCst) + 1;
    if immediate {
        return flush_pending_window_states();
    }

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(300)).await;
        if WINDOW_STATE_SAVE_EPOCH.load(Ordering::SeqCst) == epoch {
            let _ = flush_pending_window_states();
        }
    });
    Ok(())
}

#[cfg(not(target_os = "android"))]
fn should_persist_window_event(event: &WindowEvent) -> Option<bool> {
    match event {
        WindowEvent::Resized(_) | WindowEvent::Moved(_) => Some(false),
        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => Some(true),
        _ => None,
    }
}

#[cfg(not(target_os = "android"))]
fn handle_main_window_close(window: &Window, event: &WindowEvent) {
    if window.label() == "main" {
        if let WindowEvent::CloseRequested { api, .. } = event {
            if APP_EXITING.load(Ordering::Relaxed) {
                return;
            }

            api.prevent_close();
            let _ = persist_window_state(window, true);
            match main_window_close_action(current_runtime_settings()) {
                MainWindowCloseAction::KeepBackground => {
                    let _ = window.hide();
                    apply_dock_visibility(
                        window.app_handle(),
                        dock_visibility_for_background_keepalive(),
                    );
                }
                MainWindowCloseAction::Quit => {
                    APP_EXITING.store(true, Ordering::Relaxed);
                    close_auxiliary_windows(window.app_handle());
                    window.app_handle().exit(0);
                }
            }
        }
    }
}

#[cfg(not(target_os = "android"))]
fn handle_mini_window_focus(window: &Window, event: &WindowEvent) {
    if window.label() != MINI_WINDOW_LABEL {
        return;
    }

    if matches!(event, WindowEvent::Focused(false)) && !MINI_WINDOW_PINNED.load(Ordering::Relaxed) {
        let _ = window.hide();
        let _ = window.emit(MINI_WINDOW_HIDE_EVENT, ());
    }
}

#[cfg(not(target_os = "android"))]
fn handle_run_event(app: &AppHandle, event: &RunEvent) {
    match event {
        RunEvent::ExitRequested { api, code, .. } => {
            if should_prevent_implicit_exit(
                code.is_some(),
                APP_EXITING.load(Ordering::Relaxed),
                current_runtime_settings(),
            ) {
                api.prevent_exit();
                apply_dock_visibility(app, dock_visibility_for_background_keepalive());
                return;
            }

            APP_EXITING.store(true, Ordering::Relaxed);
            close_auxiliary_windows(app);
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } => {
            let reason = startup::launch_show_reason(&[], startup::current_launch_event());
            let _ = request_main_window(app, reason);
        }
        _ => {}
    }
}

fn downloads_dir() -> Result<PathBuf, String> {
    let path = dirs::download_dir()
        .or_else(dirs::desktop_dir)
        .ok_or_else(|| String::from("Unable to resolve Downloads or Desktop directory"))?;
    Ok(path)
}

pub(crate) fn percent_decode_bytes(encoded: &str) -> Result<Vec<u8>, String> {
    let raw = encoded.as_bytes();
    let mut out = Vec::with_capacity(raw.len());
    let mut idx = 0;
    while idx < raw.len() {
        if raw[idx] == b'%' {
            if idx + 2 >= raw.len() {
                return Err(String::from("Invalid percent-encoded IPC header"));
            }
            let hi = (raw[idx + 1] as char)
                .to_digit(16)
                .ok_or_else(|| String::from("Invalid percent-encoded IPC header"))?;
            let lo = (raw[idx + 2] as char)
                .to_digit(16)
                .ok_or_else(|| String::from("Invalid percent-encoded IPC header"))?;
            out.push(((hi << 4) | lo) as u8);
            idx += 3;
        } else {
            out.push(raw[idx]);
            idx += 1;
        }
    }
    Ok(out)
}

pub(crate) fn extract_decoded_header(
    headers: &tauri::http::HeaderMap,
    name: &str,
) -> Result<String, String> {
    let value = headers
        .get(name)
        .ok_or_else(|| format!("Missing required IPC header: {name}"))?
        .to_str()
        .map_err(|_| format!("Invalid ASCII in IPC header: {name}"))?;
    let bytes = percent_decode_bytes(value)?;
    String::from_utf8(bytes).map_err(|_| format!("Invalid UTF-8 in IPC header: {name}"))
}

pub(crate) fn extract_zeroizing_header(
    headers: &tauri::http::HeaderMap,
    name: &str,
) -> Result<zeroize::Zeroizing<String>, String> {
    let value = headers
        .get(name)
        .ok_or_else(|| format!("Missing required IPC header: {name}"))?
        .to_str()
        .map_err(|_| format!("Invalid ASCII in IPC header: {name}"))?;
    let decoded = zeroize::Zeroizing::new(percent_decode_bytes(value)?);
    let mut raw_vec = Vec::with_capacity(decoded.len());
    raw_vec.extend_from_slice(&decoded);
    match String::from_utf8(raw_vec) {
        Ok(secret) => Ok(zeroize::Zeroizing::new(secret)),
        Err(err) => {
            let mut bad = err.into_bytes();
            zeroize::Zeroize::zeroize(&mut bad);
            Err(format!("Invalid UTF-8 in IPC header: {name}"))
        }
    }
}

pub(crate) fn extract_raw_ipc_bytes(request: &tauri::ipc::Request<'_>) -> Result<Vec<u8>, String> {
    extract_ipc_body_bytes(request.body())
}

fn extract_ipc_body_bytes(body: &tauri::ipc::InvokeBody) -> Result<Vec<u8>, String> {
    match body {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        // Android WebView IPC uses postMessage and always delivers InvokeBody::Json.
        // Accept base64-wrapped payloads from Android as well as byte arrays from postMessage fallback.
        tauri::ipc::InvokeBody::Json(Value::Object(map)) => {
            let Some(encoded) = map.get("base64").and_then(Value::as_str) else {
                return Err(String::from("Expected raw or base64 binary IPC payload"));
            };
            if encoded.trim().is_empty() {
                return Ok(Vec::new());
            }
            decode_base64_payload(encoded)
        }
        tauri::ipc::InvokeBody::Json(Value::Array(items)) => {
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                let byte = item
                    .as_u64()
                    .and_then(|n| u8::try_from(n).ok())
                    .ok_or_else(|| String::from("Invalid byte in IPC payload array"))?;
                out.push(byte);
            }
            Ok(out)
        }
        tauri::ipc::InvokeBody::Json(_) => Err(String::from("Expected raw binary IPC payload")),
    }
}

struct TempFileGuard(PathBuf);

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

#[cfg(not(target_os = "android"))]
async fn pick_save_file_path(file_name: &str) -> Option<PathBuf> {
    rfd::AsyncFileDialog::new()
        .set_file_name(file_name)
        .save_file()
        .await
        .map(|handle| handle.path().to_path_buf())
}

#[cfg(not(target_os = "android"))]
async fn save_file_bytes(file_name: String, bytes: Vec<u8>) -> Result<String, String> {
    let Some(file_path) = pick_save_file_path(&file_name).await else {
        return Ok(String::new());
    };

    let written_path = file_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        fs::write(&written_path, bytes).map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| String::from("Save file task failed"))??;
    Ok(file_path.display().to_string())
}

#[tauri::command]
#[cfg(not(target_os = "android"))]
async fn save_file(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let file_name = extract_decoded_header(request.headers(), "x-file-name")?;
    let bytes = extract_raw_ipc_bytes(&request)?;
    save_file_bytes(file_name, bytes).await
}

#[tauri::command]
async fn save_base64_image(data: String) -> Result<TauriFileMetadata, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let decoded = decode_base64_image_payload(&data)?;
        let id = Uuid::new_v4().to_string();
        let file_name = format!("{}{}", id, decoded.extension);
        let path = files_dir()?.join(&file_name);

        fs::write(&path, &decoded.bytes).map_err(|error| error.to_string())?;

        Ok(TauriFileMetadata {
            id,
            name: file_name.clone(),
            origin_name: file_name,
            path: path.display().to_string(),
            size: decoded.bytes.len() as u64,
            ext: decoded.extension.clone(),
            file_type: file_type_from_extension(&decoded.extension).to_string(),
            created_at: chrono::Utc::now().to_rfc3339(),
            count: 1,
        })
    })
    .await
    .map_err(|_| String::from("Save base64 image task failed"))?
}

fn normalize_base_url(url: &str) -> String {
    url.trim_end_matches('/').to_string()
}

fn default_obsidian_config_path() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let base =
            dirs::config_dir().ok_or_else(|| String::from("Unable to resolve config directory"))?;
        Ok(base.join("obsidian").join("obsidian.json"))
    }

    #[cfg(target_os = "macos")]
    {
        let home =
            dirs::home_dir().ok_or_else(|| String::from("Unable to resolve home directory"))?;
        Ok(home
            .join("Library")
            .join("Application Support")
            .join("obsidian")
            .join("obsidian.json"))
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let home =
            dirs::home_dir().ok_or_else(|| String::from("Unable to resolve home directory"))?;
        let xdg_config_home = std::env::var("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| home.join(".config"));

        let config_dirs = ["obsidian", "Obsidian"];
        let file_names = ["obsidian.json", "Obsidian.json"];
        let mut candidates = Vec::new();

        for dir in config_dirs {
            for file in file_names {
                candidates.push(xdg_config_home.join(dir).join(file));
                candidates.push(
                    home.join("snap")
                        .join("obsidian")
                        .join("current")
                        .join(".config")
                        .join(dir)
                        .join(file),
                );
                candidates.push(
                    home.join("snap")
                        .join("obsidian")
                        .join("common")
                        .join(".config")
                        .join(dir)
                        .join(file),
                );
                candidates.push(
                    home.join(".var")
                        .join("app")
                        .join("md.obsidian.Obsidian")
                        .join("config")
                        .join(dir)
                        .join(file),
                );
            }
        }

        if let Some(existing) = candidates.into_iter().find(|path| path.exists()) {
            return Ok(existing);
        }

        Ok(xdg_config_home.join("obsidian").join("obsidian.json"))
    }
}

fn parse_obsidian_vaults(config_content: &str) -> Result<Vec<ObsidianVaultInfo>, String> {
    let config: Value = serde_json::from_str(config_content).map_err(|error| error.to_string())?;
    let Some(vaults) = config.get("vaults").and_then(|vaults| vaults.as_object()) else {
        return Ok(Vec::new());
    };

    Ok(vaults
        .values()
        .filter_map(|vault| {
            let path = vault.get("path")?.as_str()?.trim().to_string();
            if path.is_empty() {
                return None;
            }
            let name = vault
                .get("name")
                .and_then(|name| name.as_str())
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(ToOwned::to_owned)
                .or_else(|| {
                    Path::new(&path)
                        .file_name()
                        .and_then(|name| name.to_str())
                        .map(ToOwned::to_owned)
                })
                .unwrap_or_else(|| path.clone());

            Some(ObsidianVaultInfo { path, name })
        })
        .collect())
}

fn obsidian_vaults() -> Result<Vec<ObsidianVaultInfo>, String> {
    let config_path = default_obsidian_config_path()?;
    if !config_path.exists() {
        return Ok(Vec::new());
    }

    let config_content = fs::read_to_string(config_path).map_err(|error| error.to_string())?;
    parse_obsidian_vaults(&config_content)
}

fn traverse_obsidian_directory(
    dir_path: &Path,
    relative_path: &str,
    results: &mut Vec<ObsidianFileInfo>,
) -> Result<(), String> {
    if !relative_path.is_empty() {
        let name = Path::new(relative_path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(relative_path)
            .to_string();

        results.push(ObsidianFileInfo {
            path: relative_path.to_string(),
            r#type: String::from("folder"),
            name,
        });
    }

    let mut entries = fs::read_dir(dir_path)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        let item_name = entry.file_name().to_string_lossy().to_string();
        if item_name.starts_with('.') {
            continue;
        }

        let next_relative = if relative_path.is_empty() {
            item_name.clone()
        } else {
            format!("{}/{}", relative_path, item_name)
        };

        let full_path = entry.path();
        if file_type.is_dir() {
            traverse_obsidian_directory(&full_path, &next_relative, results)?;
        } else if file_type.is_file() && item_name.ends_with(".md") {
            results.push(ObsidianFileInfo {
                path: next_relative,
                r#type: String::from("markdown"),
                name: item_name,
            });
        }
    }

    Ok(())
}

fn obsidian_files(vault_name: &str) -> Result<Vec<ObsidianFileInfo>, String> {
    let vault = obsidian_vaults()?
        .into_iter()
        .find(|vault| vault.name == vault_name || vault.path == vault_name)
        .ok_or_else(|| format!("Obsidian vault not found: {}", vault_name))?;

    let vault_path = PathBuf::from(&vault.path);
    if !vault_path.exists() {
        return Ok(Vec::new());
    }

    let mut results = Vec::new();
    traverse_obsidian_directory(&vault_path, "", &mut results)?;
    Ok(results)
}

#[tauri::command]
async fn start_http_request(
    window: Window,
    request: NativeHttpRequest,
) -> Result<NativeHttpResponseStart, String> {
    let request_id = if request.request_id.trim().is_empty() {
        Uuid::new_v4().to_string()
    } else {
        request.request_id.clone()
    };

    if request
        .task_epoch
        .is_some_and(|epoch| epoch != mobile::TASK_EPOCH.load(Ordering::SeqCst))
    {
        return Err("Background task was stopped".into());
    }
    struct StartGuard {
        id: String,
        armed: bool,
    }
    impl Drop for StartGuard {
        fn drop(&mut self) {
            if self.armed {
                remove_native_http_abort(&self.id);
                http_delivery::remove(&self.id);
            }
        }
    }
    let mut start_guard = StartGuard {
        id: request_id.clone(),
        armed: true,
    };
    let abort_handle = register_native_http_abort(&request_id);
    #[cfg(target_os = "android")]
    http_delivery::register(&request_id);
    let (target, client) = tokio::select! {
      result = net_policy::guarded_http_client(&request.url, net_policy::HostPolicy::User) => result?,
      _ = abort_handle.cancelled() => {
        return Err(String::from("Request was aborted"));
      }
    };

    let method =
        Method::from_bytes(request.method.as_bytes()).map_err(|error| error.to_string())?;
    let mut builder = client.request(method, target);

    for header in &request.headers {
        let header_name =
            HeaderName::from_bytes(header.name.as_bytes()).map_err(|error| error.to_string())?;
        if net_policy::is_forbidden_header(&header_name) {
            continue;
        }
        let header_value =
            HeaderValue::from_str(&header.value).map_err(|error| error.to_string())?;
        builder = builder.header(header_name, header_value);
    }

    if let Some(body_text) = request.body_text.filter(|text| !text.is_empty()) {
        builder = builder.body(body_text);
    } else if let Some(body) = request.body.filter(|bytes| !bytes.is_empty()) {
        builder = builder.body(body);
    }

    if abort_handle.is_aborted() {
        remove_native_http_abort(&request_id);
        return Err(String::from("Request was aborted"));
    }

    let response = tokio::select! {
      result = builder.send() => result.map_err(|error| {
        remove_native_http_abort(&request_id);
        error.to_string()
      })?,
      _ = abort_handle.cancelled() => {
        remove_native_http_abort(&request_id);
        return Err(String::from("Request was aborted"));
      }
    };

    let response_headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            value.to_str().ok().map(|value| NativeHttpHeader {
                name: name.as_str().to_string(),
                value: value.to_string(),
            })
        })
        .collect::<Vec<_>>();

    let response_start = NativeHttpResponseStart {
        request_id: request_id.clone(),
        status: response.status().as_u16(),
        status_text: response
            .status()
            .canonical_reason()
            .unwrap_or_default()
            .to_string(),
        headers: response_headers,
    };

    let task_window = window.clone();
    let task_request_id = request_id.clone();
    tauri::async_runtime::spawn(async move {
        let mut stream = response.bytes_stream();

        loop {
            let chunk = tokio::select! {
              chunk = stream.next() => chunk,
              _ = abort_handle.cancelled() => None,
            };
            let Some(chunk) = chunk else { break };
            match chunk {
                Ok(bytes) => {
                    for part in bytes.chunks(16 * 1024) {
                        if abort_handle.is_aborted() {
                            break;
                        }
                        emit_native_http_chunk(
                            &task_window,
                            &task_request_id,
                            part.to_vec(),
                            false,
                            None,
                        )
                        .await;
                    }
                }
                Err(error) => {
                    let _ = emit_native_http_chunk(
                        &task_window,
                        &task_request_id,
                        Vec::new(),
                        true,
                        Some(error.to_string()),
                    )
                    .await;
                    remove_native_http_abort(&task_request_id);
                    return;
                }
            }
        }

        let _ = emit_native_http_chunk(
            &task_window,
            &task_request_id,
            Vec::new(),
            true,
            abort_handle
                .is_aborted()
                .then(|| "Request was aborted".into()),
        )
        .await;
        remove_native_http_abort(&task_request_id);
    });

    start_guard.armed = false;
    Ok(response_start)
}

#[tauri::command]
async fn abort_http_request(request_id: String) -> Result<bool, String> {
    http_delivery::remove(&request_id);
    if let Ok(registry) = native_http_abort_registry().lock() {
        if let Some(handle) = registry.get(&request_id) {
            handle.cancel();
            return Ok(true);
        }
    }

    Ok(false)
}

async fn webdav_client(config: &BackupWebDavConfig) -> Result<Client, String> {
    let (_, client) =
        net_policy::guarded_http_client(&config.url, net_policy::HostPolicy::User).await?;
    Ok(client)
}

const MAX_WEBDAV_ARCHIVE_BYTES: u64 = 4 * 1024 * 1024 * 1024;

async fn upload_webdav_file(
    config: &BackupWebDavConfig,
    archive_path: &Path,
    content_length: u64,
) -> Result<String, String> {
    if content_length > MAX_WEBDAV_ARCHIVE_BYTES {
        return Err(String::from(
            "WebDAV backup archive exceeds maximum supported size",
        ));
    }
    let raw_file_name = config
        .file_name
        .as_deref()
        .filter(|file_name| !file_name.trim().is_empty())
        .unwrap_or("lich13studio-backup.zip");
    let safe_name = validate_safe_backup_file_name(raw_file_name)?;
    let client = webdav_client(config).await?;
    let target = format!("{}/{}", normalize_base_url(&config.url), safe_name);

    let file = File::open(archive_path).map_err(|error| error.to_string())?;
    let body_stream = futures_util::stream::unfold(Some(file), |reader_opt| async move {
        let mut reader = reader_opt?;
        let chunk_res = tauri::async_runtime::spawn_blocking(
            move || -> Result<(File, Option<Vec<u8>>), std::io::Error> {
                let mut buf = vec![0u8; 64 * 1024];
                let read = reader.read(&mut buf)?;
                if read == 0 {
                    Ok((reader, None))
                } else {
                    buf.truncate(read);
                    Ok((reader, Some(buf)))
                }
            },
        )
        .await;
        match chunk_res {
            Ok(Ok((_, None))) => None,
            Ok(Ok((next_reader, Some(chunk)))) => {
                Some((Ok::<Vec<u8>, std::io::Error>(chunk), Some(next_reader)))
            }
            Ok(Err(io_err)) => Some((Err(io_err), None)),
            Err(_) => Some((
                Err(std::io::Error::other("WebDAV upload read task failed")),
                None,
            )),
        }
    });

    let mut request = client
        .put(&target)
        .basic_auth(&config.username, Some(&config.password))
        .header(CONTENT_TYPE, "application/zip")
        .header(CONTENT_LENGTH, content_length);

    if let Some(user_agent) = config
        .user_agent
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        request = request.header(USER_AGENT, user_agent);
    }

    request
        .body(reqwest::Body::wrap_stream(body_stream))
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;

    Ok(target)
}

async fn download_webdav_to_file(
    config: &BackupWebDavConfig,
    dest_path: &Path,
) -> Result<(), String> {
    const MAX_WEBDAV_RESTORE_BYTES: u64 = MAX_WEBDAV_ARCHIVE_BYTES;
    let raw_file_name = config
        .file_name
        .as_deref()
        .filter(|file_name| !file_name.trim().is_empty())
        .unwrap_or("lich13studio-backup.zip");
    let safe_name = validate_safe_backup_file_name(raw_file_name)?;
    let client = webdav_client(config).await?;
    let target = format!("{}/{}", normalize_base_url(&config.url), safe_name);

    let mut request = client
        .get(&target)
        .basic_auth(&config.username, Some(&config.password));
    if let Some(user_agent) = config
        .user_agent
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        request = request.header(USER_AGENT, user_agent);
    }

    let response = request
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;

    if let Some(len) = response.content_length() {
        if len > MAX_WEBDAV_RESTORE_BYTES {
            return Err(String::from(
                "Remote WebDAV backup exceeds maximum supported size",
            ));
        }
    }

    let dest = dest_path.to_path_buf();
    let writer = tauri::async_runtime::spawn_blocking(move || {
        File::create(&dest)
            .map(BufWriter::new)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| String::from("WebDAV download file task failed"))??;

    let mut stream = response.bytes_stream();
    let mut writer_opt = Some(writer);
    let mut total_written = 0u64;

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|error| error.to_string())?;
        total_written = total_written.saturating_add(bytes.len() as u64);
        if total_written > MAX_WEBDAV_RESTORE_BYTES {
            return Err(String::from(
                "Remote WebDAV backup exceeds maximum supported size",
            ));
        }
        let mut current_writer = writer_opt
            .take()
            .ok_or_else(|| String::from("WebDAV download writer unavailable"))?;
        current_writer =
            tauri::async_runtime::spawn_blocking(move || -> Result<BufWriter<File>, String> {
                current_writer
                    .write_all(&bytes)
                    .map_err(|error| error.to_string())?;
                Ok(current_writer)
            })
            .await
            .map_err(|_| String::from("WebDAV download write task failed"))??;
        writer_opt = Some(current_writer);
    }

    if let Some(mut final_writer) = writer_opt {
        tauri::async_runtime::spawn_blocking(move || {
            final_writer.flush().map_err(|error| error.to_string())
        })
        .await
        .map_err(|_| String::from("WebDAV download flush task failed"))??;
    }

    Ok(())
}

fn parse_webdav_listing(xml: &str) -> Result<Vec<RemoteBackupFileInfo>, String> {
    let document = Document::parse(xml).map_err(|error| error.to_string())?;
    let mut files = Vec::new();

    for response in document.descendants().filter(|node| {
        node.has_tag_name(("DAV:", "response")) || node.tag_name().name() == "response"
    }) {
        let href = response
            .children()
            .find(|node| node.has_tag_name(("DAV:", "href")) || node.tag_name().name() == "href")
            .and_then(|node| node.text())
            .unwrap_or_default()
            .trim()
            .to_string();

        let prop = response
            .descendants()
            .find(|node| node.has_tag_name(("DAV:", "prop")) || node.tag_name().name() == "prop");

        let Some(prop) = prop else {
            continue;
        };

        let is_collection = prop.descendants().any(|node| {
            node.has_tag_name(("DAV:", "collection")) || node.tag_name().name() == "collection"
        });

        if is_collection {
            continue;
        }

        let file_name = href
            .trim_end_matches('/')
            .split('/')
            .rfind(|segment| !segment.is_empty())
            .unwrap_or_default()
            .to_string();

        if file_name.is_empty() {
            continue;
        }

        let modified_time = prop
            .descendants()
            .find(|node| {
                node.has_tag_name(("DAV:", "getlastmodified"))
                    || node.tag_name().name() == "getlastmodified"
            })
            .and_then(|node| node.text())
            .unwrap_or("")
            .to_string();

        let size = prop
            .descendants()
            .find(|node| {
                node.has_tag_name(("DAV:", "getcontentlength"))
                    || node.tag_name().name() == "getcontentlength"
            })
            .and_then(|node| node.text())
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0);

        files.push(RemoteBackupFileInfo {
            file_name,
            modified_time,
            size,
        });
    }

    Ok(files)
}

async fn list_webdav(config: &BackupWebDavConfig) -> Result<Vec<RemoteBackupFileInfo>, String> {
    let client = webdav_client(config).await?;
    let target = normalize_base_url(&config.url);
    let body = r#"<?xml version="1.0" encoding="utf-8" ?><propfind xmlns="DAV:"><prop><getlastmodified/><getcontentlength/><resourcetype/></prop></propfind>"#;

    let mut request = client
        .request(
            reqwest::Method::from_bytes(b"PROPFIND").map_err(|error| error.to_string())?,
            &target,
        )
        .basic_auth(&config.username, Some(&config.password))
        .header("Depth", "1")
        .header(CONTENT_TYPE, "application/xml")
        .body(body.to_string());

    if let Some(user_agent) = config
        .user_agent
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        request = request.header(USER_AGENT, user_agent);
    }

    let response = request
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;

    let payload = response.text().await.map_err(|error| error.to_string())?;
    parse_webdav_listing(&payload)
}

fn validate_safe_backup_file_name(file_name: &str) -> Result<&str, String> {
    let trimmed = file_name.trim();
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains(['/', '\\', ':'])
        || trimmed.chars().any(char::is_control)
    {
        return Err(String::from("Invalid backup file name"));
    }
    let mut components = Path::new(trimmed).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) => Ok(trimmed),
        _ => Err(String::from("Invalid backup file name")),
    }
}

async fn delete_webdav(config: &BackupWebDavConfig, file_name: &str) -> Result<bool, String> {
    let safe_name = validate_safe_backup_file_name(file_name)?;
    let client = webdav_client(config).await?;
    let target = format!("{}/{}", normalize_base_url(&config.url), safe_name);

    let mut request = client
        .delete(target)
        .basic_auth(&config.username, Some(&config.password));
    if let Some(user_agent) = config
        .user_agent
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        request = request.header(USER_AGENT, user_agent);
    }

    request
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;

    Ok(true)
}

fn format_system_time(time: SystemTime) -> String {
    chrono::DateTime::<chrono::Utc>::from(time).to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn config_dir() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("config"))
}

fn files_dir() -> Result<PathBuf, String> {
    let path = app_data_dir()?.join("Data").join("Files");
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn notes_dir() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("Data").join("Notes"))
}

fn logs_dir() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("Logs"))
}

fn extension_from_mime_type(mime_type: Option<&str>) -> &'static str {
    let Some(mime_type) = mime_type else {
        return ".png";
    };

    match mime_type.trim().to_ascii_lowercase().as_str() {
        "image/jpeg" | "image/jpg" => ".jpg",
        "image/png" => ".png",
        "image/gif" => ".gif",
        "image/webp" => ".webp",
        "image/bmp" => ".bmp",
        "image/svg+xml" => ".svg",
        _ => ".png",
    }
}

fn file_type_from_extension(extension: &str) -> &'static str {
    match extension.trim().to_ascii_lowercase().as_str() {
        ".jpg" | ".jpeg" | ".png" | ".gif" | ".webp" | ".bmp" | ".svg" => "image",
        ".txt" | ".md" | ".markdown" | ".json" | ".csv" | ".log" => "text",
        ".pdf" | ".doc" | ".docx" | ".ppt" | ".pptx" | ".xls" | ".xlsx" => "document",
        _ => "other",
    }
}

fn decode_base64_payload(payload: &str) -> Result<Vec<u8>, String> {
    let normalized: String = payload
        .chars()
        .filter(|character| !character.is_ascii_whitespace())
        .collect();

    if normalized.is_empty() {
        return Err(String::from("Base64 data is required"));
    }

    general_purpose::STANDARD
        .decode(normalized.as_bytes())
        .or_else(|_| general_purpose::STANDARD_NO_PAD.decode(normalized.as_bytes()))
        .map_err(|error| format!("Failed to decode base64 image: {error}"))
}

fn decode_base64_image_payload(data: &str) -> Result<DecodedBase64ImagePayload, String> {
    let data = data.trim();

    if data.is_empty() {
        return Err(String::from("Base64 data is required"));
    }

    let (payload, extension) = if data
        .get(..5)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("data:"))
    {
        let data_url_body = &data[5..];
        let comma_index = data_url_body
            .find(',')
            .ok_or_else(|| String::from("Invalid base64 image data URL"))?;
        let header = &data_url_body[..comma_index];

        if !header
            .split(';')
            .any(|part| part.eq_ignore_ascii_case("base64"))
        {
            return Err(String::from("Only base64 image data URLs are supported"));
        }

        let media_type = header
            .split(';')
            .next()
            .filter(|value| !value.trim().is_empty());
        (
            &data_url_body[comma_index + 1..],
            extension_from_mime_type(media_type).to_string(),
        )
    } else {
        (data, ".png".to_string())
    };

    let bytes = decode_base64_payload(payload)?;

    Ok(DecodedBase64ImagePayload { bytes, extension })
}

fn system_device_type() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "mac"
    }

    #[cfg(target_os = "windows")]
    {
        "windows"
    }

    #[cfg(target_os = "android")]
    {
        "android"
    }
    #[cfg(all(
        not(target_os = "macos"),
        not(target_os = "windows"),
        not(target_os = "android")
    ))]
    {
        "linux"
    }
}

static CACHED_SYSTEM_HOSTNAME: OnceLock<String> = OnceLock::new();

fn system_hostname() -> String {
    CACHED_SYSTEM_HOSTNAME
        .get_or_init(|| {
            std::env::var("COMPUTERNAME")
                .or_else(|_| std::env::var("HOSTNAME"))
                .ok()
                .filter(|value| !value.trim().is_empty())
                .or_else(|| {
                    hidden_std_command("hostname")
                        .output()
                        .ok()
                        .filter(|output| output.status.success())
                        .and_then(|output| String::from_utf8(output.stdout).ok())
                        .map(|value| value.trim().to_string())
                        .filter(|value| !value.is_empty())
                })
                .unwrap_or_else(|| String::from("unknown"))
        })
        .clone()
}

const EXTERNAL_URL_SCHEMES: [&str; 4] = ["http", "https", "mailto", "tel"];

fn normalize_external_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(String::from("External URL is required"));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(String::from("Invalid external URL"));
    }

    let parsed = Url::parse(trimmed).map_err(|_| String::from("Invalid external URL"))?;
    if !EXTERNAL_URL_SCHEMES.contains(&parsed.scheme()) {
        return Err(format!("Blocked external URL scheme: {}", parsed.scheme()));
    }
    if matches!(parsed.scheme(), "http" | "https")
        && (parsed.host().is_none() || !parsed.username().is_empty() || parsed.password().is_some())
    {
        return Err(String::from("Invalid external URL"));
    }
    Ok(trimmed.to_string())
}

#[cfg_attr(target_os = "android", allow(dead_code))]
#[derive(Debug, PartialEq, Eq)]
enum OpenTarget {
    Url(std::ffi::OsString),
    Path(PathBuf),
}

/// Desktop `open_path` accepts an existing absolute local path, an allowed external
/// URL, or an Obsidian export URI. Anything else that looks like a URL is rejected so
/// `file:`, `javascript:` or handler schemes cannot be smuggled in as a "path".
#[cfg_attr(target_os = "android", allow(dead_code))]
fn validate_open_path(value: &str) -> Result<OpenTarget, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().any(char::is_control) {
        return Err(String::from("Invalid path"));
    }
    let scheme_len = trimmed.find(':').filter(|&end| {
        end >= 2
            && trimmed[..end].chars().enumerate().all(|(i, c)| {
                c.is_ascii_alphabetic() || (i > 0 && (c.is_ascii_digit() || "+-.".contains(c)))
            })
    });
    if let Some(end) = scheme_len {
        let scheme = trimmed[..end].to_ascii_lowercase();
        if scheme == "obsidian" {
            let parsed = Url::parse(trimmed).map_err(|_| String::from("Invalid path"))?;
            return Ok(OpenTarget::Url(parsed.to_string().into()));
        }
        return normalize_external_url(trimmed).map(|url| OpenTarget::Url(url.into()));
    }
    let path = Path::new(trimmed);
    if !path.is_absolute() {
        return Err(String::from("Path must be absolute"));
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| String::from("Path does not exist"))?;
    Ok(OpenTarget::Path(canonical))
}

fn tray_menu_item_ids() -> [&'static str; 3] {
    [
        TRAY_SHOW_MENU_ID,
        TRAY_CHECK_UPDATE_MENU_ID,
        TRAY_QUIT_MENU_ID,
    ]
}

fn normalize_update_version(version: &str) -> String {
    version
        .trim()
        .trim_start_matches(['v', 'V'])
        .split(['+', '-'])
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or("0")
        .to_string()
}

fn parse_update_version(version: &str) -> Vec<u64> {
    normalize_update_version(version)
        .split('.')
        .map(|part| part.parse::<u64>().unwrap_or(0))
        .collect()
}

fn compare_update_versions(left_version: &str, right_version: &str) -> CmpOrdering {
    let left = parse_update_version(left_version);
    let right = parse_update_version(right_version);
    let length = left.len().max(right.len());

    for index in 0..length {
        let left_part = left.get(index).copied().unwrap_or(0);
        let right_part = right.get(index).copied().unwrap_or(0);
        match left_part.cmp(&right_part) {
            CmpOrdering::Equal => {}
            ordering => return ordering,
        }
    }

    CmpOrdering::Equal
}

fn release_asset_to_app_asset(asset: Option<&GitHubReleaseAsset>) -> Option<AppUpdateAsset> {
    let asset = asset?;
    let name = asset.name.as_deref()?.trim();
    let url = asset.browser_download_url.as_deref()?.trim();
    if name.is_empty() || url.is_empty() {
        return None;
    }

    Some(AppUpdateAsset {
        name: name.to_string(),
        url: url.to_string(),
    })
}

fn select_platform_update_asset(
    assets: &[GitHubReleaseAsset],
    platform: &str,
) -> Option<AppUpdateAsset> {
    let normalized_platform = platform.to_ascii_lowercase();
    let candidates: Vec<&GitHubReleaseAsset> = assets
        .iter()
        .filter(|asset| {
            asset
                .name
                .as_deref()
                .is_some_and(|name| !name.trim().is_empty())
                && asset
                    .browser_download_url
                    .as_deref()
                    .is_some_and(|url| !url.trim().is_empty())
        })
        .collect();

    let preferred = if normalized_platform == "android" {
        candidates.iter().copied().find(|asset| {
            let name = asset
                .name
                .as_deref()
                .unwrap_or_default()
                .to_ascii_lowercase();
            name.ends_with(".apk") && name.contains("arm64")
        })
    } else if normalized_platform == "macos" || normalized_platform == "darwin" {
        candidates.iter().copied().find(|asset| {
            asset
                .name
                .as_deref()
                .unwrap_or_default()
                .to_ascii_lowercase()
                .ends_with(".dmg")
        })
    } else if normalized_platform == "windows" || normalized_platform == "win32" {
        candidates.iter().copied().find(|asset| {
            let name = asset
                .name
                .as_deref()
                .unwrap_or_default()
                .to_ascii_lowercase();
            name.ends_with(".exe") || name.contains("setup")
        })
    } else {
        candidates.iter().copied().find(|asset| {
            let name = asset
                .name
                .as_deref()
                .unwrap_or_default()
                .to_ascii_lowercase();
            name.ends_with(".appimage") || name.ends_with(".deb")
        })
    };

    release_asset_to_app_asset(preferred.or_else(|| candidates.first().copied()))
}

fn release_page_url(tag_name: Option<&str>, html_url: Option<&str>) -> String {
    let tag = tag_name.unwrap_or_default().trim();
    let version = tag
        .strip_prefix('v')
        .or_else(|| tag.strip_prefix('V'))
        .unwrap_or(tag);
    let valid_suffix = |value: &str| {
        !value.is_empty()
            && value
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-'))
    };
    let (without_build, build) = version
        .split_once('+')
        .map_or((version, None), |(a, b)| (a, Some(b)));
    let (core, prerelease) = without_build
        .split_once('-')
        .map_or((without_build, None), |(a, b)| (a, Some(b)));
    let parts: Vec<&str> = core.split('.').collect();
    let valid_tag = parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
        && build.is_none_or(valid_suffix)
        && prerelease.is_none_or(valid_suffix);
    if !valid_tag {
        return GITHUB_RELEASES_URL.to_string();
    }

    let mut expected = Url::parse(GITHUB_RELEASES_URL).expect("Static release URL");
    expected
        .path_segments_mut()
        .expect("Static release path")
        .push("tag")
        .push(tag);
    if let Ok(url) = Url::parse(html_url.unwrap_or_default().trim()) {
        if url.scheme() == "https"
            && url.host_str() == Some("github.com")
            && url.port().is_none()
            && url.username().is_empty()
            && url.password().is_none()
            && url.path() == expected.path()
            && url.query().is_none()
            && url.fragment().is_none()
        {
            return url.to_string();
        }
    }
    expected.to_string()
}

fn build_app_update_info(
    current_version: &str,
    platform: &str,
    release: GitHubLatestRelease,
) -> AppUpdateInfo {
    let latest_version = release
        .tag_name
        .as_deref()
        .map(normalize_update_version)
        .filter(|version| !version.is_empty());
    let release_url = release_page_url(release.tag_name.as_deref(), release.html_url.as_deref());
    let has_update = latest_version.as_deref().is_some_and(|version| {
        release_url != GITHUB_RELEASES_URL
            && compare_update_versions(version, current_version) == CmpOrdering::Greater
    });

    AppUpdateInfo {
        has_update,
        current_version: current_version.to_string(),
        latest_version,
        release_url,
        release_notes: release.body.unwrap_or_default(),
        asset: select_platform_update_asset(&release.assets, platform),
    }
}

async fn fetch_latest_update_info(
    current_version: &str,
    platform: &str,
) -> Result<AppUpdateInfo, String> {
    let (target, client) =
        net_policy::guarded_http_client(GITHUB_LATEST_RELEASE_API_URL, net_policy::HostPolicy::App)
            .await?;
    let release = client
        .get(target)
        .header(USER_AGENT, "lich13studio")
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<GitHubLatestRelease>()
        .await
        .map_err(|error| error.to_string())?;

    Ok(build_app_update_info(current_version, platform, release))
}

#[cfg(not(target_os = "android"))]
async fn open_update_url(update_info: &AppUpdateInfo) -> Result<bool, String> {
    open_external_url(update_info.release_url.clone()).await
}

fn notify_update_result(app: &AppHandle, title: &str, body: &str) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| error.to_string())
}

fn data_dir() -> Result<PathBuf, String> {
    let path = app_data_dir()?.join("Data");
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn install_dir() -> Result<PathBuf, String> {
    if cfg!(target_os = "android") {
        return app_data_dir();
    }
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    Ok(exe
        .parent()
        .and_then(|path| path.parent())
        .and_then(|path| path.parent())
        .map(|path| path.to_path_buf())
        .unwrap_or_else(|| {
            exe.parent()
                .unwrap_or_else(|| std::path::Path::new("/"))
                .to_path_buf()
        }))
}

fn resources_dir() -> Result<PathBuf, String> {
    Ok(install_dir()?.join("Contents").join("Resources"))
}

fn zip_file_options() -> SimpleFileOptions {
    SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644)
}

fn add_directory_to_zip<W: Write + Seek>(
    zip: &mut ZipWriter<W>,
    source_dir: &Path,
    archive_root: &str,
) -> Result<(), String> {
    if !source_dir.exists() {
        return Ok(());
    }

    for entry in WalkDir::new(source_dir) {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let relative = path
            .strip_prefix(source_dir)
            .map_err(|error| error.to_string())?;

        let archive_path = if relative.as_os_str().is_empty() {
            archive_root.trim_end_matches('/').to_string()
        } else {
            format!(
                "{}/{}",
                archive_root.trim_end_matches('/'),
                relative.to_string_lossy().replace('\\', "/")
            )
        };

        if entry.file_type().is_dir() {
            zip.add_directory(
                format!("{}/", archive_path.trim_end_matches('/')),
                zip_file_options(),
            )
            .map_err(|error| error.to_string())?;
            continue;
        }

        zip.start_file(archive_path, zip_file_options())
            .map_err(|error| error.to_string())?;
        let mut file = File::open(path).map_err(|error| error.to_string())?;
        std::io::copy(&mut file, zip).map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn write_backup_archive<W: Write + Seek>(
    writer: W,
    state: &Value,
    include_files: bool,
    data_root: &Path,
) -> Result<W, String> {
    let mut zip = ZipWriter::new(writer);

    zip.start_file("data.json", zip_file_options())
        .map_err(|error| error.to_string())?;
    serde_json::to_writer(&mut zip, state).map_err(|error| error.to_string())?;

    if include_files {
        add_directory_to_zip(&mut zip, data_root, "Data")?;
    }

    zip.finish().map_err(|error| error.to_string())
}

fn create_backup_archive_bytes(state: &Value, include_files: bool) -> Result<Vec<u8>, String> {
    let cursor = write_backup_archive(Cursor::new(Vec::new()), state, include_files, &data_dir()?)?;
    Ok(cursor.into_inner())
}

fn write_backup_archive_to_file(
    file_path: &Path,
    state: &Value,
    include_files: bool,
    data_root: &Path,
) -> Result<(), String> {
    let parent = file_path
        .parent()
        .ok_or_else(|| String::from("Invalid backup file path"))?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temp_name = format!(
        ".{}.tmp-{}",
        file_path.file_name().unwrap_or_default().to_string_lossy(),
        Uuid::new_v4()
    );
    let temp_path = parent.join(temp_name);
    let write_result = (|| -> Result<(), String> {
        let file = File::create(&temp_path).map_err(|error| error.to_string())?;
        let mut writer =
            write_backup_archive(BufWriter::new(file), state, include_files, data_root)?;
        writer.flush().map_err(|error| error.to_string())?;
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }
    if let Err(error) = fs::rename(&temp_path, file_path) {
        let _ = fs::remove_file(&temp_path);
        return Err(error.to_string());
    }
    Ok(())
}

fn validate_backup_value(data: &Value) -> Result<(), String> {
    let version = data["version"].as_u64().ok_or("Missing backup version")?;
    if !(1..=5).contains(&version)
        || !data["localStorage"].is_object()
        || !(data["indexedDB"].is_object() || (version == 1 && data["indexedDB"].is_array()))
    {
        return Err("Unsupported backup format".into());
    }
    let persisted = data["localStorage"]["persist:cherry-studio"]
        .as_str()
        .ok_or("Backup missing application state")?;
    let state: Value = serde_json::from_str(persisted).map_err(|_| "Invalid application state")?;
    if !state.is_object() {
        return Err("Invalid application state".into());
    }
    if let Some(tables) = data["indexedDB"].as_object() {
        if tables.values().any(|table| !table.is_array()) {
            return Err("Invalid backup table".into());
        }
    }
    Ok(())
}

fn validate_backup_payload(payload: &str) -> Result<(), String> {
    let data: Value = serde_json::from_str(payload).map_err(|_| "Invalid backup JSON")?;
    validate_backup_value(&data)
}

const RESTORE_PENDING_MARKER_FILE: &str = ".restore-pending.json";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct PendingRestoreMarker {
    previous_dir_name: String,
    existed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ActivePendingRestore {
    restore_id: String,
    current: PathBuf,
    previous: PathBuf,
    existed: bool,
}

fn is_valid_previous_dir_name(name: &str) -> bool {
    !name.is_empty()
        && name.starts_with("restore-previous-")
        && name.len() > "restore-previous-".len()
        && !name.contains(['/', '\\'])
        && !name.contains("..")
}

fn read_pending_restore_marker(app_data_root: &Path) -> Option<PendingRestoreMarker> {
    let marker_path = app_data_root.join(RESTORE_PENDING_MARKER_FILE);
    let raw_marker = fs::read_to_string(marker_path).ok()?;
    let marker = serde_json::from_str::<PendingRestoreMarker>(&raw_marker).ok()?;
    is_valid_previous_dir_name(&marker.previous_dir_name).then_some(marker)
}

fn active_restore_from_marker(
    app_data_root: &Path,
    marker: PendingRestoreMarker,
) -> ActivePendingRestore {
    let previous = app_data_root.join(&marker.previous_dir_name);
    ActivePendingRestore {
        restore_id: marker.previous_dir_name,
        current: app_data_root.join("Data"),
        previous,
        existed: marker.existed,
    }
}

fn write_pending_restore_marker(
    app_data_root: &Path,
    marker: &PendingRestoreMarker,
) -> Result<(), String> {
    let marker_path = app_data_root.join(RESTORE_PENDING_MARKER_FILE);
    let temp_path = app_data_root.join(format!(
        ".{RESTORE_PENDING_MARKER_FILE}.tmp-{}",
        Uuid::new_v4()
    ));
    let encoded = serde_json::to_vec(marker).map_err(|error| error.to_string())?;
    fs::write(&temp_path, encoded).map_err(|_| String::from("Cannot write restore journal"))?;
    if let Err(error) = fs::rename(&temp_path, &marker_path) {
        let _ = fs::remove_file(&temp_path);
        return Err(error.to_string());
    }
    Ok(())
}

fn remove_pending_restore_marker_for_data_dir(data_root: &Path) {
    if let Some(parent) = data_root.parent() {
        let _ = fs::remove_file(parent.join(RESTORE_PENDING_MARKER_FILE));
    }
}

static PENDING_BACKUP_RESTORE: OnceLock<Mutex<Option<ActivePendingRestore>>> = OnceLock::new();

fn finish_backup_restore_target(target: &ActivePendingRestore, commit: bool) -> Result<(), String> {
    if commit {
        if target.existed && target.previous.exists() {
            fs::remove_dir_all(&target.previous).map_err(|_| "Cannot remove restore staging")?;
        }
    } else if target.existed {
        if target.previous.exists() {
            if target.current.exists() {
                fs::remove_dir_all(&target.current)
                    .map_err(|_| "Cannot roll back restored files")?;
            }
            fs::rename(&target.previous, &target.current)
                .map_err(|_| "Cannot restore previous files")?;
        }
    } else if target.current.exists() {
        fs::remove_dir_all(&target.current).map_err(|_| "Cannot roll back restored files")?;
    }
    remove_pending_restore_marker_for_data_dir(&target.current);
    Ok(())
}

#[cfg(test)]
fn get_pending_restore_id_in_dir(app_data_root: &Path) -> Option<String> {
    let data_root = app_data_root.join("Data");
    if let Ok(pending) = PENDING_BACKUP_RESTORE.get_or_init(Default::default).lock() {
        if let Some(active) = pending.as_ref() {
            if active.current == data_root {
                return Some(active.restore_id.clone());
            }
        }
    }
    read_pending_restore_marker(app_data_root).map(|marker| marker.previous_dir_name)
}

#[cfg(test)]
fn finish_backup_restore_in_dir(app_data_root: &Path, commit: bool) -> Result<(), String> {
    let mut pending = PENDING_BACKUP_RESTORE
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "Restore lock unavailable")?;
    let data_root = app_data_root.join("Data");
    if let Some(active) = pending.as_ref() {
        if active.current == data_root {
            let target = active.clone();
            finish_backup_restore_target(&target, commit)?;
            *pending = None;
            return Ok(());
        }
    }
    if let Some(marker) = read_pending_restore_marker(app_data_root) {
        let target = active_restore_from_marker(app_data_root, marker);
        finish_backup_restore_target(&target, commit)?;
    }
    Ok(())
}

#[tauri::command]
fn get_pending_restore_id() -> Result<Option<String>, String> {
    let pending = PENDING_BACKUP_RESTORE
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "Restore lock unavailable")?;
    if let Some(active) = pending.as_ref() {
        return Ok(Some(active.restore_id.clone()));
    }
    drop(pending);
    let app_root = app_data_dir()?;
    Ok(read_pending_restore_marker(&app_root).map(|marker| marker.previous_dir_name))
}

#[tauri::command]
fn finish_backup_restore(commit: bool) -> Result<(), String> {
    let mut pending = PENDING_BACKUP_RESTORE
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "Restore lock unavailable")?;
    if let Some(target) = pending.clone() {
        finish_backup_restore_target(&target, commit)?;
        *pending = None;
        return Ok(());
    }
    let app_root = app_data_dir()?;
    if let Some(marker) = read_pending_restore_marker(&app_root) {
        let target = active_restore_from_marker(&app_root, marker);
        finish_backup_restore_target(&target, commit)?;
    }
    Ok(())
}

fn recover_and_cleanup_storage_in_dir(
    app_data_root: &Path,
    cache_root: Option<&Path>,
    stale_tmp_max_age: Duration,
) -> Result<Option<ActivePendingRestore>, String> {
    let mut deferred_restore: Option<ActivePendingRestore> = None;

    if app_data_root.exists() {
        let raw_data_dir = app_data_root.join("Data");
        let marker_path = app_data_root.join(RESTORE_PENDING_MARKER_FILE);
        if marker_path.is_file() {
            if let Some(marker) = read_pending_restore_marker(app_data_root) {
                let prev_path = app_data_root.join(&marker.previous_dir_name);
                if !raw_data_dir.exists() {
                    // Crash occurred before staging was swapped into Data/; IndexedDB could not have committed.
                    if marker.existed && prev_path.exists() {
                        fs::rename(&prev_path, &raw_data_dir).map_err(|error| error.to_string())?;
                    }
                    let _ = fs::remove_file(&marker_path);
                } else if marker.existed && !prev_path.exists() {
                    // Previous files were already purged during finish_backup_restore(true) before marker removal.
                    let _ = fs::remove_file(&marker_path);
                } else {
                    // Data/ exists alongside .restore-pending.json: defer commit vs. rollback until
                    // startup reconciles against IndexedDB's committed restoreId.
                    deferred_restore = Some(active_restore_from_marker(app_data_root, marker));
                }
            } else {
                let _ = fs::remove_file(&marker_path);
            }
        }

        let mut previous_dirs = Vec::new();
        let mut staging_dirs = Vec::new();
        let mut stale_tmp_files = Vec::new();
        let now = SystemTime::now();
        let protected_prev_name = deferred_restore
            .as_ref()
            .map(|pending| pending.restore_id.as_str());

        for entry in fs::read_dir(app_data_root).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };

            if file_type.is_dir() {
                if name_str.starts_with("restore-previous-") {
                    if protected_prev_name != Some(name_str.as_ref()) {
                        previous_dirs.push(path);
                    }
                } else if name_str.starts_with("restore-staging-") {
                    staging_dirs.push(path);
                }
            } else if file_type.is_file() && name_str.contains(".tmp-") {
                let is_stale = entry
                    .metadata()
                    .ok()
                    .and_then(|meta| meta.modified().ok())
                    .and_then(|modified| now.duration_since(modified).ok())
                    .map(|age| age >= stale_tmp_max_age)
                    .unwrap_or(false);
                if is_stale {
                    stale_tmp_files.push(path);
                }
            }
        }

        // Fallback: If Data/ is missing and a unique restore-previous-* exists without a marker, roll it back.
        if deferred_restore.is_none() && !raw_data_dir.exists() && previous_dirs.len() == 1 {
            fs::rename(&previous_dirs[0], &raw_data_dir).map_err(|error| error.to_string())?;
            previous_dirs.clear();
        }

        // Purge orphan staging directories and stale temp files; only purge unprotected restore-previous-* when Data/ exists.
        for dir in staging_dirs {
            let _ = fs::remove_dir_all(dir);
        }
        if raw_data_dir.exists() {
            for dir in previous_dirs {
                let _ = fs::remove_dir_all(dir);
            }
        }
        for tmp_file in stale_tmp_files {
            let _ = fs::remove_file(tmp_file);
        }
    }

    if let Some(cache_dir) = cache_root {
        let exports_dir = cache_dir.join("exports");
        if exports_dir.exists() {
            if let Ok(entries) = fs::read_dir(&exports_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        let _ = fs::remove_dir_all(path);
                    } else {
                        let _ = fs::remove_file(path);
                    }
                }
            }
        }
    }

    Ok(deferred_restore)
}

fn extract_backup_archive(bytes: &[u8]) -> Result<String, String> {
    extract_backup_archive_to(bytes, &data_dir()?)
}

fn extract_backup_archive_to(bytes: &[u8], data_root: &Path) -> Result<String, String> {
    extract_backup_archive_from_reader(Cursor::new(bytes), data_root)
}

fn extract_backup_archive_from_file(
    archive_path: &Path,
    data_root: &Path,
) -> Result<String, String> {
    let file = File::open(archive_path).map_err(|_| String::from("Invalid backup archive"))?;
    extract_backup_archive_from_reader(BufReader::new(file), data_root)
}

fn extract_backup_archive_from_reader<R: Read + Seek>(
    reader: R,
    data_root: &Path,
) -> Result<String, String> {
    let mut pending = PENDING_BACKUP_RESTORE
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "Restore lock unavailable")?;
    let parent = data_root.parent().ok_or("Invalid data directory")?;
    if pending.is_some() || read_pending_restore_marker(parent).is_some() {
        return Err("A backup restore is already active".into());
    }
    let mut archive = ZipArchive::new(reader).map_err(|_| "Invalid backup archive")?;
    let mut payload = String::new();
    archive
        .by_name("data.json")
        .map_err(|_| "Backup archive missing data.json")?
        .take(512 * 1024 * 1024)
        .read_to_string(&mut payload)
        .map_err(|_| "Invalid backup data")?;
    validate_backup_payload(&payload)?;
    let previous_dir_name = format!("restore-previous-{}", Uuid::new_v4());
    let staging = parent.join(format!("restore-staging-{}", Uuid::new_v4()));
    let previous = parent.join(&previous_dir_name);
    fs::create_dir_all(&staging).map_err(|_| "Cannot stage backup")?;
    let result = (|| -> Result<bool, String> {
        let mut has_data = false;
        for index in 0..archive.len() {
            let mut file = archive
                .by_index(index)
                .map_err(|_| "Damaged backup entry")?;
            let path = file.enclosed_name().ok_or("Unsafe backup path")?;
            if file
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
            {
                return Err("Backup symlinks are not supported".into());
            }
            let Ok(relative) = path.strip_prefix("Data") else {
                continue;
            };
            has_data = true;
            let output_path = staging.join(relative);
            if file.is_dir() {
                fs::create_dir_all(&output_path).map_err(|_| "Cannot stage directory")?;
                continue;
            }
            if let Some(parent) = output_path.parent() {
                fs::create_dir_all(parent).map_err(|_| "Cannot stage directory")?;
            }
            let mut output = File::create(&output_path).map_err(|_| "Cannot stage file")?;
            std::io::copy(&mut file, &mut output).map_err(|_| "Damaged backup file")?;
        }
        Ok(has_data)
    })();
    let has_data = match result {
        Ok(value) => value,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
    };
    if has_data {
        let existed = data_root.exists();
        if let Err(error) = write_pending_restore_marker(
            parent,
            &PendingRestoreMarker {
                previous_dir_name: previous_dir_name.clone(),
                existed,
            },
        ) {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
        if existed && fs::rename(data_root, &previous).is_err() {
            remove_pending_restore_marker_for_data_dir(data_root);
            let _ = fs::remove_dir_all(&staging);
            return Err("Cannot prepare backup restore".into());
        }
        if fs::rename(&staging, data_root).is_err() {
            if existed {
                let _ = fs::rename(&previous, data_root);
            }
            remove_pending_restore_marker_for_data_dir(data_root);
            let _ = fs::remove_dir_all(&staging);
            return Err("Cannot commit backup restore".into());
        }
        *pending = Some(ActivePendingRestore {
            restore_id: previous_dir_name,
            current: data_root.to_path_buf(),
            previous,
            existed,
        });
    } else {
        let _ = fs::remove_dir_all(staging);
    }
    Ok(payload)
}

#[tauri::command]
async fn export_portable_backup_archive(
    app: AppHandle,
    file_name: String,
    state: Value,
    include_files: bool,
    password: Option<String>,
) -> Result<String, String> {
    let safe_name = validate_safe_backup_file_name(&file_name)?.to_string();
    if let Some(secret) = password {
        let bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
            validate_backup_value(&state)?;
            let archive = create_backup_archive_bytes(&state, include_files)?;
            let zeroized = zeroize::Zeroizing::new(secret);
            backup_crypto::encrypt(&archive, &zeroized)
        })
        .await
        .map_err(|_| String::from("Backup archive task failed"))??;

        #[cfg(target_os = "android")]
        {
            return mobile::save_file_bytes(app, safe_name, bytes).await;
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = app;
            return save_file_bytes(safe_name, bytes).await;
        }
    }

    #[cfg(target_os = "android")]
    {
        let export_dir = app
            .path()
            .app_cache_dir()
            .map_err(|_| String::from("Could not resolve cache directory"))?
            .join("exports");
        fs::create_dir_all(&export_dir).map_err(|_| String::from("Could not stage export"))?;
        let staged_path = export_dir.join(format!("{}-{}", Uuid::new_v4(), safe_name));
        let _guard = TempFileGuard(staged_path.clone());
        let target_for_write = staged_path.clone();
        tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
            validate_backup_value(&state)?;
            write_backup_archive_to_file(&target_for_write, &state, include_files, &data_dir()?)
        })
        .await
        .map_err(|_| String::from("Backup archive task failed"))??;
        mobile::save_staged_file(app, safe_name, &staged_path).await
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        validate_backup_value(&state)?;
        let Some(file_path) = pick_save_file_path(&safe_name).await else {
            return Ok(String::new());
        };
        let target_for_write = file_path.clone();
        tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
            write_backup_archive_to_file(&target_for_write, &state, include_files, &data_dir()?)
        })
        .await
        .map_err(|_| String::from("Backup archive task failed"))??;
        Ok(file_path.display().to_string())
    }
}

fn resolve_attachment_in_root(root: &Path, name: &str) -> Result<PathBuf, String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|_| String::from("Attachment directory unavailable"))?;
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.chars().any(char::is_control) {
        return Err(String::from("Invalid attachment name"));
    }
    let clean = trimmed.strip_prefix("file://").unwrap_or(trimmed);
    let candidate = if Path::new(clean).is_absolute() {
        PathBuf::from(clean)
    } else {
        if clean.contains(['/', '\\']) || clean == "." || clean == ".." {
            return Err(String::from("Invalid attachment name"));
        }
        canonical_root.join(clean)
    };
    let canonical = candidate
        .canonicalize()
        .map_err(|_| String::from("Attachment not found"))?;
    if !canonical.starts_with(&canonical_root) || canonical == canonical_root {
        return Err(String::from("Attachment is outside application storage"));
    }
    Ok(canonical)
}

fn persist_attachment_bytes(name: &str, bytes: &[u8]) -> Result<String, String> {
    if name.is_empty() || name.contains(['/', '\\']) || name == "." || name == ".." {
        return Err("Invalid attachment name".into());
    }
    let path = files_dir()?.join(name);
    fs::write(&path, bytes).map_err(|_| "Could not save attachment")?;
    Ok(path.display().to_string())
}

#[tauri::command]
async fn persist_attachment(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let name = extract_decoded_header(request.headers(), "x-file-name")?;
    let bytes = extract_raw_ipc_bytes(&request)?;
    tauri::async_runtime::spawn_blocking(move || persist_attachment_bytes(&name, &bytes))
        .await
        .map_err(|_| String::from("Persist attachment task failed"))?
}

#[tauri::command]
async fn read_attachment(name: String) -> Result<tauri::ipc::Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let root = files_dir()?;
        let path = resolve_attachment_in_root(&root, &name)?;
        fs::read(path).map_err(|_| String::from("Could not read attachment"))
    })
    .await
    .map_err(|_| String::from("Read attachment task failed"))??;
    Ok(tauri::ipc::Response::new(bytes))
}

fn delete_attachment_in_root(root: &Path, name: &str) -> Result<bool, String> {
    match resolve_attachment_in_root(root, name) {
        Ok(path) => {
            if !path.is_file() {
                return Err(String::from("Attachment is not a regular file"));
            }
            fs::remove_file(path).map_err(|_| String::from("Could not delete attachment"))?;
            Ok(true)
        }
        Err(err) if err == "Attachment not found" => Ok(false),
        Err(err) => Err(err),
    }
}

fn clear_attachments_in_root(root: &Path) -> Result<u64, String> {
    if !root.exists() {
        return Ok(0);
    }
    let canonical_root = root
        .canonicalize()
        .map_err(|_| String::from("Attachment directory unavailable"))?;
    let mut removed = 0u64;
    for entry in fs::read_dir(&canonical_root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_file() {
            fs::remove_file(entry.path()).map_err(|error| error.to_string())?;
            removed += 1;
        }
    }
    Ok(removed)
}

#[tauri::command]
async fn delete_attachment(name: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || delete_attachment_in_root(&files_dir()?, &name))
        .await
        .map_err(|_| String::from("Delete attachment task failed"))?
}

#[tauri::command]
async fn clear_attachments() -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(|| clear_attachments_in_root(&files_dir()?))
        .await
        .map_err(|_| String::from("Clear attachments task failed"))?
}

#[cfg(not(target_os = "android"))]
fn encode_png(image: image::RgbaImage) -> Result<Vec<u8>, String> {
    let (width, height) = image.dimensions();
    let rgba = image.into_raw();
    let mut cursor = Cursor::new(Vec::new());
    let encoder = PngEncoder::new(&mut cursor);

    encoder
        .write_image(&rgba, width, height, ColorType::Rgba8.into())
        .map_err(|error| error.to_string())?;

    Ok(cursor.into_inner())
}

#[cfg(not(target_os = "android"))]
fn capture_windows() -> Result<Vec<CaptureWindowInfo>, String> {
    let current_pid = std::process::id();
    let mut windows = Vec::new();

    for window in CaptureWindow::all().map_err(|error| error.to_string())? {
        let title = window.title().map_err(|error| error.to_string())?;
        let title = title.trim().to_string();
        if title.is_empty() {
            continue;
        }

        let app_name = window.app_name().map_err(|error| error.to_string())?;
        if app_name.eq_ignore_ascii_case(APP_NAME) {
            continue;
        }

        let pid = window.pid().map_err(|error| error.to_string())?;
        if pid == current_pid {
            continue;
        }

        let width = window.width().map_err(|error| error.to_string())?;
        let height = window.height().map_err(|error| error.to_string())?;
        if width == 0 || height == 0 {
            continue;
        }

        let is_minimized = window.is_minimized().map_err(|error| error.to_string())?;
        if is_minimized {
            continue;
        }

        windows.push(CaptureWindowInfo {
            id: window.id().map_err(|error| error.to_string())?,
            app_name,
            title,
            width,
            height,
            is_focused: window.is_focused().map_err(|error| error.to_string())?,
        });
    }

    windows.sort_by(|left, right| {
        right
            .is_focused
            .cmp(&left.is_focused)
            .then_with(|| {
                left.app_name
                    .to_lowercase()
                    .cmp(&right.app_name.to_lowercase())
            })
            .then_with(|| left.title.to_lowercase().cmp(&right.title.to_lowercase()))
    });

    Ok(windows)
}

#[cfg(not(target_os = "android"))]
fn ensure_screen_capture_access() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    unsafe {
        if CGPreflightScreenCaptureAccess() {
            return Ok(());
        }

        if CGRequestScreenCaptureAccess() {
            return Ok(());
        }

        Err(String::from(
      "Screen capture permission is required. Enable Screen Recording for lich13studio in System Settings and relaunch the app.",
    ))
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

#[tauri::command]
fn app_info() -> Result<AppInfo, String> {
    let data_dir = app_data_dir()?;
    let state_file = state_path()?;
    let install_path = install_dir()?;
    let resources_path = resources_dir()?;
    let files_path = files_dir()?;
    let notes_path = notes_dir()?;
    let config_path = config_dir()?;
    let logs_path = logs_dir()?;

    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION"),
        is_packaged: true,
        app_path: resources_path.display().to_string(),
        config_path: config_path.display().to_string(),
        app_data_path: data_dir.display().to_string(),
        resources_path: resources_path.display().to_string(),
        files_path: files_path.display().to_string(),
        notes_path: notes_path.display().to_string(),
        logs_path: logs_path.display().to_string(),
        arch: std::env::consts::ARCH,
        is_portable: false,
        install_path: install_path.display().to_string(),
        bundle_id: BUNDLE_ID,
        runtime: "tauri",
        platform: std::env::consts::OS,
        state_path: state_file.display().to_string(),
    })
}

#[tauri::command]
fn get_device_type() -> String {
    system_device_type().to_string()
}

#[tauri::command]
fn get_hostname() -> String {
    system_hostname()
}

#[tauri::command]
fn set_runtime_setting(key: String, value: bool) -> Result<RuntimeSettings, String> {
    let mut settings = current_runtime_settings();
    apply_runtime_setting(&mut settings, &key, value)?;
    save_runtime_settings_to_state(settings)?;
    replace_runtime_settings(settings);
    Ok(settings)
}

#[tauri::command]
#[cfg(not(target_os = "android"))]
fn set_launch_on_boot(enabled: bool) -> Result<bool, String> {
    if enabled {
        enable_auto_launch()?;
    } else {
        disable_auto_launch()?;
    }

    Ok(enabled)
}

#[tauri::command]
fn is_startup_silent() -> bool {
    STARTED_SILENTLY.load(Ordering::SeqCst)
}

#[tauri::command]
async fn webdav_backup(state: Value, config: BackupWebDavConfig) -> Result<String, String> {
    let include_files = !config.skip_backup_file.unwrap_or(false);
    let app_root = app_data_dir()?;
    fs::create_dir_all(&app_root).map_err(|error| error.to_string())?;
    let temp_path = app_root.join(format!(".webdav-upload.tmp-{}", Uuid::new_v4()));
    let _guard = TempFileGuard(temp_path.clone());
    let temp_for_write = temp_path.clone();
    let content_length = tauri::async_runtime::spawn_blocking(move || -> Result<u64, String> {
        validate_backup_value(&state)?;
        let file = File::create(&temp_for_write).map_err(|error| error.to_string())?;
        let mut writer =
            write_backup_archive(BufWriter::new(file), &state, include_files, &data_dir()?)?;
        writer.flush().map_err(|error| error.to_string())?;
        drop(writer);
        fs::metadata(&temp_for_write)
            .map(|meta| meta.len())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| String::from("Backup archive task failed"))??;

    upload_webdav_file(&config, &temp_path, content_length).await
}

#[tauri::command]
async fn webdav_restore(config: BackupWebDavConfig) -> Result<String, String> {
    let app_root = app_data_dir()?;
    fs::create_dir_all(&app_root).map_err(|error| error.to_string())?;
    let temp_path = app_root.join(format!(".webdav-download.tmp-{}", Uuid::new_v4()));
    let _guard = TempFileGuard(temp_path.clone());
    download_webdav_to_file(&config, &temp_path).await?;
    let temp_for_extract = temp_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        extract_backup_archive_from_file(&temp_for_extract, &data_dir()?)
    })
    .await
    .map_err(|_| String::from("Backup restore task failed"))?
}

#[tauri::command]
#[cfg(not(target_os = "android"))]
async fn pick_folder() -> Result<Option<String>, String> {
    let handle = rfd::AsyncFileDialog::new().pick_folder().await;
    Ok(handle.map(|path| path.path().display().to_string()))
}

#[tauri::command]
fn get_obsidian_vaults() -> Result<Vec<ObsidianVaultInfo>, String> {
    obsidian_vaults()
}

#[tauri::command]
async fn get_obsidian_files(vault_name: String) -> Result<Vec<ObsidianFileInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || obsidian_files(&vault_name))
        .await
        .map_err(|_| String::from("Obsidian files scan task failed"))?
}

#[tauri::command]
#[cfg(not(target_os = "android"))]
async fn open_path(path: String) -> Result<bool, String> {
    let target = match validate_open_path(&path)? {
        OpenTarget::Url(url) => url,
        OpenTarget::Path(path) => path.into_os_string(),
    };

    let status = if cfg!(target_os = "macos") {
        Command::new("open").arg(&target).status().await
    } else if cfg!(target_os = "windows") {
        // ShellExecute through url.dll avoids cmd.exe parsing of `&`, `|` and `^`.
        hidden_command("rundll32")
            .arg("url.dll,FileProtocolHandler")
            .arg(&target)
            .status()
            .await
    } else {
        Command::new("xdg-open").arg(&target).status().await
    }
    .map_err(|error| error.to_string())?;

    Ok(status.success())
}

#[tauri::command]
#[cfg(not(target_os = "android"))]
async fn open_external_url(url: String) -> Result<bool, String> {
    let normalized_url = normalize_external_url(&url)?;

    let status = if cfg!(target_os = "macos") {
        Command::new("open").arg(&normalized_url).status().await
    } else if cfg!(target_os = "windows") {
        hidden_command("rundll32")
            .arg("url.dll,FileProtocolHandler")
            .arg(&normalized_url)
            .status()
            .await
    } else {
        Command::new("xdg-open").arg(&normalized_url).status().await
    }
    .map_err(|error| error.to_string())?;

    Ok(status.success())
}

#[tauri::command]
#[cfg(not(target_os = "android"))]
async fn list_capture_windows() -> Result<Vec<CaptureWindowInfo>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        ensure_screen_capture_access()?;
        capture_windows()
    })
    .await
    .map_err(|_| String::from("List capture windows task failed"))?
}

#[tauri::command]
#[cfg(not(target_os = "android"))]
async fn capture_window(window_id: u32) -> Result<tauri::ipc::Response, String> {
    let png_bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        ensure_screen_capture_access()?;
        let window = CaptureWindow::all()
            .map_err(|error| error.to_string())?
            .into_iter()
            .find(|window| window.id().ok() == Some(window_id))
            .ok_or_else(|| String::from("Target window not found"))?;

        let image = window.capture_image().map_err(|error| error.to_string())?;
        encode_png(image)
    })
    .await
    .map_err(|_| String::from("Capture window task failed"))??;
    Ok(tauri::ipc::Response::new(png_bytes))
}

#[tauri::command]
async fn backup_to_local_dir(
    file_name: String,
    local_backup_dir: Option<String>,
    state: Option<Value>,
    payload: Option<String>,
    skip_backup_file: Option<bool>,
) -> Result<bool, String> {
    let safe_name = validate_safe_backup_file_name(&file_name)?.to_string();
    let base_dir = local_backup_dir
        .filter(|dir| !dir.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or(downloads_dir()?);
    let include_files = !skip_backup_file.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
        let backup_state = match state {
            Some(value) => value,
            None => {
                let raw =
                    payload.ok_or_else(|| String::from("Backup state payload is required"))?;
                serde_json::from_str(&raw).map_err(|error| error.to_string())?
            }
        };
        validate_backup_value(&backup_state)?;
        let file_path = base_dir.join(safe_name);
        write_backup_archive_to_file(&file_path, &backup_state, include_files, &data_dir()?)?;
        Ok(true)
    })
    .await
    .map_err(|_| String::from("Local backup task failed"))?
}

#[tauri::command]
async fn restore_from_local_backup(
    file_name: String,
    local_backup_dir: Option<String>,
    password: Option<String>,
) -> Result<String, String> {
    let safe_name = validate_safe_backup_file_name(&file_name)?.to_string();
    let base_dir = local_backup_dir
        .filter(|dir| !dir.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or(downloads_dir()?);
    let file_path = base_dir.join(&safe_name);
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let lower_name = safe_name.to_ascii_lowercase();
        if lower_name.ends_with(".lich13backup") {
            let encrypted = fs::read(&file_path).map_err(|error| error.to_string())?;
            let secret = password.ok_or_else(|| String::from("Backup password is required"))?;
            let zeroized = zeroize::Zeroizing::new(secret);
            let decrypted = backup_crypto::decrypt(&encrypted, &zeroized)?;
            return extract_backup_archive(&decrypted);
        }
        if lower_name.ends_with(".zip") {
            return extract_backup_archive_from_file(&file_path, &data_dir()?);
        }

        let raw = fs::read_to_string(&file_path).map_err(|error| error.to_string())?;
        validate_backup_payload(&raw)?;
        Ok(raw)
    })
    .await
    .map_err(|_| String::from("Local restore task failed"))?
}

#[tauri::command]
async fn restore_backup_archive(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let file_name = extract_decoded_header(request.headers(), "x-file-name")?;
    let bytes = extract_raw_ipc_bytes(&request)?;
    tauri::async_runtime::spawn_blocking(move || {
        decode_portable_backup(&file_name, &bytes, &data_dir()?)
    })
    .await
    .map_err(|_| String::from("Backup restore task failed"))?
}

#[tauri::command]
async fn restore_encrypted_backup_archive(
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    let password = extract_zeroizing_header(request.headers(), "x-backup-password")?;
    let bytes = extract_raw_ipc_bytes(&request)?;
    tauri::async_runtime::spawn_blocking(move || {
        let decrypted = backup_crypto::decrypt(&bytes, &password)?;
        extract_backup_archive(&decrypted)
    })
    .await
    .map_err(|_| String::from("Encrypted backup restore task failed"))?
}

fn decode_portable_backup(
    file_name: &str,
    bytes: &[u8],
    data_root: &Path,
) -> Result<String, String> {
    let name = file_name.to_lowercase();
    // The renderer authenticates/decrypts the versioned container before this call.
    // Its original filename still carries .lich13backup, but the payload is a ZIP.
    if name.ends_with(".zip") || name.ends_with(".lich13backup") {
        return extract_backup_archive_to(bytes, data_root);
    }
    String::from_utf8(bytes.to_vec()).map_err(|_| "Invalid backup data".into())
}

fn list_local_backup_files_in_dir(
    local_backup_dir: Option<String>,
    fallback_dir: &Path,
) -> Result<Vec<LocalBackupFileInfo>, String> {
    let base_dir = local_backup_dir
        .filter(|dir| !dir.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| fallback_dir.to_path_buf());

    if !base_dir.exists() {
        return Ok(Vec::new());
    }

    let mut items = Vec::new();
    let entries = fs::read_dir(base_dir).map_err(|error| error.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        if !metadata.is_file() {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy().to_string();
        if !file_name.starts_with("lich13studio") {
            continue;
        }

        items.push(LocalBackupFileInfo {
            file_name,
            file_path: entry.path().display().to_string(),
            size: metadata.len(),
            modified_time: metadata
                .modified()
                .map(format_system_time)
                .unwrap_or_else(|_| format_system_time(SystemTime::UNIX_EPOCH)),
        });
    }

    items.sort_by(|left, right| right.modified_time.cmp(&left.modified_time));
    Ok(items)
}

#[tauri::command]
async fn list_local_backup_files(
    local_backup_dir: Option<String>,
) -> Result<Vec<LocalBackupFileInfo>, String> {
    let fallback = downloads_dir()?;
    tauri::async_runtime::spawn_blocking(move || {
        list_local_backup_files_in_dir(local_backup_dir, &fallback)
    })
    .await
    .map_err(|_| String::from("List local backups task failed"))?
}

#[tauri::command]
async fn delete_local_backup_file(
    file_name: String,
    local_backup_dir: Option<String>,
) -> Result<bool, String> {
    let safe_name = validate_safe_backup_file_name(&file_name)?;
    let base_dir = local_backup_dir
        .filter(|dir| !dir.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or(downloads_dir()?);
    let file_path = base_dir.join(safe_name);
    if file_path.exists() {
        fs::remove_file(file_path).map_err(|error| error.to_string())?;
    }
    Ok(true)
}

#[tauri::command]
async fn list_webdav_files(
    config: BackupWebDavConfig,
) -> Result<Vec<RemoteBackupFileInfo>, String> {
    list_webdav(&config).await
}

#[tauri::command]
async fn delete_webdav_file(file_name: String, config: BackupWebDavConfig) -> Result<bool, String> {
    delete_webdav(&config, &file_name).await
}

#[tauri::command]
#[cfg(not(target_os = "android"))]
fn show_main_window(app: AppHandle) -> Result<(), String> {
    show_and_focus_main_window(&app)
}

#[tauri::command]
fn show_startup_window(app: AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "android"))]
    {
        request_main_window(&app, ShowReason::Automatic)
    }
    #[cfg(target_os = "android")]
    {
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
#[cfg(not(target_os = "android"))]
fn show_mini_window(app: AppHandle) -> Result<(), String> {
    show_mini_window_at(&app, None)
}

#[tauri::command]
#[cfg(not(target_os = "android"))]
fn hide_mini_window(app: AppHandle) -> Result<(), String> {
    hide_mini_window_for_app(&app)
}

#[tauri::command]
#[cfg(not(target_os = "android"))]
fn close_mini_window(app: AppHandle) -> Result<(), String> {
    if let Some(mini_window) = app.get_webview_window(MINI_WINDOW_LABEL) {
        mini_window.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
#[cfg(not(target_os = "android"))]
fn toggle_mini_window(app: AppHandle) -> Result<(), String> {
    if let Some(mini_window) = app.get_webview_window(MINI_WINDOW_LABEL) {
        if mini_window.is_visible().unwrap_or(false) {
            return hide_mini_window_for_app(&app);
        }
    }

    show_mini_window_at(&app, None)
}

#[tauri::command]
#[cfg(not(target_os = "android"))]
fn set_mini_window_pin(is_pinned: bool) -> Result<(), String> {
    MINI_WINDOW_PINNED.store(is_pinned, Ordering::Relaxed);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    #[cfg(target_os = "macos")]
    let context = {
        let mut context = context;
        // Build the hidden main window only after launch provenance is captured and
        // the pre-launch activation guard has been released.
        if let Some(window) = context
            .config_mut()
            .app
            .windows
            .iter_mut()
            .find(|window| window.label == "main")
        {
            window.create = false;
        }
        context
    };
    let builder = tauri::Builder::default();
    #[cfg(not(target_os = "android"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _| {
        let reason = startup::launch_show_reason(&args, None);
        let _ = request_main_window(app, reason);
    }));
    #[cfg(target_os = "android")]
    let builder = builder
        .plugin(mobile::plugin())
        .on_page_load(|webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Started {
                let app = webview.app_handle().clone();
                // A fresh renderer has no collectors for the previous page's streams.
                // Route changes do not load a page and continue running in the background.
                tauri::async_runtime::spawn(async move {
                    let _ = mobile::mobile_command(app, "stopTasks".into(), None).await;
                });
            }
        });
    let app = builder
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            #[cfg(target_os = "android")]
            {
                let path = app.path().app_data_dir()?;
                fs::create_dir_all(&path)?;
                let _ = MOBILE_DATA_DIR.set(path);
                mobile::set_app_handle(app.handle().clone());
            }
            // An isolated desktop debug bundle exercises cross-platform restore without
            // touching the installed application's files. Compiled out of releases.
            #[cfg(all(debug_assertions, not(target_os = "android")))]
            if app.config().identifier.ends_with(".acceptance") {
                let path = app.path().app_data_dir()?;
                fs::create_dir_all(&path)?;
                let _ = MOBILE_DATA_DIR.set(path);
            }
            if let Ok(app_root) = app_data_dir() {
                let cache_root = app.path().app_cache_dir().ok();
                if let Ok(Some(pending_restore)) = recover_and_cleanup_storage_in_dir(
                    &app_root,
                    cache_root.as_deref(),
                    Duration::from_secs(3600),
                ) {
                    if let Ok(mut slot) =
                        PENDING_BACKUP_RESTORE.get_or_init(Default::default).lock()
                    {
                        if slot.is_none() {
                            *slot = Some(pending_restore);
                        }
                    }
                }
            }
            #[cfg(not(target_os = "android"))]
            let initial_window_state = {
                // Capture provenance during Tauri's Ready callback, while the launch
                // Apple event is current. AppKit activation has no bearing on this.
                let runtime_settings = load_runtime_settings_from_state().unwrap_or_default();
                replace_runtime_settings(runtime_settings);
                let launch_args = std::env::args().collect::<Vec<_>>();
                let source = startup::startup_source(&launch_args, startup::current_launch_event());
                let visibility = StartupVisibility::new(source, runtime_settings.launch_to_tray);
                STARTED_SILENTLY.store(visibility.is_silent(), Ordering::SeqCst);
                let _ = STARTUP_VISIBILITY.set(Mutex::new(visibility));
                let state = load_window_state("main")?;
                let mode = state
                    .as_ref()
                    .map(|state| RestoredWindowMode::from_saved(state.fullscreen, state.maximized))
                    .unwrap_or_default();
                let _ = DEFERRED_MAIN_WINDOW_MODE.set(Mutex::new(mode));
                state
            };
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                if let Some(config) = app
                    .config()
                    .app
                    .windows
                    .iter()
                    .find(|window| window.label == "main")
                {
                    WebviewWindowBuilder::from_config(app.handle(), config)?.build()?;
                }
            }
            #[cfg(not(target_os = "android"))]
            {
                if let Some(main_window) = app.get_webview_window("main") {
                    if STARTED_SILENTLY.load(Ordering::SeqCst) {
                        let _ = main_window.hide();
                        apply_dock_visibility(
                            app.handle(),
                            dock_visibility_for_background_keepalive(),
                        );
                    } else {
                        let fallback_app = app.handle().clone();
                        tauri::async_runtime::spawn(async move {
                            tokio::time::sleep(Duration::from_secs(3)).await;
                            let _ = request_main_window(&fallback_app, ShowReason::Automatic);
                        });
                    }

                    if let Some(state) = initial_window_state {
                        if let (Some(width), Some(height)) = (state.width, state.height) {
                            let _ = main_window
                                .set_size(Size::Physical(PhysicalSize::new(width, height)));
                        }

                        if let (Some(x), Some(y)) = (state.x, state.y) {
                            let _ = main_window
                                .set_position(Position::Physical(PhysicalPosition::new(x, y)));
                        }
                    }
                }

                setup_tray(app)?;
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(not(target_os = "android"))]
            {
                handle_main_window_close(window, event);
                handle_mini_window_focus(window, event);
                if let Some(immediate) = should_persist_window_event(event) {
                    let _ = persist_window_state(window, immediate);
                }
            }
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![
            mobile::mobile_command,
            app_info,
            secure_store::read_secure_credentials,
            secure_store::write_secure_credentials,
            secure_store::clear_secure_credentials,
            get_device_type,
            get_hostname,
            set_runtime_setting,
            set_launch_on_boot,
            is_startup_silent,
            export_portable_backup_archive,
            get_pending_restore_id,
            finish_backup_restore,
            persist_attachment,
            read_attachment,
            delete_attachment,
            clear_attachments,
            save_file,
            save_base64_image,
            pick_folder,
            get_obsidian_vaults,
            get_obsidian_files,
            open_path,
            open_external_url,
            list_capture_windows,
            capture_window,
            backup_to_local_dir,
            restore_from_local_backup,
            restore_backup_archive,
            restore_encrypted_backup_archive,
            list_local_backup_files,
            delete_local_backup_file,
            list_webdav_files,
            delete_webdav_file,
            webdav_backup,
            webdav_restore,
            show_main_window,
            show_startup_window,
            show_mini_window,
            hide_mini_window,
            close_mini_window,
            toggle_mini_window,
            set_mini_window_pin,
            http_delivery::acknowledge_http_chunks,
            http_delivery::replay_http_chunks,
            start_http_request,
            abort_http_request
        ])
        .build(context)
        .expect("failed to build lich13studio tauri runtime");
    #[cfg(target_os = "macos")]
    let app = {
        let mut app = app;
        // Tao activates applications before Ready/setup. Prevent that initial
        // activation; setup permits hidden windows and the show policy opts in to
        // foreground activation only for normal startup or a user action.
        app.set_activation_policy(tauri::ActivationPolicy::Prohibited);
        app
    };
    #[cfg(target_os = "android")]
    {
        // Keep the Android event loop alive across Activity destruction instead of calling
        // std::process::exit(0) from Tao during WryActivity.onDestroy(), so Activity teardown,
        // AndroidJUnitRunner reporting, and cached-process relaunches complete cleanly.
        let _ = app.run_return(|_app, event| match event {
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::Destroyed,
                ..
            } if label == "main" => {
                mobile::notify_main_window_destroyed();
            }
            RunEvent::ExitRequested {
                code: None, api, ..
            } => {
                api.prevent_exit();
            }
            _ => {}
        });
    }
    #[cfg(not(target_os = "android"))]
    app.run(|app, event| {
        handle_run_event(app, &event);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cancels_http_while_waiting_for_headers_or_stream_data() {
        let handle = Arc::new(HttpAbortHandle::new());
        let trigger = handle.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(5)).await;
            trigger.cancel();
        });
        let result = tokio::time::timeout(Duration::from_secs(1), async {
            tokio::select! {
              _ = std::future::pending::<()>() => false,
              _ = handle.cancelled() => true,
            }
        })
        .await;
        assert!(result.unwrap());
        let handle = register_native_http_abort("bulk-cancel-test");
        http_delivery::register("bulk-cancel-test");
        cancel_all_http_requests();
        assert!(handle.is_aborted());
        assert!(http_delivery::replay_http_chunks("bulk-cancel-test".into()).is_empty());
        remove_native_http_abort("bulk-cancel-test");
    }

    #[test]
    fn serializes_native_http_chunks_as_base64_strings() {
        let event = NativeHttpChunkEvent {
            sequence: Some(3),
            request_id: "req-1".into(),
            chunk: b"hello\n".to_vec(),
            done: false,
            error: None,
        };
        let serialized = serde_json::to_value(&event).unwrap();
        assert_eq!(serialized["chunk"], "aGVsbG8K");
    }

    #[test]
    fn backup_file_name_validator_rejects_traversal_and_separators() {
        for invalid in [
            "",
            "   ",
            ".",
            "..",
            "../backup.zip",
            "nested/backup.zip",
            "nested\\backup.zip",
            "C:backup.zip",
            "backup\0.zip",
        ] {
            assert!(
                validate_safe_backup_file_name(invalid).is_err(),
                "{invalid:?} should be rejected"
            );
        }
        assert_eq!(
            validate_safe_backup_file_name("lich13studio.20261125.lich13backup").unwrap(),
            "lich13studio.20261125.lich13backup"
        );
    }

    #[tokio::test]
    async fn webdav_upload_and_download_reject_unsafe_file_names_before_network() {
        let bad_config = BackupWebDavConfig {
            url: "https://webdav.example.invalid/backups".into(),
            username: "user".into(),
            password: "secret".into(),
            file_name: Some("../escape.zip".into()),
            skip_backup_file: Some(true),
            user_agent: None,
        };
        let unused_archive = PathBuf::from("unused.zip");
        assert_eq!(
            upload_webdav_file(&bad_config, &unused_archive, 3)
                .await
                .unwrap_err(),
            "Invalid backup file name"
        );
        assert_eq!(
            download_webdav_to_file(&bad_config, &unused_archive)
                .await
                .unwrap_err(),
            "Invalid backup file name"
        );
    }

    #[test]
    fn attachment_delete_and_clear_enforce_storage_boundaries() {
        let root = std::env::temp_dir().join(format!("lich13-attach-test-{}", Uuid::new_v4()));
        let files = root.join("Data").join("Files");
        fs::create_dir_all(&files).unwrap();
        let outside = root.join("outside.txt");
        fs::write(&outside, b"keep").unwrap();
        let inside = files.join("file-1.pdf");
        fs::write(&inside, b"%PDF-1.4").unwrap();

        assert!(delete_attachment_in_root(&files, "../outside.txt").is_err());
        assert!(delete_attachment_in_root(&files, outside.to_str().unwrap()).is_err());
        assert!(outside.exists());

        assert!(!delete_attachment_in_root(&files, "missing.pdf").unwrap());
        assert!(delete_attachment_in_root(&files, "file-1.pdf").unwrap());
        assert!(!inside.exists());

        fs::write(files.join("a.txt"), b"1").unwrap();
        fs::write(files.join("b.txt"), b"2").unwrap();
        assert_eq!(clear_attachments_in_root(&files).unwrap(), 2);
        assert_eq!(fs::read_dir(&files).unwrap().count(), 0);
        assert!(outside.exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn backup_restore_validates_before_writing_and_can_roll_back_files() {
        let root = std::env::temp_dir().join(format!("lich13-restore-test-{}", Uuid::new_v4()));
        let data = root.join("Data");
        fs::create_dir_all(&data).unwrap();
        fs::write(data.join("original.txt"), b"preserved").unwrap();
        let build = |payload: &[u8], name: &str| {
            let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
            zip.start_file("data.json", zip_file_options()).unwrap();
            zip.write_all(payload).unwrap();
            zip.start_file(name, zip_file_options()).unwrap();
            zip.write_all(b"new file").unwrap();
            zip.finish().unwrap().into_inner()
        };
        let state = br#"{"version":5,"localStorage":{"persist:cherry-studio":"{}"},"indexedDB":{"files":[]}}"#;
        assert!(extract_backup_archive_to(&build(b"{}", "Data/new.txt"), &data).is_err());
        assert_eq!(fs::read(data.join("original.txt")).unwrap(), b"preserved");
        assert!(extract_backup_archive_to(&build(state, "../outside.txt"), &data).is_err());
        assert!(!root.join("outside.txt").exists());
        assert_eq!(fs::read(data.join("original.txt")).unwrap(), b"preserved");
        let bytes = build(state, "Data/new.txt");
        assert!(extract_backup_archive_to(&bytes[..bytes.len() / 2], &data).is_err());
        extract_backup_archive_to(&bytes, &data).unwrap();
        assert_eq!(fs::read(data.join("new.txt")).unwrap(), b"new file");
        finish_backup_restore(false).unwrap();
        assert_eq!(fs::read(data.join("original.txt")).unwrap(), b"preserved");
        assert!(!data.join("new.txt").exists());
        extract_backup_archive_to(&bytes, &data).unwrap();
        finish_backup_restore(true).unwrap();
        assert!(!data.join("original.txt").exists());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn decodes_base64_image_data_url() {
        let decoded = decode_base64_image_payload("data:image/png;base64,iVBORw0KGgo=").unwrap();

        assert_eq!(decoded.extension, ".png");
        assert_eq!(decoded.bytes, vec![137, 80, 78, 71, 13, 10, 26, 10]);
    }

    #[test]
    fn rejects_non_base64_data_url() {
        let error = decode_base64_image_payload("data:image/png,not-base64").unwrap_err();

        assert!(error.contains("base64"));
    }

    #[tokio::test]
    async fn encrypted_mobile_backups_restore_with_their_original_extension() {
        let directory =
            std::env::temp_dir().join(format!("lich13studio-encrypted-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let payload = serde_json::json!({
          "version": 5,
          "localStorage": {"persist:cherry-studio": "{}"},
          "indexedDB": {"topics": []}
        });
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file("data.json", zip_file_options()).unwrap();
        zip.write_all(payload.to_string().as_bytes()).unwrap();
        let bytes = zip.finish().unwrap().into_inner();
        let encrypted = backup_crypto::encrypt(&bytes, "fixture password").unwrap();
        let decrypted = backup_crypto::decrypt(&encrypted, "fixture password").unwrap();
        let restored =
            decode_portable_backup("android.lich13backup", &decrypted, &directory.join("Data"))
                .unwrap();
        assert_eq!(serde_json::from_str::<Value>(&restored).unwrap(), payload);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn allows_safe_external_url_schemes() {
        for url in [
            "https://github.com/lich13/lich13studio",
            "http://example.com",
            "mailto:support@example.com",
            "tel:+15551234567",
        ] {
            assert_eq!(normalize_external_url(url).unwrap(), url);
        }
    }

    #[test]
    fn rejects_unsafe_external_url_schemes() {
        for url in [
            "",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "tauri://localhost/#/",
            "x-apple.systempreferences:com.apple.preference.security",
            "intent://scan/#Intent;scheme=zxing;end",
            "JavaScript:alert(1)",
            "https://user:pass@example.com/",
            "https://example.com/\nfoo",
            "   ",
        ] {
            assert!(
                normalize_external_url(url).is_err(),
                "{url} should be rejected"
            );
        }
    }

    #[test]
    fn open_path_rejects_url_disguised_and_empty_paths() {
        for value in [
            "",
            "  ",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "intent://x#Intent;end",
            "smb://host/share",
            "relative/path.txt",
            "/definitely/missing/lich13studio-path",
            "/tmp\nfoo",
        ] {
            assert!(
                validate_open_path(value).is_err(),
                "{value:?} should be rejected"
            );
        }
        let dir = std::env::temp_dir();
        assert_eq!(
            validate_open_path(dir.to_str().unwrap()).unwrap(),
            OpenTarget::Path(dir.canonicalize().unwrap())
        );
        assert!(matches!(
            validate_open_path("https://example.com/a"),
            Ok(OpenTarget::Url(_))
        ));
        assert!(matches!(
            validate_open_path("obsidian://new?vault=v&file=f"),
            Ok(OpenTarget::Url(_))
        ));
    }

    #[test]
    fn update_version_comparison_handles_tag_prefixes() {
        assert_eq!(
            compare_update_versions("v0.1.12", "0.1.11"),
            CmpOrdering::Greater
        );
        assert_eq!(
            compare_update_versions("0.1.12", "v0.1.12"),
            CmpOrdering::Equal
        );
        assert_eq!(
            compare_update_versions("0.1.9", "0.1.10"),
            CmpOrdering::Less
        );
    }

    #[test]
    fn release_page_url_accepts_only_the_repository_release_path() {
        assert_eq!(
            release_page_url(
                Some("v0.1.32"),
                Some("https://github.com/lich13/lich13studio/releases/tag/v0.1.32")
            ),
            "https://github.com/lich13/lich13studio/releases/tag/v0.1.32"
        );
        assert_eq!(
            release_page_url(
                Some("0.1.32"),
                Some("https://example.com/releases/tag/0.1.32")
            ),
            "https://github.com/lich13/lich13studio/releases/tag/0.1.32"
        );
        for tag in [
            None,
            Some(""),
            Some("vv0.1.32"),
            Some("v0.1"),
            Some("v0.1.32-"),
            Some("v0.1.32+"),
            Some("../v0.1.32"),
        ] {
            assert_eq!(release_page_url(tag, None), GITHUB_RELEASES_URL);
        }
        for address in [
      None,
      Some("https://example.invalid/releases/tag/v0.1.32"),
      Some("javascript:alert(1)"),
      Some("https://github.com/lich13/lich13studio/releases/download/v0.1.32/app.dmg"),
      Some("https://github.com/lich13/lich13studio/releases/tag/v0.1.31"),
      Some("https://github.com/lich13/lich13studio/releases/tag/v0.1.32?redirect=example.invalid"),
      Some("https://github.com/lich13/lich13studio/releases/tag/v0.1.32#fragment"),
      Some("https://user@github.com/lich13/lich13studio/releases/tag/v0.1.32"),
    ] {
      assert_eq!(release_page_url(Some("v0.1.32"), address), "https://github.com/lich13/lich13studio/releases/tag/v0.1.32");
    }
    }

    #[test]
    fn update_asset_selection_prefers_platform_artifacts() {
        let release = GitHubLatestRelease {
            tag_name: Some("v0.1.12".to_string()),
            html_url: Some(
                "https://github.com/lich13/lich13studio/releases/tag/v0.1.12".to_string(),
            ),
            body: None,
            assets: vec![
                GitHubReleaseAsset {
                    name: Some("lich13studio_0.1.12_x64-setup.exe".to_string()),
                    browser_download_url: Some("https://example.com/setup.exe".to_string()),
                },
                GitHubReleaseAsset {
                    name: Some("lich13studio_0.1.12_aarch64.dmg".to_string()),
                    browser_download_url: Some("https://example.com/app.dmg".to_string()),
                },
                GitHubReleaseAsset {
                    name: Some("lich13studio_0.1.30_android_arm64-v8a.apk".to_string()),
                    browser_download_url: Some("https://example.com/app.apk".to_string()),
                },
            ],
        };

        assert_eq!(
            build_app_update_info("0.1.11", "macos", release.clone())
                .asset
                .unwrap()
                .url,
            "https://example.com/app.dmg"
        );
        assert_eq!(
            build_app_update_info("0.1.11", "windows", release.clone())
                .asset
                .unwrap()
                .url,
            "https://example.com/setup.exe"
        );
        assert_eq!(
            build_app_update_info("0.1.11", "android", release)
                .asset
                .unwrap()
                .url,
            "https://example.com/app.apk"
        );
    }

    #[test]
    fn update_tray_menu_item_ids_are_stable() {
        assert_eq!(tray_menu_item_ids(), ["show", "check_update", "quit"]);
    }

    #[test]
    fn macos_login_item_uses_manageable_hidden_app_mode() {
        let config = macos_login_item_config_for_path(Path::new("/Applications/lich13studio.app"));

        assert_eq!(
            config,
            MacOSLoginItemConfig {
                app_name: "lich13studio".to_string(),
                app_path: "/Applications/lich13studio.app".to_string(),
                use_launch_agent: false,
                args: vec!["--hidden".to_string()]
            }
        );
    }

    #[test]
    fn macos_legacy_launch_agent_cleanup_path_is_stable() {
        assert_eq!(
            macos_legacy_launch_agent_file(Path::new("/Users/example")),
            PathBuf::from("/Users/example/Library/LaunchAgents/com.lich13.studio.plist")
        );
    }

    #[test]
    fn startup_silent_command_reflects_recorded_launch_mode() {
        STARTED_SILENTLY.store(false, Ordering::SeqCst);
        assert!(!is_startup_silent());

        STARTED_SILENTLY.store(true, Ordering::SeqCst);
        assert!(is_startup_silent());
        STARTED_SILENTLY.store(false, Ordering::SeqCst);
    }

    #[test]
    fn close_action_requires_tray_and_tray_on_close() {
        assert_eq!(
            main_window_close_action(RuntimeSettings {
                tray: true,
                tray_on_close: true,
                ..RuntimeSettings::default()
            }),
            MainWindowCloseAction::KeepBackground
        );
        assert_eq!(
            main_window_close_action(RuntimeSettings {
                tray: false,
                tray_on_close: true,
                ..RuntimeSettings::default()
            }),
            MainWindowCloseAction::Quit
        );
        assert_eq!(
            main_window_close_action(RuntimeSettings {
                tray: true,
                tray_on_close: false,
                ..RuntimeSettings::default()
            }),
            MainWindowCloseAction::Quit
        );
    }

    #[test]
    fn implicit_exit_is_blocked_only_for_background_keepalive() {
        let keep_background = RuntimeSettings {
            tray: true,
            tray_on_close: true,
            ..RuntimeSettings::default()
        };
        let quit_on_close = RuntimeSettings {
            tray: true,
            tray_on_close: false,
            ..RuntimeSettings::default()
        };

        assert!(should_prevent_implicit_exit(false, false, keep_background));
        assert!(!should_prevent_implicit_exit(true, false, keep_background));
        assert!(!should_prevent_implicit_exit(false, true, keep_background));
        assert!(!should_prevent_implicit_exit(false, false, quit_on_close));
    }

    #[test]
    fn runtime_settings_update_forces_tray_when_background_modes_need_it() {
        let mut settings = RuntimeSettings::default();
        apply_runtime_setting(&mut settings, SETTING_TRAY, false).unwrap();
        assert!(!settings.tray);

        apply_runtime_setting(&mut settings, SETTING_TRAY_ON_CLOSE, true).unwrap();
        assert!(settings.tray);
        assert!(settings.tray_on_close);

        apply_runtime_setting(&mut settings, SETTING_TRAY, false).unwrap();
        apply_runtime_setting(&mut settings, SETTING_LAUNCH_TO_TRAY, true).unwrap();
        assert!(settings.tray);
        assert!(settings.launch_to_tray);
    }

    #[test]
    fn dock_visibility_for_window_actions_matches_background_state() {
        assert_eq!(
            dock_visibility_for_main_window_show(),
            DockVisibility::Visible
        );
        assert_eq!(
            dock_visibility_for_background_keepalive(),
            DockVisibility::Hidden
        );
    }

    #[test]
    fn format_system_time_emits_sortable_rfc3339_utc_timestamps() {
        let t1 = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000);
        let t2 = t1 + Duration::from_millis(250);
        let formatted1 = format_system_time(t1);
        let formatted2 = format_system_time(t2);
        assert_eq!(formatted1, "2023-11-14T22:13:20.000Z");
        assert_eq!(formatted2, "2023-11-14T22:13:20.250Z");
        assert!(formatted2 > formatted1);
    }

    #[test]
    fn list_local_backup_files_falls_back_when_dir_is_empty_or_whitespace() {
        let fallback = std::env::temp_dir().join(format!("lich13-local-list-{}", Uuid::new_v4()));
        fs::create_dir_all(&fallback).unwrap();
        fs::write(fallback.join("lich13studio.20260101.zip"), b"archive").unwrap();
        fs::write(fallback.join("unrelated.zip"), b"ignore").unwrap();

        for empty_dir in [None, Some(String::new()), Some(String::from("   "))] {
            let listed = list_local_backup_files_in_dir(empty_dir, &fallback).unwrap();
            assert_eq!(listed.len(), 1);
            assert_eq!(listed[0].file_name, "lich13studio.20260101.zip");
            assert!(listed[0].modified_time.ends_with('Z'));
            assert!(listed[0].modified_time.contains('T'));
        }

        fs::remove_dir_all(fallback).unwrap();
    }

    #[test]
    fn write_backup_archive_to_file_streams_compact_json_and_cleans_temp_files() {
        let root = std::env::temp_dir().join(format!("lich13-stream-zip-{}", Uuid::new_v4()));
        let data_root = root.join("Data");
        let files_dir = data_root.join("Files");
        let out_dir = root.join("Backups");
        fs::create_dir_all(&files_dir).unwrap();
        fs::write(files_dir.join("note.txt"), b"streamed attachment").unwrap();

        let state = serde_json::json!({
            "version": 5,
            "localStorage": { "persist:cherry-studio": "{}" },
            "indexedDB": { "topics": [] }
        });
        let archive_path = out_dir.join("lich13studio.stream.zip");
        write_backup_archive_to_file(&archive_path, &state, true, &data_root).unwrap();

        let out_entries: Vec<String> = fs::read_dir(&out_dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(out_entries, vec!["lich13studio.stream.zip".to_string()]);

        let mut archive = ZipArchive::new(File::open(&archive_path).unwrap()).unwrap();
        let mut raw_json = String::new();
        archive
            .by_name("data.json")
            .unwrap()
            .read_to_string(&mut raw_json)
            .unwrap();
        assert!(!raw_json.contains('\n'));
        assert_eq!(serde_json::from_str::<Value>(&raw_json).unwrap(), state);

        let mut attachment = String::new();
        archive
            .by_name("Data/Files/note.txt")
            .unwrap()
            .read_to_string(&mut attachment)
            .unwrap();
        assert_eq!(attachment, "streamed attachment");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn decodes_uri_encoded_unicode_ipc_headers_and_zeroizes_passwords() {
        let mut headers = tauri::http::HeaderMap::new();
        headers.insert(
            "x-file-name",
            HeaderValue::from_static(
                "%E8%81%8A%E5%A4%A9%E5%A4%87%E4%BB%BD%20%F0%9F%9A%80.lich13backup",
            ),
        );
        headers.insert(
            "x-backup-password",
            HeaderValue::from_static("%E5%AF%86%E9%91%B0%232026%25!"),
        );

        assert_eq!(
            extract_decoded_header(&headers, "x-file-name").unwrap(),
            "聊天备份 🚀.lich13backup"
        );
        let secret = extract_zeroizing_header(&headers, "x-backup-password").unwrap();
        assert_eq!(secret.as_str(), "密鑰#2026%!");

        headers.insert("x-bad", HeaderValue::from_static("%E8%ZZ"));
        assert!(extract_decoded_header(&headers, "x-bad").is_err());
    }

    #[test]
    fn startup_storage_recovery_rolls_back_unique_restore_previous_before_purging_orphans() {
        let root = std::env::temp_dir().join(format!("lich13-crash-rollback-{}", Uuid::new_v4()));
        let cache = root.join("Cache");
        let prev_files = root.join("restore-previous-crashed").join("Files");
        let staging_dir = root.join("restore-staging-orphan");
        let exports_dir = cache.join("exports");
        fs::create_dir_all(&prev_files).unwrap();
        fs::create_dir_all(&staging_dir).unwrap();
        fs::create_dir_all(&exports_dir).unwrap();
        fs::write(prev_files.join("rescued.pdf"), b"rescued-bytes").unwrap();
        fs::write(staging_dir.join("partial.bin"), b"staging").unwrap();
        fs::write(exports_dir.join("leftover.zip"), b"export").unwrap();
        fs::write(root.join(".webdav-upload.tmp-stale"), b"tmp").unwrap();

        // Simulate crash where Data/ was renamed to restore-previous-crashed and staging rename never completed.
        recover_and_cleanup_storage_in_dir(&root, Some(&cache), Duration::ZERO).unwrap();

        assert_eq!(
            fs::read(root.join("Data").join("Files").join("rescued.pdf")).unwrap(),
            b"rescued-bytes"
        );
        assert!(!root.join("restore-previous-crashed").exists());
        assert!(!staging_dir.exists());
        assert!(!root.join(".webdav-upload.tmp-stale").exists());
        assert_eq!(fs::read_dir(&exports_dir).unwrap().count(), 0);

        // When Data/ already exists, leftover restore-previous-* and restore-staging-* are purged without overwriting Data/.
        let leftover_prev = root.join("restore-previous-stale");
        fs::create_dir_all(&leftover_prev).unwrap();
        fs::write(leftover_prev.join("old.txt"), b"old").unwrap();
        recover_and_cleanup_storage_in_dir(&root, Some(&cache), Duration::from_secs(3600)).unwrap();

        assert!(!leftover_prev.exists());
        assert_eq!(
            fs::read(root.join("Data").join("Files").join("rescued.pdf")).unwrap(),
            b"rescued-bytes"
        );

        // Case A: Crash AFTER staging was swapped into Data/ but BEFORE IndexedDB committed.
        // Rust setup() must keep BOTH Data/ and restore-previous-* intact until IndexedDB reconciliation.
        let uncommitted_prev_name = "restore-previous-uncommitted";
        let uncommitted_prev = root.join(uncommitted_prev_name).join("Files");
        let unrelated_prev = root.join("restore-previous-unrelated-orphan");
        fs::create_dir_all(&uncommitted_prev).unwrap();
        fs::create_dir_all(&unrelated_prev).unwrap();
        fs::write(uncommitted_prev.join("original.pdf"), b"original-bytes").unwrap();
        fs::write(unrelated_prev.join("stale.bin"), b"stale").unwrap();
        fs::remove_dir_all(root.join("Data")).unwrap();
        fs::create_dir_all(root.join("Data").join("Files")).unwrap();
        fs::write(
            root.join("Data").join("Files").join("uncommitted.pdf"),
            b"new-uncommitted",
        )
        .unwrap();
        write_pending_restore_marker(
            &root,
            &PendingRestoreMarker {
                previous_dir_name: uncommitted_prev_name.to_string(),
                existed: true,
            },
        )
        .unwrap();

        let deferred =
            recover_and_cleanup_storage_in_dir(&root, Some(&cache), Duration::from_secs(3600))
                .unwrap()
                .expect("expected deferred pending restore");
        assert_eq!(deferred.restore_id, uncommitted_prev_name);
        assert_eq!(
            get_pending_restore_id_in_dir(&root).as_deref(),
            Some(uncommitted_prev_name)
        );
        // Unrelated orphan previous dir is purged, while active restore-previous-* and Data/ remain intact.
        assert!(!unrelated_prev.exists());
        assert!(root.join(uncommitted_prev_name).exists());
        assert!(root
            .join("Data")
            .join("Files")
            .join("uncommitted.pdf")
            .exists());
        assert!(root.join(RESTORE_PENDING_MARKER_FILE).is_file());

        // Reconcile with commit = false (IndexedDB did NOT commit restoreId): rolls restore-previous-* back to Data/.
        finish_backup_restore_in_dir(&root, false).unwrap();
        assert_eq!(
            fs::read(root.join("Data").join("Files").join("original.pdf")).unwrap(),
            b"original-bytes"
        );
        assert!(!root
            .join("Data")
            .join("Files")
            .join("uncommitted.pdf")
            .exists());
        assert!(!root.join(uncommitted_prev_name).exists());
        assert!(!root.join(RESTORE_PENDING_MARKER_FILE).exists());
        assert_eq!(get_pending_restore_id_in_dir(&root), None);

        // Case B: Crash AFTER IndexedDB committed restoreId (before finish_backup_restore(true) or after partial failure).
        let committed_prev_name = "restore-previous-committed";
        let committed_prev = root.join(committed_prev_name).join("Files");
        fs::create_dir_all(&committed_prev).unwrap();
        fs::write(committed_prev.join("old-attachment.pdf"), b"old-bytes").unwrap();
        fs::remove_dir_all(root.join("Data")).unwrap();
        fs::create_dir_all(root.join("Data").join("Files")).unwrap();
        fs::write(
            root.join("Data")
                .join("Files")
                .join("restored-attachment.pdf"),
            b"new-committed-bytes",
        )
        .unwrap();
        write_pending_restore_marker(
            &root,
            &PendingRestoreMarker {
                previous_dir_name: committed_prev_name.to_string(),
                existed: true,
            },
        )
        .unwrap();

        let deferred_committed =
            recover_and_cleanup_storage_in_dir(&root, Some(&cache), Duration::from_secs(3600))
                .unwrap()
                .expect("expected deferred committed restore");
        assert_eq!(deferred_committed.restore_id, committed_prev_name);
        assert!(root.join(committed_prev_name).exists());
        assert_eq!(
            fs::read(
                root.join("Data")
                    .join("Files")
                    .join("restored-attachment.pdf")
            )
            .unwrap(),
            b"new-committed-bytes"
        );

        // Reconcile with commit = true (IndexedDB DID commit restoreId): keeps new Data/ and deletes restore-previous-*.
        finish_backup_restore_in_dir(&root, true).unwrap();
        assert_eq!(
            fs::read(
                root.join("Data")
                    .join("Files")
                    .join("restored-attachment.pdf")
            )
            .unwrap(),
            b"new-committed-bytes"
        );
        assert!(!root
            .join("Data")
            .join("Files")
            .join("old-attachment.pdf")
            .exists());
        assert!(!root.join(committed_prev_name).exists());
        assert!(!root.join(RESTORE_PENDING_MARKER_FILE).exists());

        // Case C: Fresh install (existed = false) crashing after IndexedDB commit preserves Data/; crashing before commit removes Data/.
        write_pending_restore_marker(
            &root,
            &PendingRestoreMarker {
                previous_dir_name: "restore-previous-fresh-committed".to_string(),
                existed: false,
            },
        )
        .unwrap();
        assert!(
            recover_and_cleanup_storage_in_dir(&root, Some(&cache), Duration::from_secs(3600))
                .unwrap()
                .is_some()
        );
        finish_backup_restore_in_dir(&root, true).unwrap();
        assert!(root
            .join("Data")
            .join("Files")
            .join("restored-attachment.pdf")
            .exists());

        write_pending_restore_marker(
            &root,
            &PendingRestoreMarker {
                previous_dir_name: "restore-previous-fresh-aborted".to_string(),
                existed: false,
            },
        )
        .unwrap();
        assert!(
            recover_and_cleanup_storage_in_dir(&root, Some(&cache), Duration::from_secs(3600))
                .unwrap()
                .is_some()
        );
        finish_backup_restore_in_dir(&root, false).unwrap();
        assert!(!root.join("Data").exists());
        assert!(!root.join(RESTORE_PENDING_MARKER_FILE).exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn binary_ipc_decoder_accepts_raw_desktop_and_android_base64_and_webdav_enforces_size_cap(
    ) {
        assert_eq!(
            extract_ipc_body_bytes(&tauri::ipc::InvokeBody::Raw(vec![1, 2, 3])).unwrap(),
            vec![1, 2, 3]
        );
        assert_eq!(
            extract_ipc_body_bytes(&tauri::ipc::InvokeBody::Json(json!({ "base64": "AQID" })))
                .unwrap(),
            vec![1, 2, 3]
        );
        assert_eq!(
            extract_ipc_body_bytes(&tauri::ipc::InvokeBody::Json(json!({ "base64": "" }))).unwrap(),
            Vec::<u8>::new()
        );
        assert_eq!(
            extract_ipc_body_bytes(&tauri::ipc::InvokeBody::Json(json!([4, 5, 6]))).unwrap(),
            vec![4, 5, 6]
        );
        assert!(
            extract_ipc_body_bytes(&tauri::ipc::InvokeBody::Json(json!({ "wrong": 1 }))).is_err()
        );

        let err = upload_webdav_file(
            &BackupWebDavConfig {
                url: "https://webdav.example.invalid/backups".into(),
                username: "u".into(),
                password: "p".into(),
                file_name: Some("lich13studio.zip".into()),
                skip_backup_file: None,
                user_agent: None,
            },
            Path::new("/tmp/nonexistent.zip"),
            MAX_WEBDAV_ARCHIVE_BYTES + 1,
        )
        .await
        .unwrap_err();
        assert!(err.contains("exceeds maximum supported size"));
    }
}
