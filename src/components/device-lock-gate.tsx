"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface LockState {
  configured: boolean;
  biometricEnabled: boolean;
  locked: boolean;
  retryAfterMs: number | null;
}

/**
 * Device lock gate (P8a §10): when a PIN is configured and the device is
 * locked, the app shows this PIN pad instead of the UI. Web/desktop ignores
 * the gate entirely (lock is a mobile concept — the desktop session is the
 * cookie).
 *
 * P11: biometric unlock — when the user enabled biometrics, the locked
 * screen offers fingerprint/face via the native prompt, falling back to the
 * PIN (and the PIN remains the recovery path).
 *
 * P12: PIN setup lives in the onboarding wizard (first-run) and Settings
 * (reset via the recovery code). No nag banner here — if no PIN is
 * configured, the app simply isn't locked.
 */
export function DeviceLockGate({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [isMobile, setIsMobile] = useState(false);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [bioBusy, setBioBusy] = useState(false);

  useEffect(() => {
    const cap = window.Capacitor;
    setIsMobile(!!cap?.isNativePlatform?.());
  }, []);

  const lock = useQuery({
    queryKey: ["device-lock"],
    queryFn: () => api.get<LockState>("/api/device-lock"),
    enabled: isMobile,
    staleTime: 10_000,
  });

  async function unlock() {
    setErr(null);
    try {
      await api.post("/api/device-lock/unlock", { pin });
      setPin("");
      qc.invalidateQueries({ queryKey: ["device-lock"] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Wrong PIN.");
      setPin("");
    }
  }

  async function unlockWithBiometric() {
    setErr(null);
    setBioBusy(true);
    try {
      const { authenticateBiometric } = await import("@/lib/biometric");
      const ok = await authenticateBiometric("Unlock Open Finance");
      if (!ok) return; // cancelled → stay on the PIN pad
      await api.post("/api/device-lock/biometric");
      qc.invalidateQueries({ queryKey: ["device-lock"] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Biometric unlock failed.");
    } finally {
      setBioBusy(false);
    }
  }

  if (!isMobile || lock.isLoading) return <>{children}</>;

  // FAIL CLOSED: if the lock-status fetch errored (or settled with no data),
  // do NOT render the app — a failed /api/device-lock call must never
  // silently unlock the device. Show a calm error + retry instead.
  if (lock.isError || !lock.data) {
    return (
      <div
        className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background p-6"
        style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <h1 className="text-xl font-semibold">Device lock unavailable</h1>
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t verify your device lock status.
        </p>
        <Button onClick={() => lock.refetch()} disabled={lock.isFetching} className="w-48">
          {lock.isFetching ? "Retrying…" : "Try again"}
        </Button>
      </div>
    );
  }

  // No PIN configured → not locked, nothing to show (setup lives in the
  // onboarding wizard / Settings).
  if (!lock.data.configured) return <>{children}</>;

  // locked → PIN pad + biometric option
  if (lock.data.locked) {
    return (
      <div
        className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background p-6"
        style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <h1 className="text-xl font-semibold">Device locked</h1>
        <p className="text-sm text-muted-foreground">Enter your PIN to unlock.</p>
        {lock.data.biometricEnabled && (
          <Button variant="secondary" onClick={unlockWithBiometric} disabled={bioBusy} className="w-48">
            {bioBusy ? "Checking…" : "Unlock with biometrics"}
          </Button>
        )}
        <Input aria-label={"Device PIN"}
          type="password"
          inputMode="numeric"
          autoFocus
          placeholder="••••"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 12))}
          onKeyDown={(e) => e.key === "Enter" && unlock()}
          className="w-40 text-center text-xl tracking-widest"
        />
        <Button onClick={unlock}>Unlock</Button>
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>
    );
  }

  return <>{children}</>;
}

