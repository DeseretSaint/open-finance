"use client";

import { useEffect, useState } from "react";
import { hasWindow } from "@/lib/browser-env";

/**
 * Shared keyboard-height effect (D1 — replaces the five inline copies in
 * login / register / wizard / transactions / accounts / budgets).
 *
 * Tracks the on-screen keyboard via visualViewport and returns how many px
 * the layout should lift so the focused control stays visible. 0 when the
 * keyboard is closed (or the delta is small enough to be a safari chrome
 * collapse, < 100px).
 */
export function useKeyboardHeight(): number {
  const [kbdHeight, setKbdHeight] = useState(0);

  useEffect(() => {
    if (!hasWindow() || !window.visualViewport) return;

    const isTextEntry = () => {
      const el = document.activeElement;
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el?.getAttribute("contenteditable") === "true";
    };

    const onResize = () => {
      const vv = window.visualViewport!;
      const delta = Math.max(0, window.innerHeight - vv.height);
      // Only move modal/layout content while the user is actually typing. This
      // prevents Android WebView chrome/compactness changes from being treated
      // as a keyboard and avoids the old stuck-lift behavior.
      setKbdHeight(isTextEntry() && delta > 60 ? delta : 0);
    };
    const onFocus = () => onResize();
    const onBlur = () => setKbdHeight(0);

    window.visualViewport.addEventListener("resize", onResize);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onBlur);
    return () => {
      window.visualViewport?.removeEventListener("resize", onResize);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onBlur);
    };
  }, []);

  return kbdHeight;
}
