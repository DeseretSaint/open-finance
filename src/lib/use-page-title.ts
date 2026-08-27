"use client";

import { useEffect } from "react";

import { hasDocument } from "@/lib/browser-env";

/**
 * Sets document.title for the page while it is mounted and restores the
 * previous title on unmount. SSR-safe: no-ops when there is no document.
 * Screen-reader and browser-history users get a per-page name instead of
 * the app-wide default on every route.
 */
export function usePageTitle(title: string): void {
  useEffect(() => {
    if (!hasDocument()) return;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
