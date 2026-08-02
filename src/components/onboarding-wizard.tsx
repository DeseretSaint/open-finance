"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { isSoloCandidate } from "@/lib/mobile-mode";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

/**
 * First-run onboarding wizard (P8c).
 *
 * Shown instead of the app until the user completes (or skips) setup:
 *   1. Welcome        — what you&apos;ll set up
 *   2. Plaid keys     — link to dashboard.plaid.com, copy client_id + secret
 *                       back into the boxes, validated against Plaid
 *   3. Link bank      — Plaid Link (native LinkKit on phone, web on hub)
 *   4. Your agent     — connect an AI agent now, or do it later
 *   5. Done           — enter the app (marks onboarding complete)
 *
 * Every step is skippable — nothing is required to use the app. Replayable
 * from Settings → "Restart setup tour" (POST /api/onboarding { action: "reset" }).
 * Demo users never see it (the demo route marks onboarding complete).
 */

const STEPS = ["welcome", "plaid", "bank", "agent", "done"] as const;
type Step = (typeof STEPS)[number];

const PLAID_SIGNUP_URL = "https://dashboard.plaid.com/signup";
const PLAID_KEYS_URL = "https://dashboard.plaid.com/keys";

export function OnboardingWizard() {
  const router = useRouter();
  const [solo, setSolo] = useState(false);
  const [step, setStep] = useState<Step>("welcome");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // plaid keys
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [environment, setEnvironment] = useState<"sandbox" | "production">("sandbox");
  const [keysSaved, setKeysSaved] = useState(false);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [linkedCount, setLinkedCount] = useState(0);

  useEffect(() => {
    if (typeof window !== "undefined") setSolo(isSoloCandidate(window.location.origin));
  }, []);

  // Prefill existing creds state (e.g. after restart).
  useEffect(() => {
    api
      .get<{ environments: Array<{ environment: string; hasKeys: boolean }> }>("/api/plaid/credentials")
      .then((res) => {
        const any = res.environments.find((e) => e.hasKeys);
        if (any) {
          setEnvironment(any.environment as "sandbox" | "production");
          setKeysSaved(true);
        }
      })
      .catch(() => {});
  }, []);

  async function saveKeys() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await api.put("/api/plaid/credentials", { clientId, secret, environment });
      setKeysSaved(true);
      setMsg("Plaid keys saved and validated ✓");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save Plaid keys.");
    } finally {
      setBusy(false);
    }
  }

  async function startLink() {
    setBusy(true);
    setErr(null);
    try {
      const res = await api.get<{ linkToken: string }>(`/api/plaid/link-token?environment=${environment}`);
      setLinkToken(res.linkToken);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create link token.");
    } finally {
      setBusy(false);
    }
  }

  const onLinkSuccess = useCallback(
    async (publicToken: string, institutionName?: string | null) => {
      setBusy(true);
      setErr(null);
      try {
        await api.post("/api/plaid/exchange", {
          publicToken,
          environment,
          institutionId: null,
          institutionName: institutionName ?? null,
        });
        setLinkedCount((c) => c + 1);
        setMsg(institutionName ? `${institutionName} linked ✓` : "Bank linked ✓");
        setLinkToken(null);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not link bank.");
      } finally {
        setBusy(false);
      }
    },
    [environment]
  );

  async function finish() {
    setBusy(true);
    try {
      await api.post("/api/onboarding", { action: "complete" });
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not finish setup.");
      setBusy(false);
    }
  }

  async function skipAll() {
    await finish();
  }

  const stepIndex = STEPS.indexOf(step);
  const progress = `${stepIndex + 1} / ${STEPS.length}`;

  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-background px-4 py-8"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="w-full max-w-md">
        {/* progress */}
        <div className="mb-4 flex items-center justify-between text-xs text-text-muted">
          <span className="font-medium text-text">Set up Open Finance</span>
          <span>{progress}</span>
        </div>
        <div className="mb-6 flex gap-1">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full ${i <= stepIndex ? "bg-accent" : "bg-border"}`}
            />
          ))}
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-card)]">
          {step === "welcome" && (
            <>
              <h1 className="text-2xl font-bold text-text">Welcome 👋</h1>
              <p className="mt-2 text-sm text-text-muted">
                Open Finance runs entirely on your {solo ? "phone" : "machine"} — your data stays yours. In the
                next couple of minutes you&apos;ll set up:
              </p>
              <ul className="mt-4 space-y-2 text-sm text-text">
                <li>🔑 Your own Plaid keys (free — optional)</li>
                <li>🏦 Link your bank accounts (optional)</li>
                <li>🤖 Connect your AI agent (optional — do it later if you want)</li>
              </ul>
              <p className="mt-4 text-xs text-text-muted">
                Every step can be skipped — you can always add these later in Settings.
              </p>
              <div className="mt-6 flex gap-3">
                <Button variant="secondary" onClick={skipAll} className="flex-1" disabled={busy}>
                  Skip
                </Button>
                <Button onClick={() => setStep("plaid")} className="flex-1">
                  Get started
                </Button>
              </div>
            </>
          )}

          {step === "plaid" && (
            <>
              <h1 className="text-2xl font-bold text-text">Bring your own Plaid keys</h1>
              <p className="mt-2 text-sm text-text-muted">
                Plaid connects your bank to the app. It&apos;s free for developers, and{" "}
                <strong className="text-text">your keys stay on this {solo ? "phone" : "machine"}</strong> — we
                never see them.
              </p>
              <ol className="mt-4 space-y-2 text-sm text-text">
                <li>
                  1. Open{" "}
                  <a href={PLAID_SIGNUP_URL} target="_blank" rel="noreferrer" className="font-medium text-accent">
                    dashboard.plaid.com
                  </a>{" "}
                  and create a free account (or sign in).
                </li>
                <li>
                  2. Go to{" "}
                  <a href={PLAID_KEYS_URL} target="_blank" rel="noreferrer" className="font-medium text-accent">
                    Dashboard → Keys
                  </a>
                  .
                </li>
                <li>3. Copy your Client ID and Secret, then paste them below.</li>
              </ol>
              <div className="mt-4 space-y-3">
                <Input placeholder="Plaid Client ID (e.g. 5f2a…)" value={clientId} onChange={(e) => setClientId(e.target.value)} />
                <Input
                  type="password"
                  placeholder="Plaid Secret"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                />
                <Select value={environment} onChange={(e) => setEnvironment(e.target.value as "sandbox" | "production")}>
                  <option value="sandbox">Sandbox (test data)</option>
                  <option value="production">Production (real banks)</option>
                </Select>
              </div>
              {err && <p className="mt-3 text-sm text-danger">{err}</p>}
              {msg && <p className="mt-3 text-sm text-success">{msg}</p>}
              {keysSaved && !msg && <p className="mt-3 text-sm text-success">Keys saved ✓</p>}
              <div className="mt-6 flex gap-3">
                <Button variant="secondary" onClick={() => setStep("bank")} className="flex-1">
                  Skip
                </Button>
                <Button onClick={saveKeys} disabled={busy || !clientId || !secret} className="flex-1">
                  {busy ? "Validating…" : "Save & validate"}
                </Button>
              </div>
            </>
          )}

          {step === "bank" && (
            <>
              <h1 className="text-2xl font-bold text-text">Link your bank</h1>
              <p className="mt-2 text-sm text-text-muted">
                {keysSaved
                  ? "Connect a bank account — it will appear in your accounts automatically. You can also track everything manually without linking a bank."
                  : "You skipped Plaid keys, so we&apos;ll track manually. You can add bank connections anytime in Settings."}
              </p>

              {keysSaved && !linkToken && (
                <Button onClick={startLink} disabled={busy} className="mt-5 w-full">
                  {busy ? "Preparing…" : "Connect a bank account"}
                </Button>
              )}

              {keysSaved && linkToken && <NativeOrWebLink token={linkToken} solo={solo} onSuccess={onLinkSuccess} />}

              {linkedCount > 0 && <p className="mt-3 text-sm text-success">{linkedCount} connected ✓</p>}
              {msg && !linkToken && <p className="mt-3 text-sm text-success">{msg}</p>}
              {err && <p className="mt-3 text-sm text-danger">{err}</p>}

              <div className="mt-6 flex gap-3">
                <Button
                  variant="secondary"
                  onClick={() => setStep("agent")}
                  className="flex-1"
                  disabled={busy}
                >
                  {keysSaved ? "Continue" : "Continue"}
                </Button>
                {keysSaved && (
                  <Button onClick={() => setStep("agent")} className="flex-1" disabled={busy}>
                    {linkedCount > 0 ? "Done linking" : "Skip"}
                  </Button>
                )}
              </div>
            </>
          )}

          {step === "agent" && (
            <>
              <h1 className="text-2xl font-bold text-text">Your AI agent</h1>
              <p className="mt-2 text-sm text-text-muted">
                Open Finance can connect to any agent (Hermes, Claude, Cursor…). Your agent gets a token with
                read-only access by default — and asks permission before reading anything.
              </p>
              <p className="mt-3 text-sm text-text-muted">
                You can set that up now in the <strong className="text-text">Agents</strong> page, or come back
                later — it&apos;s fully optional.
              </p>
              <div className="mt-6 flex gap-3">
                <Button variant="secondary" onClick={() => setStep("done")} className="flex-1">
                  Do this later
                </Button>
                <Button onClick={() => router.push("/agents")} className="flex-1">
                  Connect an agent
                </Button>
              </div>
            </>
          )}

          {step === "done" && (
            <>
              <h1 className="text-2xl font-bold text-text">You&apos;re all set 🎉</h1>
              <p className="mt-2 text-sm text-text-muted">
                Your {solo ? "phone" : "instance"} is ready. Here&apos;s what you configured:
              </p>
              <ul className="mt-4 space-y-2 text-sm text-text">
                <li>🔑 Plaid keys: {keysSaved ? "saved ✓" : "skipped (manual tracking)"}</li>
                <li>🏦 Banks linked: {linkedCount}</li>
                <li>🤖 Agent: set up later in Agents (whenever you&apos;re ready)</li>
              </ul>
              <p className="mt-4 text-xs text-text-muted">
                You can replay this tour anytime from Settings → &quot;Restart setup tour&quot;.
              </p>
              {err && <p className="mt-3 text-sm text-danger">{err}</p>}
              <Button onClick={finish} disabled={busy} className="mt-6 w-full">
                {busy ? "Entering…" : "Enter Open Finance"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Plaid Link launcher — native LinkKit on the phone, react-plaid-link on web. */
function NativeOrWebLink({
  token,
  solo,
  onSuccess,
}: {
  token: string;
  solo: boolean;
  onSuccess: (publicToken: string, institutionName?: string | null) => Promise<void>;
}) {
  const [linking, setLinking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const web = useMemo(
    () =>
      solo
        ? null
        : () =>
            import("react-plaid-link").then((m) => (
              <m.PlaidLink
                token={token}
                onSuccess={(publicToken, metadata) => {
                  if (publicToken) void onSuccess(publicToken, metadata.institution?.name ?? null);
                }}
              >
                <Button>Connect a bank account</Button>
              </m.PlaidLink>
            )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [solo, token]
  );

  const [webEl, setWebEl] = useState<React.ReactNode | null>(null);
  useEffect(() => {
    if (!solo && web) web().then(setWebEl).catch(() => setErr("Could not load bank linking."));
  }, [solo, web]);

  async function nativeLaunch() {
    setLinking(true);
    setErr(null);
    try {
      const { launchNativeLink } = await import("@/server/plaid/native");
      const res = await launchNativeLink(token);
      if (res.cancelled) return;
      if (res.publicToken) await onSuccess(res.publicToken);
      else setErr(res.exit?.message ?? "Bank linking was cancelled.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not open bank linking.");
    } finally {
      setLinking(false);
    }
  }

  if (!solo)
    return (
      <div className="mt-5">
        {webEl}
        {err && <p className="mt-2 text-sm text-danger">{err}</p>}
      </div>
    );

  return (
    <>
      <Button onClick={nativeLaunch} disabled={linking} className="mt-5 w-full">
        {linking ? "Opening bank linking…" : "Connect a bank account"}
      </Button>
      {err && <p className="mt-2 text-sm text-danger">{err}</p>}
    </>
  );
}
