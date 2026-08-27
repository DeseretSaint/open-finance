"use client";

import { useEffect, useRef } from "react";

/**
 * Wire Escape-key dismissal onto a modal dialog (WAI-ARIA dialog pattern: a
 * keyboard user must be able to close it without reaching for a pointer).
 *
 * `handler` is kept in a ref so callers may pass an inline arrow without the
 * listener being torn down and re-added on every render. The listener is only
 * attached while `enabled` is true (i.e. the modal is actually open), so no
 * stray global key handling runs when nothing is showing.
 */
export function useEscapeToClose(handler: () => void, enabled = true): void {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        ref.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
