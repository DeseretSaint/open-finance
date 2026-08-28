"use client";

import { useEffect, useRef, type RefObject } from "react";
import { App } from "@capacitor/app";
import type { PluginListenerHandle } from "@capacitor/core";
import { isNativePlatform } from "@/lib/mobile-mode";
import { hasDocument } from "@/lib/browser-env";

// Android hardware Back-button coordinator for modal dialogs (run 179).
// A module-level stack of the close fns of open dialogs; the Back handler pops
// the TOPMOST and closes only it. The Capacitor listener is registered ONLY
// while a dialog is open and torn down the instant the stack empties, so when
// no dialog is open the OS/webview owns Back exactly as before (no global
// back-hijack, no regression to in-app navigation).
const openDialogs: Array<() => void> = [];
let backHandle: PluginListenerHandle | null = null;
let backWanted = false;

async function ensureBackListener(): Promise<void> {
  if (!hasDocument()) return;
  if (!isNativePlatform()) return; // plain web: no hardware Back to intercept
  if (backHandle) return;
  backWanted = true;
  backHandle = await App.addListener("backButton", () => {
    const top = openDialogs[openDialogs.length - 1];
    if (top) {
      openDialogs.pop();
      top();
    }
    if (openDialogs.length === 0) removeBackListener();
  });
  // The dialog may have closed before the async listener resolved — drop the
  // handle immediately rather than leaving a no-op listener alive.
  if (!backWanted) {
    backHandle.remove();
    backHandle = null;
  }
}

function removeBackListener(): void {
  backWanted = false;
  if (backHandle) {
    backHandle.remove();
    backHandle = null;
  }
}

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
 * conditionally renders the dialog. `onClose` (optional) is invoked when the
 * Android hardware Back button is pressed, closing only the topmost open
 * dialog — see the module-level coordinator above. Omit it for sheets that
 * don't want Back-to-close (none today, but the param stays optional so the
 * 10 existing call sites are untouched).
 */
export function useDialogA11y(
  open: boolean,
  onClose?: () => void,
): RefObject<HTMLDivElement | null> {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Keep the underlying page from scrolling behind the open dialog (mobile).
  useBodyScrollLock(open);

  // Register this dialog for Android hardware Back-to-close while it is open.
  // A stable closure is pushed so onClose identity changes between renders
  // don't stack duplicate entries; the latest onClose is read via a ref.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || !onClose) return;
    const close = () => onCloseRef.current?.();
    openDialogs.push(close);
    void ensureBackListener();
    return () => {
      const i = openDialogs.indexOf(close);
      if (i !== -1) openDialogs.splice(i, 1);
      if (openDialogs.length === 0) removeBackListener();
    };
  }, [open, onClose]);

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
        // SAFETY: activeElement may be null (indexOf → -1); it is only used as an index, never dereferenced.
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

/**
 * Lock background scroll while a modal is open. On mobile (<md) the app shell
 * scrolls on the documentElement, so a sheet open over the page would let the
 * underlying list drift on swipe without this. Desktop scrolls an inner
 * container (body never scrolls) so this is a harmless no-op there. Restores
 * the prior overflow on close — never leaves the page stuck non-scrollable.
 */
function useBodyScrollLock(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
}
