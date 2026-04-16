use futures_util::StreamExt;
use image::codecs::png::PngEncoder;
use image::{ColorType, ImageEncoder};
use reqwest::header::{HeaderName, HeaderValue, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use reqwest::{Client, Method};
use roxmltree::Document;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::fs::File;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, RunEvent, Size, Window, WindowEvent};
use tokio::process::Command;
use uuid::Uuid;
use walkdir::WalkDir;
use xcap::Window as CaptureWindow;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
  fn CGPreflightScreenCaptureAccess() -> bool;
  fn CGRequestScreenCaptureAccess() -> bool;
}

const APP_NAME: &str = "lich13studio";
const BUNDLE_ID: &str = "com.lich13.studio";
const DEFAULT_STATE_FILE: &str = "state.json";
const WINDOW_STATE_KEY: &str = "windowState";

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderRequest {
  id: String,
  name: String,
  api_type: String,
  api_key: String,
  api_host: Option<String>,
  model_ids: Vec<String>,
  enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatMessage {
  role: String,
  content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatRequest {
  stream_id: Option<String>,
  provider: ProviderRequest,
  model_id: String,
  system_prompt: Option<String>,
  messages: Vec<ChatMessage>,
  temperature: Option<f64>,
  max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatChunkEvent {
  stream_id: String,
  delta: String,
  done: bool,
  error: Option<String>,
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
  timeout_ms: Option<u64>,
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
struct NativeHttpChunkEvent {
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpServerRequest {
  transport: String,
  command: Option<String>,
  args: Option<Vec<String>>,
  url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OperationResult {
  ok: bool,
  message: String,
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

const NATIVE_HTTP_CHUNK_EVENT: &str = "native_http_chunk";

static HTTP_REQUEST_ABORTS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

fn native_http_abort_registry() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
  HTTP_REQUEST_ABORTS.get_or_init(|| Mutex::new(HashMap::new()))
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

fn is_native_http_aborted(request_id: &str) -> bool {
  native_http_abort_registry()
    .lock()
    .ok()
    .and_then(|registry| registry.get(request_id).cloned())
    .map(|flag| flag.load(Ordering::Relaxed))
    .unwrap_or(false)
}

async fn emit_native_http_chunk(window: &Window, request_id: &str, chunk: Vec<u8>, done: bool, error: Option<String>) {
  let payload = NativeHttpChunkEvent {
    request_id: request_id.to_string(),
    chunk,
    done,
    error,
  };
  let _ = window.emit(NATIVE_HTTP_CHUNK_EVENT, payload);
}

fn app_data_dir() -> Result<PathBuf, String> {
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

fn handle_main_window_close(_window: &Window, _event: &WindowEvent) {
  #[cfg(target_os = "macos")]
  if _window.label() == "main" {
    if let WindowEvent::CloseRequested { api, .. } = _event {
      if APP_EXITING.load(Ordering::Relaxed) {
        return;
      }

      api.prevent_close();
      let _ = persist_window_state(_window);
      let _ = _window.hide();
    }
  }
}

fn handle_run_event(_app: &AppHandle, _event: &RunEvent) {
  #[cfg(target_os = "macos")]
  match _event {
    RunEvent::ExitRequested { .. } => {
      APP_EXITING.store(true, Ordering::Relaxed);
    }
    RunEvent::Reopen {
      has_visible_windows, ..
    } => {
      if !has_visible_windows {
        if let Some(main_window) = _app.get_webview_window("main") {
          let _ = main_window.show();
          let _ = main_window.set_focus();
        }
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

fn resolve_openai_host(provider: &ProviderRequest) -> String {
  normalize_base_url(
    provider
      .api_host
      .as_deref()
      .filter(|host| !host.trim().is_empty())
      .unwrap_or("https://api.openai.com"),
  )
}

fn resolve_gemini_host(provider: &ProviderRequest) -> String {
  normalize_base_url(
    provider
      .api_host
      .as_deref()
      .filter(|host| !host.trim().is_empty())
      .unwrap_or("https://generativelanguage.googleapis.com"),
  )
}

fn resolve_anthropic_host(provider: &ProviderRequest) -> String {
  normalize_base_url(
    provider
      .api_host
      .as_deref()
      .filter(|host| !host.trim().is_empty())
      .unwrap_or("https://api.anthropic.com"),
  )
}

async fn emit_chunk(window: &Window, stream_id: &str, delta: String, done: bool, error: Option<String>) {
  let payload = ChatChunkEvent {
    stream_id: stream_id.to_string(),
    delta,
    done,
    error,
  };
  let _ = window.emit("chat_chunk", payload);
}

#[tauri::command]
async fn start_http_request(window: Window, request: NativeHttpRequest) -> Result<NativeHttpResponseStart, String> {
  let request_id = if request.request_id.trim().is_empty() {
    Uuid::new_v4().to_string()
  } else {
    request.request_id.clone()
  };

  let abort_flag = register_native_http_abort(&request_id);
  let timeout = Duration::from_millis(request.timeout_ms.unwrap_or(600_000));
  let client = Client::builder()
    .timeout(timeout)
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

  let response = builder.send().await.map_err(|error| {
    remove_native_http_abort(&request_id);
    error.to_string()
  })?;

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

    while let Some(chunk) = stream.next().await {
      if abort_flag.load(Ordering::Relaxed) || is_native_http_aborted(&task_request_id) {
        break;
      }

      match chunk {
        Ok(bytes) => {
          emit_native_http_chunk(&task_window, &task_request_id, bytes.to_vec(), false, None).await;
        }
        Err(error) => {
          let _ = emit_native_http_chunk(&task_window, &task_request_id, Vec::new(), true, Some(error.to_string())).await;
          remove_native_http_abort(&task_request_id);
          return;
        }
      }
    }

    let _ = emit_native_http_chunk(&task_window, &task_request_id, Vec::new(), true, None).await;
    remove_native_http_abort(&task_request_id);
  });

  Ok(response_start)
}

#[tauri::command]
async fn abort_http_request(request_id: String) -> Result<bool, String> {
  if let Ok(registry) = native_http_abort_registry().lock() {
    if let Some(flag) = registry.get(&request_id) {
      flag.store(true, Ordering::Relaxed);
      return Ok(true);
    }
  }

  Ok(false)
}

fn split_sse_events(buffer: &mut String) -> Vec<String> {
  let normalized = buffer.replace("\r\n", "\n");
  *buffer = normalized;
  let mut events = Vec::new();

  while let Some(position) = buffer.find("\n\n") {
    let event = buffer[..position].to_string();
    let rest = buffer[position + 2..].to_string();
    *buffer = rest;
    if !event.trim().is_empty() {
      events.push(event);
    }
  }

  events
}

fn parse_sse_data(event: &str) -> Vec<String> {
  event
    .lines()
    .filter_map(|line| line.strip_prefix("data:"))
    .map(|line| line.trim().to_string())
    .filter(|line| !line.is_empty())
    .collect()
}

fn build_openai_messages(request: &ChatRequest) -> Vec<Value> {
  let mut messages = Vec::new();

  if let Some(system_prompt) = request.system_prompt.as_ref().filter(|prompt| !prompt.trim().is_empty()) {
    messages.push(json!({
      "role": "system",
      "content": system_prompt
    }));
  }

  messages.extend(request.messages.iter().map(|message| {
    json!({
      "role": message.role,
      "content": message.content
    })
  }));

  messages
}

fn build_anthropic_messages(request: &ChatRequest) -> Vec<Value> {
  request
    .messages
    .iter()
    .map(|message| {
      json!({
        "role": message.role,
        "content": message.content
      })
    })
    .collect()
}

fn build_gemini_contents(request: &ChatRequest) -> Vec<Value> {
  let mut contents = Vec::new();

  if let Some(system_prompt) = request.system_prompt.as_ref().filter(|prompt| !prompt.trim().is_empty()) {
    contents.push(json!({
      "role": "user",
      "parts": [{ "text": format!("System instruction:\n{}", system_prompt) }]
    }));
  }

  contents.extend(request.messages.iter().map(|message| {
    json!({
      "role": if message.role == "assistant" { "model" } else { "user" },
      "parts": [{ "text": message.content }]
    })
  }));

  contents
}

async fn stream_openai(window: Window, stream_id: String, request: ChatRequest) {
  let client = Client::new();
  let endpoint = format!("{}/v1/chat/completions", resolve_openai_host(&request.provider));
  let body = json!({
    "model": request.model_id,
    "messages": build_openai_messages(&request),
    "stream": true,
    "temperature": request.temperature.unwrap_or(0.7),
    "max_tokens": request.max_tokens.unwrap_or(2048)
  });

  let response = client
    .post(endpoint)
    .header(AUTHORIZATION, format!("Bearer {}", request.provider.api_key))
    .header(CONTENT_TYPE, "application/json")
    .json(&body)
    .send()
    .await;

  match response {
    Ok(response) if response.status().is_success() => {
      let mut stream = response.bytes_stream();
      let mut buffer = String::new();

      while let Some(chunk) = stream.next().await {
        match chunk {
          Ok(bytes) => {
            buffer.push_str(&String::from_utf8_lossy(&bytes));
            for event in split_sse_events(&mut buffer) {
              for data in parse_sse_data(&event) {
                if data == "[DONE]" {
                  emit_chunk(&window, &stream_id, String::new(), true, None).await;
                  return;
                }

                let payload: Value = match serde_json::from_str(&data) {
                  Ok(value) => value,
                  Err(_) => continue,
                };
                let delta = payload["choices"][0]["delta"]["content"]
                  .as_str()
                  .unwrap_or_default()
                  .to_string();
                if !delta.is_empty() {
                  emit_chunk(&window, &stream_id, delta, false, None).await;
                }
              }
            }
          }
          Err(error) => {
            emit_chunk(&window, &stream_id, String::new(), true, Some(error.to_string())).await;
            return;
          }
        }
      }

      emit_chunk(&window, &stream_id, String::new(), true, None).await;
    }
    Ok(response) => {
      let error = response.text().await.unwrap_or_else(|_| String::from("OpenAI-compatible request failed"));
      emit_chunk(&window, &stream_id, String::new(), true, Some(error)).await;
    }
    Err(error) => {
      emit_chunk(&window, &stream_id, String::new(), true, Some(error.to_string())).await;
    }
  }
}

async fn stream_anthropic(window: Window, stream_id: String, request: ChatRequest) {
  let client = Client::new();
  let endpoint = format!("{}/v1/messages", resolve_anthropic_host(&request.provider));
  let body = json!({
    "model": request.model_id,
    "system": request.system_prompt.clone().unwrap_or_default(),
    "messages": build_anthropic_messages(&request),
    "max_tokens": request.max_tokens.unwrap_or(2048),
    "stream": true
  });

  let response = client
    .post(endpoint)
    .header("x-api-key", request.provider.api_key)
    .header("anthropic-version", "2023-06-01")
    .header(CONTENT_TYPE, "application/json")
    .json(&body)
    .send()
    .await;

  match response {
    Ok(response) if response.status().is_success() => {
      let mut stream = response.bytes_stream();
      let mut buffer = String::new();

      while let Some(chunk) = stream.next().await {
        match chunk {
          Ok(bytes) => {
            buffer.push_str(&String::from_utf8_lossy(&bytes));
            for event in split_sse_events(&mut buffer) {
              for data in parse_sse_data(&event) {
                let payload: Value = match serde_json::from_str(&data) {
                  Ok(value) => value,
                  Err(_) => continue,
                };

                if payload["type"].as_str() == Some("content_block_delta")
                  && payload["delta"]["type"].as_str() == Some("text_delta")
                {
                  let delta = payload["delta"]["text"].as_str().unwrap_or_default().to_string();
                  if !delta.is_empty() {
                    emit_chunk(&window, &stream_id, delta, false, None).await;
                  }
                }

                if payload["type"].as_str() == Some("message_stop") {
                  emit_chunk(&window, &stream_id, String::new(), true, None).await;
                  return;
                }

                if payload["type"].as_str() == Some("error") {
                  let message = payload["error"]["message"]
                    .as_str()
                    .unwrap_or("Anthropic streaming failed")
                    .to_string();
                  emit_chunk(&window, &stream_id, String::new(), true, Some(message)).await;
                  return;
                }
              }
            }
          }
          Err(error) => {
            emit_chunk(&window, &stream_id, String::new(), true, Some(error.to_string())).await;
            return;
          }
        }
      }

      emit_chunk(&window, &stream_id, String::new(), true, None).await;
    }
    Ok(response) => {
      let error = response.text().await.unwrap_or_else(|_| String::from("Anthropic request failed"));
      emit_chunk(&window, &stream_id, String::new(), true, Some(error)).await;
    }
    Err(error) => {
      emit_chunk(&window, &stream_id, String::new(), true, Some(error.to_string())).await;
    }
  }
}

async fn stream_gemini(window: Window, stream_id: String, request: ChatRequest) {
  let client = Client::new();
  let endpoint = format!(
    "{}/v1beta/models/{}:streamGenerateContent?alt=sse",
    resolve_gemini_host(&request.provider),
    request.model_id
  );
  let body = json!({
    "contents": build_gemini_contents(&request),
    "generationConfig": {
      "temperature": request.temperature.unwrap_or(0.7),
      "maxOutputTokens": request.max_tokens.unwrap_or(2048)
    }
  });

  let response = client
    .post(endpoint)
    .header("x-goog-api-key", request.provider.api_key)
    .header(CONTENT_TYPE, "application/json")
    .json(&body)
    .send()
    .await;

  match response {
    Ok(response) if response.status().is_success() => {
      let mut stream = response.bytes_stream();
      let mut buffer = String::new();

      while let Some(chunk) = stream.next().await {
        match chunk {
          Ok(bytes) => {
            buffer.push_str(&String::from_utf8_lossy(&bytes));
            for event in split_sse_events(&mut buffer) {
              for data in parse_sse_data(&event) {
                let payload: Value = match serde_json::from_str(&data) {
                  Ok(value) => value,
                  Err(_) => continue,
                };

                let delta = payload["candidates"]
                  .as_array()
                  .and_then(|candidates| candidates.first())
                  .and_then(|candidate| candidate["content"]["parts"].as_array())
                  .map(|parts| {
                    parts
                      .iter()
                      .filter_map(|part| part["text"].as_str())
                      .collect::<Vec<_>>()
                      .join("")
                  })
                  .unwrap_or_default();

                if !delta.is_empty() {
                  emit_chunk(&window, &stream_id, delta, false, None).await;
                }
              }
            }
          }
          Err(error) => {
            emit_chunk(&window, &stream_id, String::new(), true, Some(error.to_string())).await;
            return;
          }
        }
      }

      emit_chunk(&window, &stream_id, String::new(), true, None).await;
    }
    Ok(response) => {
      let error = response.text().await.unwrap_or_else(|_| String::from("Gemini request failed"));
      emit_chunk(&window, &stream_id, String::new(), true, Some(error)).await;
    }
    Err(error) => {
      emit_chunk(&window, &stream_id, String::new(), true, Some(error.to_string())).await;
    }
  }
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

fn system_device_type() -> &'static str {
  #[cfg(target_os = "macos")]
  {
    "mac"
  }

  #[cfg(target_os = "windows")]
  {
    "windows"
  }

  #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
  {
    "linux"
  }
}

fn system_hostname() -> String {
  std::env::var("COMPUTERNAME")
    .or_else(|_| std::env::var("HOSTNAME"))
    .ok()
    .filter(|value| !value.trim().is_empty())
    .unwrap_or_else(|| String::from("unknown"))
}

fn data_dir() -> Result<PathBuf, String> {
  let path = app_data_dir()?.join("Data");
  fs::create_dir_all(&path).map_err(|error| error.to_string())?;
  Ok(path)
}

fn install_dir() -> Result<PathBuf, String> {
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

fn extract_backup_archive(bytes: &[u8]) -> Result<String, String> {
  let reader = Cursor::new(bytes);
  let mut archive = ZipArchive::new(reader).map_err(|error| error.to_string())?;
  let mut payload = String::new();
  let mut has_data = false;
  let data_root = data_dir()?;

  for index in 0..archive.len() {
    let mut file = archive.by_index(index).map_err(|error| error.to_string())?;
    let name = file.name().replace('\\', "/");

    if name == "data.json" {
      file.read_to_string(&mut payload).map_err(|error| error.to_string())?;
      continue;
    }

    if !name.starts_with("Data/") {
      continue;
    }

    if !has_data {
      fs::remove_dir_all(&data_root).ok();
      fs::create_dir_all(&data_root).map_err(|error| error.to_string())?;
      has_data = true;
    }

    let relative = name.trim_start_matches("Data/");
    let out_path = data_root.join(relative);

    if file.is_dir() {
      fs::create_dir_all(&out_path).map_err(|error| error.to_string())?;
      continue;
    }

    if let Some(parent) = out_path.parent() {
      fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let mut output = File::create(&out_path).map_err(|error| error.to_string())?;
    std::io::copy(&mut file, &mut output).map_err(|error| error.to_string())?;
  }

  if payload.is_empty() {
    return Err(String::from("Backup archive missing data.json"));
  }

  Ok(payload)
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
async fn open_path(path: String) -> Result<bool, String> {
  if path.trim().is_empty() {
    return Ok(false);
  }

  let status = if cfg!(target_os = "macos") {
    Command::new("open").arg(&path).status().await
  } else {
    Command::new("xdg-open").arg(&path).status().await
  }
  .map_err(|error| error.to_string())?;

  Ok(status.success())
}

#[tauri::command]
fn list_capture_windows() -> Result<Vec<CaptureWindowInfo>, String> {
  ensure_screen_capture_access()?;
  capture_windows()
}

#[tauri::command]
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
  if file_name.to_lowercase().ends_with(".zip") {
    return extract_backup_archive(&bytes);
  }

  String::from_utf8(bytes).map_err(|error| error.to_string())
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
async fn test_provider(provider: ProviderRequest) -> Result<OperationResult, String> {
  let client = Client::new();
  let model_id = provider
    .model_ids
    .first()
    .cloned()
    .unwrap_or_else(|| String::from("gpt-5-chat"));

  let result = match provider.api_type.as_str() {
    "anthropic" => {
      let response = client
        .post(format!("{}/v1/messages", resolve_anthropic_host(&provider)))
        .header("x-api-key", provider.api_key)
        .header("anthropic-version", "2023-06-01")
        .header(CONTENT_TYPE, "application/json")
        .json(&json!({
          "model": model_id,
          "max_tokens": 1,
          "messages": [{ "role": "user", "content": "ping" }]
        }))
        .send()
        .await;
      response
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
      OperationResult { ok: true, message: String::from("Anthropic connectivity verified") }
    }
    "gemini" => {
      let response = client
        .post(format!(
          "{}/v1beta/models/{}:generateContent",
          resolve_gemini_host(&provider),
          model_id
        ))
        .header("x-goog-api-key", provider.api_key)
        .header(CONTENT_TYPE, "application/json")
        .json(&json!({
          "contents": [{ "parts": [{ "text": "ping" }] }]
        }))
        .send()
        .await;
      response
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
      OperationResult { ok: true, message: String::from("Gemini connectivity verified") }
    }
    _ => {
      let response = client
        .post(format!("{}/v1/chat/completions", resolve_openai_host(&provider)))
        .header(AUTHORIZATION, format!("Bearer {}", provider.api_key))
        .header(CONTENT_TYPE, "application/json")
        .json(&json!({
          "model": model_id,
          "messages": [{ "role": "user", "content": "ping" }],
          "max_tokens": 1
        }))
        .send()
        .await;
      response
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
      OperationResult { ok: true, message: String::from("OpenAI-compatible connectivity verified") }
    }
  };

  Ok(result)
}

#[tauri::command]
async fn test_mcp(server: McpServerRequest) -> Result<OperationResult, String> {
  match server.transport.as_str() {
    "local" => {
      let command = server
        .command
        .clone()
        .filter(|command| !command.trim().is_empty())
        .ok_or_else(|| String::from("Local MCP command is required"))?;
      let args = server.args.clone().unwrap_or_default();
      let output = Command::new(command)
        .args(args)
        .arg("--help")
        .output()
        .await
        .map_err(|error| error.to_string())?;

      Ok(OperationResult {
        ok: output.status.success(),
        message: if output.status.success() {
          String::from("Local MCP command executed successfully")
        } else {
          String::from_utf8_lossy(&output.stderr).to_string()
        },
      })
    }
    "remote" => {
      let target = server
        .url
        .clone()
        .filter(|url| !url.trim().is_empty())
        .ok_or_else(|| String::from("Remote MCP URL is required"))?;
      let response = Client::new()
        .get(target)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|error| error.to_string())?;

      Ok(OperationResult {
        ok: response.status().is_success() || response.status().is_redirection(),
        message: format!("Remote MCP endpoint responded with HTTP {}", response.status()),
      })
    }
    _ => Err(String::from("Unsupported MCP transport")),
  }
}

#[tauri::command]
async fn check_mcp_connectivity(server: McpServerRequest) -> Result<bool, String> {
  let result = test_mcp(server).await?;
  Ok(result.ok)
}

#[tauri::command]
async fn start_chat(window: Window, request: ChatRequest) -> Result<String, String> {
  let stream_id = request
    .stream_id
    .clone()
    .filter(|stream_id| !stream_id.trim().is_empty())
    .unwrap_or_else(|| Uuid::new_v4().to_string());
  let provider_type = request.provider.api_type.clone();
  let task_window = window.clone();
  let task_stream_id = stream_id.clone();

  tauri::async_runtime::spawn(async move {
    match provider_type.as_str() {
      "anthropic" => stream_anthropic(task_window, task_stream_id, request).await,
      "gemini" => stream_gemini(task_window, task_stream_id, request).await,
      _ => stream_openai(task_window, task_stream_id, request).await,
    }
  });

  Ok(stream_id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_notification::init())
    .setup(|app| {
      if let Some(main_window) = app.get_webview_window("main") {
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

      Ok(())
    })
    .on_window_event(|window, event| {
      handle_main_window_close(window, event);
      if should_persist_window_event(event) {
        let _ = persist_window_state(window);
      }
    })
    .invoke_handler(tauri::generate_handler![
      app_info,
      get_device_type,
      get_hostname,
      load_state,
      save_state,
      export_backup,
      save_file,
      pick_folder,
      get_obsidian_vaults,
      get_obsidian_files,
      open_path,
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
      test_provider,
      test_mcp,
      check_mcp_connectivity,
      start_chat,
      start_http_request,
      abort_http_request
    ])
    .build(tauri::generate_context!())
    .expect("failed to build lich13studio tauri runtime")
    .run(|app, event| {
      handle_run_event(app, &event);
    });
}
