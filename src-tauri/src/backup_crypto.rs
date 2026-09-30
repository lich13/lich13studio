use aes_gcm::{
  aead::{rand_core::RngCore, Aead, AeadCore, KeyInit, OsRng, Payload},
  Aes256Gcm,
};
use argon2::{Algorithm, Argon2, Params, Version};
use zeroize::Zeroizing;

const MAGIC: &[u8] = b"LICH13BK\x01";
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;

fn cipher(password: &str, salt: &[u8]) -> Result<Aes256Gcm, String> {
  if password.is_empty() {
    return Err("Backup password is required".into());
  }
  let params = Params::new(65536, 3, 1, Some(32)).map_err(|_| "Invalid KDF parameters")?;
  let mut key = Zeroizing::new([0u8; 32]);
  Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
    .hash_password_into(password.as_bytes(), salt, key.as_mut())
    .map_err(|_| "Backup key derivation failed")?;
  Aes256Gcm::new_from_slice(key.as_ref()).map_err(|_| "Backup cipher initialization failed".into())
}

fn encrypt(bytes: &[u8], password: &str) -> Result<Vec<u8>, String> {
  let mut salt = [0u8; SALT_LEN];
  OsRng.fill_bytes(&mut salt);
  let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
  let mut header = MAGIC.to_vec();
  header.extend_from_slice(&salt);
  header.extend_from_slice(&nonce);
  let encrypted = cipher(password, &salt)?
    .encrypt(
      &nonce,
      Payload {
        msg: bytes,
        aad: &header,
      },
    )
    .map_err(|_| "Backup encryption failed")?;
  header.extend(encrypted);
  Ok(header)
}

fn decrypt(bytes: &[u8], password: &str) -> Result<Vec<u8>, String> {
  let header_len = MAGIC.len() + SALT_LEN + NONCE_LEN;
  if bytes.len() < header_len + 16 || !bytes.starts_with(MAGIC) {
    return Err("Invalid encrypted backup".into());
  }
  let salt = &bytes[MAGIC.len()..MAGIC.len() + SALT_LEN];
  let nonce = &bytes[MAGIC.len() + SALT_LEN..header_len];
  cipher(password, salt)?
    .decrypt(
      nonce.into(),
      Payload {
        msg: &bytes[header_len..],
        aad: &bytes[..header_len],
      },
    )
    .map_err(|_| "Incorrect password or damaged backup".into())
}

#[tauri::command]
pub async fn encrypt_backup(bytes: Vec<u8>, password: String) -> Result<Vec<u8>, String> {
  tauri::async_runtime::spawn_blocking(move || encrypt(&bytes, &Zeroizing::new(password)))
    .await
    .map_err(|_| "Backup encryption task failed")?
}

#[tauri::command]
pub async fn decrypt_backup(bytes: Vec<u8>, password: String) -> Result<Vec<u8>, String> {
  tauri::async_runtime::spawn_blocking(move || decrypt(&bytes, &Zeroizing::new(password)))
    .await
    .map_err(|_| "Backup decryption task failed")?
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn portable_authenticated_backups() {
    let bytes = br#"{"version":5,"key":"test-only-secret"}"#;
    let encrypted = encrypt(bytes, "test password").unwrap();
    assert_eq!(decrypt(&encrypted, "test password").unwrap(), bytes);
    assert!(!encrypted
      .windows(16)
      .any(|window| window == b"test-only-secret"));
    assert_ne!(encrypted, encrypt(bytes, "test password").unwrap());
    assert!(decrypt(&encrypted, "wrong password").is_err());
    let mut damaged = encrypted.clone();
    *damaged.last_mut().unwrap() ^= 1;
    assert!(decrypt(&damaged, "test password").is_err());
    assert!(decrypt(b"not a backup", "test password").is_err());
  }
}
