"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { PairingSection } from "@/components/pairing-section";
import { isSoloCandidate } from "@/lib/mobile-mode";
import { hasWindow } from "@/lib/browser-env";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { CustomSelect } from "@/components/ui/custom-select";
import { MotifHero } from "@/components/motif-hero";
import { useKeyboardHeight } from "@/lib/use-keyboard-height";

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

type Step = "welcome" | "paydays" | "security" | "plaid" | "bank" | "agent" | "done";

/** Numbered setup steps between welcome and done — drives the progress dots. */
const WIZARD_STEPS: Step[] = ["paydays", "security", "plaid", "bank", "agent"];

/** Calm progress dots for the numbered steps; hidden on welcome/done. */
function StepProgress({ step }: { step: Step }) {
  const idx = WIZARD_STEPS.indexOf(step);
  if (idx === -1) return null;
  return (
    <div
      role="status"
      aria-label={`Step ${idx + 1} of ${WIZARD_STEPS.length}`}
      className="mb-4 flex items-center justify-center gap-2"
    >
      <div className="flex items-center gap-1.5">
        {WIZARD_STEPS.map((s, i) => (
          <span
            key={s}
            aria-current={i === idx ? "step" : undefined}
            className={`h-1.5 rounded-full transition-all ${
              i === idx ? "w-5 bg-accent" : i < idx ? "w-1.5 bg-accent/50" : "w-1.5 bg-border"
            }`}
          />
        ))}
      </div>
      <span className="text-[11px] font-medium text-text-muted">
        Step {idx + 1} of {WIZARD_STEPS.length}
      </span>
    </div>
  );
}

const PLAID_SIGNUP_URL = "https://dashboard.plaid.com/signup";
const PLAID_KEYS_URL = "https://dashboard.plaid.com/developers/keys";
const PLAID_TRIAL_URL = "https://dashboard.plaid.com/trial-plan";

