"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { hasWindow } from "@/lib/browser-env";

/**
 * Custom select — replaces the native <select> (which pops the stock Android
 * picker). Renders a bottom sheet on mobile and a popover on desktop.
 *
 * Keyboard listbox pattern (WAI-ARIA): the popup is a single tab stop
 * (role="listbox", tabIndex=0) that owns an `aria-activedescendant` pointing
 * at the active option; ArrowUp/Down/Home/End move the active option,
 * Enter/Space choose it, Escape closes. Focus is moved into the listbox the
 * moment it opens so keyboard and screen-reader users land inside it (the
 * previous build left focus on the trigger, reachable only by tabbing).
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
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  // Reset the active option to the current selection and move focus into the
  // listbox whenever it opens.
  useEffect(() => {
    if (!open) return;
    const idx = Math.max(0, options.findIndex((o) => o.value === value));
    setActiveIndex(idx);
    listRef.current?.focus();
  }, [open, options, value]);

  // Keep the active option scrolled into view as it changes.
  useEffect(() => {
    if (!open || !hasWindow()) return;
    document
      .getElementById(`of-cs-opt-${activeIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function onListKey(e: React.KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => Math.min(options.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        e.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        {
          const o = options[activeIndex];
          if (o) {
            onChange(o.value);
            setOpen(false);
          }
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
    }
  }

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            setActiveIndex(
              e.key === "ArrowDown" ? 0 : Math.max(0, options.length - 1)
            );
          }
        }}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 text-sm text-text focus:outline-2 focus:outline-accent"
      >
        <span className={selected ? "" : "text-text-muted"}>
          {selected ? selected.label : placeholder}
        </span>
        <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0 text-text-muted" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 4.5L6 8L9.5 4.5" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setOpen(false)} />
          <div
            ref={listRef}
            role="listbox"
            tabIndex={0}
            aria-activedescendant={`of-cs-opt-${activeIndex}`}
            onKeyDown={onListKey}
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border border-border bg-surface p-3 shadow-2xl outline-none md:absolute md:inset-x-auto md:bottom-auto md:mt-1 md:w-full md:rounded-xl"
            style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
          >
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border md:hidden" />
            <div className="max-h-[45dvh] overflow-y-auto md:max-h-72">
              {options.map((o, i) => (
                <div
                  key={o.value}
                  id={`of-cs-opt-${i}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={o.value === value}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                    o.value === value
                      ? "bg-accent/10 font-medium text-accent-text"
                      : "text-text hover:bg-surface-muted",
                    i === activeIndex ? "ring-1 ring-accent" : ""
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
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export type { ReactNode };
