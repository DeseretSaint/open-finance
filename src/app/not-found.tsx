import type { Metadata } from "next";
import Link from "next/link";
import { Compass } from "lucide-react";

export const metadata: Metadata = {
  title: "Page not found — Open Finance",
};

/**
 * Root 404 (run 100): served by Next.js for any unmatched route. Without this
 * file the framework renders its default unstyled 404 — off-brand for a calm
 * fintech app. Static, token-styled, no client JS; the root layout's theme
 * script restores dark mode + accent before first paint.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-[var(--shadow-card)]">
        <Compass className="mx-auto h-10 w-10 text-text-muted" aria-hidden="true" />
        <h1 className="mt-4 text-lg font-semibold text-text">Page not found</h1>
        <p className="mt-2 text-sm text-text-muted">
          That page doesn&apos;t exist, or it may have moved. Your data is safe —
          head back to your dashboard.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-block rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:brightness-110"
        >
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
