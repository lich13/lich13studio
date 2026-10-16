//! Desktop credential storage in the OS credential store (macOS Keychain,
//! Windows Credential Manager, Linux Secret Service).
//!
//! The renderer keeps one JSON object of `ref -> secret`. Windows limits a single
//! credential blob to 2560 bytes, so the object is split into chunks written under
//! a fresh generation and only then published through a manifest entry. A failed
//! or interrupted write leaves the previous generation readable.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::sync::Mutex;

const MANIFEST_KEY: &str = "manifest";
const CHUNK_CHARS: usize = 1000;

pub trait SecretBackend {
    fn get(&self, key: &str) -> Result<Option<String>, String>;
    fn set(&self, key: &str, value: &str) -> Result<(), String>;
    fn delete(&self, key: &str) -> Result<(), String>;
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
struct Manifest {
    generation: String,
    chunks: usize,
}

fn chunk_key(generation: &str, index: usize) -> String {
    format!("{generation}.{index}")
}

fn read_manifest(backend: &dyn SecretBackend) -> Result<Option<Manifest>, String> {
    backend
        .get(MANIFEST_KEY)?
        .map(|raw| {
            serde_json::from_str(&raw)
                .map_err(|_| String::from("Secure credential store is invalid"))
        })
        .transpose()
}

pub fn read_map(backend: &dyn SecretBackend) -> Result<Map<String, Value>, String> {
    let Some(manifest) = read_manifest(backend)? else {
        return Ok(Map::new());
    };
    let mut raw = String::new();
    for index in 0..manifest.chunks {
        raw.push_str(
            &backend
                .get(&chunk_key(&manifest.generation, index))?
                .ok_or_else(|| String::from("Secure credential store is incomplete"))?,
        );
    }
    match serde_json::from_str(&raw) {
        Ok(Value::Object(map)) => Ok(map),
        _ => Err(String::from("Secure credential store is invalid")),
    }
}

fn write_map(backend: &dyn SecretBackend, map: &Map<String, Value>) -> Result<(), String> {
    let previous = read_manifest(backend)?;
    let raw = Value::Object(map.clone()).to_string();
    let chars: Vec<char> = raw.chars().collect();
    let generation = uuid::Uuid::new_v4().simple().to_string();
    let chunks: Vec<String> = chars
        .chunks(CHUNK_CHARS)
        .map(|chunk| chunk.iter().collect())
        .collect();
    for (index, chunk) in chunks.iter().enumerate() {
        if let Err(error) = backend.set(&chunk_key(&generation, index), chunk) {
            for written in 0..index {
                let _ = backend.delete(&chunk_key(&generation, written));
            }
            return Err(error);
        }
    }
    let manifest = Manifest {
        generation,
        chunks: chunks.len(),
    };
    backend.set(
        MANIFEST_KEY,
        &serde_json::to_string(&manifest).map_err(|error| error.to_string())?,
    )?;
    if let Some(previous) = previous {
        for index in 0..previous.chunks {
            let _ = backend.delete(&chunk_key(&previous.generation, index));
        }
    }
    Ok(())
}

/// `replace == false` merges entries into the stored object so concurrent windows
/// never drop each other's references; `replace == true` prunes to `entries`.
pub fn write_entries(
    backend: &dyn SecretBackend,
    entries: Map<String, Value>,
    replace: bool,
) -> Result<(), String> {
    let map = if replace {
        entries
    } else {
        let mut current = read_map(backend)?;
        current.extend(entries);
        current
    };
    write_map(backend, &map)
}

pub fn clear(backend: &dyn SecretBackend) -> Result<(), String> {
    if let Some(manifest) = read_manifest(backend)? {
        backend.delete(MANIFEST_KEY)?;
        for index in 0..manifest.chunks {
            let _ = backend.delete(&chunk_key(&manifest.generation, index));
        }
    }
    Ok(())
}

static LOCK: Mutex<()> = Mutex::new(());

#[cfg(not(target_os = "android"))]
mod platform {
    use super::SecretBackend;

    const SERVICE: &str = "com.lich13.studio.credentials";

    pub struct KeyringBackend;

    // Errors never include credential values; only the platform failure kind.
    fn describe(error: keyring::Error) -> String {
        match error {
            keyring::Error::PlatformFailure(_) | keyring::Error::NoStorageAccess(_) => {
                String::from("Secure credential store is unavailable")
            }
            _ => String::from("Secure credential store operation failed"),
        }
    }

    impl SecretBackend for KeyringBackend {
        fn get(&self, key: &str) -> Result<Option<String>, String> {
            match keyring::Entry::new(SERVICE, key)
                .map_err(describe)?
                .get_password()
            {
                Ok(value) => Ok(Some(value)),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(error) => Err(describe(error)),
            }
        }
        fn set(&self, key: &str, value: &str) -> Result<(), String> {
            keyring::Entry::new(SERVICE, key)
                .map_err(describe)?
                .set_password(value)
                .map_err(describe)
        }
        fn delete(&self, key: &str) -> Result<(), String> {
            match keyring::Entry::new(SERVICE, key)
                .map_err(describe)?
                .delete_credential()
            {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(error) => Err(describe(error)),
            }
        }
    }
}

#[cfg(not(target_os = "android"))]
async fn with_backend<T: Send + 'static>(
    action: impl FnOnce(&dyn SecretBackend) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        action(&platform::KeyringBackend)
    })
    .await
    .map_err(|_| String::from("Secure credential store operation failed"))?
}

