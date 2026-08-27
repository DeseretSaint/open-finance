/**
 * WebCrypto shim for the P8b solo webview — mirrors the subset of node:crypto
 * used by the domain layer (randomUUID, randomBytes, createHash,
 * timingSafeEqual, createCipheriv/createDecipheriv) so the SAME domain
 * services run unchanged on the phone. Node 22 also has globalThis.crypto,
 * so this module works in both runtimes.
 *
 * Bundlers (webpack/Next) resolve `node:crypto` to this file via the mobile
 * build's resolve.alias — the server build keeps the real node:crypto.
 */

export function randomUUID(): string {
  return crypto.randomUUID();
}

export function randomBytes(size: number): Uint8Array {
  const b = new Uint8Array(size);
  crypto.getRandomValues(b);
  return b;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  // SAFETY: bytes is a getRandomValues-backed Uint8Array whose .buffer is a non-shared ArrayBuffer; slice() returns a fresh ArrayBuffer.
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** SHA-256 hex digest (mirrors node's createHash('sha256')). */
export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time compare of two hex strings (used by device-lock / auth). */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** AES-256-GCM encrypt → base64(iv || tag || ct), mirroring src/lib/crypto.ts. */
export async function aesGcmEncrypt(plaintext: string, keyBytes: Uint8Array, aad: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad), tagLength: 128 },
    key,
    new TextEncoder().encode(plaintext)
  );
  const combined = new Uint8Array(iv.length + ct.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ct), iv.length);
  return btoa(String.fromCharCode(...Array.from(combined)));
}

/** AES-256-GCM decrypt of base64(iv || tag || ct). */
export async function aesGcmDecrypt(envelope: string, keyBytes: Uint8Array, aad: string): Promise<string> {
  const raw = Uint8Array.from(atob(envelope), (c) => c.charCodeAt(0));
  const iv = raw.subarray(0, 12);
  const ct = raw.subarray(12);
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad), tagLength: 128 },
    key,
    toArrayBuffer(ct)
  );
  return new TextDecoder().decode(pt);
}
