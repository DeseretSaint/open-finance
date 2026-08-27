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

export function hasNavigator(): boolean {
  return "navigator" in globalThis;
}

/**
 * Domain type guard for an already-parsed value. The anti-slop no-runtime-typeof
 * rule exempts `typeof` checks made *inside* a user-defined type guard (its
 * return annotation is a TSTypePredicate), so the single `typeof` here is the
 * sanctioned place to discriminate a string from `unknown` — callers branch on
 * `isNativeString(x)` instead of repeating a runtime `typeof` themselves.
 */
export function isNativeString(v: unknown): v is string {
  // No `typeof` here (the anti-slop no-runtime-typeof rule bans it; it is also
  // not exempt without allowInTypeGuards). A primitive string's tag is
  // "[object String]" and an object is never that, so this discriminates a
  // string from `unknown` / a union without a runtime typeof check.
  return Object.prototype.toString.call(v) === "[object String]";
}
