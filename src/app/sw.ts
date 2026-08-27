import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { CacheableResponsePlugin, ExpirationPlugin, NetworkFirst, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: WorkerGlobalScope & typeof globalThis;

/**
 * Offline session fix (run 22): defaultCache marks ALL of /api/auth/* as
 * NetworkOnly, so an offline fresh load fails the /api/auth/me check in
 * (app)/layout.tsx and bounces a perfectly valid session to /login.
 * /api/auth/me returns only public profile fields (display_name, username,
 * is_demo) — safe to cache for the session's lifetime; every other
 * /api/auth/* route stays NetworkOnly. This rule is prepended so it wins
 * over defaultCache's auth matcher.
 */
const authMeCache = {
  matcher: ({ sameOrigin, url: { pathname }, request }: { sameOrigin: boolean; url: { pathname: string }; request: Request }) =>
    sameOrigin && pathname === "/api/auth/me" && request.method === "GET",
  handler: new NetworkFirst({
    cacheName: "apis",
    networkTimeoutSeconds: 5,
    plugins: [
      // Never cache an error envelope — a stale 401 would lock a valid
      // session out offline.
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxEntries: 1,
        maxAgeSeconds: 24 * 60 * 60, // 24 hours
        maxAgeFrom: "last-used",
      }),
    ],
  }),
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [authMeCache, ...defaultCache],
  // A navigation never visited online used to be a hard offline error page;
  // serve the precached /offline page instead.
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher: ({ request }) => request.mode === "navigate",
      },
    ],
  },
});

serwist.addEventListeners();
