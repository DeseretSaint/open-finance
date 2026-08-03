"use client";

import { useEffect, useState } from "react";

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
    if (typeof window === "undefined" || !window.visualViewport) return;
    const onResize = () => {
      const vv = window.visualViewport!;
      const delta = Math.max(0, window.innerHeight - vv.height);
      setKbdHeight(delta > 100 ? delta : 0);
    };
    window.visualViewport.addEventListener("resize", onResize);
    return () => window.visualViewport!.removeEventListener("resize", onResize);
  }, []);

  return kbdHeight;
}
