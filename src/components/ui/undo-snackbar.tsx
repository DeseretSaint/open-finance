"use client";

import { useEffect, useRef, useState } from "react";

/**
 * M3 Snackbar with a single UNDO action. Used for reversible deletes so the
 * user gets an out-of-the-way recovery path instead of a habituated
 * "Are you sure?" confirm (Q38: undo > warning). Auto-dismisses after
 * `duration` ms (M3 LONG = 2750ms); only one is shown at a time.
 */
export function UndoSnackbar({
  open,
  message,
  onUndo,
  onClose,
  undoLabel = "Undo",
  duration = 2750,
}: {
  open: boolean;
  message: string;
  onUndo: () => void;
  onClose: () => void;
  undoLabel?: string;
  duration?: number;
}) {
  // WCAG 2.2.1 (Timing Adjustable): the Undo action is the ONLY recovery path,
  // so the auto-dismiss timer pauses while the user is hovering or keyboard-
  // focused inside the snackbar (M3 also specifies pause-on-hover/focus).
  const [paused, setPaused] = useState(false);

  // The auto-dismiss timer must NOT depend on the callback identities: every
  // call site passes inline arrows (`onClose={() => setUndoTxn(null)}`), so a
  // callback dep would restart the countdown on EVERY parent re-render (list
  // refetch, debounce tick, …) and the snackbar could linger indefinitely.
  const onCloseRef = useRef(onClose);
  const onUndoRef = useRef(onUndo);
  useEffect(() => {
    onCloseRef.current = onClose;
    onUndoRef.current = onUndo;
  }, [onClose, onUndo]);

  useEffect(() => {
    if (!open || paused) return;
    const id = setTimeout(() => onCloseRef.current(), duration);
    return () => clearTimeout(id);
  }, [open, paused, duration]);

  useEffect(() => {
    if (!open) setPaused(false);
  }, [open]);

  // The aria-live region must be present in the DOM BEFORE its content changes,
  // otherwise most screen readers never announce the insertion (the classic
  // "live region added with content" failure). So the region stays mounted and
  // only the bar inside it is conditional.
  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="of-snackbar pointer-events-none fixed inset-x-0 z-[70] flex justify-center p-4"
    >
      {!open ? null : (
      <div
        className="pointer-events-auto flex w-full max-w-sm items-center gap-4 rounded-xl bg-zinc-900 px-4 py-3 text-sm text-white shadow-2xl"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <span className="flex-1">{message}</span>
        <button
          type="button"
          onClick={() => {
            onUndoRef.current();
            onCloseRef.current();
          }}
          className="min-h-11 min-w-11 shrink-0 rounded-md px-3 py-2 text-sm font-semibold text-[var(--accent)] transition-colors hover:brightness-110"
        >
          {undoLabel}
        </button>
      </div>
      )}
    </div>
  );
}
