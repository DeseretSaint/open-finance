/**
 * PIN hashing for device lock — dual-runtime (Node 22 server AND browser
 * webview, P8b solo). Uses WebCrypto (globalThis.crypto.subtle), which exists
 * in both environments, so the SAME device_lock service runs unchanged on the
 * hub and on the phone. Output format matches the previous node:crypto
 * implementation (hex), so existing device_lock rows stay valid.
 */

const ITERATIONS = 100_000;
const KEYLEN_BYTES = 32;
const SALT_BYTES = 16;

export function randomSaltHex(): string {
  const bytes = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function derivePinHashHex(pin: string, saltHex: string): Promise<string> {
  // The salt is a hex string in storage, but node's pbkdf2Sync hashed the
  // raw string as UTF-8 bytes. Keep that byte-semantics (hash the UTF-8 of
  // the salt string) so legacy hashes and tests using plain salt strings
  // behave identically.
  const salt = new TextEncoder().encode(saltHex);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    KEYLEN_BYTES * 8
  );
  return Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time hex compare (both inputs are hex strings). */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
