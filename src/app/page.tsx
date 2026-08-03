"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { isSoloCandidate } from "@/lib/mobile-mode";
import { LogoMark } from "@/components/sidebar";
import { MotifHero } from "@/components/motif-hero";

/**
 * Landing: either you're creating a new account, or you already have one on
 * this device — in which case we go straight to the unlock screen (PIN or
 * biometric). The demo is always available.
 */
export default function Home() {
  const router = useRouter();
  const [hasAccount, setHasAccount] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isSoloCandidate(window.location.origin)) {
      // Solo: an account exists when the device has been bootstrapped.
      api
        .get<{ exists: boolean }>("/api/device/status")
        .then((r) => setHasAccount(r.exists))
        .catch(() => setHasAccount(false));
    } else {
      // Web: if a session already exists, go straight in (401 → not signed in).
      api
        .get<{ user: { id: string } }>("/api/auth/me")
        .then((r) => {
          if (r.user?.id) router.replace("/dashboard");
          else setHasAccount(false);
        })
        .catch(() => setHasAccount(false));
    }
  }, [router]);

  return (
    <main
      className="forced-dark flex min-h-screen flex-col items-center justify-center bg-background px-5 text-text"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-4 w-fit">
          <LogoMark size={52} />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Open Finance</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-text-muted">
          The finance app that lets you <strong className="text-text">bring your own agent</strong> — and asks
          permission before it looks anywhere. Self-hosted, open source, MIT.
        </p>
        <div className="mt-5">
          <MotifHero />
        </div>
        <div className="mt-6 flex flex-col gap-2.5">
          {hasAccount ? (
            <Link
              href="/login"
              className="w-full rounded-xl px-6 py-3 text-center text-sm font-semibold text-white transition-colors hover:brightness-110"
              style={{ background: "var(--accent)" }}
            >
              Unlock your account
            </Link>
          ) : (
            <Link
              href="/register"
              className="w-full rounded-xl px-6 py-3 text-center text-sm font-semibold text-white transition-colors hover:brightness-110"
              style={{ background: "var(--accent)" }}
            >
              Create an account
            </Link>
          )}
          <Link href="/demo" className="w-full rounded-xl px-6 py-2 text-center text-sm font-medium text-accent">
            Try the live demo →
          </Link>
        </div>

        <div className="mx-auto mt-8 grid gap-3 text-left">
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-sm font-semibold">Your data</p>
            <p className="mt-0.5 text-xs text-text-muted">A SQLite file on your machine or your hub. We run nothing.</p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-sm font-semibold">Your bank</p>
            <p className="mt-0.5 text-xs text-text-muted">Bring your own free Plaid keys — or skip banks entirely and track manually.</p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-sm font-semibold">Your agent</p>
            <p className="mt-0.5 text-xs text-text-muted">Read-only by default. You control every read and write — change it anytime.</p>
          </div>
        </div>
      </div>
    </main>
  );
}
