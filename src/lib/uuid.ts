/**
 * UUID helper — dual-runtime (Node 22 server AND browser webview).
 * globalThis.crypto.randomUUID exists in both, so domain services can use it
 * instead of `import { randomUUID } from "node:crypto"` (which breaks the
 * P8b solo webview bundle).
 */
export function randomUUID(): string {
  return crypto.randomUUID();
}
