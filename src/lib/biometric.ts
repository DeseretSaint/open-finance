"use client";

/**
 * Biometric unlock bridge (P11) — fingerprint / face via the native
 * BiometricPrompt, provided by @aparajita/capacitor-biometric-auth (registered
 * natively by `cap sync`). Falls back gracefully when the native plugin isn't
 * present (desktop web / tests).
 */

import { BiometricAuth } from "@aparajita/capacitor-biometric-auth";

import { hasWindow } from "@/lib/browser-env";

export interface BiometricAvailability {
  available: boolean;
  strong: boolean;
  type: "fingerprint" | "face" | "iris" | "none";
}

/**
 * The native plugin returns the BiometryType enum ORDINAL (0 none, 1 touchId,
 * 2 faceId, 3 fingerprintAuthentication, 4 faceAuthentication, 5 iris), not a
 * string — so it must be mapped, never coerced. A bare `as` would leave a
 * number in the UI ("Unlock with your 3").
 */
function biometryTypeLabel(value: unknown): BiometricAvailability["type"] {
  switch (value) {
    case 1: // touchId (iOS)
    case 3: // fingerprintAuthentication (Android)
      return "fingerprint";
    case 2: // faceId (iOS)
    case 4: // faceAuthentication (Android)
      return "face";
    case 5: // irisAuthentication
      return "iris";
    default:
      return "none";
  }
}

function nativeAvailable(): boolean {
  if (!hasWindow()) return false;
  // Native bridge globals are declared in src/lib/native-globals.d.ts.
  return !!window.Capacitor?.isNativePlatform?.();
}

export async function checkBiometricAvailability(): Promise<BiometricAvailability> {
  if (!nativeAvailable()) return { available: false, strong: false, type: "none" };
  try {
    const r = await BiometricAuth.checkBiometry();
    return {
      available: r.isAvailable,
      strong: r.strongBiometryIsAvailable,
      type: biometryTypeLabel(r.biometryType),
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
