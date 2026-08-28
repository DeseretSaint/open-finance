"use client";

import { useEscapeToClose } from "@/lib/use-escape-to-close";
import { useDialogA11y } from "@/lib/use-dialog-a11y";

/**
 * Custom confirmation dialog — replaces window.confirm() (which pops the
 * stock Android dialog). Bottom sheet on mobile, centered dialog on desktop,
 * styled with the app's design tokens. Danger-tone by default.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  tone = "danger",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEscapeToClose(() => { if (!busy) onCancel(); }, open);
  const ref = useDialogA11y(open, () => {
    if (!busy) onCancel();
  });

  if (!open) return null;
  return (
    <div
      ref={ref}
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm md:items-center md:p-6"
      onClick={() => !busy && onCancel()}
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full overflow-hidden rounded-t-3xl border border-border bg-surface p-5 shadow-2xl md:max-w-sm md:rounded-3xl"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border md:hidden" />
        <h3 className="text-base font-semibold text-text">{title}</h3>
        {message && <p className="mt-1.5 text-sm text-text-muted">{message}</p>}
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-11 flex-1 rounded-xl border border-border bg-surface px-4 text-sm font-medium text-text transition-colors hover:bg-surface-muted disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="h-11 flex-1 rounded-xl px-4 text-sm font-semibold transition-colors hover:brightness-110 disabled:opacity-50"
            style={tone === "danger" ? { background: "var(--danger)", color: "var(--danger-foreground)" } : { background: "var(--accent)", color: "var(--accent-foreground)" }}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
