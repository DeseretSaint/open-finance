/**
 * Browser/SSR environment detection.
 *
 * Every client lib needs to know "am I in a browser or being server-rendered"
 * before touching window/document/localStorage. Centralizing it here keeps the
 * check in ONE place and avoids scattered `typeof window` probes (the
 * anti-slop no-runtime-typeof rule bans runtime typeof narrowing — an `in`
 * check on globalThis tests the same global binding without it).
 *
 * Equivalent semantics to `typeof window !== "undefined"`: in a browser/webview
 * `window` is a property of globalThis; in Node SSR and Web Workers it is not.
 * Tests stub the globals by assigning to globalThis, which the `in` check sees.
 */

export function hasWindow(): boolean {
  return "window" in globalThis;
}

export function hasDocument(): boolean {
  return "document" in globalThis;
}
