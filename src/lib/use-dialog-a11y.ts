"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Focus containment + return for modal dialogs (WAI-ARIA dialog pattern):
 * while open, Tab/Shift+Tab cycle within the dialog instead of escaping into
 * the background page, and on close focus returns to the element that opened
 * the dialog. Pairs with `useEscapeToClose`; keep `aria-modal="true"` on the
 * container. No dependencies — a deliberately small, self-contained trap.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** All focusable descendants of `container`, in DOM order. */
export function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/**
 * Pure Tab-wrap decision. Given how many focusables exist, the index of the
 * currently-focused one (-1 when focus is outside the list), and whether
 * Shift is held: return the index that should receive focus, or null when the
 * browser's default Tab behavior should proceed.
 */
export function tabWrapTarget(
  count: number,
  currentIndex: number,
  shiftKey: boolean,
): number | null {
  if (count === 0) return null;
  if (shiftKey) {
    // Shift+Tab at/before the first item wraps to the last.
    return currentIndex <= 0 ? count - 1 : null;
  }
  // Tab from the last item (or from outside) wraps to the first.
  return currentIndex === -1 || currentIndex === count - 1 ? 0 : null;
}

/**
 * Wire the trap onto a modal: attach the returned ref to the dialog container
 * (the `role="dialog"` element). `open` must track the same state that
 * conditionally renders the dialog.
 */
export function useDialogA11y(open: boolean): RefObject<HTMLDivElement | null> {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;

    const trigger =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Move focus into the dialog. React's own `autoFocus` (applied during
    // commit, before this effect) wins when it already landed inside.
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !container.contains(active)) {
      const items = focusableIn(container);
      const target = items[0] ?? container;
      if (target === container && !container.hasAttribute("tabindex")) {
        container.setAttribute("tabindex", "-1");
      }
      target.focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusableIn(container);
      const target = tabWrapTarget(
        items.length,
        items.indexOf(document.activeElement as HTMLElement),
        e.shiftKey,
      );
      if (target !== null) {
        e.preventDefault();
        items[target].focus();
      } else if (items.length === 0) {
        e.preventDefault();
      }
    };
    container.addEventListener("keydown", onKey);

    return () => {
      container.removeEventListener("keydown", onKey);
      // Return focus to the trigger if it's still in the document.
      if (trigger && trigger.isConnected) trigger.focus();
    };
  }, [open]);

  return containerRef;
}
