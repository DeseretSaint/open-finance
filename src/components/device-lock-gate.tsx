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
 * locked, the app shows this PIN pad instead of the UI. Also surfaces the
 * "set up device lock" card for first-time mobile users. Web/desktop ignores
 * the gate entirely (lock is a mobile concept — the desktop session is the
 * cookie).
 */
export function DeviceLockGate({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [isMobile, setIsMobile] = useState(false);
  const [pin, setPin] = useState("");
  const [setupPin, setSetupPin] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
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

  async function savePin() {
    setErr(null);
    try {
      await api.post("/api/device-lock/pin", { pin: setupPin });
      setSetupPin("");
      qc.invalidateQueries({ queryKey: ["device-lock"] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed.");
    }
  }

  if (!isMobile || lock.isLoading || !lock.data) return <>{children}</>;

  // locked → PIN pad
  if (lock.data.locked) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6">
        <h1 className="text-xl font-semibold">Device locked</h1>
        <p className="text-sm text-muted-foreground">Enter your PIN to unlock.</p>
        <Input
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

  // not configured → show setup card above the app (dismissible)
  if (!lock.data.configured) {
    return (
      <>
        <div className="fixed inset-x-0 top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-2 text-sm">
            <span>Set a device PIN to lock the app on this phone.</span>
            <div className="flex items-center gap-2">
              <Input
                type="password"
                inputMode="numeric"
                placeholder="4–12 digits"
                value={setupPin}
                onChange={(e) => setSetupPin(e.target.value.replace(/\D/g, "").slice(0, 12))}
                className="w-28"
              />
              <Button size="sm" onClick={savePin}>
                Set PIN
              </Button>
            </div>
          </div>
        </div>
        <div className="pt-10">{children}</div>
      </>
    );
  }

  return <>{children}</>;
}
