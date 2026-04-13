'use strict';

/**
 * Passlock Crypto — Web Crypto API wrappers.
 * AES-256-GCM + PBKDF2-SHA256 (310,000 rounds).
 * Nothing here contacts the network.
 */
const Crypto = (() => {

  const PBKDF2_ITERATIONS = 310_000;
  const KEY_LEN = 256;

  /** Encode string to Uint8Array */
  const enc = str => new TextEncoder().encode(str);

  /** Uint8Array → base64 string */
  function toB64(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let bin = '';
    bytes.forEach(b => bin += String.fromCharCode(b));
    return btoa(bin);
  }

  /** base64 string → Uint8Array */
  function fromB64(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** Random bytes */
  function randomBytes(n) {
    return crypto.getRandomValues(new Uint8Array(n));
  }

  /**
   * Derive an AES-KW key from a password using PBKDF2.
   * Used for wrapping/unwrapping the vault key.
   */
  async function deriveWrappingKey(password, salt) {
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-KW', length: KEY_LEN },
      false,
      ['wrapKey', 'unwrapKey']
    );
  }

  /** Generate a random AES-256-GCM vault key (extractable for wrapping). */
  async function generateVaultKey() {
    return crypto.subtle.generateKey(
      { name: 'AES-GCM', length: KEY_LEN },
      true,
      ['encrypt', 'decrypt']
    );
  }

  /** Wrap vaultKey with wrappingKey using AES-KW. Returns base64. */
  async function wrapVaultKey(vaultKey, wrappingKey) {
    const wrapped = await crypto.subtle.wrapKey('raw', vaultKey, wrappingKey, 'AES-KW');
    return toB64(wrapped);
  }

  /**
   * Unwrap the vault key. Returns a non-extractable CryptoKey.
   * Throws if password is wrong.
   */
  async function unwrapVaultKey(wrappedB64, wrappingKey) {
    const wrapped = fromB64(wrappedB64);
    return crypto.subtle.unwrapKey(
      'raw', wrapped, wrappingKey,
      'AES-KW',
      { name: 'AES-GCM', length: KEY_LEN },
      false,          // non-extractable after unwrap
      ['encrypt', 'decrypt']
    );
  }

  /** Encrypt JSON-serialisable data. Returns {iv, data} both base64. */
  async function encrypt(obj, vaultKey) {
    const iv = randomBytes(12);
    const pt = enc(JSON.stringify(obj));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, vaultKey, pt);
    return { iv: toB64(iv), data: toB64(ct) };
  }

  /** Decrypt {iv, data} (both base64) and parse JSON. */
  async function decrypt({ iv, data }, vaultKey) {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(iv) },
      vaultKey,
      fromB64(data)
    );
    return JSON.parse(new TextDecoder().decode(pt));
  }

  /** Cryptographically secure password generator. */
  function generatePassword(length = 20) {
    const UPPER   = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const LOWER   = 'abcdefghijklmnopqrstuvwxyz';
    const DIGITS  = '0123456789';
    const SYMBOLS = '!@#$%^&*()-_=+[]{}|;:,.<>?';
    const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

    const randByte = () => crypto.getRandomValues(new Uint8Array(1))[0];
    const pick = charset => charset[randByte() % charset.length];

    // Guarantee one of each category, fill rest randomly
    const required = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
    const rest = Array.from({ length: length - 4 }, () => pick(ALL));
    const all = [...required, ...rest];

    // Fisher-Yates shuffle with crypto randomness
    for (let i = all.length - 1; i > 0; i--) {
      const j = randByte() % (i + 1);
      [all[i], all[j]] = [all[j], all[i]];
    }
    return all.join('');
  }

  return {
    toB64, fromB64, randomBytes,
    deriveWrappingKey, generateVaultKey, wrapVaultKey, unwrapVaultKey,
    encrypt, decrypt, generatePassword,
  };
})();
