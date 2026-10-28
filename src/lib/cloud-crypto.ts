/**
 * End-to-end encryption for cloud sync, WebCrypto only. The sync passphrase is stretched with
 * PBKDF2 (SHA-256) into a 256-bit AES-GCM key; the server keeps only the salt and an encrypted
 * check text (`CloudKeySetup`), never the passphrase or the key. The raw key stays on this device,
 * base64, under `chrome.storage.local` `cloudSyncKey` (`src/lib/cloud-auth.ts`).
 */
import { ExplainedError } from '@/lib/error-message';
import type { CloudKeySetup, EncryptedPayload } from '@/types';

/** PBKDF2 rounds for a new setup (OWASP's 2023 figure for PBKDF2-HMAC-SHA256). */
export const KDF_ITERATIONS = 600_000;
/** The text encrypted into `check`: decrypting it back proves the passphrase. */
export const KEY_CHECK_TEXT = 'tabinet-key-check-v1';

/** The PBKDF2 rounds a key setup may ask for (the sync server refuses any other). */
export const KDF_MIN_ITERATIONS = 100_000;
export const KDF_MAX_ITERATIONS = 10_000_000;
/** The salt lengths, in bytes, a key setup may carry (the sync server refuses any other). */
export const SALT_MIN_BYTES = 16;
export const SALT_MAX_BYTES = 64;

const SALT_BYTES = 16;
export const IV_BYTES = 12;
const KEY_BITS = 256;

/** A record that does not decrypt (tampered, cut short, or made with another key). */
export class CloudDecryptError extends ExplainedError {
  constructor(message: string) {
    super(message, 'errorCloudDecrypt');
    this.name = 'CloudDecryptError';
  }
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** Base64 to bytes; throws on text that is not base64. */
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** The length in bytes of `text` when it is canonical base64, else `undefined`. Pure. */
export function base64ByteLength(text: string): number | undefined {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) {
    return undefined;
  }
  try {
    return atob(text).length;
  } catch {
    return undefined;
  }
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function deriveRawKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

function importAesKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptBytes(
  key: CryptoKey,
  plain: Uint8Array<ArrayBuffer>,
): Promise<EncryptedPayload> {
  const iv = randomBytes(IV_BYTES);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(cipher)) };
}

/** The plaintext, or `null` when AES-GCM refuses it (wrong key, tampered, malformed). */
async function decryptBytes(
  key: CryptoKey,
  payload: EncryptedPayload,
): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(payload.iv) },
      key,
      fromBase64(payload.ciphertext),
    );
    return new Uint8Array(plain);
  } catch {
    return null;
  }
}

/**
 * A new sync passphrase: a fresh salt, the key derived from it, and the check text encrypted
 * under that key. `setup` goes to the server; `rawKey` (base64) stays on this device.
 * `iterations` exists for tests; everything else uses `KDF_ITERATIONS`.
 */
export async function createKeySetup(
  passphrase: string,
  iterations: number = KDF_ITERATIONS,
): Promise<{ setup: CloudKeySetup; rawKey: string }> {
  const salt = randomBytes(SALT_BYTES);
  const raw = await deriveRawKey(passphrase, salt, iterations);
  const key = await importAesKey(raw);
  const check = await encryptBytes(key, new TextEncoder().encode(KEY_CHECK_TEXT));
  return {
    setup: {
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations },
      salt: toBase64(salt),
      check: check.ciphertext,
      checkIv: check.iv,
    },
    rawKey: toBase64(raw),
  };
}

/**
 * The raw key (base64) for `passphrase` under the server's `setup`, or `null` when the passphrase
 * is wrong: the check text does not decrypt, or decrypts to something else.
 */
export async function unlockKeySetup(
  setup: CloudKeySetup,
  passphrase: string,
): Promise<string | null> {
  const raw = await deriveRawKey(passphrase, fromBase64(setup.salt), setup.kdf.iterations);
  const key = await importAesKey(raw);
  const plain = await decryptBytes(key, { iv: setup.checkIv, ciphertext: setup.check });
  if (plain === null || new TextDecoder().decode(plain) !== KEY_CHECK_TEXT) {
    return null;
  }
  return toBase64(raw);
}

/**
 * Whether `rawKey` (base64) is the key `setup` was made with: the check text decrypts under it.
 * `false` for anything else, a key that is not base64 included.
 */
export async function keyMatchesSetup(rawKey: string, setup: CloudKeySetup): Promise<boolean> {
  try {
    const key = await importAesKey(fromBase64(rawKey));
    const plain = await decryptBytes(key, { iv: setup.checkIv, ciphertext: setup.check });
    return plain !== null && new TextDecoder().decode(plain) === KEY_CHECK_TEXT;
  } catch {
    return false;
  }
}

/** `value` as JSON, UTF-8, then AES-GCM under `rawKey` with a fresh 12-byte iv. */
export async function encryptRecord(rawKey: string, value: unknown): Promise<EncryptedPayload> {
  const key = await importAesKey(fromBase64(rawKey));
  return encryptBytes(key, new TextEncoder().encode(JSON.stringify(value)));
}

/** The inverse of `encryptRecord`; throws `CloudDecryptError` on anything that does not decrypt. */
export async function decryptRecord(rawKey: string, payload: EncryptedPayload): Promise<unknown> {
  const key = await importAesKey(fromBase64(rawKey));
  const plain = await decryptBytes(key, payload);
  if (plain === null) {
    throw new CloudDecryptError('AES-GCM refused the record (tampered or another key)');
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
    return value;
  } catch {
    throw new CloudDecryptError('The record decrypted to something that is not JSON');
  }
}