#[cfg(target_os = "android")]
async fn with_backend<T: Send + 'static>(
    _action: impl FnOnce(&dyn SecretBackend) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let _ = &LOCK;
    Err(String::from(
        "Android uses the Keystore-backed mobile store",
    ))
}

#[tauri::command]
pub async fn read_secure_credentials() -> Result<String, String> {
    with_backend(|backend| read_map(backend).map(|map| Value::Object(map).to_string())).await
}

#[tauri::command]
pub async fn write_secure_credentials(value: String, replace: bool) -> Result<(), String> {
    let entries = match serde_json::from_str(&value) {
        Ok(Value::Object(map)) => map,
        _ => return Err(String::from("Invalid credential payload")),
    };
    with_backend(move |backend| write_entries(backend, entries, replace)).await
}

#[tauri::command]
pub async fn clear_secure_credentials() -> Result<(), String> {
    with_backend(clear).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::BTreeMap;

    #[derive(Default)]
    struct MemoryBackend {
        entries: RefCell<BTreeMap<String, String>>,
        fail_set_after: RefCell<Option<usize>>,
    }

    impl SecretBackend for MemoryBackend {
        fn get(&self, key: &str) -> Result<Option<String>, String> {
            Ok(self.entries.borrow().get(key).cloned())
        }
        fn set(&self, key: &str, value: &str) -> Result<(), String> {
            let mut remaining = self.fail_set_after.borrow_mut();
            if let Some(count) = remaining.as_mut() {
                if *count == 0 {
                    return Err("unavailable".into());
                }
                *count -= 1;
            }
            self.entries
                .borrow_mut()
                .insert(key.to_owned(), value.to_owned());
            Ok(())
        }
        fn delete(&self, key: &str) -> Result<(), String> {
            self.entries.borrow_mut().remove(key);
            Ok(())
        }
    }

    fn map(value: Value) -> Map<String, Value> {
        value.as_object().unwrap().clone()
    }

    #[test]
    fn round_trips_large_maps_across_chunks() {
        let backend = MemoryBackend::default();
        assert!(read_map(&backend).unwrap().is_empty());
        let secret = "k".repeat(CHUNK_CHARS * 3 + 7);
        write_entries(
            &backend,
            map(serde_json::json!({"ref:a": secret, "ref:b": {"X": "y"}})),
            true,
        )
        .unwrap();
        let stored = read_map(&backend).unwrap();
        assert_eq!(stored["ref:a"], Value::String(secret));
        assert!(backend.entries.borrow().len() > 3);
        assert!(backend
            .entries
            .borrow()
            .values()
            .all(|v| v.chars().count() <= CHUNK_CHARS));
    }

    #[test]
    fn merge_keeps_existing_refs_and_replace_prunes() {
        let backend = MemoryBackend::default();
        write_entries(&backend, map(serde_json::json!({"a": "1"})), false).unwrap();
        write_entries(&backend, map(serde_json::json!({"b": "2"})), false).unwrap();
        assert_eq!(read_map(&backend).unwrap().len(), 2);
        write_entries(&backend, map(serde_json::json!({"b": "2"})), true).unwrap();
        assert_eq!(
            read_map(&backend).unwrap(),
            map(serde_json::json!({"b": "2"}))
        );
        // Old generations are removed after publishing a new manifest.
        assert_eq!(backend.entries.borrow().len(), 2);
    }

    #[test]
    fn failed_write_keeps_previous_generation() {
        let backend = MemoryBackend::default();
        write_entries(&backend, map(serde_json::json!({"a": "old"})), true).unwrap();
        let before = backend.entries.borrow().clone();
        *backend.fail_set_after.borrow_mut() = Some(1);
        let big = "n".repeat(CHUNK_CHARS * 2);
        assert!(write_entries(&backend, map(serde_json::json!({"a": big})), true).is_err());
        assert_eq!(*backend.entries.borrow(), before);
        assert_eq!(read_map(&backend).unwrap()["a"], "old");
    }

    #[test]
    fn clear_removes_everything_and_is_idempotent() {
        let backend = MemoryBackend::default();
        write_entries(&backend, map(serde_json::json!({"a": "1"})), true).unwrap();
        clear(&backend).unwrap();
        clear(&backend).unwrap();
        assert!(backend.entries.borrow().is_empty());
        assert!(read_map(&backend).unwrap().is_empty());
    }

    #[test]
    fn incomplete_store_is_an_error_not_an_empty_map() {
        let backend = MemoryBackend::default();
        write_entries(&backend, map(serde_json::json!({"a": "1"})), true).unwrap();
        let chunk = backend
            .entries
            .borrow()
            .keys()
            .find(|key| key.as_str() != MANIFEST_KEY)
            .cloned()
            .unwrap();
        backend.entries.borrow_mut().remove(&chunk);
        assert!(read_map(&backend).is_err());
    }
}
