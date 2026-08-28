"use client";

import { useEffect } from "react";

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
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(onClose, duration);
    return () => clearTimeout(id);
  }, [open, duration, onClose]);

  if (!open) return null;
  return (
    <div
      role="status"
      aria-live="polite"
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
          className="shrink-0 rounded-md px-2 py-1 text-sm font-semibold text-[var(--accent)] transition-colors hover:brightness-110"
        >
          {undoLabel}
        </button>
      </div>
    </div>
  );
}
