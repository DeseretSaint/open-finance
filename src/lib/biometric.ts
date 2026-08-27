"use client";

/**
 * Biometric unlock bridge (P11) — fingerprint / face via the native
 * BiometricPrompt, provided by @aparajita/capacitor-biometric-auth (registered
 * natively by `cap sync`). Falls back gracefully when the native plugin isn't
 * present (desktop web / tests).
 */

import { BiometricAuth } from "@aparajita/capacitor-biometric-auth";

export interface BiometricAvailability {
  available: boolean;
  strong: boolean;
  type: "fingerprint" | "face" | "iris" | "none";
}

function nativeAvailable(): boolean {
  if (typeof window === "undefined") return false;
  // SAFETY: window is the only handle to the Capacitor bridge on native; cast to read its shape.
  const cap = (window as unknown as { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

export async function checkBiometricAvailability(): Promise<BiometricAvailability> {
  if (!nativeAvailable()) return { available: false, strong: false, type: "none" };
  try {
    const r = await BiometricAuth.checkBiometry();
    return {
      available: r.isAvailable,
      strong: r.strongBiometryIsAvailable,
      // SAFETY: native biometryType is a free-form string; coerce to our closed union, defaulting to "none".
      type: (r.biometryType as unknown as BiometricAvailability["type"]) ?? "none",
    };
  } catch {
    return { available: false, strong: false, type: "none" };
  }
}

/** Returns true only on successful biometric authentication. */
export async function authenticateBiometric(reason: string): Promise<boolean> {
  if (!nativeAvailable()) return false;
  try {
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: "Use PIN instead",
      allowDeviceCredential: true,
    });
    return true;
  } catch {
    return false; // cancelled or failed — caller falls back to PIN
  }
}
