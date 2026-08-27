"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * SettingsGroup — a labeled section that groups related setting cards.
 * Used to replace the flat 15-card wall on the Settings page with a small
 * number of scannable groups (Account · Security · Connections · AI · Data).
 */
export function SettingsGroup({
  title,
  description,
  children,
  defaultOpen = true,
  collapsible = false,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const body = <div className="grid gap-6 lg:grid-cols-2">{children}</div>;

  if (!collapsible) {
    return (
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-text-muted">{description}</p>}
        </div>
        {body}
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-left"
      >
        <span>
          <span className="text-sm font-semibold uppercase tracking-wide text-text-muted">{title}</span>
          {description && <span className="mt-0.5 block text-xs text-text-muted">{description}</span>}
        </span>
        <ChevronDown
          size={16}
          className={cn("shrink-0 text-text-muted transition-transform", open ? "rotate-180" : "")}
        />
      </button>
      {open && body}
    </section>
  );
}

/**
 * Disclosure — an inline collapsible for hiding advanced/detail controls
 * inside an otherwise simple card (progressive disclosure).
 */
export function Disclosure({
  label,
  children,
  defaultOpen = false,
}: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-xs font-medium text-accent-text transition-colors hover:underline"
      >
        <ChevronDown size={13} className={cn("transition-transform", open ? "rotate-180" : "")} />
        {open ? `Hide ${label}` : label}
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}
