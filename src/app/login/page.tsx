"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { isSoloCandidate } from "@/lib/mobile-mode";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

const DURATIONS = [
  { value: "1h", label: "1 hour" },
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "forever", label: "Forever (not recommended)" },
] as const;

export default function LoginPage() {
  const router = useRouter();
  const [solo, setSolo] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [duration, setDuration] = useState<string>("30d");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        // Solo unlock: verify the device PIN (device-lock). No session needed.
        await api.post("/api/device-lock/unlock", { pin });
        router.push("/dashboard");
        router.refresh();
      } else {
        await api.post("/api/auth/login", {
          username,
          password,
          duration,
          device_label: "Web browser",
        });
        router.push("/dashboard");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-background p-6"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div
            className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl text-xl font-bold"
            style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}
          >
            ₿
          </div>
          <h1 className="text-2xl font-bold text-text">Open Finance</h1>
          <p className="mt-1 text-sm text-text-muted">
            {solo ? "This phone is your wallet. Data stays on-device." : "Self-hosted. Your data, your machine."}
          </p>
        </div>
        <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-surface p-6 shadow-[var(--shadow-card)]">
          {solo ? (
            <>
              <Input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={12}
                placeholder="Enter your PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))}
                autoFocus
              />
              {error && <p className="text-sm text-danger">{error}</p>}
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? "Unlocking…" : "Unlock"}
              </Button>
            </>
          ) : (
            <>
              <Input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Select value={duration} onChange={(e) => setDuration(e.target.value)}>
                {DURATIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    Stay signed in for {d.label}
                  </option>
                ))}
              </Select>
              {error && <p className="text-sm text-danger">{error}</p>}
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? "Signing in…" : "Sign in"}
              </Button>
            </>
          )}
        </form>
        <p className="mt-4 text-center text-sm text-text-muted">
          {solo ? "New phone? " : "New here? "}
          <Link href="/register" className="font-medium text-accent">
            {solo ? "Set up this device" : "Create an account"}
          </Link>
        </p>
      </div>
    </main>
  );
}
