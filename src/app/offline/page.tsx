import type { Metadata } from "next";
import Link from "next/link";
import { WifiOff } from "lucide-react";

export const metadata: Metadata = {
  title: "Offline — Open Finance",
};

/**
 * Serwist navigation fallback (run 22): served by the service worker when a
 * page navigation can't be answered from network or cache while offline.
 * Static, token-styled, no client JS — must render with zero network access.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-[var(--shadow-card)]">
        <WifiOff className="mx-auto h-10 w-10 text-text-muted" aria-hidden="true" />
        <h1 className="mt-4 text-lg font-semibold text-text">You&apos;re offline</h1>
        <p className="mt-2 text-sm text-text-muted">
          Open Finance can&apos;t reach the server right now. Pages you&apos;ve
          visited before will still load — check your connection and try again.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:brightness-110"
        >
          Try again
        </Link>
      </div>
    </main>
  );
}
