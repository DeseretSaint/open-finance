"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { isSoloCandidate } from "@/lib/mobile-mode";
import { hasWindow } from "@/lib/browser-env";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { CustomSelect } from "@/components/ui/custom-select";
import { LogoMark } from "@/components/sidebar";
import { MotifHero } from "@/components/motif-hero";
import { useKeyboardHeight } from "@/lib/use-keyboard-height";

const DURATIONS = [
  { value: "1h", label: "1 hour" },
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "forever", label: "Forever (not recommended)" },
] as const;

export default function LoginPage() {
  const kbdHeight = useKeyboardHeight();
  const router = useRouter();
  const [solo, setSolo] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [duration, setDuration] = useState<string>("30d");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPin, setNewPin] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryMsg, setRecoveryMsg] = useState<string | null>(null);

  useEffect(() => {
    if (hasWindow()) {
      setSolo(isSoloCandidate(window.location.origin));
    }
  }, []);


  const lock = useQuery({
    queryKey: ["device-lock"],
    queryFn: () => api.get<{ configured: boolean; biometricEnabled: boolean }>("/api/device-lock"),
    enabled: solo,
    retry: false,
  });

  async function unlockWithBiometric() {
    setError(null);
    setBioBusy(true);
    try {
      const { authenticateBiometric } = await import("@/lib/biometric");
      const ok = await authenticateBiometric("Unlock Open Finance");
      if (!ok) return; // cancelled → stay on PIN
      await api.post("/api/device-lock/biometric");
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Biometric unlock failed.");
    } finally {
      setBioBusy(false);
    }
  }

  async function submitRecovery() {
    setRecoveryBusy(true);
    setError(null);
    setRecoveryMsg(null);
    try {
      await api.post("/api/auth/recovery", { recovery_code: recoveryCode.trim(), new_pin: newPin });
      setRecoveryMsg("PIN reset — sign in with your new PIN.");
      setPin(newPin);
      setNewPin("");
      setRecoveryCode("");
      setShowRecovery(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset PIN — check your recovery code.");
    } finally {
      setRecoveryBusy(false);
    }
  }

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
      className="forced-dark flex min-h-screen items-center justify-center bg-background p-6"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: `calc(env(safe-area-inset-bottom) + ${kbdHeight}px)`,
      }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 w-fit">
            <LogoMark size={48} />
          </div>
          <h1 className="text-2xl font-bold text-text">Open Finance</h1>
          <p className="mt-1 text-sm text-text-muted">
            {solo ? "This phone is your wallet. Data stays on-device." : "Self-hosted. Your data, your machine."}
          </p>
        </div>
        <div className="mb-4">
          <MotifHero compact />
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-card)]">
          {solo ? (
            <>
              {lock.data?.biometricEnabled && (
                <Button type="button" variant="secondary" onClick={unlockWithBiometric} disabled={bioBusy} className="w-full" size="lg">
                  {bioBusy ? "Checking…" : "Unlock with biometrics"}
                </Button>
              )}
              <div>
                <label htmlFor="login-pin" className="mb-1 block text-xs font-medium text-text-muted">
                  Device PIN
                </label>
                <Input
                  id="login-pin"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={12}
                  placeholder="Enter your PIN"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))}
                  autoFocus
                />
              </div>
              {error && (
                <p role="alert" className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={busy || !pin} className="w-full" size="lg">
                {busy ? "Unlocking…" : "Unlock"}
              </Button>
              {recoveryMsg && (
                <p role="status" className="rounded-lg bg-[var(--success-soft)] px-3 py-2 text-sm text-success">
                  {recoveryMsg}
                </p>
              )}
              <button
                type="button"
                onClick={() => {
                  setShowRecovery((v) => !v);
                  setError(null);
                  setRecoveryMsg(null);
                }}
                className="w-full text-center text-xs font-medium text-accent-text"
              >
                {showRecovery ? "Back to PIN" : "Forgot your PIN?"}
              </button>
              {showRecovery && (
                <div className="space-y-3 rounded-xl border border-border bg-surface-muted p-4">
                  <p className="text-xs text-text-muted">
                    Enter the <strong className="text-text">recovery code</strong> you saved during setup, plus a new
                    PIN. This is the only way to reset it without wiping the app.
                  </p>
                  <div>
                    <label htmlFor="recovery-code" className="mb-1 block text-xs font-medium text-text-muted">
                      Recovery code
                    </label>
                    <Input
                      id="recovery-code"
                      placeholder="Recovery code"
                      value={recoveryCode}
                      onChange={(e) => setRecoveryCode(e.target.value)}
                      className="font-mono"
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label htmlFor="recovery-new-pin" className="mb-1 block text-xs font-medium text-text-muted">
                      New PIN
                    </label>
                    <Input
                      id="recovery-new-pin"
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={12}
                      placeholder="New PIN (4–12 digits)"
                      value={newPin}
                      onChange={(e) => setNewPin(e.target.value.replace(/[^0-9]/g, "").slice(0, 12))}
                      autoComplete="off"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={submitRecovery}
                    disabled={recoveryBusy || recoveryCode.trim().length < 8 || newPin.length < 4}
                    className="w-full"
                  >
                    {recoveryBusy ? "Resetting…" : "Reset PIN"}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <>
              <div>
                <label htmlFor="login-username" className="mb-1 block text-xs font-medium text-text-muted">
                  Username
                </label>
                <Input id="login-username" autoComplete="username" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
              </div>
              <div>
                <label htmlFor="login-password" className="mb-1 block text-xs font-medium text-text-muted">
                  Password
                </label>
                <PasswordInput
                  id="login-password"
                  autoComplete="current-password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div>
                <label id="login-duration-label" className="mb-1 block text-xs font-medium text-text-muted">
                  Stay signed in
                </label>
                <CustomSelect
                  ariaLabel="Stay signed in"
                  value={duration}
                  onChange={setDuration}
                  options={DURATIONS.map((d) => ({ value: d.value, label: d.label }))}
                />
              </div>
              {error && (
                <p role="alert" className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={busy || !username || !password} className="w-full" size="lg">
                {busy ? "Signing in…" : "Sign in"}
              </Button>
            </>
          )}
        </form>
        <p className="mt-4 text-center text-sm text-text-muted">
          {solo ? "New phone? " : "New here? "}
          <Link href="/register" className="font-medium text-accent-text">
            {solo ? "Set up this device" : "Create an account"}
          </Link>
        </p>
      </div>
    </main>
  );
}
