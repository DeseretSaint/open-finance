"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Custom time picker — replaces <input type="time"> (stock Android dialog).
 * Bottom sheet on mobile, popover on desktop. Value is 24h "HH:MM".
 * Minutes snap to 15-minute steps (00/15/30/45) — plenty for a daily digest.
 */
function parseTime(value: string): { h24: number; m: number } {
  const [h, m] = value.split(":").map(Number);
  return { h24: Number.isFinite(h) ? h : 9, m: Number.isFinite(m) ? m : 0 };
}

function fmtTime(h24: number, m: number): string {
  return `${String(h24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function display(h24: number, m: number): string {
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

const MINUTES = [0, 15, 30, 45];

export function CustomTimePicker({
  value,
  onChange,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const { h24, m } = parseTime(value);
  const [viewH, setViewH] = useState(h24);
  const [viewM, setViewM] = useState(m);

  useEffect(() => {
    if (!open) return;
    const { h24: h, m: mm } = parseTime(value);
    setViewH(h);
    setViewM(mm);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, value]);

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 text-sm text-text focus:outline-2 focus:outline-accent"
      >
        <span>{display(h24, m)}</span>
        <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0 text-text-muted" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="6" cy="6" r="4.25" />
          <path d="M6 3.5V6l1.8 1.2" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label="Pick a time"
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border border-border bg-surface p-4 shadow-2xl md:absolute md:inset-x-auto md:bottom-auto md:mt-1 md:w-72 md:rounded-xl"
            style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
          >
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border md:hidden" />
            <p className="mb-3 text-sm font-semibold text-text">{display(viewH, viewM)}</p>
            <div className="flex items-center gap-4">
              {/* Hour column */}
              <div className="flex-1">
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-text-muted">Hour</p>
                <div className="flex h-32 flex-col gap-1 overflow-y-auto pr-1">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((h12) => {
                    const h24v = viewH >= 12 ? (h12 === 12 ? 12 : h12 + 12) : h12 === 12 ? 0 : h12;
                    const active = h24v === viewH;
                    return (
                      <button
                        key={h12}
                        type="button"
                        onClick={() => setViewH(h24v)}
                        className={cn(
                          "rounded-md py-1.5 text-sm transition-colors",
                          active ? "bg-[var(--accent)] font-semibold text-[var(--accent-foreground)]" : "text-text hover:bg-surface-muted"
                        )}
                      >
                        {h12}
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Minute column */}
              <div className="flex-1">
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-text-muted">Minute</p>
                <div className="flex h-32 flex-col gap-1 overflow-y-auto pr-1">
                  {MINUTES.map((mm) => {
                    const active = mm === viewM;
                    return (
                      <button
                        key={mm}
                        type="button"
                        onClick={() => setViewM(mm)}
                        className={cn(
                          "rounded-md py-1.5 text-sm transition-colors",
                          active ? "bg-[var(--accent)] font-semibold text-[var(--accent-foreground)]" : "text-text hover:bg-surface-muted"
                        )}
                      >
                        {String(mm).padStart(2, "0")}
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* AM/PM */}
              <div className="flex flex-1 flex-col gap-1">
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-text-muted">Period</p>
                {(["AM", "PM"] as const).map((p) => {
                  const active = (p === "PM") === (viewH >= 12);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setViewH((h) => (p === "PM" ? (h % 12) + 12 : h % 12))}
                      className={cn(
                        "rounded-md py-2 text-sm transition-colors",
                        active ? "bg-[var(--accent)] font-semibold text-[var(--accent-foreground)]" : "text-text hover:bg-surface-muted"
                      )}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
              <button
                type="button"
                onClick={() => {
                  const now = new Date();
                  onChange(fmtTime(now.getHours(), Math.floor(now.getMinutes() / 15) * 15));
                  setOpen(false);
                }}
                className="text-xs font-medium text-accent"
              >
                Now
              </button>
              <button type="button" onClick={() => setOpen(false)} className="text-xs text-text-muted">
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange(fmtTime(viewH, viewM));
                  setOpen(false);
                }}
                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-foreground)]"
              >
                Set
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
