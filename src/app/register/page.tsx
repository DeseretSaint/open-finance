"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { isSoloCandidate } from "@/lib/mobile-mode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MotifHero } from "@/components/motif-hero";
import { useKeyboardHeight } from "@/lib/use-keyboard-height";

export default function RegisterPage() {
  const kbdHeight = useKeyboardHeight();
  const router = useRouter();
  const [solo, setSolo] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setSolo(isSoloCandidate(window.location.origin));
    }
  }, []);


  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (solo) {
        // Device bootstrap: display name → one-time recovery code. The PIN is
        // set in the onboarding wizard's Security step (P12).
        const res = await api.post<{ recoveryCode: string; user: { display_name: string } }>(
          "/api/auth/register",
          { display_name: displayName || "This phone" }
        );
        setRecoveryCode(res.recoveryCode);
      } else {
        await api.post("/api/auth/register", { username, display_name: displayName, password, device_label: "Web browser" });
        try { localStorage.setItem("of-has-account", "1"); } catch { /* private mode */ }
        router.push("/dashboard");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed.");
    } finally {
      setBusy(false);
    }
  }

  // After solo bootstrap: show the recovery code once, then proceed.
  if (solo && recoveryCode) {
    return (
      <main
        className="forced-dark flex min-h-screen items-center justify-center bg-background p-6"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: `calc(env(safe-area-inset-bottom) + ${kbdHeight}px)`,
        }}
      >
        <div className="w-full max-w-sm">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold text-text">Your device is ready</h1>
            <p className="mt-1 text-sm text-text-muted">
              This phone is now your standalone wallet. Everything stays on-device.
            </p>
          </div>
          <div className="space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-card)]">
            <div>
              <p className="text-sm font-medium text-text">Recovery code (save this!)</p>
              <p className="mt-1 rounded-lg bg-background p-3 font-mono text-sm tracking-widest text-accent">
                {recoveryCode}
              </p>
              <p className="mt-2 text-xs text-text-muted">
                If you forget your PIN, this code is the only way to reset it. It is shown
                once and never again. You&apos;ll set your PIN in the next step.
              </p>
            </div>
            <Button className="w-full" size="lg" onClick={() => router.push("/dashboard")}>
              Continue
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main
      className="forced-dark flex min-h-screen items-center justify-center bg-background p-6"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: `calc(env(safe-area-inset-bottom) + ${kbdHeight}px)`,
      }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-text">
            {solo ? "Set up this phone" : "Create your account"}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {solo
              ? "Runs fully on this device — no server, no hub. You can connect a hub later."
              : "Runs entirely on your machine."}
          </p>
        </div>
        <div className="mb-4">
          <MotifHero compact />
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-card)]">
          <div>
            <label htmlFor="reg-display" className="mb-1 block text-xs font-medium text-text-muted">
              Display name <span className="font-normal">(optional)</span>
            </label>
            <Input
              id="reg-display"
              autoComplete="name"
              placeholder="Shown in the app"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoFocus
            />
          </div>
          {!solo && (
            <>
              <div>
                <label htmlFor="reg-username" className="mb-1 block text-xs font-medium text-text-muted">
                  Username
                </label>
                <Input
                  id="reg-username"
                  autoComplete="username"
                  placeholder="Your login name"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="reg-password" className="mb-1 block text-xs font-medium text-text-muted">
                  Password
                </label>
                <Input
                  id="reg-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Choose a password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-xs text-text-muted">
                  <li>Anything you&apos;ll remember — no minimum length</li>
                  <li>Not your username or a common password</li>
                </ul>
              </div>
            </>
          )}
          {error && (
            <p role="alert" className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <Button
            type="submit"
            disabled={busy || (!solo && (!username || !password))}
            className="w-full"
            size="lg"
          >
            {busy ? "Setting up…" : solo ? "Set up device" : "Create account"}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-text-muted">
          {solo ? "Already set up? " : "Already have an account? "}
          <Link href="/login" className="font-medium text-accent">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

