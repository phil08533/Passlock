'use strict';

/**
 * Passlock Crypto — Web Crypto API wrappers.
 * AES-256-GCM + PBKDF2-SHA256.
 * Nothing here contacts the network.
 */
const Crypto = (() => {

  const PBKDF2_ROUNDS_PASSWORD = 310_000;
  const PBKDF2_ROUNDS_PIN      = 100_000;
  const KEY_LEN = 256;

  const enc = str => new TextEncoder().encode(str);

  function toB64(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let bin = '';
    bytes.forEach(b => bin += String.fromCharCode(b));
    return btoa(bin);
  }

  function fromB64(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function randomBytes(n) {
    return crypto.getRandomValues(new Uint8Array(n));
  }

  /** Derive an AES-KW wrapping key from a password (310,000 PBKDF2 rounds). */
  async function deriveWrappingKey(password, salt) {
    const km = await crypto.subtle.importKey('raw', enc(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ROUNDS_PASSWORD, hash: 'SHA-256' },
      km,
      { name: 'AES-KW', length: KEY_LEN },
      false, ['wrapKey', 'unwrapKey']
    );
  }

  /** Derive an AES-KW wrapping key from a PIN (100,000 PBKDF2 rounds — faster for UX). */
  async function deriveWrappingKeyFromPin(pin, salt) {
    const km = await crypto.subtle.importKey('raw', enc(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ROUNDS_PIN, hash: 'SHA-256' },
      km,
      { name: 'AES-KW', length: KEY_LEN },
      false, ['wrapKey', 'unwrapKey']
    );
  }

  /** Generate a random AES-256-GCM vault key (extractable for key-wrapping). */
  async function generateVaultKey() {
    return crypto.subtle.generateKey(
      { name: 'AES-GCM', length: KEY_LEN },
      true,                           // must be extractable to wrapKey
      ['encrypt', 'decrypt']
    );
  }

  /** Wrap vaultKey with wrappingKey (AES-KW). Returns base64 string. */
  async function wrapVaultKey(vaultKey, wrappingKey) {
    const wrapped = await crypto.subtle.wrapKey('raw', vaultKey, wrappingKey, 'AES-KW');
    return toB64(wrapped);
  }

  /**
   * Unwrap the vault key. Returns an extractable CryptoKey so it can be
   * re-wrapped when changing password or adding a PIN.
   */
  async function unwrapVaultKey(wrappedB64, wrappingKey) {
    return crypto.subtle.unwrapKey(
      'raw', fromB64(wrappedB64), wrappingKey,
      'AES-KW',
      { name: 'AES-GCM', length: KEY_LEN },
      true,           // extractable — needed for wrapKey (change password / set PIN)
      ['encrypt', 'decrypt']
    );
  }

  /** Encrypt a JSON-serialisable object. Returns { iv, data } (both base64). */
  async function encrypt(obj, vaultKey) {
    const iv = randomBytes(12);
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, vaultKey,
      enc(JSON.stringify(obj))
    );
    return { iv: toB64(iv), data: toB64(ct) };
  }

  /** Decrypt { iv, data } (both base64) and parse as JSON. */
  async function decrypt({ iv, data }, vaultKey) {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(iv) }, vaultKey, fromB64(data)
    );
    return JSON.parse(new TextDecoder().decode(pt));
  }

  /**
   * Encrypt raw bytes (ArrayBuffer / TypedArray).
   * Returns { iv, data } — both base64 — for storage in .vault JSON.
   */
  async function encryptBytes(buffer, vaultKey) {
    const iv = randomBytes(12);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, vaultKey, buffer);
    return { iv: toB64(iv), data: toB64(ct) };
  }

  /**
   * Decrypt a { iv, data } pair (both base64) back to an ArrayBuffer.
   */
  async function decryptBytes(iv, data, vaultKey) {
    return crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(iv) }, vaultKey, fromB64(data)
    );
  }

  /** Cryptographically secure password generator (20 chars). */
  function generatePassword(length = 20) {
    const UPPER   = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const LOWER   = 'abcdefghijklmnopqrstuvwxyz';
    const DIGITS  = '0123456789';
    const SYMBOLS = '!@#$%^&*()-_=+[]{}|;:,.<>?';
    const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

    const randByte = () => crypto.getRandomValues(new Uint8Array(1))[0];
    const pick = charset => charset[randByte() % charset.length];

    const required = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
    const rest = Array.from({ length: length - 4 }, () => pick(ALL));
    const all = [...required, ...rest];

    for (let i = all.length - 1; i > 0; i--) {
      const j = randByte() % (i + 1);
      [all[i], all[j]] = [all[j], all[i]];
    }
    return all.join('');
  }

  return {
    toB64, fromB64, randomBytes,
    deriveWrappingKey, deriveWrappingKeyFromPin,
    generateVaultKey, wrapVaultKey, unwrapVaultKey,
    encrypt, decrypt, encryptBytes, decryptBytes,
    generatePassword,
  };
})();
