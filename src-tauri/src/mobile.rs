use serde_json::Value;
use std::sync::atomic::AtomicU64;
#[cfg(target_os = "android")]
use std::sync::atomic::Ordering;
pub static TASK_EPOCH: AtomicU64 = AtomicU64::new(0);

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_com_lich13_studio_BackgroundService_cancelNativeTasks(
  _env: *mut std::ffi::c_void,
  _class: *mut std::ffi::c_void,
) {
  TASK_EPOCH.fetch_add(1, Ordering::SeqCst);
  if let Ok(registry) = crate::native_http_abort_registry().lock() {
    for flag in registry.values() {
      flag.store(true, Ordering::SeqCst);
    }
  }
}
use tauri::AppHandle;
#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(target_os = "android")]
struct MobilePlugin(tauri::plugin::PluginHandle<tauri::Wry>);

#[cfg(target_os = "android")]
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
  tauri::plugin::Builder::new("mobile-runtime")
    .setup(|app, api| {
      app.manage(MobilePlugin(api.register_android_plugin(
        "com.lich13.studio",
        "MobileRuntimePlugin",
      )?));
      Ok(())
    })
    .build()
}

// The Kotlin plugin is not exposed to arbitrary web origins. Renderer commands
// are routed through this allowlist and the main Tauri capability.
#[tauri::command]
pub async fn mobile_command(
  app: AppHandle,
  command: String,
  args: Option<Value>,
) -> Result<Value, String> {
  let allowed = [
    "readCredentials",
    "writeCredentials",
    "clearCredentials",
    "beginTask",
    "endTask",
    "stopTasks",
    "taskState",
    "notificationPermission",
    "background",
    "saveFile",
    "openUrl",
    "consumeImportIntent",
  ];
  if !allowed.contains(&command.as_str()) {
    return Err("Unsupported mobile operation".into());
  }
  #[cfg(target_os = "android")]
  {
    tauri::async_runtime::spawn_blocking(move || {
      let result: Value = app
        .state::<MobilePlugin>()
        .0
        .run_mobile_plugin(&command, args.unwrap_or_else(|| serde_json::json!({})))
        .map_err(|_| format!("Mobile operation failed: {command}"))?;
      if command == "beginTask" {
        Ok(serde_json::json!({"epoch": TASK_EPOCH.load(Ordering::SeqCst)}))
      } else {
        Ok(result)
      }
    })
    .await
    .map_err(|_| "Mobile task failed")?
  }
  #[cfg(not(target_os = "android"))]
  {
    let _ = (app, args);
    Err("Mobile operation unavailable".into())
  }
}

#[cfg(target_os = "android")]
mod commands {
  use super::*;
  use crate::CaptureWindowInfo;
  #[tauri::command]
  pub fn set_launch_on_boot(_enabled: bool) -> Result<bool, String> {
    Err("Desktop only".into())
  }
  #[tauri::command]
  pub fn is_launch_on_boot_enabled() -> bool {
    false
  }
  #[tauri::command]
  pub async fn save_file(
    app: AppHandle,
    file_name: String,
    bytes: Vec<u8>,
  ) -> Result<String, String> {
    let path = crate::files_dir()?.join(format!(
      "{}-{}",
      uuid::Uuid::new_v4(),
      std::path::Path::new(&file_name)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
    ));
    std::fs::write(&path, bytes).map_err(|_| "Could not stage export")?;
    let result = mobile_command(
      app,
      "saveFile".into(),
      Some(serde_json::json!({"path": path, "name": file_name})),
    )
    .await;
    let _ = std::fs::remove_file(&path);
    result.map(|value| value["uri"].as_str().unwrap_or_default().to_owned())
  }
  #[tauri::command]
  pub async fn pick_folder() -> Option<String> {
    None
  }
  #[tauri::command]
  pub async fn open_path(app: AppHandle, path: String) -> Result<bool, String> {
    mobile_command(
      app,
      "openUrl".into(),
      Some(serde_json::json!({"url": path})),
    )
    .await
    .map(|_| true)
  }
  #[tauri::command]
  pub async fn open_external_url(app: AppHandle, url: String) -> Result<bool, String> {
    let url = crate::normalize_external_url(&url)?;
    mobile_command(app, "openUrl".into(), Some(serde_json::json!({"url": url})))
      .await
      .map(|_| true)
  }
  #[tauri::command]
  pub fn list_capture_windows() -> Vec<CaptureWindowInfo> {
    Vec::new()
  }
  #[tauri::command]
  pub fn capture_window(_window_id: u32) -> Result<Vec<u8>, String> {
    Err("Desktop only".into())
  }
  #[tauri::command]
  pub fn show_main_window() {}
  #[tauri::command]
  pub fn show_mini_window() -> Result<(), String> {
    Err("Desktop only".into())
  }
  #[tauri::command]
  pub fn hide_mini_window() {}
  #[tauri::command]
  pub fn close_mini_window() {}
  #[tauri::command]
  pub fn toggle_mini_window() {}
  #[tauri::command]
  pub fn set_mini_window_pin(_is_pinned: bool) {}
}
#[cfg(target_os = "android")]
pub use commands::*;
