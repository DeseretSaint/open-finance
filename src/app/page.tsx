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

  function safeLocalGet(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  const [showPair, setShowPair] = useState(false);
  const [hubUrl, setHubUrl] = useState("");
  const [pairBusy, setPairBusy] = useState(false);
  const [pairErr, setPairErr] = useState<string | null>(null);

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
      // If this browser has completed sign-up before but the session expired,
      // route straight to /login instead of showing "Create an account" again.
      api
        .get<{ user: { id: string } }>("/api/auth/me")
        .then((r) => {
          if (r.user?.id) router.replace("/dashboard");
          else if (safeLocalGet("of-has-account") === "1") router.replace("/login");
          else setHasAccount(false);
        })
        .catch(() => {
          if (safeLocalGet("of-has-account") === "1") router.replace("/login");
          else setHasAccount(false);
        });
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
          <button
            type="button"
            onClick={() => setShowPair((v) => !v)}
            className="w-full rounded-xl border border-border px-6 py-2.5 text-center text-sm font-medium text-accent hover:bg-surface"
          >
            Pair an existing standalone phone
          </button>
          <Link href="/demo" className="w-full rounded-xl px-6 py-2 text-center text-sm font-medium text-accent">
            Try the live demo →
          </Link>
        </div>

        {showPair && (
          <div className="mt-4 rounded-2xl border border-accent/30 bg-surface p-5 text-left">
            <h2 className="text-base font-semibold">Pair an existing standalone phone</h2>
            <p className="mt-1 text-xs text-text-muted">
              First pair the phone to this computer. Then export the encrypted phone backup from Settings on the phone
              and import it here. This adds data; it never clears the phone or requires reconnecting Plaid.
            </p>
            <label className="mt-3 block text-xs font-medium text-text-muted" htmlFor="hub-url">Hub URL</label>
            <input id="hub-url" value={hubUrl} onChange={(e) => setHubUrl(e.target.value)} placeholder="http://100.x.y.z:3000" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text" />
            <button
              type="button"
              disabled={pairBusy || !hubUrl.trim()}
              onClick={async () => {
                setPairBusy(true); setPairErr(null);
                try { const base = hubUrl.trim().replace(/\/+$/, ""); localStorage.setItem("of-hub-url", base); window.location.href = `${base}/pair?import=1`; }
                catch (e) { setPairErr(e instanceof Error ? e.message : "Could not open the phone pairing page."); setPairBusy(false); }
              }}
              className="mt-3 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: "var(--accent)" }}
            >{pairBusy ? "Opening pairing…" : "Pair this hub to my phone"}</button>
            {pairErr && <p className="mt-2 text-xs text-danger">{pairErr}</p>}
          </div>
        )}

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
