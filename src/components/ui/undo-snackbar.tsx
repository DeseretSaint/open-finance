"use client";

import { useEffect, useState } from "react";

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

  useEffect(() => {
    if (!open || paused) return;
    const id = setTimeout(onClose, duration);
    return () => clearTimeout(id);
  }, [open, paused, duration, onClose]);

  useEffect(() => {
    if (!open) setPaused(false);
  }, [open]);

  if (!open) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="fixed inset-x-0 bottom-0 z-[70] flex justify-center p-4 md:bottom-4"
    >
      <div
        className="flex w-full max-w-sm items-center gap-4 rounded-xl bg-zinc-900 px-4 py-3 text-sm text-white shadow-2xl"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <span className="flex-1">{message}</span>
        <button
          type="button"
          onClick={() => {
            onUndo();
            onClose();
          }}
          className="min-h-11 min-w-11 shrink-0 rounded-md px-3 py-2 text-sm font-semibold text-[var(--accent)] transition-colors hover:brightness-110"
        >
          {undoLabel}
        </button>
      </div>
    </div>
  );
}
