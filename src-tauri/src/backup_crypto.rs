use aes_gcm::{
    aead::{rand_core::RngCore, AeadCore, AeadInPlace, KeyInit, OsRng},
    Aes256Gcm, Nonce, Tag,
};
use argon2::{Algorithm, Argon2, Params, Version};
use zeroize::Zeroizing;

const MAGIC: &[u8] = b"LICH13BK\x01";
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;

fn cipher(password: &str, salt: &[u8]) -> Result<Aes256Gcm, String> {
    if password.is_empty() {
        return Err("Backup password is required".into());
    }
    let params = Params::new(65536, 3, 1, Some(32)).map_err(|_| "Invalid KDF parameters")?;
    let mut key = Zeroizing::new([0u8; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, key.as_mut())
        .map_err(|_| "Backup key derivation failed")?;
    Aes256Gcm::new_from_slice(key.as_ref())
        .map_err(|_| "Backup cipher initialization failed".into())
}

pub(crate) fn encrypt_owned(mut bytes: Vec<u8>, password: &str) -> Result<Vec<u8>, String> {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let header_len = MAGIC.len() + SALT_LEN + NONCE_LEN;
    let msg_len = bytes.len();
    bytes.reserve_exact(header_len + TAG_LEN);

    let mut header = [0u8; MAGIC.len() + SALT_LEN + NONCE_LEN];
    header[..MAGIC.len()].copy_from_slice(MAGIC);
    header[MAGIC.len()..MAGIC.len() + SALT_LEN].copy_from_slice(&salt);
    header[MAGIC.len() + SALT_LEN..].copy_from_slice(&nonce);

    let tag = cipher(password, &salt)?
        .encrypt_in_place_detached(&nonce, &header, &mut bytes[..msg_len])
        .map_err(|_| "Backup encryption failed")?;
    bytes.splice(0..0, header);
    bytes.extend_from_slice(&tag);
    Ok(bytes)
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn encrypt(bytes: &[u8], password: &str) -> Result<Vec<u8>, String> {
    encrypt_owned(bytes.to_vec(), password)
}

pub(crate) fn decrypt_owned(mut bytes: Vec<u8>, password: &str) -> Result<Vec<u8>, String> {
    let header_len = MAGIC.len() + SALT_LEN + NONCE_LEN;
    if bytes.len() < header_len + TAG_LEN || !bytes.starts_with(MAGIC) {
        return Err("Invalid encrypted backup".into());
    }
    let tag_offset = bytes.len() - TAG_LEN;
    let tag = Tag::clone_from_slice(&bytes[tag_offset..]);
    bytes.truncate(tag_offset);

    let (header, ciphertext) = bytes.split_at_mut(header_len);
    let salt = &header[MAGIC.len()..MAGIC.len() + SALT_LEN];
    let nonce = Nonce::from_slice(&header[MAGIC.len() + SALT_LEN..header_len]);
    cipher(password, salt)?
        .decrypt_in_place_detached(nonce, header, ciphertext, &tag)
        .map_err(|_| "Incorrect password or damaged backup")?;
    bytes.drain(..header_len);
    Ok(bytes)
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn decrypt(bytes: &[u8], password: &str) -> Result<Vec<u8>, String> {
    decrypt_owned(bytes.to_vec(), password)
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
