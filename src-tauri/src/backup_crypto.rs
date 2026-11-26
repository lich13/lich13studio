use aes_gcm::{
    aead::{rand_core::RngCore, AeadCore, AeadInPlace, KeyInit, OsRng},
    Aes256Gcm, Nonce, Tag,
};
use argon2::{Algorithm, Argon2, Params, Version};
use zeroize::Zeroizing;

pub(crate) const MAGIC: &[u8] = b"LICH13BK\x01";
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;
pub(crate) const HEADER_LEN: usize = MAGIC.len() + SALT_LEN + NONCE_LEN;
pub(crate) const MIN_ENCRYPTED_LEN: usize = HEADER_LEN + TAG_LEN;

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

/// Encrypts a buffer whose first `HEADER_LEN` bytes were reserved for the
/// `LICH13BK\x01 || salt || nonce` header, avoiding any `splice(0..0, ...)` memmove.
pub(crate) fn encrypt_prefixed_in_place(
    prefixed_bytes: &mut Vec<u8>,
    password: &str,
) -> Result<(), String> {
    if prefixed_bytes.len() < HEADER_LEN {
        return Err("Invalid pre-allocated backup buffer".into());
    }
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    prefixed_bytes.reserve_exact(TAG_LEN);

    let (header, plaintext) = prefixed_bytes.split_at_mut(HEADER_LEN);
    header[..MAGIC.len()].copy_from_slice(MAGIC);
    header[MAGIC.len()..MAGIC.len() + SALT_LEN].copy_from_slice(&salt);
    header[MAGIC.len() + SALT_LEN..].copy_from_slice(&nonce);

    let tag = cipher(password, &salt)?
        .encrypt_in_place_detached(&nonce, header, plaintext)
        .map_err(|_| "Backup encryption failed")?;
    prefixed_bytes.extend_from_slice(&tag);
    Ok(())
}

#[cfg(test)]
pub(crate) fn encrypt(bytes: &[u8], password: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(HEADER_LEN + bytes.len() + TAG_LEN);
    out.resize(HEADER_LEN, 0);
    out.extend_from_slice(bytes);
    encrypt_prefixed_in_place(&mut out, password)?;
    Ok(out)
}

/// Decrypts an encrypted backup slice in-place and returns the authenticated
/// plaintext slice `&bytes[HEADER_LEN..tag_offset]` without any `drain(..HEADER_LEN)` memmove.
pub(crate) fn decrypt_in_place<'a>(
    bytes: &'a mut [u8],
    password: &str,
) -> Result<&'a [u8], String> {
    if bytes.len() < HEADER_LEN + TAG_LEN || !bytes.starts_with(MAGIC) {
        return Err("Invalid encrypted backup".into());
    }
    let tag_offset = bytes.len() - TAG_LEN;
    let tag = Tag::clone_from_slice(&bytes[tag_offset..]);

    let (header, ciphertext) = bytes[..tag_offset].split_at_mut(HEADER_LEN);
    let salt = &header[MAGIC.len()..MAGIC.len() + SALT_LEN];
    let nonce = Nonce::from_slice(&header[MAGIC.len() + SALT_LEN..HEADER_LEN]);
    cipher(password, salt)?
        .decrypt_in_place_detached(nonce, header, ciphertext, &tag)
        .map_err(|_| "Incorrect password or damaged backup")?;
    Ok(&bytes[HEADER_LEN..tag_offset])
}

#[cfg(test)]
pub(crate) fn decrypt(bytes: &[u8], password: &str) -> Result<Vec<u8>, String> {
    let mut owned = bytes.to_vec();
    let plaintext = decrypt_in_place(&mut owned, password)?;
    Ok(plaintext.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn legacy_v0_1_44_encrypt_deterministic(
        plaintext: &[u8],
        password: &str,
        salt: [u8; SALT_LEN],
        nonce_bytes: [u8; NONCE_LEN],
    ) -> Vec<u8> {
        let mut body = plaintext.to_vec();
        let mut header = [0u8; HEADER_LEN];
        header[..MAGIC.len()].copy_from_slice(MAGIC);
        header[MAGIC.len()..MAGIC.len() + SALT_LEN].copy_from_slice(&salt);
        header[MAGIC.len() + SALT_LEN..].copy_from_slice(&nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let tag = cipher(password, &salt)
            .unwrap()
            .encrypt_in_place_detached(nonce, &header, &mut body)
            .unwrap();
        body.splice(0..0, header);
        body.extend_from_slice(&tag);
        body
    }

    fn legacy_v0_1_44_decrypt(mut bytes: Vec<u8>, password: &str) -> Result<Vec<u8>, String> {
        if bytes.len() < HEADER_LEN + TAG_LEN || !bytes.starts_with(MAGIC) {
            return Err("Invalid encrypted backup".into());
        }
        let tag_offset = bytes.len() - TAG_LEN;
        let tag = Tag::clone_from_slice(&bytes[tag_offset..]);
        bytes.truncate(tag_offset);
        let (header, ciphertext) = bytes.split_at_mut(HEADER_LEN);
        let salt = &header[MAGIC.len()..MAGIC.len() + SALT_LEN];
        let nonce = Nonce::from_slice(&header[MAGIC.len() + SALT_LEN..HEADER_LEN]);
        cipher(password, salt)?
            .decrypt_in_place_detached(nonce, header, ciphertext, &tag)
            .map_err(|_| "Incorrect password or damaged backup")?;
        bytes.drain(..HEADER_LEN);
        Ok(bytes)
    }

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

    #[test]
    fn bidirectional_v0_1_44_wire_compatibility_and_aad_tamper_rejection() {
        let plaintext =
            br#"{"version":5,"localStorage":{"persist:cherry-studio":"{}"},"indexedDB":{}}"#;
        let legacy_blob = legacy_v0_1_44_encrypt_deterministic(
            plaintext,
            "compat-secret-2026",
            [0x11; SALT_LEN],
            [0x22; NONCE_LEN],
        );

        // v0.1.44 ciphertext decrypts cleanly via new zero-memmove decrypt_in_place
        let mut in_place_copy = legacy_blob.clone();
        let slice = decrypt_in_place(&mut in_place_copy, "compat-secret-2026").unwrap();
        assert_eq!(slice, plaintext);

        // New pre-reserved encrypt_prefixed_in_place output decrypts cleanly via v0.1.44 reader
        let mut prefixed = vec![0u8; HEADER_LEN];
        prefixed.extend_from_slice(plaintext);
        encrypt_prefixed_in_place(&mut prefixed, "compat-secret-2026").unwrap();
        assert_eq!(&prefixed[..MAGIC.len()], MAGIC);
        assert_eq!(
            legacy_v0_1_44_decrypt(prefixed.clone(), "compat-secret-2026").unwrap(),
            plaintext
        );

        // Header AAD tamper, body tamper, and empty password must all fail
        let mut header_tampered = prefixed.clone();
        header_tampered[0] ^= 0xff;
        assert!(decrypt_in_place(&mut header_tampered, "compat-secret-2026").is_err());

        let mut aad_salt_tampered = prefixed.clone();
        aad_salt_tampered[MAGIC.len()] ^= 0x01;
        assert!(decrypt_in_place(&mut aad_salt_tampered, "compat-secret-2026").is_err());

        let mut body_tampered = prefixed;
        body_tampered[HEADER_LEN] ^= 0x80;
        assert!(decrypt_in_place(&mut body_tampered, "compat-secret-2026").is_err());
        assert!(encrypt(plaintext, "").is_err());
    }
}
