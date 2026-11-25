use serde_json::Value;
use std::sync::atomic::AtomicU64;
#[cfg(target_os = "android")]
use std::sync::atomic::Ordering;
pub static TASK_EPOCH: AtomicU64 = AtomicU64::new(0);

#[cfg(target_os = "android")]
static MOBILE_APP_HANDLE: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();
#[cfg(target_os = "android")]
static MAIN_WINDOW_DESTROYED: tokio::sync::Notify = tokio::sync::Notify::const_new();

#[cfg(target_os = "android")]
pub fn set_app_handle(app: AppHandle) {
    let _ = MOBILE_APP_HANDLE.set(app);
}

#[cfg(target_os = "android")]
pub fn notify_main_window_destroyed() {
    MAIN_WINDOW_DESTROYED.notify_waiters();
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_com_lich13_studio_MainActivity_recreateMainWindow(
    _env: *mut std::ffi::c_void,
    _class: *mut std::ffi::c_void,
) {
    tauri::async_runtime::spawn(async {
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        let app = loop {
            if let Some(app) = MOBILE_APP_HANDLE.get() {
                break app.clone();
            }
            if tokio::time::Instant::now() >= deadline {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        };
        while app.get_webview_window("main").is_some() {
            let notified = MAIN_WINDOW_DESTROYED.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if app.get_webview_window("main").is_none() {
                break;
            }
            if tokio::time::Instant::now() >= deadline {
                return;
            }
            let _ = tokio::time::timeout(std::time::Duration::from_millis(50), notified).await;
        }
        let _ = tauri::async_runtime::spawn_blocking(move || {
            if app.get_webview_window("main").is_none() {
                if let Some(config) = app.config().app.windows.iter().find(|w| w.label == "main") {
                    if let Ok(builder) = tauri::WebviewWindowBuilder::from_config(&app, config) {
                        let _ = builder.build();
                    }
                }
            }
        })
        .await;
    });
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_com_lich13_studio_BackgroundService_cancelNativeTasks(
    _env: *mut std::ffi::c_void,
    _class: *mut std::ffi::c_void,
) {
    TASK_EPOCH.fetch_add(1, Ordering::SeqCst);
    crate::cancel_all_http_requests();
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_com_lich13_studio_MainActivity_notifyProviderImportPending(
    _env: *mut std::ffi::c_void,
    _class: *mut std::ffi::c_void,
) {
    if let Some(app) = MOBILE_APP_HANDLE.get().cloned() {
        // Dispatch off the Android UI thread so Wry's bounded(8) MainPipe channel
        // cannot self-deadlock while the UI thread Looper is busy.
        tauri::async_runtime::spawn(async move {
            use tauri::Emitter;
            let _ = app.emit("provider-import-pending", ());
        });
    }
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_com_lich13_studio_MainActivity_notifyBackPressed(
    _env: *mut std::ffi::c_void,
    _class: *mut std::ffi::c_void,
) -> u8 {
    if let Some(app) = MOBILE_APP_HANDLE.get() {
        if app.get_webview_window("main").is_some() {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                use tauri::Emitter;
                let _ = app.emit("mobile-back-pressed", ());
            });
            return 1;
        }
    }
    0
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
        "takePendingImports",
        "taskState",
        "notificationPermission",
        "background",
        "saveFile",
        "openUrl",
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
    pub(crate) async fn save_staged_file(
        app: AppHandle,
        file_name: String,
        staged_path: &std::path::Path,
    ) -> Result<String, String> {
        let result = mobile_command(
            app,
            "saveFile".into(),
            Some(serde_json::json!({"path": staged_path, "name": file_name})),
        )
        .await;
        let _ = std::fs::remove_file(staged_path);
        result.map(|value| value["uri"].as_str().unwrap_or_default().to_owned())
    }
    pub(crate) async fn save_file_bytes(
        app: AppHandle,
        file_name: String,
        bytes: Vec<u8>,
    ) -> Result<String, String> {
        let export_dir = app
            .path()
            .app_cache_dir()
            .map_err(|_| String::from("Could not resolve cache directory"))?
            .join("exports");
        std::fs::create_dir_all(&export_dir).map_err(|_| String::from("Could not stage export"))?;
        let path = export_dir.join(format!(
            "{}-{}",
            uuid::Uuid::new_v4(),
            std::path::Path::new(&file_name)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
        ));
        let path_for_write = path.clone();
        tauri::async_runtime::spawn_blocking(move || {
            std::fs::write(&path_for_write, bytes)
                .map_err(|_| String::from("Could not stage export"))
        })
        .await
        .map_err(|_| String::from("Stage export task failed"))??;
        save_staged_file(app, file_name, &path).await
    }
    #[tauri::command]
    pub async fn save_file(
        app: AppHandle,
        request: tauri::ipc::Request<'_>,
    ) -> Result<String, String> {
        let file_name = crate::extract_decoded_header(request.headers(), "x-file-name")?;
        let bytes = crate::extract_raw_ipc_bytes(&request)?;
        save_file_bytes(app, file_name, bytes).await
    }
    #[tauri::command]
    pub async fn pick_folder() -> Option<String> {
        None
    }
    #[tauri::command]
    pub async fn open_path(app: AppHandle, path: String) -> Result<bool, String> {
        // Android cannot hand app-private paths to other apps; only allowed URLs open.
        let url = crate::normalize_external_url(&path)?;
        mobile_command(app, "openUrl".into(), Some(serde_json::json!({"url": url})))
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
    pub async fn list_capture_windows() -> Vec<CaptureWindowInfo> {
        Vec::new()
    }
    #[tauri::command]
    pub async fn capture_window(_window_id: u32) -> Result<tauri::ipc::Response, String> {
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
