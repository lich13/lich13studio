mod mobile;
mod http_delivery;
mod backup_crypto;
#[cfg(not(target_os = "android"))]
use tauri::Monitor;
#[cfg(not(target_os = "android"))]
use auto_launch::{AutoLaunch, AutoLaunchBuilder};
use base64::{engine::general_purpose, Engine as _};
use futures_util::StreamExt;
use image::codecs::png::PngEncoder;
use image::{ColorType, ImageEncoder};
use reqwest::header::{HeaderName, HeaderValue, CONTENT_TYPE, USER_AGENT};
use reqwest::{Client, Method};
use roxmltree::Document;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::cmp::Ordering as CmpOrdering;
use std::collections::HashMap;
use std::ffi::OsStr;
use std::fs;
use std::fs::File;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
#[cfg(not(target_os = "android"))]
use tauri::image::Image;
#[cfg(not(target_os = "android"))]
use tauri::menu::{Menu, MenuItem};
#[cfg(not(target_os = "android"))]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
  AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, RunEvent, Size, WebviewUrl,
  WebviewWindow, WebviewWindowBuilder, Window, WindowEvent,
};
use tauri_plugin_notification::NotificationExt;
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
const GITHUB_LATEST_RELEASE_API_URL: &str = "https://api.github.com/repos/lich13/lich13studio/releases/latest";
const GITHUB_RELEASES_URL: &str = "https://github.com/lich13/lich13studio/releases";
#[cfg(any(not(target_os = "macos"), test))]
const LOGIN_STARTUP_ARG: &str = "--lich13studio-login-startup";
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

#[cfg(target_os = "macos")]
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeHttpChunkEvent {
  sequence: Option<u64>,
  request_id: String,
  chunk: Vec<u8>,
  done: bool,
  error: Option<String>,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StartupSource {
  Normal,
  #[cfg(any(not(target_os = "macos"), test))]
  LoginStartupArg,
  MacOSHiddenLoginItem,
}

#[cfg(any(target_os = "macos", test))]
#[derive(Debug, Clone, PartialEq, Eq)]
struct MacOSLoginItemConfig {
  app_name: String,
  app_path: String,
  use_launch_agent: bool,
  args: Vec<String>,
}

#[cfg(not(target_os = "macos"))]
#[derive(Debug, Clone, PartialEq, Eq)]
struct AutoLaunchConfig {
  app_name: String,
  app_path: String,
  use_launch_agent: bool,
  args: Vec<String>,
}

const NATIVE_HTTP_CHUNK_EVENT: &str = "native_http_chunk";
const FOCUS_CHAT_INPUT_EVENT: &str = "focus_chat_input";

static HTTP_REQUEST_ABORTS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
static MAIN_WINDOW_SHOWN: AtomicBool = AtomicBool::new(false);
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

#[cfg(not(target_os = "windows"))]
fn hidden_command<S: AsRef<OsStr>>(program: S) -> Command {
  Command::new(program)
}

fn native_http_abort_registry() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
  HTTP_REQUEST_ABORTS.get_or_init(|| Mutex::new(HashMap::new()))
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

fn apply_runtime_setting(settings: &mut RuntimeSettings, key: &str, value: bool) -> Result<(), String> {
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

fn main_window_close_action(settings: RuntimeSettings) -> MainWindowCloseAction {
  if settings.tray && settings.tray_on_close {
    MainWindowCloseAction::KeepBackground
  } else {
    MainWindowCloseAction::Quit
  }
}

fn should_prevent_implicit_exit(exit_code_present: bool, app_exiting: bool, settings: RuntimeSettings) -> bool {
  !exit_code_present && !app_exiting && matches!(main_window_close_action(settings), MainWindowCloseAction::KeepBackground)
}

#[cfg(any(not(target_os = "macos"), test))]
fn has_login_startup_arg(args: &[String]) -> bool {
  args.iter().any(|arg| arg == LOGIN_STARTUP_ARG)
}

fn should_start_silently_for_source(source: StartupSource, settings: RuntimeSettings) -> bool {
  if !settings.launch_to_tray {
    return false;
  }

  match source {
    #[cfg(any(not(target_os = "macos"), test))]
    StartupSource::LoginStartupArg => true,
    StartupSource::MacOSHiddenLoginItem => true,
    StartupSource::Normal => false,
  }
}

#[cfg(any(not(target_os = "macos"), test))]
fn should_start_silently_from_args(args: &[String], settings: RuntimeSettings) -> bool {
  should_start_silently_for_source(
    if has_login_startup_arg(args) {
      StartupSource::LoginStartupArg
    } else {
      StartupSource::Normal
    },
    settings,
  )
}

#[cfg(any(target_os = "macos", test))]
fn should_start_silently_from_macos_login_item(is_hidden_login_item: bool, settings: RuntimeSettings) -> bool {
  should_start_silently_for_source(
    if is_hidden_login_item {
      StartupSource::MacOSHiddenLoginItem
    } else {
      StartupSource::Normal
    },
    settings,
  )
}

#[cfg(target_os = "macos")]
fn is_current_macos_app_hidden() -> bool {
  use objc2::MainThreadMarker;
  use objc2_app_kit::NSApplication;

  MainThreadMarker::new()
    .map(|marker| NSApplication::sharedApplication(marker).isHidden())
    .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn unhide_current_macos_app() {
  use objc2::MainThreadMarker;
  use objc2_app_kit::NSApplication;

  if let Some(marker) = MainThreadMarker::new() {
    NSApplication::sharedApplication(marker).unhide(None);
  }
}

#[cfg(target_os = "macos")]
fn should_start_silently(args: &[String], settings: RuntimeSettings) -> bool {
  let _ = args;
  should_start_silently_from_macos_login_item(is_current_macos_app_hidden(), settings)
}

#[cfg(not(target_os = "macos"))]
fn should_start_silently(args: &[String], settings: RuntimeSettings) -> bool {
  should_start_silently_from_args(args, settings)
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

#[cfg(any(target_os = "macos", test))]
fn macos_app_bundle_path(executable_path: &Path) -> Option<PathBuf> {
  let path = executable_path.to_string_lossy();
  path
    .find(".app/Contents/MacOS/")
    .map(|index| PathBuf::from(&path[..index + ".app".len()]))
}

#[cfg(not(target_os = "android"))]
fn current_auto_launch_path() -> Result<PathBuf, String> {
  let executable_path =
    std::env::current_exe().map_err(|error| format!("Unable to resolve current exe: {error}"))?;

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
  home
    .join("Library")
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
    Err(error) => Err(format!("Failed to remove legacy LaunchAgent {}: {error}", file.display())),
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
fn is_auto_launch_enabled() -> Result<bool, String> {
  with_auto_launch_lock(|| {
    let app_path = current_auto_launch_path()?;

    #[cfg(target_os = "macos")]
    {
      build_auto_launch(&app_path)?
        .is_enabled()
        .map_err(|error| format!("Failed to check macOS login item: {error}"))
    }

    #[cfg(not(target_os = "macos"))]
    {
      build_auto_launch(&app_path)?
        .is_enabled()
        .map_err(|error| format!("Failed to check auto launch: {error}"))
    }
  })
}

#[cfg(not(target_os = "android"))]
fn mark_main_window_shown(window: &WebviewWindow) -> Result<(), String> {
  if !MAIN_WINDOW_SHOWN.swap(true, Ordering::SeqCst) {
    apply_dock_visibility(window.app_handle(), dock_visibility_for_main_window_show());
    window.show().map_err(|error| error.to_string())?;
    let _ = window.set_focus();
  }

  Ok(())
}

#[cfg(not(target_os = "android"))]
fn show_and_focus_main_window(app: &AppHandle) -> Result<(), String> {
  let main_window = app
    .get_webview_window("main")
    .ok_or_else(|| String::from("Main window not found"))?;

  MAIN_WINDOW_SHOWN.store(true, Ordering::SeqCst);
  apply_dock_visibility(app, dock_visibility_for_main_window_show());
  main_window.show().map_err(|error| error.to_string())?;
  let _ = main_window.unminimize();
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
fn position_mini_window(window: &WebviewWindow, anchor: Option<PhysicalPosition<f64>>) -> Result<(), String> {
  let size = window
    .inner_size()
    .unwrap_or_else(|_| PhysicalSize::new(MINI_WINDOW_WIDTH, MINI_WINDOW_HEIGHT));
  let monitors = window.available_monitors().map_err(|error| error.to_string())?;
  let monitor = anchor
    .and_then(|point| monitors.iter().find(|monitor| monitor_contains_point(monitor, point)).cloned())
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
      clamp_i32(point.x.round() as i32 - size.width as i32 + 14, work_area.position.x + margin, max_x),
      clamp_i32(point.y.round() as i32 + 10, work_area.position.y + margin, max_y),
    )
  } else {
    (
      clamp_i32(
        work_area.position.x + work_area.size.width as i32 - size.width as i32 - 24,
        work_area.position.x + margin,
        max_x,
      ),
      clamp_i32(work_area.position.y + 24, work_area.position.y + margin, max_y),
    )
  };

  window
    .set_position(Position::Physical(PhysicalPosition::new(target_x, target_y)))
    .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "android"))]
fn get_or_create_mini_window(app: &AppHandle) -> Result<WebviewWindow, String> {
  if let Some(window) = app.get_webview_window(MINI_WINDOW_LABEL) {
    return Ok(window);
  }

  WebviewWindowBuilder::new(app, MINI_WINDOW_LABEL, WebviewUrl::App("miniWindow.html".into()))
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
fn show_mini_window_at(app: &AppHandle, anchor: Option<PhysicalPosition<f64>>) -> Result<(), String> {
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
fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
  let [show_id, check_update_id, quit_id] = tray_menu_item_ids();
  let show_item = MenuItem::with_id(app, show_id, "打开主界面", true, None::<&str>)?;
  let check_update_item = MenuItem::with_id(app, check_update_id, "检测更新", true, None::<&str>)?;
  let quit_item = MenuItem::with_id(app, quit_id, "退出", true, None::<&str>)?;
  let menu = Menu::with_items(app, &[&show_item, &check_update_item, &quit_item])?;

  let decoded_icon = image::load_from_memory(include_bytes!("../../build/tray_icon.png"))?.into_rgba8();
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
          match fetch_latest_update_info(env!("CARGO_PKG_VERSION"), std::env::consts::OS).await {
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
              let _ = notify_update_result(&app_handle, "已是最新版本", "当前 lich13studio 已是最新版本。");
            }
            Err(error) => {
              let _ = notify_update_result(&app_handle, "检查更新失败", &format!("无法检查更新：{error}"));
            }
          }
        });
      }
      TRAY_QUIT_MENU_ID => {
        #[cfg(target_os = "macos")]
        APP_EXITING.store(true, Ordering::Relaxed);
        app.exit(0);
      }
      _ => {}
    })
    .build(app)?;

  Ok(())
}

