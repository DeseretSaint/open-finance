"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Custom select — replaces the native <select> (which pops the stock Android
 * picker). Renders a bottom sheet on mobile and a popover on desktop.
 */
export interface CustomSelectOption {
  value: string;
  label: string;
  hint?: string;
}

export function CustomSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: CustomSelectOption[];
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 text-sm text-text focus:outline-2 focus:outline-accent"
      >
        <span className={selected ? "" : "text-text-muted"}>{selected ? selected.label : placeholder}</span>
        <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0 text-text-muted" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 4.5L6 8L9.5 4.5" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setOpen(false)} />
          <div
            role="listbox"
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border border-border bg-surface p-3 shadow-2xl md:absolute md:inset-x-auto md:bottom-auto md:mt-1 md:w-full md:rounded-xl"
            style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
          >
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border md:hidden" />
            <div className="max-h-[45dvh] overflow-y-auto md:max-h-72">
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                    o.value === value ? "bg-accent/10 font-medium text-accent-text" : "text-text hover:bg-surface-muted"
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{o.label}</span>
                    {o.hint && <span className="block truncate text-xs text-text-muted">{o.hint}</span>}
                  </span>
                  {o.value === value && (
                    <svg viewBox="0 0 12 12" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 6.5L4.5 9L10 3" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export type { ReactNode };
