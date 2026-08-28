"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useDialogA11y } from "@/lib/use-dialog-a11y";

/**
 * Custom date picker — replaces <input type="date"> (stock Android picker).
 * Month-grid popover on desktop, bottom sheet on mobile. Returns YYYY-MM-DD.
 */
function toParts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y: y || new Date().getFullYear(), m: m || new Date().getMonth() + 1, d: d || 1 };
}

function fmt(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export function CustomDatePicker({
  value,
  onChange,
  max,
  min,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  max?: string;
  min?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useDialogA11y(open, () => setOpen(false));
  const gridRef = useRef<HTMLDivElement | null>(null);
  const { y: vy, m: vm } = toParts(value);
  const [viewY, setViewY] = useState(vy);
  const [viewM, setViewM] = useState(vm);
  const today = new Date();
  const todayStr = fmt(today.getFullYear(), today.getMonth() + 1, today.getDate());

  // Grid keyboard nav: arrows move focus between day cells (7-col wrap),
  // Enter/Space selects the focused day. Mirrors the CustomSelect listbox
  // a11y pattern so the picker is reachable without a pointer (run 182).
  function onGridKey(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " "].includes(e.key)) return;
    const grid = gridRef.current;
    if (!grid) return;
    const days = Array.from(grid.querySelectorAll<HTMLButtonElement>("button[data-day]"));
    if (days.length === 0) return;
    const cur = days.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Enter" || e.key === " ") {
      if (cur >= 0) {
        e.preventDefault();
        days[cur].click();
      }
      return;
    }
    e.preventDefault();
    const cols = 7;
    let next = cur < 0 ? 0 : cur;
    if (e.key === "ArrowRight") next = Math.min(days.length - 1, cur + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, cur - 1);
    else if (e.key === "ArrowDown") next = Math.min(days.length - 1, cur + cols);
    else if (e.key === "ArrowUp") next = Math.max(0, cur - cols);
    days[next]?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const { y, m } = toParts(value);
    setViewY(y);
    setViewM(m);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, value]);

  const cells = useMemo(() => {
    const first = new Date(viewY, viewM - 1, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(viewY, viewM, 0).getDate();
    const out: Array<{ iso: string; day: number; disabled: boolean }> = [];
    for (let i = 0; i < startPad; i++) out.push({ iso: "", day: 0, disabled: true });
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = fmt(viewY, viewM, d);
      const disabled = (min !== undefined && iso < min) || (max !== undefined && iso > max);
      out.push({ iso, day: d, disabled });
    }
    return out;
  }, [viewY, viewM, min, max]);

  function shift(deltaY: number, deltaM: number) {
    let y = viewY + deltaY;
    let m = viewM + deltaM;
    while (m < 1) { m += 12; y--; }
    while (m > 12) { m -= 12; y++; }
    setViewY(y);
    setViewM(m);
  }

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
        <span>{value || "Select date"}</span>
        <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0 text-text-muted" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1.5" y="2" width="9" height="8" rx="1" />
          <path d="M1.5 4.5h9M4 1v2M8 1v2" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setOpen(false)} />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Pick a date"
            className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-[640px] rounded-t-[28px] border border-border bg-surface p-4 shadow-2xl md:absolute md:inset-x-auto md:bottom-auto md:mt-1 md:w-72 md:max-w-full md:rounded-xl"
            style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
          >
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border md:hidden" />
            <div className="mb-3 flex items-center justify-between">
              <button type="button" aria-label="Previous month" onClick={() => shift(0, -1)} className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-muted">
                <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7.5 2.5L4 6l3.5 3.5" /></svg>
              </button>
              <p className="text-sm font-semibold text-text">
                {MONTHS[viewM - 1]} {viewY}
              </p>
              <button type="button" aria-label="Next month" onClick={() => shift(0, 1)} className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-muted">
                <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 2.5L8 6l-3.5 3.5" /></svg>
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center" ref={gridRef} onKeyDown={onGridKey}>
              {WEEKDAYS.map((w, i) => (
                <span key={i} className="py-1 text-[10px] font-medium uppercase text-text-muted">{w}</span>
              ))}
              {cells.map((c, i) =>
                c.disabled ? (
                  <span key={i} className="h-8" />
                ) : (
                  <button
                    key={i}
                    type="button"
                    data-day={c.iso}
                    disabled={c.disabled}
                    onClick={() => {
                      onChange(c.iso);
                      setOpen(false);
                    }}
                    className={cn(
                      "h-8 rounded-md text-xs transition-colors",
                      c.iso === value
                        ? "bg-accent font-semibold text-[var(--accent-foreground)]"
                        : c.iso === todayStr
                          ? "font-semibold text-accent-text hover:bg-surface-muted"
                          : "text-text hover:bg-surface-muted"
                    )}
                  >
                    {c.day}
                  </button>
                )
              )}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
              <button type="button" onClick={() => { onChange(todayStr); setOpen(false); }} className="text-xs font-medium text-accent-text">
                Today
              </button>
              <button type="button" onClick={() => setOpen(false)} className="text-xs text-text-muted">
                Close
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