export function OnboardingWizard() {
  const kbdHeight = useKeyboardHeight();
  const router = useRouter();
  const [solo, setSolo] = useState(false);
  const [step, setStep] = useState<Step>("welcome");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // plaid keys
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [environment, setEnvironment] = useState<"sandbox" | "production">("production");
  // Manual payday schedule (012) — optional, for accurate projections.
  const [payMode, setPayMode] = useState<"auto" | "interval" | "days_of_month">("auto");
  const [payInterval, setPayInterval] = useState<"weekly" | "biweekly" | "monthly">("monthly");
  const [payDays, setPayDays] = useState<number[]>([]);

  async function savePaydays() {
    if (payMode === "auto") return;
    try {
      await api.put("/api/planning/paydays", {
        mode: payMode,
        interval: payMode === "interval" ? payInterval : null,
        days: payMode === "days_of_month" ? payDays : undefined,
      });
    } catch {
      // Non-blocking — the user can set paydays later in Settings.
    }
  }
  const [keysSaved, setKeysSaved] = useState(false);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [linkedCount, setLinkedCount] = useState(0);

  // security (P12): device PIN is set HERE (solo first-run), not via a banner.
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinSaved, setPinSaved] = useState(false);

  // agent wiring (P12): provider selection in the wizard (web only).
  const [agentProvider, setAgentProvider] = useState<string | null>(null);
  // agent access tiers (P20–P25): per-tab read + write selection, global,
  // backlog, and guardrails — mirrors Settings → AI agent connection.
  const [agentTabs, setAgentTabs] = useState<string[]>(["activity"]);
  const [agentTabsWrite, setAgentTabsWrite] = useState<string[]>([]);
  const [agentAutoCategorize, setAgentAutoCategorize] = useState(false);
  const [agentBacklog, setAgentBacklog] = useState(1);
  const [agentGlobal, setAgentGlobal] = useState(false);
  const [agentGlobalWrite, setAgentGlobalWrite] = useState(true);
  const [agentAutoApproveReads, setAgentAutoApproveReads] = useState(true);
  const [agentRequireWriteConfirm, setAgentRequireWriteConfirm] = useState(true);
  const [agentPrefsSaved, setAgentPrefsSaved] = useState(false);
  // In-wizard token creation (web): no detour to the Agents tab.
  const [agentTokenName, setAgentTokenName] = useState("");
  const [agentTokenBusy, setAgentTokenBusy] = useState(false);
  const [agentToken, setAgentToken] = useState<{ token: string } | null>(null);


  async function saveAgentPrefs() {
    if (agentPrefsSaved) return;
    try {
      await api.put("/api/agent/prefs", {
        tabs: agentTabs,
        tabsWrite: agentTabsWrite,
        autoCategorize: agentAutoCategorize,
        categorizeBacklogMonths: agentBacklog,
        global: agentGlobal,
        globalWrite: agentGlobalWrite,
        autoApproveReads: agentAutoApproveReads,
        requireWriteConfirm: agentRequireWriteConfirm,
      });
      setAgentPrefsSaved(true);
    } catch {
      // Preference is best-effort — never block the wizard on it.
      setAgentPrefsSaved(true);
    }
  }

  useEffect(() => {
    if (hasWindow()) setSolo(isSoloCandidate(window.location.origin));
  }, []);

  async function savePinStep() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      if (pin.length < 4 || pin.length > 12 || !/^\d+$/.test(pin)) {
        throw new Error("PIN must be 4–12 digits.");
      }
      if (pin !== pinConfirm) {
        throw new Error("PINs don't match.");
      }
      await api.post("/api/device-lock/pin", { pin });
      setPinSaved(true);
      setMsg("Device PIN set.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not set PIN.");
    } finally {
      setBusy(false);
    }
  }

  // Prefill existing creds state (e.g. after restart).
  useEffect(() => {
    api
      .get<{ environments: Array<{ environment: string; hasKeys: boolean }> }>("/api/plaid/credentials")
      .then((res) => {
        const any = res.environments.find((e) => e.hasKeys);
        if (any) {
          // SAFETY: environments come from the Plaid API where environment is exactly "sandbox" | "production".
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
      setMsg("Bank connection keys saved and validated.");
      // Advance straight to the link step — "Skip" was the only way forward
      // before, which made the save feel pointless.
      setStep("bank");
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
        setMsg(institutionName ? `${institutionName} connected.` : "Bank connected.");
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
      // Warm the solo DB (open + migrate) WHILE the transition happens so the
      // dashboard's first queries hit a ready database instead of paying the
      // cold-open cost (first entry after the wizard was slow).
      if (hasWindow()) {
        void import("@/lib/solo-router")
          .then((m) => m.getSoloDb())
          .catch(() => {});
      }
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not finish setup.");
      setBusy(false);
    }
  }

  async function skipAll() {
    if (solo && !pinSaved) {
      // Solo users must set a PIN (it's the only unlock path) — route them
      // through the Security step instead of skipping past it.
      setStep("security");
      return;
    }
    await finish();
  }

  // Demo-first entry: log into the seeded demo account (same endpoint the
  // /demo page uses) so a first-run user can explore real-looking data before
  // committing to setup. "Start fresh" (skipAll) is the explicit empty-account
  // exit one line below.
  async function tryDemo() {
    setBusy(true);
    setErr(null);
    try {
      await api.post("/api/auth/demo");
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Demo unavailable.");
      setBusy(false);
    }
  }

  return (
    <div
      className="forced-dark flex min-h-dvh items-center justify-center bg-background px-4 py-8"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: `calc(env(safe-area-inset-bottom) + ${kbdHeight}px)`,
        backgroundColor: "#0c0a09",
        color: "#fafaf9",
      }}
    >
      <div className="w-full max-w-md">
        <div className="mb-4 text-center text-xs font-medium text-text">Set up Open Finance</div>
        <StepProgress step={step} />

        <div className="rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-card)]">
          {step === "welcome" && (
            <>
              <div className="mb-5">
                <MotifHero compact />
              </div>
              <h1 className="text-2xl font-bold text-text">Welcome</h1>
              <p className="mt-2 text-sm text-text-muted">
                Open Finance runs entirely on your {solo ? "phone" : "machine"} — your data stays yours. In the
                next couple of minutes you&apos;ll set up:
              </p>
              <ul className="mt-4 space-y-2 text-sm text-text">
                <li>Connect a bank — free and optional</li>
                <li>Link your bank accounts (optional)</li>
                <li>Connect your AI assistant (optional — do it later if you want)</li>
              </ul>
              <p className="mt-4 text-xs text-text-muted">
                Every step can be skipped — you can always add these later in Settings.
              </p>
              <div className="mt-6 flex gap-3">
                <Button variant="secondary" onClick={skipAll} className="flex-1" disabled={busy}>
                  Start fresh
                </Button>
                <Button onClick={() => setStep("paydays")} className="flex-1" disabled={busy}>
                  Get started
                </Button>
              </div>
              <button
                type="button"
                onClick={tryDemo}
                disabled={busy}
                className="mt-3 w-full text-center text-sm font-medium text-accent-text transition-colors hover:text-accent disabled:opacity-50"
              >
                Or explore with sample data first →
              </button>
            </>
          )}

          {step === "paydays" && (
            <>
              <h1 className="text-2xl font-bold text-text">When do you get paid?</h1>
              <p className="mt-2 text-sm text-text-muted">
                Optional — but it makes the Plan tab&apos;s projections accurate, even before your first synced
                paycheck. Skip it and the app guesses from your income.
              </p>
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ["auto", "Auto — skip for now"],
                      ["interval", "Regular interval"],
                      ["days_of_month", "Specific days"],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setPayMode(mode)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                        payMode === mode ? "border-accent bg-accent/10 text-accent-text" : "border-border text-text-muted hover:text-text"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {payMode === "interval" && (
                  <div className="flex flex-wrap gap-1.5">
                    {(["weekly", "biweekly", "monthly"] as const).map((iv) => (
                      <button
                        key={iv}
                        type="button"
                        onClick={() => setPayInterval(iv)}
                        className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                          payInterval === iv ? "border-accent bg-accent/10 font-medium text-accent-text" : "border-border text-text-muted hover:text-text"
                        }`}
                      >
                        {iv === "biweekly" ? "Every 2 weeks" : iv === "weekly" ? "Every week" : "Every month"}
                      </button>
                    ))}
                  </div>
                )}
                {payMode === "days_of_month" && (
                  <div>
                    <div className="flex flex-wrap gap-1.5">
                      {[1, 5, 10, 15, 20, 25, 30].map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() =>
                            setPayDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)))
                          }
                          className={`h-9 w-9 rounded-full border text-xs transition-colors ${
                            payDays.includes(d) ? "border-accent bg-accent/10 font-medium text-accent-text" : "border-border text-text-muted hover:text-text"
                          }`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-xs text-text-muted">
                      {payDays.length > 0 ? `Paid on the ${payDays.join(" & ")} of each month` : "Pick the days you get paid"}
                    </p>
                  </div>
                )}
              </div>
              <div className="mt-6 flex gap-3">
                <Button
                  variant="secondary"
                  onClick={async () => {
                    await savePaydays();
                    setStep("security");
                  }}
                  className="flex-1"
                  disabled={busy}
                >
                  Skip
                </Button>
                <Button
                  onClick={async () => {
                    await savePaydays();
                    setStep("security");
                  }}
                  className="flex-1"
                  disabled={busy || (payMode === "days_of_month" && payDays.length === 0)}
                >
                  Continue
                </Button>
              </div>
            </>
          )}

          {step === "security" && (
            <>
              <h1 className="text-2xl font-bold text-text">Lock this {solo ? "phone" : "device"}</h1>
              <p className="mt-2 text-sm text-text-muted">
                {solo ? (
                  <>
                    Set a <strong className="text-text">4–12 digit PIN</strong> — the app locks when you close it,
                    and only this PIN (or your fingerprint / face) opens it. If you ever forget it, the{" "}
                    <strong className="text-text">recovery code</strong> from the previous step is the only way back
                    in — keep it somewhere safe.
                  </>
                ) : (
                  <>
                    This machine is protected by your account password. The phone app adds a PIN for quick locking —
                    you can set that up on the phone.
                  </>
                )}
              </p>
              {solo ? (
                <div className="mt-4 space-y-3">
                  <Input aria-label={"New PIN"}
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    pattern="[0-9]*"
                    maxLength={12}
                    placeholder="New PIN (4–12 digits)"
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))}
                  />
                  <Input aria-label={"Confirm PIN"}
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    pattern="[0-9]*"
                    maxLength={12}
                    placeholder="Confirm PIN"
                    value={pinConfirm}
                    onChange={(e) => setPinConfirm(e.target.value.replace(/[^0-9]/g, ""))}
                  />
                </div>
              ) : (
                <p className="mt-4 rounded-lg bg-surface-muted px-3 py-2 text-xs text-text-muted">
                  Nothing to do here — your account password covers desktop access.
                </p>
              )}
              {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}
              {msg && <p role="status" className="mt-3 text-sm text-success">{msg}</p>}
              <div className="mt-6 flex gap-3">
                <Button
                  variant="secondary"
                  onClick={() => setStep("plaid")}
                  className="flex-1"
                  disabled={busy || (solo && !pinSaved)}
                >
                  {solo && !pinSaved ? "Set PIN to continue" : "Skip"}
                </Button>
                {solo && !pinSaved ? (
                  <Button onClick={savePinStep} disabled={busy || pin.length < 4 || pin !== pinConfirm} className="flex-1">
                    {busy ? "Saving…" : "Set PIN"}
                  </Button>
                ) : (
                  <Button onClick={() => setStep("plaid")} className="flex-1" disabled={busy}>
                    Continue
                  </Button>
                )}
              </div>
            </>
          )}

          {step === "plaid" && (
            <>
              <h1 className="text-2xl font-bold text-text">Connect your bank (optional)</h1>
              <p className="mt-2 text-sm text-text-muted">
                Open Finance uses a secure service called Plaid to connect to your bank. It&apos;s free for personal use, and{" "}
                <strong className="text-text">your connection keys stay on this {solo ? "phone" : "machine"}</strong> — we
                never see them.
              </p>
              <ol className="mt-4 space-y-2 text-sm text-text">
                <li>
                  1. Open{" "}
                  <a href={PLAID_SIGNUP_URL} target="_blank" rel="noreferrer" className="font-medium text-accent-text">
                    dashboard.plaid.com
                  </a>{" "}
                  and create a free account (or sign in).
                </li>
                <li>
                  2. In Plaid, open{" "}
                  <a href={PLAID_TRIAL_URL} target="_blank" rel="noreferrer" className="font-medium text-accent-text">
                    Dashboard → Trial plan
                  </a>{" "}
                  and copy your production keys (these connect to your real bank accounts).
                </li>
                <li>3. Paste your Client ID and Secret (your connection keys) below.</li>
              </ol>
              <p className="mt-2 text-xs text-text-muted">
                Only using test data? Sandbox keys are at{" "}
                <a href={PLAID_KEYS_URL} target="_blank" rel="noreferrer" className="font-medium text-accent-text">
                  Dashboard → Developers → Keys
                </a>{" "}
                — pick &ldquo;Sandbox&rdquo; below for those.
              </p>
              <div className="mt-4 space-y-3">
                <Input aria-label={"Plaid client ID"} placeholder="Client ID (starts with 5f…)" value={clientId} onChange={(e) => setClientId(e.target.value)} />
                <PasswordInput aria-label={"Plaid secret"}
                  placeholder="Secret"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                />
                <CustomSelect
                  ariaLabel="Plaid environment"
                  value={environment}
                  // SAFETY: the only options are "production" | "sandbox", so v is one of the two literals.
                  onChange={(v) => setEnvironment(v as "sandbox" | "production")}
                  options={[
                    { value: "production", label: "Production", hint: "real banks — recommended" },
                    { value: "sandbox", label: "Sandbox", hint: "test data only" },
                  ]}
                />
              </div>
              {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}
              {msg && <p role="status" className="mt-3 text-sm text-success">{msg}</p>}
              {keysSaved && !msg && <p role="status" className="mt-3 text-sm text-success">Keys saved.</p>}
              <div className="mt-6 flex gap-3">
                <Button variant="secondary" onClick={() => setStep("bank")} className="flex-1">
                  Skip
                </Button>
                <Button onClick={saveKeys} disabled={busy || !clientId || !secret} className="flex-1">
                  {busy ? "Checking…" : "Save & check"}
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

              {linkedCount > 0 && <p role="status" className="mt-3 text-sm text-success">{linkedCount} connected.</p>}
              {msg && !linkToken && <p role="status" className="mt-3 text-sm text-success">{msg}</p>}
              {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}

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
              <h1 className="text-2xl font-bold text-text">Your AI assistant (optional)</h1>
              <p className="mt-2 text-sm text-text-muted">
                {solo ? (
                  <>
                    This phone can hold your banks and finances by itself. Your AI agent is a separate connection: it runs through an Open Finance hub, so you must install Open Finance on the computer you want the agent to use. You can pair this phone to that hub over Tailscale later — no second hub account is needed.
                  </>
                ) : (
                  <>
                    Everything works without one. An AI assistant can answer money questions and — only when you
                    allow it — help with budgets. It can look, but can&apos;t touch, until you say so. Pick yours:
                  </>
                )}
              </p>

              {!solo && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {(["Hermes", "Claude", "Cursor", "Other"] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setAgentProvider(p)}
                      className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                        agentProvider === p
                          ? "border-accent bg-accent/5 font-medium text-accent-text"
                          : "border-border text-text-muted hover:bg-surface-muted"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}

              {/* In-wizard wiring: create the token right here (web) or pair
                  with a hub (solo) — no detour to another tab. */}
              {!solo && agentProvider && !agentToken && (
                <div className="mt-4 space-y-3 rounded-xl border border-border p-4">
                  <p className="text-sm font-medium text-text">Create your agent&apos;s token</p>
                  <p className="text-xs text-text-muted">
                    A token is how your agent authenticates. Read-only by default — you just picked what it may see
                    below.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Token name — e.g. my-agent"
                      value={agentTokenName}
                      onChange={(e) => setAgentTokenName(e.target.value)}
                      aria-label="Token name"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={agentTokenBusy || !agentTokenName.trim()}
                      onClick={async () => {
                        setAgentTokenBusy(true);
                        try {
                          const res = await api.post<{ token: string }>("/api/agent/tokens", {
                            name: agentTokenName.trim(),
                            preset: "custom",
                            scopes: [],
                          });
                          setAgentToken(res);
                        } catch (e) {
                          setErr(e instanceof Error ? e.message : "Could not create token.");
                        } finally {
                          setAgentTokenBusy(false);
                        }
                      }}
                    >
                      {agentTokenBusy ? "Creating…" : "Create token"}
                    </Button>
                  </div>
                  <p className="text-xs text-text-muted">
                    Endpoint:{" "}
                    <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-accent-text">
                      {hasWindow() ? window.location.origin : ""}/api/mcp
                    </code>
                  </p>
                </div>
              )}
              {!solo && agentProvider && agentToken && (
                <div className="mt-4 rounded-xl border border-success/30 bg-[var(--success-soft)] p-4">
                  <p className="text-xs font-medium text-success">Copy your token now — shown only once:</p>
                  <code className="mt-1 block break-all rounded-lg bg-background px-3 py-2 text-sm text-text">
                    {agentToken.token}
                  </code>
                  <p className="mt-2 text-xs text-text-muted">
                    Point your agent at{" "}
                    <code className="rounded bg-surface-muted px-1 py-0.5 font-mono text-accent-text">
                      {hasWindow() ? window.location.origin : ""}/api/mcp
                    </code>{" "}
                    with this token. You can fine-tune permissions anytime in Settings → AI agent connection.
                  </p>
                </div>
              )}

              {solo && (
                <div className="mt-4 space-y-3 rounded-xl border border-border p-4">
                  <p className="text-sm font-medium text-text">Connect this phone to your agent hub</p>
                  <p className="text-xs text-text-muted">
                    This is optional. Install Open Finance on the computer that will host your agent, start its Hub mode,
                    and install Tailscale on both devices. Then pair this phone with the hub below. Pairing uses the hub&apos;s
                    existing account; it does not create a second account or merge phone data automatically.
                  </p>
                  <PairingSection compact />
                </div>
              )}

              {/* Agent access tiers — mirrors Settings → AI agent connection */}
              <div className="mt-4 space-y-3 rounded-xl border border-border p-4">
                <p className="text-sm font-medium text-text">What can your AI see and do?</p>
                <p className="text-xs text-text-muted">
                  Read = it may look. Write = it may change (each change still asks your approval). Activity read-only
                  is a good start.
                </p>
                <div className="space-y-1.5">
                  {[
                    ["dashboard", "Home"],
                    ["accounts", "Accounts"],
                    ["activity", "Activity"],
                    ["budgets", "Budgets"],
                    ["reports", "Reports"],
                    ["planning", "Plan"],
                    ["agents", "Agents"],
                    ["settings", "Settings"],
                  ].map(([tab, label]) => {
                    const readOn = agentGlobal || agentTabs.includes(tab);
                    const writeOn = agentGlobal || agentTabsWrite.includes(tab);
                    return (
                      <div
                        key={tab}
                        className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 ${
                          agentGlobal ? "border-accent/30 bg-accent/5" : "border-border"
                        }`}
                      >
                        <span className={`text-xs ${agentGlobal ? "text-text" : "text-text"}`}>{label}</span>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            disabled={agentGlobal}
                            onClick={() =>
                              setAgentTabs((prev) => (prev.includes(tab) ? prev.filter((t) => t !== tab) : [...prev, tab]))
                            }
                            className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                              readOn
                                ? "border-accent bg-accent/10 font-medium text-accent-text"
                                : "border-border text-text-muted hover:text-text"
                            } ${agentGlobal ? "opacity-60" : ""}`}
                          >
                            Read
                          </button>
                          <button
                            type="button"
                            disabled={agentGlobal || !readOn}
                            onClick={() =>
                              setAgentTabsWrite((prev) =>
                                prev.includes(tab) ? prev.filter((t) => t !== tab) : [...prev, tab]
                              )
                            }
                            className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                              writeOn
                                ? "border-accent bg-accent text-[var(--accent-foreground)]"
                                : "border-border text-text-muted hover:text-text"
                            } ${agentGlobal || !readOn ? "opacity-60" : ""}`}
                          >
                            Write
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="wiz-categorize" className="text-sm text-text">
                    Smart categorization{" "}
                    <span className="text-xs text-text-muted">(lets it tidy up transaction categories)</span>
                  </label>
                  <input
                    id="wiz-categorize"
                    type="checkbox"
                    checked={agentAutoCategorize}
                    onChange={(e) => setAgentAutoCategorize(e.target.checked)}
                    className="h-5 w-5 accent-[var(--accent)]"
                  />
                </div>
                {agentAutoCategorize && (
                  <label className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                    Categorize back:
                    <CustomSelect
                      ariaLabel="Categorization backlog"
                      className="w-44"
                      value={String(agentBacklog)}
                      onChange={(v) => setAgentBacklog(Number(v))}
                      options={[
                        { value: "0", label: "None — just new ones", hint: "moving forward" },
                        { value: "1", label: "1 month", hint: "recommended" },
                        { value: "3", label: "3 months" },
                        { value: "6", label: "6 months" },
                        { value: "12", label: "1 year" },
                      ]}
                    />
                  </label>
                )}
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="wiz-global" className="text-sm text-text">
                    Full access{" "}
                    <span className="text-xs text-text-muted">(see and change everything — most people don&apos;t need this)</span>
                  </label>
                  <input
                    id="wiz-global"
                    type="checkbox"
                    checked={agentGlobal}
                    onChange={(e) => {
                      setAgentGlobal(e.target.checked);
                      setAgentGlobalWrite(e.target.checked);
                    }}
                    className="h-5 w-5 accent-[var(--accent)]"
                  />
                </div>

                {/* Guardrails — same toggles as Settings → AI agent connection */}
                <div className="rounded-lg bg-surface-muted px-3 py-2.5">
                  <p className="text-xs font-medium text-text">AI guardrails</p>
                  <p className="mt-0.5 text-[11px] text-text-muted">
                    Two can&apos;t be turned off: it can never delete accounts and can never move money (no payment rails).
                  </p>
                  <label className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-xs text-text">
                      Auto-approve read requests{" "}
                      <span className="text-text-muted">(reads inside your caps skip the inbox)</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={agentAutoApproveReads}
                      onChange={(e) => setAgentAutoApproveReads(e.target.checked)}
                      className="h-5 w-5 accent-[var(--accent)]"
                    />
                  </label>
                  <label className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-xs text-text">
                      Confirm before destructive writes{" "}
                      <span className="text-text-muted">(deleting a category, bill, debt or goal)</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={agentRequireWriteConfirm}
                      onChange={(e) => setAgentRequireWriteConfirm(e.target.checked)}
                      className="h-5 w-5 accent-[var(--accent)]"
                    />
                  </label>
                </div>
              </div>

              <div className="mt-6 flex gap-3">
                <Button variant="secondary" onClick={() => setStep("done")} className="flex-1">
                  No thanks
                </Button>
                <Button
                  onClick={async () => {
                    await saveAgentPrefs();
                    setStep("done");
                  }}
                  className="flex-1"
                >
                  Continue
                </Button>
              </div>
            </>
          )}

          {step === "done" && (
            <>
              <h1 className="text-2xl font-bold text-text">You&apos;re all set</h1>
              <p className="mt-2 text-sm text-text-muted">
                Your {solo ? "phone" : "instance"} is ready. Here&apos;s what you configured:
              </p>
              <ul className="mt-4 space-y-2 text-sm text-text">
                <li>Bank connection: {keysSaved ? "keys saved" : "skipped (manual tracking)"}</li>
                <li>Banks linked: {linkedCount}</li>
                <li>Device PIN: {solo ? (pinSaved ? "set" : "skipped") : "password-protected"}</li>
                <li>AI assistant: {agentPrefsSaved ? `access configured (${agentGlobal ? "global read + write" : agentTabs.join(" + ")}${agentAutoCategorize ? " + smart categorization" : ""})` : "set up later in Agents (whenever you're ready)"}</li>
              </ul>
              <p className="mt-4 text-xs text-text-muted">
                You can replay this tour anytime from Settings → &quot;Restart setup tour&quot;.
              </p>
              {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}
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

  // iOS has no native PlaidProxy plugin (it's an Android Kotlin plugin), so
  // solo-iOS uses the web Plaid Link flow inside the WKWebView.
  const [useWebLink, setUseWebLink] = useState(false);
  useEffect(() => {
    if (!hasWindow()) return;
    const cap = window.Capacitor;
    if (cap?.getPlatform?.() === "ios") setUseWebLink(true);
  }, []);

  const web = useMemo(
    () =>
      solo && !useWebLink
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
    [solo, useWebLink, token]
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
      if (res.publicToken) await onSuccess(res.publicToken, res.institutionName ?? null);
      else setErr(res.exit?.message ?? "Bank linking was cancelled.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not open bank linking.");
    } finally {
      setLinking(false);
    }
  }

  if (!solo || (solo && useWebLink))
    return (
      <div className="mt-5">
        {webEl}
        {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
      </div>
    );

  return (
    <>
      <Button onClick={nativeLaunch} disabled={linking} className="mt-5 w-full">
        {linking ? "Opening bank linking…" : "Connect a bank account"}
      </Button>
      {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
    </>
  );
}
