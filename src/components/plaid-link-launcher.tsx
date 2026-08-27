"use client";

/**
 * Plaid Link launcher — native LinkKit on the phone (solo Android), web
 * react-plaid-link everywhere else. AUTO-OPENS as soon as a token is set.
 *
 * WHY THIS EXISTS: the old pattern rendered <PlaidLink className="hidden">
 * which NEVER opens — react-plaid-link v5's PlaidLink is a <button> that only
 * opens Link when clicked, so a hidden button is a silent no-op (Reconnect
 * "did nothing"). This component auto-launches on token: native LinkKit via
 * launchNativeLink on solo Android, usePlaidLink().open() on web/solo-iOS.
 */
import { useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { isSoloCandidate } from "@/lib/mobile-mode";
import { hasWindow } from "@/lib/browser-env";

interface Props {
  token: string;
  onSuccess: (publicToken: string, institutionName?: string | null) => void | Promise<void>;
  onExit?: () => void;
}

export function PlaidLinkLauncher({ token, onSuccess, onExit }: Props) {
  const [solo] = useState(() => hasWindow() && isSoloCandidate(window.location.origin));
  // iOS has no native PlaidProxy plugin (Android-only Kotlin), so solo-iOS uses
  // the web flow inside the WKWebView.
  const [useWebLink, setUseWebLink] = useState(false);
  useEffect(() => {
    if (!hasWindow()) return;
    // SAFETY: window.Capacitor is absent on web/non-native; optional chaining guards the read.
    const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
    if (cap?.getPlatform?.() === "ios") setUseWebLink(true);
  }, []);

  const webActive = !solo || (solo && useWebLink);

  if (webActive) {
    return (
      <WebPlaidAutoOpen
        token={token}
        onSuccess={(t, name) => void onSuccess(t, name)}
        onExit={onExit}
      />
    );
  }
  return <NativePlaidAutoOpen token={token} onSuccess={onSuccess} onExit={onExit} />;
}

/** Native LinkKit launcher (solo Android): fires once per token. */
function NativePlaidAutoOpen({
  token,
  onSuccess,
  onExit,
}: {
  token: string;
  onSuccess: Props["onSuccess"];
  onExit?: () => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [launched, setLaunched] = useState(false);

  useEffect(() => {
    if (launched) return;
    setLaunched(true);
    (async () => {
      try {
        const { launchNativeLink } = await import("@/server/plaid/native");
        const res = await launchNativeLink(token);
        if (res.cancelled) {
          onExit?.();
          return;
        }
        if (res.publicToken) await onSuccess(res.publicToken, res.institutionName ?? null);
        else setErr(res.exit?.message ?? "Bank linking was cancelled.");
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not open bank linking.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, launched]);

  if (err) return <p className="mt-2 text-sm text-danger">{err}</p>;
  return null;
}

/** Web Plaid Link: opens once the link.js script is ready (auto-open). */
function WebPlaidAutoOpen({
  token,
  onSuccess,
  onExit,
}: {
  token: string;
  onSuccess: (publicToken: string, institutionName?: string | null) => void;
  onExit?: () => void;
}) {
  const { open, ready } = usePlaidLink({
    token,
    onSuccess: (publicToken, metadata) => {
      if (publicToken) onSuccess(publicToken, metadata.institution?.name ?? null);
    },
    onExit,
  });
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (ready && !opened) {
      setOpened(true);
      open();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, opened]);

  return null;
}
