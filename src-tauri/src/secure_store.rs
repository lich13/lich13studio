//! Desktop credential storage in an isolated local JSON file (`credentials.json`)
//! under `app_data_dir()`, outside `Data/` so unencrypted `.zip` backups never
//! bundle credentials and macOS ad-hoc reinstalls never trigger Keychain prompts.

use serde_json::{Map, Value};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const CREDENTIALS_FILE_NAME: &str = "credentials.json";

static LOCK: Mutex<()> = Mutex::new(());

fn credentials_path() -> Result<PathBuf, String> {
    Ok(crate::app_data_dir()?.join(CREDENTIALS_FILE_NAME))
}

pub fn read_map_at(path: &Path) -> Result<Map<String, Value>, String> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Map::new()),
        Err(_) => return Err(String::from("Secure credential store is unavailable")),
    };
    match serde_json::from_str(&raw) {
        Ok(Value::Object(map)) => Ok(map),
        _ => Err(String::from("Secure credential store is invalid")),
    }
}

fn write_map_at(path: &Path, map: &Map<String, Value>) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| String::from("Invalid credential store path"))?;
    fs::create_dir_all(parent)
        .map_err(|_| String::from("Secure credential store is unavailable"))?;

    let payload = serde_json::to_vec(&Value::Object(map.clone()))
        .map_err(|_| String::from("Secure credential store operation failed"))?;
    let temp_path = parent.join(format!(
        ".{CREDENTIALS_FILE_NAME}.tmp-{}",
        uuid::Uuid::new_v4().simple()
    ));

    let write_result = (|| -> io::Result<()> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp_path)?;
        file.write_all(&payload)?;
        file.sync_all()?;
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
        return Err(String::from("Secure credential store operation failed"));
    }

    if fs::rename(&temp_path, path).is_err() {
        let _ = fs::remove_file(&temp_path);
        return Err(String::from("Secure credential store operation failed"));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }

    Ok(())
}

/// `replace == false` merges entries into the stored object so concurrent windows
/// never drop each other's references; `replace == true` prunes to `entries`.
pub fn write_entries_at(
    path: &Path,
    entries: Map<String, Value>,
    replace: bool,
) -> Result<(), String> {
    let map = if replace {
        entries
    } else {
        let mut current = read_map_at(path)?;
        current.extend(entries);
        current
    };
    write_map_at(path, &map)
}

pub fn clear_at(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(String::from("Secure credential store operation failed")),
    }
}

#[cfg(not(target_os = "android"))]
async fn with_store_path<T: Send + 'static>(
    action: impl FnOnce(&Path) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let path = credentials_path()?;
        action(&path)
    })
    .await
    .map_err(|_| String::from("Secure credential store operation failed"))?
}

#[cfg(target_os = "android")]
async fn with_store_path<T: Send + 'static>(
    _action: impl FnOnce(&Path) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let _ = (&LOCK, credentials_path);
    Err(String::from(
        "Android uses the Keystore-backed mobile store",
    ))
}

#[tauri::command]
pub async fn read_secure_credentials() -> Result<String, String> {
    with_store_path(|path| read_map_at(path).map(|map| Value::Object(map).to_string())).await
}

#[tauri::command]
pub async fn write_secure_credentials(value: String, replace: bool) -> Result<(), String> {
    let entries = match serde_json::from_str(&value) {
        Ok(Value::Object(map)) => map,
        _ => return Err(String::from("Invalid credential payload")),
    };
    with_store_path(move |path| write_entries_at(path, entries, replace)).await
}

#[tauri::command]
pub async fn clear_secure_credentials() -> Result<(), String> {
    with_store_path(clear_at).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store_path(name: &str) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "lich13-cred-test-{name}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join(CREDENTIALS_FILE_NAME);
        (dir, file)
    }

    fn map(value: Value) -> Map<String, Value> {
        value.as_object().unwrap().clone()
    }

    #[test]
    fn round_trips_large_maps_in_single_0600_file() {
        let (dir, path) = temp_store_path("roundtrip");
        assert!(read_map_at(&path).unwrap().is_empty());

        let secret = "k".repeat(4096);
        write_entries_at(
            &path,
            map(serde_json::json!({"ref:a": secret, "ref:b": {"X-Auth": "token"}})),
            true,
        )
        .unwrap();

        let stored = read_map_at(&path).unwrap();
        assert_eq!(stored["ref:a"], Value::String(secret));
        assert_eq!(stored["ref:b"], serde_json::json!({"X-Auth": "token"}));

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }

        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name() != CREDENTIALS_FILE_NAME)
            .collect();
        assert!(leftovers.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn merge_keeps_existing_refs_and_replace_prunes() {
        let (dir, path) = temp_store_path("merge");
        write_entries_at(&path, map(serde_json::json!({"a": "1"})), false).unwrap();
        write_entries_at(&path, map(serde_json::json!({"b": "2"})), false).unwrap();
        assert_eq!(read_map_at(&path).unwrap().len(), 2);

        write_entries_at(&path, map(serde_json::json!({"b": "2"})), true).unwrap();
        assert_eq!(
            read_map_at(&path).unwrap(),
            map(serde_json::json!({"b": "2"}))
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn clear_removes_file_and_is_idempotent() {
        let (dir, path) = temp_store_path("clear");
        write_entries_at(&path, map(serde_json::json!({"a": "1"})), true).unwrap();
        clear_at(&path).unwrap();
        clear_at(&path).unwrap();
        assert!(!path.exists());
        assert!(read_map_at(&path).unwrap().is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn invalid_json_file_is_an_error_not_an_empty_map() {
        let (dir, path) = temp_store_path("invalid");
        fs::write(&path, b"not-json").unwrap();
        assert!(read_map_at(&path).is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
