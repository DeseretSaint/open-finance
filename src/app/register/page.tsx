"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { isSoloCandidate } from "@/lib/mobile-mode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function RegisterPage() {
  const router = useRouter();
  const [solo, setSolo] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
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
        // Device bootstrap: display name + PIN → returns a one-time recovery code.
        const res = await api.post<{ recoveryCode: string; user: { display_name: string } }>(
          "/api/auth/register",
          { display_name: displayName || "This phone", pin }
        );
        setRecoveryCode(res.recoveryCode);
      } else {
        await api.post("/api/auth/register", { username, display_name: displayName, password });
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
        className="flex min-h-screen items-center justify-center bg-background p-6"
        style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="w-full max-w-sm">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold text-text">Your device is ready</h1>
            <p className="mt-1 text-sm text-text-muted">
              This phone is now your standalone wallet. Everything stays on-device.
            </p>
          </div>
          <div className="space-y-3 rounded-xl border border-border bg-surface p-6 shadow-[var(--shadow-card)]">
            <div>
              <p className="text-sm font-medium text-text">Recovery code (save this!)</p>
              <p className="mt-1 rounded-lg bg-background p-3 font-mono text-sm tracking-widest text-accent">
                {recoveryCode}
              </p>
              <p className="mt-2 text-xs text-text-muted">
                If you forget your PIN, this code is the only way to reset it. It is shown
                once and never again.
              </p>
            </div>
            <Button className="w-full" onClick={() => router.push("/dashboard")}>
              Continue
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-background p-6"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
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
        <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-surface p-6 shadow-[var(--shadow-card)]">
          <Input
            placeholder="Display name (optional)"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoFocus
          />
          {solo ? (
            <>
              <Input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={12}
                placeholder="PIN (4–12 digits)"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))}
              />
              <p className="text-xs text-text-muted">
                Your PIN unlocks this app. Choose 4–12 digits.
              </p>
            </>
          ) : (
            <>
              <Input
                placeholder="Username (your login)"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <Input
                type="password"
                placeholder="Password (10+ characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Setting up…" : solo ? "Set up device" : "Create account"}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-text-muted">
          {solo ? (
            "Already set up? "
          ) : (
            "Already have an account? "
          )}
          <Link href="/login" className="font-medium text-accent">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
