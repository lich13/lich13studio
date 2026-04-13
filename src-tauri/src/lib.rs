use futures_util::StreamExt;
use image::codecs::png::PngEncoder;
use image::{ColorType, ImageEncoder};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use reqwest::Client;
use roxmltree::Document;
use rusty_s3::actions::ListObjectsV2;
use rusty_s3::{Bucket, Credentials, S3Action, UrlStyle};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::Cursor;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Window};
use tokio::process::Command;
use url::Url;
use uuid::Uuid;
use xcap::Window as CaptureWindow;

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
  fn CGPreflightScreenCaptureAccess() -> bool;
  fn CGRequestScreenCaptureAccess() -> bool;
}

const APP_NAME: &str = "lich13studio";
const BUNDLE_ID: &str = "com.lich13.studio";
const DEFAULT_STATE_FILE: &str = "state.json";

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
struct BackupWebDavConfig {
  url: String,
  username: String,
  password: String,
  file_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupS3Config {
  endpoint: String,
  region: String,
  bucket: String,
  access_key: String,
  secret_key: String,
  object_key: String,
  root: Option<String>,
  path_style: bool,
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
struct CaptureWindowInfo {
  id: u32,
  app_name: String,
  title: String,
  width: u32,
  height: u32,
  is_focused: bool,
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

fn normalize_base_url(url: &str) -> String {
  url.trim_end_matches('/').to_string()
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

async fn upload_webdav(config: &BackupWebDavConfig, payload: String) -> Result<String, String> {
  let client = Client::new();
  let file_name = config
    .file_name
    .clone()
    .filter(|file_name| !file_name.trim().is_empty())
    .unwrap_or_else(|| String::from("lich13studio-backup.json"));
  let target = format!("{}/{}", normalize_base_url(&config.url), file_name);

  client
    .put(&target)
    .basic_auth(&config.username, Some(&config.password))
    .header(CONTENT_TYPE, "application/json")
    .body(payload)
    .send()
    .await
    .map_err(|error| error.to_string())?
    .error_for_status()
    .map_err(|error| error.to_string())?;

  Ok(target)
}

async fn download_webdav(config: &BackupWebDavConfig) -> Result<Value, String> {
  let client = Client::new();
  let file_name = config
    .file_name
    .clone()
    .filter(|file_name| !file_name.trim().is_empty())
    .unwrap_or_else(|| String::from("lich13studio-backup.json"));
  let target = format!("{}/{}", normalize_base_url(&config.url), file_name);

  let payload = client
    .get(&target)
    .basic_auth(&config.username, Some(&config.password))
    .send()
    .await
    .map_err(|error| error.to_string())?
    .error_for_status()
    .map_err(|error| error.to_string())?
    .text()
    .await
    .map_err(|error| error.to_string())?;

  serde_json::from_str(&payload).map_err(|error| error.to_string())
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

  let response = client
    .request(reqwest::Method::from_bytes(b"PROPFIND").map_err(|error| error.to_string())?, &target)
    .basic_auth(&config.username, Some(&config.password))
    .header("Depth", "1")
    .header(CONTENT_TYPE, "application/xml")
    .body(body.to_string())
    .send()
    .await
    .map_err(|error| error.to_string())?
    .error_for_status()
    .map_err(|error| error.to_string())?;

  let payload = response.text().await.map_err(|error| error.to_string())?;
  parse_webdav_listing(&payload)
}

async fn delete_webdav(config: &BackupWebDavConfig, file_name: &str) -> Result<bool, String> {
  let client = Client::new();
  let target = format!("{}/{}", normalize_base_url(&config.url), file_name);

  client
    .delete(target)
    .basic_auth(&config.username, Some(&config.password))
    .send()
    .await
    .map_err(|error| error.to_string())?
    .error_for_status()
    .map_err(|error| error.to_string())?;

  Ok(true)
}

async fn upload_s3(config: &BackupS3Config, payload: String) -> Result<String, String> {
  let endpoint = Url::parse(&config.endpoint).map_err(|error| error.to_string())?;
  let bucket_name: &'static str = Box::leak(config.bucket.clone().into_boxed_str());
  let region: &'static str = Box::leak(config.region.clone().into_boxed_str());
  let object_key = config.object_key.clone();
  let bucket = Bucket::new(
    endpoint,
    if config.path_style { UrlStyle::Path } else { UrlStyle::VirtualHost },
    bucket_name,
    region,
  )
  .map_err(|error| error.to_string())?;
  let credentials = Credentials::new(&config.access_key, &config.secret_key);
  let action = bucket.put_object(Some(&credentials), &object_key);
  let signed = action.sign(Duration::from_secs(900));
  let client = Client::new();

  client
    .put(signed.as_str())
    .header(CONTENT_TYPE, "application/json")
    .body(payload)
    .send()
    .await
    .map_err(|error| error.to_string())?
    .error_for_status()
    .map_err(|error| error.to_string())?;

  Ok(format!("{}/{}", config.bucket, object_key))
}

async fn download_s3(config: &BackupS3Config) -> Result<Value, String> {
  let endpoint = Url::parse(&config.endpoint).map_err(|error| error.to_string())?;
  let bucket_name: &'static str = Box::leak(config.bucket.clone().into_boxed_str());
  let region: &'static str = Box::leak(config.region.clone().into_boxed_str());
  let object_key = config.object_key.clone();
  let bucket = Bucket::new(
    endpoint,
    if config.path_style { UrlStyle::Path } else { UrlStyle::VirtualHost },
    bucket_name,
    region,
  )
  .map_err(|error| error.to_string())?;
  let credentials = Credentials::new(&config.access_key, &config.secret_key);
  let action = bucket.get_object(Some(&credentials), &object_key);
  let signed = action.sign(Duration::from_secs(900));
  let client = Client::new();

  let payload = client
    .get(signed.as_str())
    .send()
    .await
    .map_err(|error| error.to_string())?
    .error_for_status()
    .map_err(|error| error.to_string())?
    .text()
    .await
    .map_err(|error| error.to_string())?;

  serde_json::from_str(&payload).map_err(|error| error.to_string())
}

async fn list_s3(config: &BackupS3Config) -> Result<Vec<RemoteBackupFileInfo>, String> {
  let endpoint = Url::parse(&config.endpoint).map_err(|error| error.to_string())?;
  let bucket_name: &'static str = Box::leak(config.bucket.clone().into_boxed_str());
  let region: &'static str = Box::leak(config.region.clone().into_boxed_str());
  let bucket = Bucket::new(
    endpoint,
    if config.path_style { UrlStyle::Path } else { UrlStyle::VirtualHost },
    bucket_name,
    region,
  )
  .map_err(|error| error.to_string())?;
  let credentials = Credentials::new(&config.access_key, &config.secret_key);
  let mut action = bucket.list_objects_v2(Some(&credentials));
  if let Some(root) = config.root.as_ref().filter(|root| !root.trim().is_empty()) {
    action.with_prefix(root.clone());
  }
  let signed = action.sign(Duration::from_secs(900));
  let client = Client::new();

  let payload = client
    .get(signed.as_str())
    .send()
    .await
    .map_err(|error| error.to_string())?
    .error_for_status()
    .map_err(|error| error.to_string())?
    .text()
    .await
    .map_err(|error| error.to_string())?;

  let parsed = ListObjectsV2::parse_response(&payload).map_err(|error| error.to_string())?;
  let root_prefix = config.root.clone().unwrap_or_default();

  Ok(
    parsed
      .contents
      .into_iter()
      .map(|item| {
        let file_name = if !root_prefix.is_empty() && item.key.starts_with(&root_prefix) {
          item.key[root_prefix.len()..].trim_start_matches('/').to_string()
        } else {
          item.key.rsplit('/').next().unwrap_or(&item.key).to_string()
        };

        RemoteBackupFileInfo {
          file_name,
          modified_time: item.last_modified,
          size: item.size,
        }
      })
      .filter(|item| !item.file_name.is_empty())
      .collect(),
  )
}

async fn delete_s3(config: &BackupS3Config, file_name: &str) -> Result<bool, String> {
  let endpoint = Url::parse(&config.endpoint).map_err(|error| error.to_string())?;
  let bucket_name: &'static str = Box::leak(config.bucket.clone().into_boxed_str());
  let region: &'static str = Box::leak(config.region.clone().into_boxed_str());
  let bucket = Bucket::new(
    endpoint,
    if config.path_style { UrlStyle::Path } else { UrlStyle::VirtualHost },
    bucket_name,
    region,
  )
  .map_err(|error| error.to_string())?;
  let credentials = Credentials::new(&config.access_key, &config.secret_key);
  let object_key = if let Some(root) = config.root.as_ref().filter(|root| !root.trim().is_empty()) {
    format!("{}/{}", root.trim_end_matches('/'), file_name)
  } else {
    file_name.to_string()
  };
  let action = bucket.delete_object(Some(&credentials), &object_key);
  let signed = action.sign(Duration::from_secs(900));
  let client = Client::new();

  client
    .delete(signed.as_str())
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
fn load_state() -> Result<Value, String> {
  load_state_file()
}

#[tauri::command]
fn save_state(state: Value) -> Result<String, String> {
  save_state_file(&state)
}

#[tauri::command]
fn export_backup(state: Value) -> Result<String, String> {
  let path = downloads_dir()?.join(format!("lich13studio-backup-{}.json", timestamp_tag()));
  let payload = serde_json::to_vec_pretty(&state).map_err(|error| error.to_string())?;
  fs::write(&path, payload).map_err(|error| error.to_string())?;
  Ok(path.display().to_string())
}

#[tauri::command]
async fn webdav_backup(state: Value, config: BackupWebDavConfig) -> Result<String, String> {
  let payload = serde_json::to_string_pretty(&state).map_err(|error| error.to_string())?;
  upload_webdav(&config, payload).await
}

#[tauri::command]
async fn webdav_restore(config: BackupWebDavConfig) -> Result<Value, String> {
  download_webdav(&config).await
}

#[tauri::command]
async fn s3_backup(state: Value, config: BackupS3Config) -> Result<String, String> {
  let payload = serde_json::to_string_pretty(&state).map_err(|error| error.to_string())?;
  upload_s3(&config, payload).await
}

#[tauri::command]
async fn s3_restore(config: BackupS3Config) -> Result<Value, String> {
  download_s3(&config).await
}

#[tauri::command]
async fn pick_folder() -> Result<Option<String>, String> {
  let handle = rfd::AsyncFileDialog::new().pick_folder().await;
  Ok(handle.map(|path| path.path().display().to_string()))
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
async fn backup_to_local_dir(file_name: String, local_backup_dir: Option<String>, payload: String) -> Result<bool, String> {
  let base_dir = local_backup_dir
    .map(PathBuf::from)
    .unwrap_or(downloads_dir()?);

  fs::create_dir_all(&base_dir).map_err(|error| error.to_string())?;
  let file_path = base_dir.join(file_name);
  fs::write(file_path, payload).map_err(|error| error.to_string())?;
  Ok(true)
}

#[tauri::command]
async fn restore_from_local_backup(file_name: String, local_backup_dir: Option<String>) -> Result<String, String> {
  let base_dir = local_backup_dir
    .map(PathBuf::from)
    .unwrap_or(downloads_dir()?);
  let file_path = base_dir.join(file_name);
  fs::read_to_string(file_path).map_err(|error| error.to_string())
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
    if !file_name.starts_with("cherry-studio.") && !file_name.starts_with("lich13studio") {
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
async fn delete_webdav_file(file_name: String, config: BackupWebDavConfig) -> Result<bool, String> {
  delete_webdav(&config, &file_name).await
}

#[tauri::command]
async fn list_s3_files(config: BackupS3Config) -> Result<Vec<RemoteBackupFileInfo>, String> {
  list_s3(&config).await
}

#[tauri::command]
async fn delete_s3_file(file_name: String, config: BackupS3Config) -> Result<bool, String> {
  delete_s3(&config, &file_name).await
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
    .invoke_handler(tauri::generate_handler![
      app_info,
      load_state,
      save_state,
      export_backup,
      pick_folder,
      open_path,
      list_capture_windows,
      capture_window,
      backup_to_local_dir,
      restore_from_local_backup,
      list_local_backup_files,
      delete_local_backup_file,
      list_webdav_files,
      delete_webdav_file,
      list_s3_files,
      delete_s3_file,
      webdav_backup,
      webdav_restore,
      s3_backup,
      s3_restore,
      test_provider,
      test_mcp,
      check_mcp_connectivity,
      start_chat
    ])
    .run(tauri::generate_context!())
    .expect("failed to run lich13studio tauri runtime");
}
