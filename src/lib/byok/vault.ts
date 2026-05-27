/**
 * Client-side vault for BYOK provider keys.
 *
 * Two storage modes:
 *   - **plain**: key (+ provider) is written to localStorage as-is.
 *     Persists across sessions; trivially readable by any same-origin script.
 *   - **encrypted**: PBKDF2 derives an AES-GCM key from a passphrase + salt;
 *     ciphertext + salt + IV + provider are stored. Passphrase is never
 *     persisted — the user enters it once per session to unlock.
 *
 * All operations are local; nothing here talks to the network. The runtime
 * cache of the unlocked plaintext lives in the BYOK context, not here.
 *
 * Schema versioning:
 *   - v1: legacy Anthropic-only shape (no provider field). Decoded as
 *     {provider: "anthropic"} on read so users who saved a key before the
 *     multi-provider release keep working.
 *   - v2: provider-aware shape.
 */

import type { Provider } from "./providers";

const STORAGE_KEY = "websitepls:byok";
const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

type StoredKeyV1 =
  | { v: 1; kind: "plain"; key: string }
  | { v: 1; kind: "encrypted"; salt: string; iv: string; ciphertext: string };

type StoredKeyV2 =
  | { v: 2; kind: "plain"; provider: Provider; key: string }
  | {
      v: 2;
      kind: "encrypted";
      provider: Provider;
      salt: string;
      iv: string;
      ciphertext: string;
    };

type StoredKey = StoredKeyV1 | StoredKeyV2;

export type VaultStatus =
  | { kind: "none" }
  | { kind: "plain"; provider: Provider }
  | { kind: "encrypted"; provider: Provider };

// Web Crypto APIs expect `BufferSource`, which under TS's stricter typed-array
// generics means a typed array backed by `ArrayBuffer` (not the broader
// `ArrayBufferLike`). These helpers always allocate fresh ArrayBuffer-backed
// bytes so the types line up without casts at every call site.
type Bytes = Uint8Array<ArrayBuffer>;

function randomBytes(n: number): Bytes {
  const buf = new Uint8Array(new ArrayBuffer(n));
  crypto.getRandomValues(buf);
  return buf as Bytes;
}

function bytesFromString(s: string): Bytes {
  const enc = new TextEncoder().encode(s);
  const copy = new Uint8Array(new ArrayBuffer(enc.byteLength));
  copy.set(enc);
  return copy as Bytes;
}

function b64encode(bytes: Bytes): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64decode(s: string): Bytes {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out as Bytes;
}

function readRaw(): StoredKey | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredKey;
    if (parsed.v !== 1 && parsed.v !== 2) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeRaw(value: StoredKey): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

/**
 * Backward-compat: a v1 entry is decoded as Anthropic. New writes always
 * go out as v2, so v1 entries naturally migrate the next time the user
 * saves or removes the key.
 */
function entryProvider(entry: StoredKey): Provider {
  if (entry.v === 1) return "anthropic";
  return entry.provider;
}

export function loadVaultStatus(): VaultStatus {
  const stored = readRaw();
  if (!stored) return { kind: "none" };
  return { kind: stored.kind, provider: entryProvider(stored) };
}

export function loadPlainKey(): { key: string; provider: Provider } | null {
  const stored = readRaw();
  if (stored?.kind === "plain") {
    return { key: stored.key, provider: entryProvider(stored) };
  }
  return null;
}

export function savePlainKey(provider: Provider, key: string): void {
  writeRaw({ v: 2, kind: "plain", provider, key });
}

export function removeKey(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* best-effort */
  }
}

async function deriveAesKey(
  passphrase: string,
  salt: Bytes,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    bytesFromString(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function saveEncryptedKey(
  provider: Provider,
  apiKey: string,
  passphrase: string,
): Promise<void> {
  if (!passphrase || passphrase.length < 4) {
    throw new Error("Passphrase must be at least 4 characters.");
  }
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveAesKey(passphrase, salt);
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    bytesFromString(apiKey),
  );
  const ciphertext = new Uint8Array(ciphertextBuf) as Bytes;
  writeRaw({
    v: 2,
    kind: "encrypted",
    provider,
    salt: b64encode(salt),
    iv: b64encode(iv),
    ciphertext: b64encode(ciphertext),
  });
}

/**
 * Decrypts the stored key with the given passphrase. Throws on wrong
 * passphrase (AES-GCM auth tag mismatch) or if no encrypted key exists.
 * Returns both the plaintext key and the provider it belongs to.
 */
export async function unlockEncryptedKey(
  passphrase: string,
): Promise<{ key: string; provider: Provider }> {
  const stored = readRaw();
  if (!stored || stored.kind !== "encrypted") {
    throw new Error("No encrypted key in this browser.");
  }
  const salt = b64decode(stored.salt);
  const iv = b64decode(stored.iv);
  const ciphertext = b64decode(stored.ciphertext);
  const key = await deriveAesKey(passphrase, salt);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext,
    );
    return {
      key: new TextDecoder().decode(plaintext),
      provider: entryProvider(stored),
    };
  } catch {
    throw new Error("Wrong passphrase.");
  }
}