fn register_native_http_abort(request_id: &str) -> Arc<AtomicBool> {
  let flag = Arc::new(AtomicBool::new(false));
  if let Ok(mut registry) = native_http_abort_registry().lock() {
    registry.insert(request_id.to_string(), flag.clone());
  }
  flag
}

fn remove_native_http_abort(request_id: &str) {
  if let Ok(mut registry) = native_http_abort_registry().lock() {
    registry.remove(request_id);
  }
}

async fn emit_native_http_chunk(window: &Window, request_id: &str, chunk: Vec<u8>, done: bool, error: Option<String>) {
  let payload = NativeHttpChunkEvent {
    sequence: None,
    request_id: request_id.to_string(),
    chunk,
    done,
    error,
  };
  #[cfg(target_os = "android")]
  {
    let flag = native_http_abort_registry().lock().unwrap().get(request_id).cloned();
    if let Some(flag) = flag { http_delivery::emit(window, payload, &flag).await; }
  }
  #[cfg(not(target_os = "android"))]
  let _ = window.emit(NATIVE_HTTP_CHUNK_EVENT, payload);
}

static MOBILE_DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

fn app_data_dir() -> Result<PathBuf, String> {
  if let Some(path) = MOBILE_DATA_DIR.get() { return Ok(path.clone()); }
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
fn persist_window_state(window: &Window) -> Result<(), String> {
  let label = window.label().to_string();
  let mut state = load_state_file().unwrap_or_else(|_| json!({}));
  let mut persisted_state = load_window_state(&label)?.unwrap_or_default();
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

  window_state_map.insert(
    label,
    serde_json::to_value(persisted_state).map_err(|error| error.to_string())?,
  );

  save_state_file(&state)?;
  Ok(())
}

fn should_persist_window_event(event: &WindowEvent) -> bool {
  matches!(
    event,
    WindowEvent::Resized(_) | WindowEvent::Moved(_) | WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
  )
}

#[cfg(not(target_os = "android"))]
fn handle_main_window_close(_window: &Window, _event: &WindowEvent) {
  #[cfg(target_os = "macos")]
  if _window.label() == "main" {
    if let WindowEvent::CloseRequested { api, .. } = _event {
      if APP_EXITING.load(Ordering::Relaxed) {
        return;
      }

      api.prevent_close();
      let _ = persist_window_state(_window);
      match main_window_close_action(current_runtime_settings()) {
        MainWindowCloseAction::KeepBackground => {
          let _ = _window.hide();
          apply_dock_visibility(_window.app_handle(), dock_visibility_for_background_keepalive());
        }
        MainWindowCloseAction::Quit => {
          APP_EXITING.store(true, Ordering::Relaxed);
          _window.app_handle().exit(0);
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
fn handle_run_event(_app: &AppHandle, _event: &RunEvent) {
  #[cfg(target_os = "macos")]
  match _event {
    RunEvent::ExitRequested { api, code, .. } => {
      if should_prevent_implicit_exit(code.is_some(), APP_EXITING.load(Ordering::Relaxed), current_runtime_settings()) {
        api.prevent_exit();
        apply_dock_visibility(_app, dock_visibility_for_background_keepalive());
        return;
      }

      APP_EXITING.store(true, Ordering::Relaxed);
    }
    RunEvent::Reopen {
      has_visible_windows, ..
    } => {
      if !has_visible_windows {
        let _ = show_and_focus_main_window(_app);
      }
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

fn timestamp_tag() -> String {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_secs().to_string())
    .unwrap_or_else(|_| String::from("0"))
}

#[tauri::command]
#[cfg(not(target_os = "android"))]
async fn save_file(file_name: String, bytes: Vec<u8>) -> Result<String, String> {
  let handle = rfd::AsyncFileDialog::new()
    .set_file_name(file_name.as_str())
    .save_file()
    .await;

  let Some(file_handle) = handle else {
    return Err(String::from("User canceled the save dialog"));
  };

  let file_path = file_handle.path().to_path_buf();
  fs::write(&file_path, bytes).map_err(|error| error.to_string())?;
  Ok(file_path.display().to_string())
}

#[tauri::command]
fn save_base64_image(data: String) -> Result<TauriFileMetadata, String> {
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
}

fn normalize_base_url(url: &str) -> String {
  url.trim_end_matches('/').to_string()
}

fn default_obsidian_config_path() -> Result<PathBuf, String> {
  #[cfg(target_os = "windows")]
  {
    let base = dirs::config_dir().ok_or_else(|| String::from("Unable to resolve config directory"))?;
    return Ok(base.join("obsidian").join("obsidian.json"));
  }

  #[cfg(target_os = "macos")]
  {
    let home = dirs::home_dir().ok_or_else(|| String::from("Unable to resolve home directory"))?;
    return Ok(
      home
        .join("Library")
        .join("Application Support")
        .join("obsidian")
        .join("obsidian.json"),
    );
  }

  #[cfg(not(any(target_os = "windows", target_os = "macos")))]
  {
    let home = dirs::home_dir().ok_or_else(|| String::from("Unable to resolve home directory"))?;
    let xdg_config_home = std::env::var("XDG_CONFIG_HOME")
      .map(PathBuf::from)
      .unwrap_or_else(|_| home.join(".config"));

    let config_dirs = ["obsidian", "Obsidian"];
    let file_names = ["obsidian.json", "Obsidian.json"];
    let mut candidates = Vec::new();

    for dir in config_dirs {
      for file in file_names {
        candidates.push(xdg_config_home.join(dir).join(file));
        candidates.push(home.join("snap").join("obsidian").join("current").join(".config").join(dir).join(file));
        candidates.push(home.join("snap").join("obsidian").join("common").join(".config").join(dir).join(file));
        candidates.push(
          home
            .join(".var")
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

  Ok(
    vaults
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
      .collect(),
  )
}

fn obsidian_vaults() -> Result<Vec<ObsidianVaultInfo>, String> {
  let config_path = default_obsidian_config_path()?;
  if !config_path.exists() {
    return Ok(Vec::new());
  }

  let config_content = fs::read_to_string(config_path).map_err(|error| error.to_string())?;
  parse_obsidian_vaults(&config_content)
}

fn traverse_obsidian_directory(dir_path: &Path, relative_path: &str, results: &mut Vec<ObsidianFileInfo>) -> Result<(), String> {
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

async fn wait_for_http_abort(flag: &AtomicBool) {
  while !flag.load(Ordering::Relaxed) {
    tokio::time::sleep(Duration::from_millis(25)).await;
  }
}

#[tauri::command]
async fn start_http_request(window: Window, request: NativeHttpRequest) -> Result<NativeHttpResponseStart, String> {
  let request_id = if request.request_id.trim().is_empty() {
    Uuid::new_v4().to_string()
  } else {
    request.request_id.clone()
  };

  if request.task_epoch.is_some_and(|epoch| epoch != mobile::TASK_EPOCH.load(Ordering::SeqCst)) {
    return Err("Background task was stopped".into());
  }
  struct StartGuard { id: String, armed: bool }
  impl Drop for StartGuard { fn drop(&mut self) { if self.armed { remove_native_http_abort(&self.id); http_delivery::remove(&self.id); } } }
  let mut start_guard = StartGuard { id: request_id.clone(), armed: true };
  let abort_flag = register_native_http_abort(&request_id);
  #[cfg(target_os = "android")]
  http_delivery::register(&request_id);
  let client = Client::builder()
    .build()
    .map_err(|error| error.to_string())?;

  let method = Method::from_bytes(request.method.as_bytes()).map_err(|error| error.to_string())?;
  let mut builder = client.request(method, &request.url);

  for header in &request.headers {
    let header_name = HeaderName::from_bytes(header.name.as_bytes()).map_err(|error| error.to_string())?;
    let header_value = HeaderValue::from_str(&header.value).map_err(|error| error.to_string())?;
    builder = builder.header(header_name, header_value);
  }

  if let Some(body) = request.body.clone().filter(|bytes| !bytes.is_empty()) {
    builder = builder.body(body);
  }

  if abort_flag.load(Ordering::Relaxed) {
    remove_native_http_abort(&request_id);
    return Err(String::from("Request was aborted"));
  }

  let response = tokio::select! {
    result = builder.send() => result.map_err(|error| {
      remove_native_http_abort(&request_id);
      error.to_string()
    })?,
    _ = wait_for_http_abort(&abort_flag) => {
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
        _ = wait_for_http_abort(&abort_flag) => None,
      };
      let Some(chunk) = chunk else { break };
      match chunk {
        Ok(bytes) => {
          for part in bytes.chunks(16 * 1024) {
            if abort_flag.load(Ordering::Relaxed) { break; }
            emit_native_http_chunk(&task_window, &task_request_id, part.to_vec(), false, None).await;
          }
        }
        Err(error) => {
          let _ = emit_native_http_chunk(&task_window, &task_request_id, Vec::new(), true, Some(error.to_string())).await;
          remove_native_http_abort(&task_request_id);
          return;
        }
      }
    }

    let _ = emit_native_http_chunk(&task_window, &task_request_id, Vec::new(), true, abort_flag.load(Ordering::Relaxed).then(|| "Request was aborted".into())).await;
    remove_native_http_abort(&task_request_id);
  });

  start_guard.armed = false;
  Ok(response_start)
}

#[tauri::command]
async fn abort_http_request(request_id: String) -> Result<bool, String> {
  http_delivery::remove(&request_id);
  if let Ok(registry) = native_http_abort_registry().lock() {
    if let Some(flag) = registry.get(&request_id) {
      flag.store(true, Ordering::Relaxed);
      return Ok(true);
    }
  }

  Ok(false)
}

async fn upload_webdav(config: &BackupWebDavConfig, payload: Vec<u8>) -> Result<String, String> {
  let client = Client::new();
  let file_name = config
    .file_name
    .clone()
    .filter(|file_name| !file_name.trim().is_empty())
    .unwrap_or_else(|| String::from("lich13studio-backup.zip"));
  let target = format!("{}/{}", normalize_base_url(&config.url), file_name);

  let mut request = client
    .put(&target)
    .basic_auth(&config.username, Some(&config.password))
    .header(CONTENT_TYPE, "application/zip");

  if let Some(user_agent) = config.user_agent.as_ref().filter(|value| !value.trim().is_empty()) {
    request = request.header(USER_AGENT, user_agent);
  }

  request
    .body(payload)
    .send()
    .await
    .map_err(|error| error.to_string())?
    .error_for_status()
    .map_err(|error| error.to_string())?;

  Ok(target)
}

async fn download_webdav(config: &BackupWebDavConfig) -> Result<Vec<u8>, String> {
  let client = Client::new();
  let file_name = config
    .file_name
    .clone()
    .filter(|file_name| !file_name.trim().is_empty())
    .unwrap_or_else(|| String::from("lich13studio-backup.zip"));
  let target = format!("{}/{}", normalize_base_url(&config.url), file_name);

  let mut request = client.get(&target).basic_auth(&config.username, Some(&config.password));
  if let Some(user_agent) = config.user_agent.as_ref().filter(|value| !value.trim().is_empty()) {
    request = request.header(USER_AGENT, user_agent);
  }

  let payload = request
    .send()
    .await
    .map_err(|error| error.to_string())?
    .error_for_status()
    .map_err(|error| error.to_string())?
    .bytes()
    .await
    .map_err(|error| error.to_string())?;

  Ok(payload.to_vec())
}

fn parse_webdav_listing(xml: &str) -> Result<Vec<RemoteBackupFileInfo>, String> {
  let document = Document::parse(xml).map_err(|error| error.to_string())?;
  let mut files = Vec::new();

  for response in document.descendants().filter(|node| node.has_tag_name(("DAV:", "response")) || node.tag_name().name() == "response") {
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

    let is_collection = prop
      .descendants()
      .any(|node| node.has_tag_name(("DAV:", "collection")) || node.tag_name().name() == "collection");

    if is_collection {
      continue;
    }

    let file_name = href
      .trim_end_matches('/')
      .split('/')
      .filter(|segment| !segment.is_empty())
      .last()
      .unwrap_or_default()
      .to_string();

    if file_name.is_empty() {
      continue;
    }

    let modified_time = prop
      .descendants()
      .find(|node| node.has_tag_name(("DAV:", "getlastmodified")) || node.tag_name().name() == "getlastmodified")
      .and_then(|node| node.text())
      .unwrap_or("")
      .to_string();

    let size = prop
      .descendants()
      .find(|node| node.has_tag_name(("DAV:", "getcontentlength")) || node.tag_name().name() == "getcontentlength")
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
  let client = Client::new();
  let target = normalize_base_url(&config.url);
  let body = r#"<?xml version="1.0" encoding="utf-8" ?><propfind xmlns="DAV:"><prop><getlastmodified/><getcontentlength/><resourcetype/></prop></propfind>"#;

  let mut request = client
    .request(reqwest::Method::from_bytes(b"PROPFIND").map_err(|error| error.to_string())?, &target)
    .basic_auth(&config.username, Some(&config.password))
    .header("Depth", "1")
    .header(CONTENT_TYPE, "application/xml")
    .body(body.to_string());

  if let Some(user_agent) = config.user_agent.as_ref().filter(|value| !value.trim().is_empty()) {
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

async fn check_webdav(config: &BackupWebDavConfig) -> Result<bool, String> {
  let client = Client::new();
  let target = normalize_base_url(&config.url);
  let body = r#"<?xml version="1.0" encoding="utf-8" ?><propfind xmlns="DAV:"><prop><displayname/></prop></propfind>"#;

  let mut request = client
    .request(reqwest::Method::from_bytes(b"PROPFIND").map_err(|error| error.to_string())?, &target)
    .basic_auth(&config.username, Some(&config.password))
    .header("Depth", "0")
    .header(CONTENT_TYPE, "application/xml")
    .body(body.to_string());

  if let Some(user_agent) = config.user_agent.as_ref().filter(|value| !value.trim().is_empty()) {
    request = request.header(USER_AGENT, user_agent);
  }

  let response = request.send().await.map_err(|error| error.to_string())?;

  Ok(response.status().is_success())
}

async fn create_webdav_folder(
  config: &BackupWebDavConfig,
  dir_path: &str,
) -> Result<bool, String> {
  let client = Client::new();
  let mut current = normalize_base_url(&config.url);

  for segment in dir_path.split('/').filter(|segment| !segment.trim().is_empty()) {
    current = format!("{}/{}", current, segment);
    let mut request = client
      .request(reqwest::Method::from_bytes(b"MKCOL").map_err(|error| error.to_string())?, &current)
      .basic_auth(&config.username, Some(&config.password));

    if let Some(user_agent) = config.user_agent.as_ref().filter(|value| !value.trim().is_empty()) {
      request = request.header(USER_AGENT, user_agent);
    }

    let response = request.send().await.map_err(|error| error.to_string())?;

    let status = response.status();
    if !(status.is_success() || status.as_u16() == 405) {
      return Err(format!("Failed to create WebDAV directory: HTTP {}", status));
    }
  }

  Ok(true)
}

async fn delete_webdav(config: &BackupWebDavConfig, file_name: &str) -> Result<bool, String> {
  let client = Client::new();
  let target = format!("{}/{}", normalize_base_url(&config.url), file_name);

  let mut request = client.delete(target).basic_auth(&config.username, Some(&config.password));
  if let Some(user_agent) = config.user_agent.as_ref().filter(|value| !value.trim().is_empty()) {
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
  time
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_secs().to_string())
    .unwrap_or_else(|_| String::from("0"))
}

fn config_dir() -> Result<PathBuf, String> {
  let path = app_data_dir()?.join("config");
  fs::create_dir_all(&path).map_err(|error| error.to_string())?;
  Ok(path)
}

fn files_dir() -> Result<PathBuf, String> {
  let path = app_data_dir()?.join("Data").join("Files");
  fs::create_dir_all(&path).map_err(|error| error.to_string())?;
  Ok(path)
}

fn notes_dir() -> Result<PathBuf, String> {
  let path = app_data_dir()?.join("Data").join("Notes");
  fs::create_dir_all(&path).map_err(|error| error.to_string())?;
  Ok(path)
}

fn logs_dir() -> Result<PathBuf, String> {
  let path = app_data_dir()?.join("Logs");
  fs::create_dir_all(&path).map_err(|error| error.to_string())?;
  Ok(path)
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
  let normalized: String = payload.chars().filter(|character| !character.is_ascii_whitespace()).collect();

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

  let (payload, extension) = if data.get(..5).is_some_and(|prefix| prefix.eq_ignore_ascii_case("data:")) {
    let data_url_body = &data[5..];
    let comma_index = data_url_body
      .find(',')
      .ok_or_else(|| String::from("Invalid base64 image data URL"))?;
    let header = &data_url_body[..comma_index];

    if !header.split(';').any(|part| part.eq_ignore_ascii_case("base64")) {
      return Err(String::from("Only base64 image data URLs are supported"));
    }

    let media_type = header.split(';').next().filter(|value| !value.trim().is_empty());
    (&data_url_body[comma_index + 1..], extension_from_mime_type(media_type).to_string())
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
  { "android" }
  #[cfg(all(not(target_os = "macos"), not(target_os = "windows"), not(target_os = "android")))]
  {
    "linux"
  }
}

fn system_hostname() -> String {
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
}

fn normalize_external_url(value: &str) -> Result<String, String> {
  let trimmed = value.trim();
  if trimmed.is_empty() {
    return Err(String::from("External URL is required"));
  }

  let parsed = Url::parse(trimmed).map_err(|_| String::from("Invalid external URL"))?;
  match parsed.scheme() {
    "http" | "https" | "mailto" | "tel" => Ok(trimmed.to_string()),
    scheme => Err(format!("Blocked external URL scheme: {scheme}")),
  }
}

fn tray_menu_item_ids() -> [&'static str; 3] {
  [TRAY_SHOW_MENU_ID, TRAY_CHECK_UPDATE_MENU_ID, TRAY_QUIT_MENU_ID]
}

fn normalize_update_version(version: &str) -> String {
  version
    .trim()
    .trim_start_matches(|value| value == 'v' || value == 'V')
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

fn select_platform_update_asset(assets: &[GitHubReleaseAsset], platform: &str) -> Option<AppUpdateAsset> {
  let normalized_platform = platform.to_ascii_lowercase();
  let candidates: Vec<&GitHubReleaseAsset> = assets
    .iter()
    .filter(|asset| {
      asset.name.as_deref().is_some_and(|name| !name.trim().is_empty())
        && asset
          .browser_download_url
          .as_deref()
          .is_some_and(|url| !url.trim().is_empty())
    })
    .collect();

  let preferred = if normalized_platform == "android" {
    candidates.iter().copied().find(|asset| {
      let name = asset.name.as_deref().unwrap_or_default().to_ascii_lowercase();
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
      let name = asset.name.as_deref().unwrap_or_default().to_ascii_lowercase();
      name.ends_with(".exe") || name.contains("setup")
    })
  } else {
    candidates.iter().copied().find(|asset| {
      let name = asset.name.as_deref().unwrap_or_default().to_ascii_lowercase();
      name.ends_with(".appimage") || name.ends_with(".deb")
    })
  };

  release_asset_to_app_asset(preferred.or_else(|| candidates.first().copied()))
}

fn release_page_url(tag_name: Option<&str>, html_url: Option<&str>) -> String {
  let tag = tag_name.unwrap_or_default().trim();
  let version = tag.strip_prefix('v').or_else(|| tag.strip_prefix('V')).unwrap_or(tag);
  let valid_suffix = |value: &str| {
    !value.is_empty() && value.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-'))
  };
  let (without_build, build) = version.split_once('+').map_or((version, None), |(a, b)| (a, Some(b)));
  let (core, prerelease) = without_build.split_once('-').map_or((without_build, None), |(a, b)| (a, Some(b)));
  let parts: Vec<&str> = core.split('.').collect();
  let valid_tag = parts.len() == 3
    && parts.iter().all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
    && build.map_or(true, valid_suffix)
    && prerelease.map_or(true, valid_suffix);
  if !valid_tag {
    return GITHUB_RELEASES_URL.to_string();
  }

  let mut expected = Url::parse(GITHUB_RELEASES_URL).expect("Static release URL");
  expected.path_segments_mut().expect("Static release path").push("tag").push(tag);
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

fn build_app_update_info(current_version: &str, platform: &str, release: GitHubLatestRelease) -> AppUpdateInfo {
  let latest_version = release
    .tag_name
    .as_deref()
    .map(normalize_update_version)
    .filter(|version| !version.is_empty());
  let release_url = release_page_url(release.tag_name.as_deref(), release.html_url.as_deref());
  let has_update = latest_version
    .as_deref()
    .is_some_and(|version| release_url != GITHUB_RELEASES_URL && compare_update_versions(version, current_version) == CmpOrdering::Greater);

  AppUpdateInfo {
    has_update,
    current_version: current_version.to_string(),
    latest_version,
    release_url,
    release_notes: release.body.unwrap_or_default(),
    asset: select_platform_update_asset(&release.assets, platform),
  }
}

async fn fetch_latest_update_info(current_version: &str, platform: &str) -> Result<AppUpdateInfo, String> {
  let release = Client::new()
    .get(GITHUB_LATEST_RELEASE_API_URL)
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
  app
    .notification()
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
  if cfg!(target_os = "android") { return app_data_dir(); }
  let exe = std::env::current_exe().map_err(|error| error.to_string())?;
  Ok(
    exe.parent()
      .and_then(|path| path.parent())
      .and_then(|path| path.parent())
      .map(|path| path.to_path_buf())
      .unwrap_or_else(|| exe.parent().unwrap_or_else(|| std::path::Path::new("/")).to_path_buf()),
  )
}

fn resources_dir() -> Result<PathBuf, String> {
  Ok(install_dir()?.join("Contents").join("Resources"))
}

fn zip_file_options() -> SimpleFileOptions {
  SimpleFileOptions::default()
    .compression_method(CompressionMethod::Deflated)
    .unix_permissions(0o644)
}

fn add_directory_to_zip(
  zip: &mut ZipWriter<Cursor<Vec<u8>>>,
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
      zip.add_directory(format!("{}/", archive_path.trim_end_matches('/')), zip_file_options())
        .map_err(|error| error.to_string())?;
      continue;
    }

    zip.start_file(archive_path, zip_file_options())
      .map_err(|error| error.to_string())?;
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    zip.write_all(&bytes).map_err(|error| error.to_string())?;
  }

  Ok(())
}

fn create_backup_archive_bytes(state: &Value, include_files: bool) -> Result<Vec<u8>, String> {
  let cursor = Cursor::new(Vec::new());
  let mut zip = ZipWriter::new(cursor);

  zip.start_file("data.json", zip_file_options())
    .map_err(|error| error.to_string())?;
  let payload = serde_json::to_vec_pretty(state).map_err(|error| error.to_string())?;
  zip.write_all(&payload).map_err(|error| error.to_string())?;

  if include_files {
    add_directory_to_zip(&mut zip, &data_dir()?, "Data")?;
  }

  let cursor = zip.finish().map_err(|error| error.to_string())?;
  Ok(cursor.into_inner())
}

fn validate_backup_payload(payload: &str) -> Result<(), String> {
  let data: Value = serde_json::from_str(payload).map_err(|_| "Invalid backup JSON")?;
  let version = data["version"].as_u64().ok_or("Missing backup version")?;
  if !(1..=5).contains(&version) || !data["localStorage"].is_object()
      || !(data["indexedDB"].is_object() || (version == 1 && data["indexedDB"].is_array())) {
    return Err("Unsupported backup format".into());
  }
  let persisted = data["localStorage"]["persist:cherry-studio"].as_str().ok_or("Backup missing application state")?;
  let state: Value = serde_json::from_str(persisted).map_err(|_| "Invalid application state")?;
  if !state.is_object() { return Err("Invalid application state".into()); }
  if let Some(tables) = data["indexedDB"].as_object() {
    if tables.values().any(|table| !table.is_array()) { return Err("Invalid backup table".into()); }
  }
  Ok(())
}

static PENDING_BACKUP_RESTORE: OnceLock<Mutex<Option<(PathBuf, PathBuf, bool)>>> = OnceLock::new();

#[tauri::command]
fn finish_backup_restore(commit: bool) -> Result<(), String> {
  let mut pending = PENDING_BACKUP_RESTORE.get_or_init(Default::default).lock().map_err(|_| "Restore lock unavailable")?;
  let Some((current, previous, existed)) = pending.as_ref() else { return Ok(()) };
  if commit {
    if *existed && previous.exists() { fs::remove_dir_all(previous).map_err(|_| "Cannot remove restore staging")?; }
  } else {
    if current.exists() { fs::remove_dir_all(current).map_err(|_| "Cannot roll back restored files")?; }
    if *existed { fs::rename(previous, current).map_err(|_| "Cannot restore previous files")?; }
  }
  *pending = None;
  Ok(())
}

fn extract_backup_archive(bytes: &[u8]) -> Result<String, String> {
  extract_backup_archive_to(bytes, &data_dir()?)
}

fn extract_backup_archive_to(bytes: &[u8], data_root: &Path) -> Result<String, String> {
  let mut pending = PENDING_BACKUP_RESTORE.get_or_init(Default::default).lock().map_err(|_| "Restore lock unavailable")?;
  if pending.is_some() { return Err("A backup restore is already active".into()); }
  let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|_| "Invalid backup archive")?;
  let mut payload = String::new();
  archive.by_name("data.json").map_err(|_| "Backup archive missing data.json")?
    .take(512 * 1024 * 1024).read_to_string(&mut payload).map_err(|_| "Invalid backup data")?;
  validate_backup_payload(&payload)?;
  let parent = data_root.parent().ok_or("Invalid data directory")?;
  let staging = parent.join(format!("restore-staging-{}", Uuid::new_v4()));
  let previous = parent.join(format!("restore-previous-{}", Uuid::new_v4()));
  fs::create_dir_all(&staging).map_err(|_| "Cannot stage backup")?;
  let result = (|| -> Result<bool, String> {
    let mut has_data = false;
    for index in 0..archive.len() {
      let mut file = archive.by_index(index).map_err(|_| "Damaged backup entry")?;
      let path = file.enclosed_name().ok_or("Unsafe backup path")?;
      if file.unix_mode().is_some_and(|mode| mode & 0o170000 == 0o120000) { return Err("Backup symlinks are not supported".into()); }
      let Ok(relative) = path.strip_prefix("Data") else { continue };
      has_data = true;
      let output_path = staging.join(relative);
      if file.is_dir() { fs::create_dir_all(&output_path).map_err(|_| "Cannot stage directory")?; continue }
      if let Some(parent) = output_path.parent() { fs::create_dir_all(parent).map_err(|_| "Cannot stage directory")?; }
      let mut output = File::create(&output_path).map_err(|_| "Cannot stage file")?;
      std::io::copy(&mut file, &mut output).map_err(|_| "Damaged backup file")?;
      output.sync_all().map_err(|_| "Cannot flush backup file")?;
    }
    Ok(has_data)
  })();
  let has_data = match result { Ok(value) => value, Err(error) => { let _ = fs::remove_dir_all(&staging); return Err(error) } };
  if has_data {
    let existed = data_root.exists();
    if existed { fs::rename(data_root, &previous).map_err(|_| "Cannot prepare backup restore")?; }
    if fs::rename(&staging, data_root).is_err() {
      if existed { let _ = fs::rename(&previous, data_root); }
      let _ = fs::remove_dir_all(&staging);
      return Err("Cannot commit backup restore".into());
    }
    *pending = Some((data_root.to_path_buf(), previous, existed));
  } else { let _ = fs::remove_dir_all(staging); }
  Ok(payload)
}

#[tauri::command]
fn create_portable_backup(state: Value, include_files: bool) -> Result<Vec<u8>, String> {
  validate_backup_payload(&state.to_string())?;
  create_backup_archive_bytes(&state, include_files)
}

#[tauri::command]
fn persist_attachment(name: String, bytes: Vec<u8>) -> Result<String, String> {
  if name.is_empty() || name.contains(['/', '\\']) || name == "." || name == ".." { return Err("Invalid attachment name".into()); }
  let path = files_dir()?.join(name);
  fs::write(&path, bytes).map_err(|_| "Could not save attachment")?;
  Ok(path.display().to_string())
}

#[tauri::command]
fn read_attachment(name: String) -> Result<Vec<u8>, String> {
  let root = files_dir()?.canonicalize().map_err(|_| "Attachment directory unavailable")?;
  let name = name.strip_prefix("file://").unwrap_or(&name);
  let path = if Path::new(name).is_absolute() { PathBuf::from(name) } else { root.join(name) };
  let path = path.canonicalize().map_err(|_| "Attachment not found")?;
  if !path.starts_with(root) { return Err("Attachment is outside application storage".into()); }
  fs::read(path).map_err(|_| "Could not read attachment".into())
}

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
      .then_with(|| left.app_name.to_lowercase().cmp(&right.app_name.to_lowercase()))
      .then_with(|| left.title.to_lowercase().cmp(&right.title.to_lowercase()))
  });

  Ok(windows)
}

fn ensure_screen_capture_access() -> Result<(), String> {
  #[cfg(target_os = "macos")]
  unsafe {
    if CGPreflightScreenCaptureAccess() {
      return Ok(());
    }

    if CGRequestScreenCaptureAccess() {
      return Ok(());
    }

    return Err(String::from(
      "Screen capture permission is required. Enable Screen Recording for lich13studio in System Settings and relaunch the app.",
    ));
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
fn load_state() -> Result<Value, String> {
  load_state_file()
}

#[tauri::command]
fn save_state(state: Value) -> Result<String, String> {
  save_state_file(&state)
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
#[cfg(not(target_os = "android"))]
fn is_launch_on_boot_enabled() -> Result<bool, String> {
  is_auto_launch_enabled()
}

#[tauri::command]
fn is_startup_silent() -> bool {
  STARTED_SILENTLY.load(Ordering::SeqCst)
}

#[tauri::command]
fn export_backup(state: Value) -> Result<String, String> {
  let path = downloads_dir()?.join(format!("lich13studio-backup-{}.zip", timestamp_tag()));
  let payload = create_backup_archive_bytes(&state, true)?;
  fs::write(&path, payload).map_err(|error| error.to_string())?;
  Ok(path.display().to_string())
}

#[tauri::command]
async fn webdav_backup(state: Value, config: BackupWebDavConfig) -> Result<String, String> {
  let payload = create_backup_archive_bytes(&state, !config.skip_backup_file.unwrap_or(false))?;
  upload_webdav(&config, payload).await
}

#[tauri::command]
async fn webdav_restore(config: BackupWebDavConfig) -> Result<Value, String> {
  let bytes = download_webdav(&config).await?;
  let payload = extract_backup_archive(&bytes)?;
  serde_json::from_str(&payload).map_err(|error| error.to_string())
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
fn get_obsidian_files(vault_name: String) -> Result<Vec<ObsidianFileInfo>, String> {
  obsidian_files(&vault_name)
}

#[tauri::command]
#[cfg(not(target_os = "android"))]
async fn open_path(path: String) -> Result<bool, String> {
  if path.trim().is_empty() {
    return Ok(false);
  }

  let status = if cfg!(target_os = "macos") {
    Command::new("open").arg(&path).status().await
  } else if cfg!(target_os = "windows") {
    hidden_command("cmd")
      .arg("/C")
      .arg("start")
      .arg("")
      .arg(&path)
      .status()
      .await
  } else {
    Command::new("xdg-open").arg(&path).status().await
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
fn list_capture_windows() -> Result<Vec<CaptureWindowInfo>, String> {
  ensure_screen_capture_access()?;
  capture_windows()
}

#[tauri::command]
#[cfg(not(target_os = "android"))]
fn capture_window(window_id: u32) -> Result<Vec<u8>, String> {
  ensure_screen_capture_access()?;
  let window = CaptureWindow::all()
    .map_err(|error| error.to_string())?
    .into_iter()
    .find(|window| window.id().ok() == Some(window_id))
    .ok_or_else(|| String::from("Target window not found"))?;

  let image = window.capture_image().map_err(|error| error.to_string())?;
  encode_png(image)
}

#[tauri::command]
async fn backup_to_local_dir(
  file_name: String,
  local_backup_dir: Option<String>,
  payload: String,
  skip_backup_file: Option<bool>,
) -> Result<bool, String> {
  let base_dir = local_backup_dir
    .map(PathBuf::from)
    .unwrap_or(downloads_dir()?);

  fs::create_dir_all(&base_dir).map_err(|error| error.to_string())?;
  let file_path = base_dir.join(file_name);
  let state: Value = serde_json::from_str(&payload).map_err(|error| error.to_string())?;
  let bytes = create_backup_archive_bytes(&state, !skip_backup_file.unwrap_or(false))?;
  fs::write(file_path, bytes).map_err(|error| error.to_string())?;
  Ok(true)
}

#[tauri::command]
async fn restore_from_local_backup(file_name: String, local_backup_dir: Option<String>) -> Result<String, String> {
  let base_dir = local_backup_dir
    .map(PathBuf::from)
    .unwrap_or(downloads_dir()?);
  let file_path = base_dir.join(file_name);
  if file_path
    .extension()
    .and_then(|ext| ext.to_str())
    .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
  {
    let bytes = fs::read(file_path).map_err(|error| error.to_string())?;
    return extract_backup_archive(&bytes);
  }

  fs::read_to_string(file_path).map_err(|error| error.to_string())
}

#[tauri::command]
async fn restore_backup_archive(file_name: String, bytes: Vec<u8>) -> Result<String, String> {
  decode_portable_backup(&file_name, &bytes, &data_dir()?)
}

fn decode_portable_backup(file_name: &str, bytes: &[u8], data_root: &Path) -> Result<String, String> {
  let name = file_name.to_lowercase();
  // The renderer authenticates/decrypts the versioned container before this call.
  // Its original filename still carries .lich13backup, but the payload is a ZIP.
  if name.ends_with(".zip") || name.ends_with(".lich13backup") {
    return extract_backup_archive_to(bytes, data_root);
  }
  String::from_utf8(bytes.to_vec()).map_err(|_| "Invalid backup data".into())
}

#[tauri::command]
async fn list_local_backup_files(local_backup_dir: Option<String>) -> Result<Vec<LocalBackupFileInfo>, String> {
  let base_dir = local_backup_dir
    .map(PathBuf::from)
    .unwrap_or(downloads_dir()?);

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
        .unwrap_or_else(|_| String::from("0")),
    });
  }

  items.sort_by(|left, right| right.modified_time.cmp(&left.modified_time));
  Ok(items)
}

#[tauri::command]
async fn delete_local_backup_file(file_name: String, local_backup_dir: Option<String>) -> Result<bool, String> {
  let base_dir = local_backup_dir
    .map(PathBuf::from)
    .unwrap_or(downloads_dir()?);
  let file_path = base_dir.join(file_name);
  if file_path.exists() {
    fs::remove_file(file_path).map_err(|error| error.to_string())?;
  }
  Ok(true)
}

#[tauri::command]
async fn list_webdav_files(config: BackupWebDavConfig) -> Result<Vec<RemoteBackupFileInfo>, String> {
  list_webdav(&config).await
}

#[tauri::command]
async fn check_webdav_connection(config: BackupWebDavConfig) -> Result<bool, String> {
  check_webdav(&config).await
}

#[tauri::command]
async fn create_webdav_directory(config: BackupWebDavConfig, path: String) -> Result<bool, String> {
  create_webdav_folder(&config, &path).await
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

// Keep import credentials only in memory until the main renderer can receive them.
#[derive(Default)]
struct PendingProviderImports(Mutex<Vec<String>>);

impl PendingProviderImports {
  fn enqueue(&self, urls: &[Url]) {
    let mut pending = self.0.lock().unwrap();
    for url in urls.iter().filter(|url| url.scheme() == "ccswitch") {
      let value = url.as_str().to_owned();
      if !pending.contains(&value) {
        pending.push(value);
      }
    }
  }

  fn take(&self, window_label: &str) -> Vec<String> {
    if window_label != "main" {
      return Vec::new();
    }
    std::mem::take(&mut *self.0.lock().unwrap())
  }
}

#[tauri::command]
fn take_pending_provider_imports(app: AppHandle, window: Window, pending: tauri::State<PendingProviderImports>) -> Vec<String> {
  #[cfg(target_os = "android")]
  { let app = app.clone(); tauri::async_runtime::spawn(async move { let _ = mobile::mobile_command(app, "consumeImportIntent".into(), None).await; }); }
  let _ = app;
  pending.take(window.label())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default().manage(PendingProviderImports::default());
  #[cfg(not(target_os = "android"))]
  let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| { let _ = show_and_focus_main_window(app); }));
  #[cfg(target_os = "android")]
  let builder = builder.plugin(mobile::plugin()).on_page_load(|webview, payload| {
    if payload.event() == tauri::webview::PageLoadEvent::Started {
      let app = webview.app_handle().clone();
      // A fresh renderer has no collectors for the previous page's streams.
      // Route changes do not load a page and continue running in the background.
      tauri::async_runtime::spawn(async move {
        let _ = mobile::mobile_command(app, "stopTasks".into(), None).await;
      });
    }
  });
  builder
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_notification::init())
    .setup(|app| {
      #[cfg(target_os = "android")]
      { let path = app.path().app_data_dir()?; fs::create_dir_all(&path)?; let _ = MOBILE_DATA_DIR.set(path); }
      // An isolated desktop debug bundle exercises cross-platform restore without
      // touching the installed application's files. Compiled out of releases.
      #[cfg(all(debug_assertions, not(target_os = "android")))]
      if app.config().identifier.ends_with(".acceptance") {
        let path = app.path().app_data_dir()?;
        fs::create_dir_all(&path)?;
        let _ = MOBILE_DATA_DIR.set(path);
      }
      use tauri_plugin_deep_link::DeepLinkExt;
      let import_app = app.handle().clone();
      if let Ok(Some(urls)) = app.deep_link().get_current() {
        app.state::<PendingProviderImports>().enqueue(&urls);
      }
      app.deep_link().on_open_url(move |event| {
        import_app.state::<PendingProviderImports>().enqueue(&event.urls());
        let _ = import_app.emit_to("main", "provider-import-pending", ());
        #[cfg(not(target_os = "android"))]
        let _ = show_and_focus_main_window(&import_app);
      });
      #[cfg(not(target_os = "android"))]
      {
      let runtime_settings = load_runtime_settings_from_state().unwrap_or_default();
      replace_runtime_settings(runtime_settings);
      let launch_args = std::env::args().collect::<Vec<_>>();
      let start_silently = should_start_silently(&launch_args, runtime_settings);
      STARTED_SILENTLY.store(start_silently, Ordering::SeqCst);
      MAIN_WINDOW_SHOWN.store(start_silently, Ordering::SeqCst);

      if let Some(main_window) = app.get_webview_window("main") {
        if start_silently {
          let _ = main_window.hide();
          apply_dock_visibility(app.handle(), dock_visibility_for_background_keepalive());
        } else {
          let fallback_window = main_window.clone();
          tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(3)).await;
            let _ = mark_main_window_shown(&fallback_window);
          });
        }

        if let Some(state) = load_window_state(main_window.label())? {
          if let (Some(width), Some(height)) = (state.width, state.height) {
            let _ = main_window.set_size(Size::Physical(PhysicalSize::new(width, height)));
          }

          if let (Some(x), Some(y)) = (state.x, state.y) {
            let _ = main_window.set_position(Position::Physical(PhysicalPosition::new(x, y)));
          }

          if state.fullscreen {
            let _ = main_window.set_fullscreen(true);
          } else if state.maximized {
            let _ = main_window.maximize();
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
      if should_persist_window_event(event) {
        let _ = persist_window_state(window);
      }
      }
      let _ = (window, event);
    })
    .invoke_handler(tauri::generate_handler![
      mobile::mobile_command,
      backup_crypto::encrypt_backup,
      backup_crypto::decrypt_backup,
      app_info,
      take_pending_provider_imports,
      get_device_type,
      get_hostname,
      load_state,
      save_state,
      set_runtime_setting,
      set_launch_on_boot,
      is_launch_on_boot_enabled,
      is_startup_silent,
      create_portable_backup,
      finish_backup_restore,
      persist_attachment,
      read_attachment,
      export_backup,
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
      list_local_backup_files,
      delete_local_backup_file,
      list_webdav_files,
      check_webdav_connection,
      create_webdav_directory,
      delete_webdav_file,
      webdav_backup,
      webdav_restore,
      show_main_window,
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
    .build(tauri::generate_context!())
    .expect("failed to build lich13studio tauri runtime")
    .run(|app, event| {
      #[cfg(not(target_os = "android"))]
      handle_run_event(app, &event);
      let _ = (app, event);
    });
}

#[cfg(test)]
mod tests {
  use super::*;

  #[tokio::test]
  async fn cancels_http_while_waiting_for_headers_or_stream_data() {
    let flag = Arc::new(AtomicBool::new(false));
    let trigger = flag.clone();
    tokio::spawn(async move {
      tokio::time::sleep(Duration::from_millis(20)).await;
      trigger.store(true, Ordering::Relaxed);
    });
    let result = tokio::time::timeout(Duration::from_secs(1), async {
      tokio::select! {
        _ = std::future::pending::<()>() => false,
        _ = wait_for_http_abort(&flag) => true,
      }
    }).await;
    assert_eq!(result.unwrap(), true);
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
    assert!(extract_backup_archive_to(&bytes[..bytes.len()/2], &data).is_err());
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
  fn queues_provider_imports_until_main_renderer_is_ready() {
    let pending = PendingProviderImports::default();
    let first = Url::parse("ccswitch://v1/import?app=codex").unwrap();
    let second = Url::parse("ccswitch://v1/import?app=claude").unwrap();
    pending.enqueue(&[first.clone(), Url::parse("cherrystudio://ignored").unwrap()]);
    pending.enqueue(&[first.clone(), second.clone()]);
    assert!(pending.take("mini").is_empty());
    assert_eq!(pending.take("main"), vec![first.to_string(), second.to_string()]);
    assert!(pending.take("main").is_empty());
    pending.enqueue(&[first.clone()]);
    assert_eq!(pending.take("main"), vec![first.to_string()]);
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
    let directory = std::env::temp_dir().join(format!("lich13studio-encrypted-test-{}", Uuid::new_v4()));
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
    let encrypted = backup_crypto::encrypt_backup(bytes, "fixture password".into()).await.unwrap();
    let decrypted = backup_crypto::decrypt_backup(encrypted, "fixture password".into()).await.unwrap();
    let restored = decode_portable_backup("android.lich13backup", &decrypted, &directory.join("Data")).unwrap();
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
    ] {
      assert!(normalize_external_url(url).is_err(), "{url} should be rejected");
    }
  }

  #[test]
  fn update_version_comparison_handles_tag_prefixes() {
    assert_eq!(compare_update_versions("v0.1.12", "0.1.11"), CmpOrdering::Greater);
    assert_eq!(compare_update_versions("0.1.12", "v0.1.12"), CmpOrdering::Equal);
    assert_eq!(compare_update_versions("0.1.9", "0.1.10"), CmpOrdering::Less);
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
      release_page_url(Some("0.1.32"), Some("https://example.com/releases/tag/0.1.32")),
      "https://github.com/lich13/lich13studio/releases/tag/0.1.32"
    );
    for tag in [None, Some(""), Some("vv0.1.32"), Some("v0.1"), Some("v0.1.32-"), Some("v0.1.32+"), Some("../v0.1.32")] {
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
      html_url: Some("https://github.com/lich13/lich13studio/releases/tag/v0.1.12".to_string()),
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
      build_app_update_info("0.1.11", "macos", release.clone()).asset.unwrap().url,
      "https://example.com/app.dmg"
    );
    assert_eq!(
      build_app_update_info("0.1.11", "windows", release.clone()).asset.unwrap().url,
      "https://example.com/setup.exe"
    );
    assert_eq!(
      build_app_update_info("0.1.11", "android", release).asset.unwrap().url,
      "https://example.com/app.apk"
    );
  }

  #[test]
  fn update_tray_menu_item_ids_are_stable() {
    assert_eq!(tray_menu_item_ids(), ["show", "check_update", "quit"]);
  }

  #[test]
  fn non_macos_startup_arg_uses_silent_setting() {
    assert!(should_start_silently_from_args(
      &[LOGIN_STARTUP_ARG.to_string()],
      RuntimeSettings {
        launch_to_tray: true,
        ..RuntimeSettings::default()
      }
    ));
    assert!(!should_start_silently_from_args(
      &[LOGIN_STARTUP_ARG.to_string()],
      RuntimeSettings {
        launch_to_tray: false,
        ..RuntimeSettings::default()
      }
    ));
    assert!(!should_start_silently_from_args(
      &["--lich13studio-login-startup=1".to_string()],
      RuntimeSettings {
        launch_to_tray: true,
        ..RuntimeSettings::default()
      }
    ));
  }

  #[test]
  fn startup_source_silent_policy_requires_background_setting() {
    let silent_settings = RuntimeSettings {
      launch_to_tray: true,
      ..RuntimeSettings::default()
    };
    let visible_settings = RuntimeSettings {
      launch_to_tray: false,
      ..RuntimeSettings::default()
    };

    assert!(should_start_silently_for_source(StartupSource::LoginStartupArg, silent_settings));
    assert!(should_start_silently_for_source(
      StartupSource::MacOSHiddenLoginItem,
      silent_settings
    ));
    assert!(!should_start_silently_for_source(StartupSource::Normal, silent_settings));
    assert!(!should_start_silently_for_source(
      StartupSource::MacOSHiddenLoginItem,
      visible_settings
    ));
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
      macos_legacy_launch_agent_file(Path::new("/Users/gosu")),
      PathBuf::from("/Users/gosu/Library/LaunchAgents/com.lich13.studio.plist")
    );
  }

  #[test]
  fn macos_silent_start_uses_hidden_login_item_and_setting() {
    assert!(should_start_silently_from_macos_login_item(
      true,
      RuntimeSettings {
        launch_to_tray: true,
        ..RuntimeSettings::default()
      }
    ));
    assert!(!should_start_silently_from_macos_login_item(
      true,
      RuntimeSettings {
        launch_to_tray: false,
        ..RuntimeSettings::default()
      }
    ));
    assert!(!should_start_silently_from_macos_login_item(
      false,
      RuntimeSettings {
        launch_to_tray: true,
        ..RuntimeSettings::default()
      }
    ));
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
    assert_eq!(dock_visibility_for_main_window_show(), DockVisibility::Visible);
    assert_eq!(
      dock_visibility_for_background_keepalive(),
      DockVisibility::Hidden
    );
  }
}
