import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Offline-flow guards (run 22): the service worker must keep serving a valid
 * session offline. defaultCache (@serwist/next) marks ALL of /api/auth/* as
 * NetworkOnly, which bounced offline fresh loads to /login despite a valid
 * cookie — (app)/layout.tsx's auth check hits /api/auth/me. sw.ts prepends a
 * NetworkFirst rule for exactly that route and registers a /offline
 * navigation fallback. These source-level guards lock the wiring (sw.ts can't
 * be imported in node: it reads `self.__SW_MANIFEST` at module scope).
 */
const swSrc = readFileSync(path.resolve(__dirname, "../src/app/sw.ts"), "utf8");
const offlineSrc = readFileSync(path.resolve(__dirname, "../src/app/offline/page.tsx"), "utf8");

describe("service worker offline session fix", () => {
  it("caches GET /api/auth/me with NetworkFirst", () => {
    expect(swSrc).toContain('pathname === "/api/auth/me"');
    expect(swSrc).toContain("request.method === \"GET\"");
    expect(swSrc).toContain("new NetworkFirst(");
    expect(swSrc).toContain("networkTimeoutSeconds: 5");
  });

  it("the me-rule is prepended BEFORE defaultCache so it wins", () => {
    const meRule = swSrc.indexOf('"/api/auth/me"');
    const spread = swSrc.indexOf("...defaultCache");
    expect(meRule).toBeGreaterThan(-1);
    expect(spread).toBeGreaterThan(-1);
    expect(meRule).toBeLessThan(spread);
    expect(swSrc).toMatch(/runtimeCaching:\s*\[\s*authMeCache\s*,\s*\.\.\.defaultCache\s*\]/);
  });

  it("never caches non-200 me responses (a stale 401 would lock a session out offline)", () => {
    expect(swSrc).toContain("new CacheableResponsePlugin({ statuses: [200] })");
  });

  it("registers the /offline navigation fallback", () => {
    expect(swSrc).toContain('url: "/offline"');
    expect(swSrc).toContain('request.mode === "navigate"');
    expect(swSrc).toContain("fallbacks:");
  });
});

describe("offline fallback page", () => {
  it("is a static server page (no client JS, renders with zero network)", () => {
    expect(offlineSrc).not.toContain('"use client"');
    expect(offlineSrc).toContain("export default function OfflinePage");
  });

  it("explains the state and offers a retry", () => {
    expect(offlineSrc).toContain("You're offline".replace("'", "&apos;"));
    expect(offlineSrc).toContain('href="/"');
    expect(offlineSrc).toContain("Try again");
  });
});
