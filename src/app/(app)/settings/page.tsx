"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlaidLink } from "react-plaid-link";
import { Moon, Sun } from "lucide-react";
import { api } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { useTheme } from "@/components/providers";
import { UpdatesCard } from "@/components/updates-card";

interface Me {
  user: { display_name: string; username: string | null; email: string | null };
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const { accent, setAccent, accents, dark, setDark } = useTheme();

  const me = useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/api/auth/me") });
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => api.get<{ sessions: Array<{ id: string; device_label: string; created_at: string; current: boolean }> }>("/api/auth/sessions") });
  const creds = useQuery({ queryKey: ["plaid-creds"], queryFn: () => api.get<{ environments: Array<{ environment: string; hasKeys: boolean; updatedAt: string }> }>("/api/plaid/credentials") });
  const items = useQuery({ queryKey: ["plaid-items"], queryFn: () => api.get<{ items: Array<{ id: string; institution_name: string | null; environment: string; status: string; accounts: unknown[] }> }>("/api/plaid/items") });

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // display name
  const [displayName, setDisplayName] = useState("");
  const saveName = useMutation({
    mutationFn: () => api.patch("/api/auth/me", { display_name: displayName }),
    onSuccess: () => {
      setMsg("Display name updated.");
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Failed."),
  });

  // password
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const changePassword = useMutation({
    mutationFn: () => api.patch("/api/auth/password", { current_password: cur, new_password: next }),
    onSuccess: () => {
      setCur("");
      setNext("");
      setMsg("Password changed — other sessions were signed out.");
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Failed."),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/api/auth/sessions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }),
  });
  const logoutAll = useMutation({
    mutationFn: () => api.post("/api/auth/logout-all"),
    onSuccess: () => (window.location.href = "/login"),
  });

  // plaid
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [environment, setEnvironment] = useState<"sandbox" | "production">("sandbox");
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  const saveCreds = useMutation({
    mutationFn: () => api.put("/api/plaid/credentials", { clientId, secret, environment }),
    onSuccess: () => {
      setClientId("");
      setSecret("");
      setMsg("Plaid keys saved and validated.");
      qc.invalidateQueries({ queryKey: ["plaid-creds"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Failed."),
  });

  async function startLink() {
    setLinking(true);
    setErr(null);
    try {
      const res = await api.get<{ linkToken: string }>(`/api/plaid/link-token?environment=${environment}`);
      setLinkToken(res.linkToken);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create link token.");
      setLinking(false);
    }
  }

  const removeItem = useMutation({
    mutationFn: (id: string) => api.del(`/api/plaid/items/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plaid-items"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardTitle>Profile</CardTitle>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            saveName.mutate();
          }}
        >
          <Input placeholder="Display name" value={displayName || (me.data?.user.display_name ?? "")} onChange={(e) => setDisplayName(e.target.value)} />
          <Button type="submit" disabled={saveName.isPending || !displayName}>
            Save display name
          </Button>
        </form>

        <h4 className="mt-6 text-sm font-semibold text-text">Change password</h4>
        <form
          className="mt-2 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            changePassword.mutate();
          }}
        >
          <Input type="password" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} />
          <Input type="password" placeholder="New password (10+ chars)" value={next} onChange={(e) => setNext(e.target.value)} />
          <Button type="submit" variant="secondary" disabled={changePassword.isPending || !cur || !next}>
            Change password
          </Button>
        </form>
      </Card>

      <NotificationsSecurityCard setMsg={setMsg} setErr={setErr} />

      <HubPanel setMsg={setMsg} setErr={setErr} />

      <AgentWiringCard />

      <Card>
        <CardTitle>Sessions</CardTitle>
        <div className="mt-4 space-y-2">
          {sessions.data?.sessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between text-sm">
              <span className="text-text">
                {s.device_label || "Unknown device"}
                {s.current && <Badge className="ml-2 bg-accent/10 text-accent">current</Badge>}
              </span>
              {!s.current && (
                <button onClick={() => revoke.mutate(s.id)} className="text-xs text-text-muted hover:text-danger">
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="mt-3 text-danger" onClick={() => logoutAll.mutate()}>
          Sign out everywhere
        </Button>
      </Card>

      <Card className="lg:col-span-2">
        <CardTitle>Bank connections (bring your own Plaid keys)</CardTitle>
        <p className="mt-1 text-sm text-text-muted">
          Paste your free Plaid keys — they&apos;re encrypted at rest and only ever leave your machine to talk to Plaid.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <label className="mb-1 block text-xs text-text-muted">Plaid client_id</label>
            <Input placeholder="6543a1b2…" value={clientId} onChange={(e) => setClientId(e.target.value)} />
          </div>
          <div className="min-w-48 flex-1">
            <label className="mb-1 block text-xs text-text-muted">Plaid secret</label>
            <Input type="password" placeholder="a1b2c3…" value={secret} onChange={(e) => setSecret(e.target.value)} />
          </div>
          <div className="min-w-32">
            <label className="mb-1 block text-xs text-text-muted">Environment</label>
            <Select value={environment} onChange={(e) => setEnvironment(e.target.value as "sandbox" | "production")}>
              <option value="sandbox">Sandbox</option>
              <option value="production">Production</option>
            </Select>
          </div>
          <Button
            variant="secondary"
            disabled={saveCreds.isPending || !clientId || !secret}
            onClick={() => saveCreds.mutate()}
          >
            {saveCreds.isPending ? "Validating…" : "Save & test keys"}
          </Button>
        </div>
        <div className="mt-2 text-xs text-text-muted">
          {creds.data?.environments.map((e) => (
            <span key={e.environment} className="mr-3">
              {e.environment}: {e.hasKeys ? "keys saved ✓" : "no keys"}
            </span>
          ))}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <Button disabled={linking} onClick={startLink}>
            {linking ? "Opening…" : "+ Connect a bank"}
          </Button>
          {linkToken && (
            <PlaidLink
              token={linkToken}
              onSuccess={async (publicToken, metadata) => {
                await api.post("/api/plaid/exchange", {
                  publicToken,
                  environment,
                  institutionId: metadata.institution?.institution_id ?? null,
                  institutionName: metadata.institution?.name ?? null,
                });
                setLinkToken(null);
                setLinking(false);
                qc.invalidateQueries({ queryKey: ["plaid-items"] });
                qc.invalidateQueries({ queryKey: ["accounts"] });
                qc.invalidateQueries({ queryKey: ["summary"] });
                setMsg("Bank connected — run a sync to pull transactions.");
              }}
              onExit={() => {
                setLinkToken(null);
                setLinking(false);
              }}
              className="hidden"
            >
              link
            </PlaidLink>
          )}
        </div>
        <div className="mt-4 space-y-2">
          {items.data?.items.map((it) => (
            <div key={it.id} className="flex items-center justify-between rounded-lg bg-surface-muted px-4 py-2.5 text-sm">
              <span className="text-text">
                {it.institution_name ?? "Institution"} <span className="text-text-muted">· {it.environment}</span>
              </span>
              <span className="flex items-center gap-3">
                <Badge className={it.status === "active" ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}>
                  {it.status}
                </Badge>
                <button onClick={() => removeItem.mutate(it.id)} className="text-xs text-text-muted hover:text-danger">
                  Remove
                </button>
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle>Appearance</CardTitle>
        <p className="mt-1 text-sm text-text-muted">Accent color — applied everywhere, charts included.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {accents.map((c) => (
            <button
              key={c}
              onClick={() => setAccent(c)}
              className="h-9 w-9 rounded-full border-2 transition-transform hover:scale-110"
              style={{
                background: c,
                borderColor: accent === c ? "var(--foreground)" : "transparent",
              }}
              aria-label={`Accent ${c}`}
              aria-pressed={accent === c}
            />
          ))}
          <button
            onClick={() => setDark(!dark)}
            className="ml-2 flex h-9 items-center gap-2 rounded-full border border-border px-3 text-xs font-medium text-text-muted transition-colors hover:text-text"
            aria-pressed={dark}
          >
            {dark ? <Sun size={14} aria-hidden /> : <Moon size={14} aria-hidden />}
            {dark ? "Light" : "Dark"}
          </button>
        </div>
      </Card>

      <BackupPanel setMsg={setMsg} setErr={setErr} />
      <UpdatesCard />

      {msg && (
        <p role="status" className="rounded-xl bg-[var(--success-soft)] px-4 py-3 text-sm font-medium text-success lg:col-span-2">
          {msg}
        </p>
      )}
      {err && (
        <p role="alert" className="rounded-xl bg-[var(--danger-soft)] px-4 py-3 text-sm font-medium text-danger lg:col-span-2">
          {err}
        </p>
      )}
    </div>
  );
}

// ── Notifications & security (P11) ─────────────────────────────────────────

function NotificationsSecurityCard({ setMsg, setErr }: { setMsg: (s: string | null) => void; setErr: (s: string | null) => void }) {
  const qc = useQueryClient();
  const [isMobile, setIsMobile] = useState(false);
  const [bioType, setBioType] = useState<string | null>(null);
  const [resetCode, setResetCode] = useState("");
  const [resetPin, setResetPin] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  const prefs = useQuery({
    queryKey: ["notif-prefs"],
    queryFn: () =>
      api.get<{
        notifEnabled: boolean;
        notifFrequency: "daily" | "weekly";
        notifTime: string;
        emailEnabled: boolean;
        emailAddress: string | null;
        emailFrequency: "daily" | "weekly";
        biometricEnabled: boolean;
      }>("/api/notifications/prefs"),
  });
  const lock = useQuery({
    queryKey: ["device-lock"],
    queryFn: () => api.get<{ configured: boolean; biometricEnabled: boolean }>("/api/device-lock"),
  });

  useEffect(() => {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    setIsMobile(!!cap?.isNativePlatform?.());
    if (cap?.isNativePlatform?.()) {
      import("@/lib/biometric")
        .then((m) => m.checkBiometricAvailability())
        .then((a) => setBioType(a.available ? a.type : null))
        .catch(() => {});
    }
  }, []);

  async function save(patch: Record<string, unknown>) {
    setErr(null);
    try {
      await api.put("/api/notifications/prefs", patch);
      qc.invalidateQueries({ queryKey: ["notif-prefs"] });
      setMsg("Preferences saved.");
      // Reschedule the on-device notification with the new settings.
      if (isMobile) {
        const { syncNotificationSchedule } = await import("@/lib/solo-notifications");
        const { getSoloDb } = await import("@/lib/solo-router");
        const db = await getSoloDb();
        const next = { ...prefs.data, ...patch } as {
          notifEnabled: boolean;
          notifFrequency: "daily" | "weekly";
          notifTime: string;
        };
        await syncNotificationSchedule(db, {
          enabled: next.notifEnabled,
          frequency: next.notifFrequency,
          time: next.notifTime,
        });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save preferences.");
    }
  }

  async function toggleBiometric(enabled: boolean) {
    setErr(null);
    try {
      if (enabled) {
        const { checkBiometricAvailability, authenticateBiometric } = await import("@/lib/biometric");
        const avail = await checkBiometricAvailability();
        if (!avail.available) {
          setErr("No fingerprint or face unlock is set up on this phone.");
          return;
        }
        const ok = await authenticateBiometric("Verify your fingerprint or face");
        if (!ok) return;
        await api.post("/api/device-lock/biometric/enable");
      } else {
        await api.post("/api/device-lock/biometric/disable");
      }
      qc.invalidateQueries({ queryKey: ["device-lock"] });
      qc.invalidateQueries({ queryKey: ["notif-prefs"] });
      setMsg(enabled ? "Biometric unlock enabled." : "Biometric unlock disabled.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update biometrics.");
    }
  }

  async function doResetPin() {
    setErr(null);
    setResetBusy(true);
    try {
      await api.post("/api/auth/recovery", { recovery_code: resetCode.trim(), new_pin: resetPin });
      setResetCode("");
      setResetPin("");
      qc.invalidateQueries({ queryKey: ["device-lock"] });
      setMsg("PIN reset — use your new PIN next time.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not reset PIN — check your recovery code.");
    } finally {
      setResetBusy(false);
    }
  }

  const p = prefs.data;
  const showBiometric = isMobile && lock.data?.configured;

  return (
    <Card className="lg:col-span-2">
      <CardTitle>Notifications &amp; security</CardTitle>

      {/* Push (local) notifications */}
      <h4 className="mt-5 text-sm font-semibold text-text">Push notifications</h4>
      <p className="mt-1 text-xs text-text-muted">
        {isMobile
          ? "Scheduled on this phone. Notifications never include amounts — just status (on track / needs review). Tap one to open the app for details."
          : "On-device notifications are for the phone app. On this desktop you can still set email digests below."}
      </p>
      <div className="mt-3 space-y-3">
        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={p?.notifEnabled ?? false}
            onChange={(e) => save({ notifEnabled: e.target.checked })}
            disabled={!p}
          />
          Enable push notifications
        </label>
        {p?.notifEnabled && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-text-muted">
              Frequency
              <Select
                value={p.notifFrequency}
                onChange={(e) => save({ notifFrequency: e.target.value as "daily" | "weekly" })}
                className="w-32"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </Select>
            </label>
            <label className="flex items-center gap-2 text-sm text-text-muted">
              Time
              <Input
                type="time"
                value={p.notifTime}
                onChange={(e) => save({ notifTime: e.target.value })}
                className="w-32"
              />
            </label>
          </div>
        )}
      </div>

      {/* Email digests */}
      <h4 className="mt-6 text-sm font-semibold text-text">Email digests</h4>
      <p className="mt-1 text-xs text-text-muted">
        A daily or weekly summary of where your budget stands. Emails are sent by your own hub (SMTP) — set
        SMTP_HOST/SMTP_USER/SMTP_PASS in the hub env to enable sending. No bank-level details, just your status.
      </p>
      <div className="mt-3 space-y-3">
        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={p?.emailEnabled ?? false}
            onChange={(e) => save({ emailEnabled: e.target.checked })}
            disabled={!p}
          />
          Enable email digests
        </label>
        {p?.emailEnabled && (
          <div className="flex flex-wrap items-center gap-3">
            <Input
              type="email"
              placeholder="you@example.com"
              value={p.emailAddress ?? ""}
              onChange={(e) => save({ emailAddress: e.target.value })}
              className="max-w-56"
            />
            <label className="flex items-center gap-2 text-sm text-text-muted">
              Frequency
              <Select
                value={p.emailFrequency}
                onChange={(e) => save({ emailFrequency: e.target.value as "daily" | "weekly" })}
                className="w-32"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </Select>
            </label>
          </div>
        )}
      </div>

      {/* Biometrics */}
      {showBiometric && (
        <>
          <h4 className="mt-6 text-sm font-semibold text-text">Biometric unlock</h4>
          <p className="mt-1 text-xs text-text-muted">
            {bioType
              ? `Unlock with your ${bioType} instead of the PIN. The system prompt handles the scan; the PIN stays as a fallback.`
              : "Set up fingerprint or face unlock in your phone's system settings first."}
          </p>
          <label className="mt-3 flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={lock.data?.biometricEnabled ?? false}
              onChange={(e) => toggleBiometric(e.target.checked)}
              disabled={!bioType}
            />
            Unlock with fingerprint / face
          </label>
        </>
      )}

      {/* PIN reset (recovery code from setup) */}
      {isMobile && (
        <>
          <h4 className="mt-6 text-sm font-semibold text-text">Reset PIN</h4>
          <p className="mt-1 text-xs text-text-muted">
            Forgot your PIN? Enter the <strong className="text-text">recovery code</strong> you saved during
            setup, plus a new PIN. This is the only way to reset it without wiping the app.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Input
              placeholder="Recovery code"
              value={resetCode}
              onChange={(e) => setResetCode(e.target.value)}
              className="min-w-40 flex-1 font-mono"
            />
            <Input
              type="password"
              inputMode="numeric"
              placeholder="New PIN (4–12 digits)"
              value={resetPin}
              onChange={(e) => setResetPin(e.target.value.replace(/[^0-9]/g, "").slice(0, 12))}
              className="min-w-36 flex-1"
            />
            <Button variant="secondary" onClick={doResetPin} disabled={resetBusy || resetCode.length < 8 || resetPin.length < 4}>
              {resetBusy ? "Resetting…" : "Reset PIN"}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

// ── Agent wiring (P12) ─────────────────────────────────────────────────────

function AgentWiringCard() {
  const [endpoint, setEndpoint] = useState("");
  const qc = useQueryClient();
  useEffect(() => {
    if (typeof window !== "undefined") setEndpoint(window.location.origin);
  }, []);

  const agents = useQuery({
    queryKey: ["agent-tokens"],
    queryFn: () => api.get<{ agents: Array<{ id: string; name: string }> }>("/api/agent/tokens"),
    retry: false,
  });
  const soloUnsupported = agents.isError;

  const prefs = useQuery({
    queryKey: ["agent-prefs"],
    queryFn: () =>
      api.get<{ prefs: { tabs: string[]; autoCategorize: boolean; global: boolean; globalWrite: boolean } }>(
        "/api/agent/prefs"
      ),
    retry: false,
  });
  const p = prefs.data?.prefs;
  const setPref = useMutation({
    mutationFn: (patch: { tabs?: string[]; autoCategorize?: boolean; global?: boolean; globalWrite?: boolean }) =>
      api.put("/api/agent/prefs", patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-prefs"] }),
  });

  const TAB_LABELS: Record<string, string> = {
    dashboard: "Home",
    accounts: "Accounts",
    activity: "Activity",
    budgets: "Budgets",
    reports: "Reports",
    planning: "Planning",
    investments: "Investments",
  };
  const TAB_ORDER = ["dashboard", "accounts", "activity", "budgets", "reports", "planning", "investments"];
  const tabs = p?.tabs ?? ["activity"];

  function toggleTab(tab: string) {
    const next = tabs.includes(tab) ? tabs.filter((t) => t !== tab) : [...tabs, tab];
    setPref.mutate({ tabs: next.length > 0 ? next : ["activity"] });
  }

  return (
    <Card className="lg:col-span-2">
      <CardTitle>AI agent connection</CardTitle>
      <p className="mt-1 text-sm text-text-muted">
        Point your finance agent (Hermes, Claude, Cursor…) at Open Finance to answer money questions and — with
        your approval — adjust budgets. Agents get a token with read-only access by default and ask permission
        before any write.
      </p>

      {/* Access tiers — per-tab read selection + global master + write */}
      <div className="mt-4 space-y-3">
        <div className="rounded-xl border border-border p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-text">Tabs the agent can read</p>
              <p className="mt-0.5 text-xs text-text-muted">
                Pick exactly what the agent may see — e.g. Activity + Budgets and nothing else. It never sees the
                tabs you leave off.
              </p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {TAB_ORDER.map((tab) => (
              <label
                key={tab}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  p?.global
                    ? "cursor-not-allowed border-border opacity-50"
                    : tabs.includes(tab)
                      ? "border-accent bg-accent/5 text-accent"
                      : "border-border text-text-muted hover:bg-surface-muted"
                }`}
              >
                <input
                  type="checkbox"
                  checked={p?.global ? true : tabs.includes(tab)}
                  disabled={!!p?.global}
                  onChange={() => toggleTab(tab)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                {TAB_LABELS[tab]}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-text-muted">
            {p?.global
              ? "Global access is on — all tabs are readable."
              : `Agent can read: ${tabs.map((t) => TAB_LABELS[t]).join(", ")}`}
          </p>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-xl border border-border p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text">Smart categorization (write)</p>
            <p className="mt-0.5 text-xs text-text-muted">
              Let your agent categorize unclear expenses — a purchase labeled &ldquo;POS DEBIT&rdquo; or an unnamed
              charge. It categorizes the ones it&apos;s confident about and leaves the gray-area ones for you. You can
              always change any category manually in the Activity tab.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={p?.autoCategorize ?? false}
            onClick={() => setPref.mutate({ autoCategorize: !(p?.autoCategorize ?? false) })}
            disabled={setPref.isPending}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              p?.autoCategorize ? "bg-[var(--accent)]" : "bg-surface-muted"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                p?.autoCategorize ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
        </div>

        <div className={`rounded-xl border p-4 ${p?.global ? "border-accent/40" : "border-border"}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-text">Global access (whole app)</p>
              <p className="mt-0.5 text-xs text-text-muted">
                One switch for everything — read access to all tabs: balances, net worth, budgets, planning, reports,
                investments.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={p?.global ?? false}
              onClick={() => setPref.mutate({ global: !(p?.global ?? false) })}
              disabled={setPref.isPending}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                p?.global ? "bg-[var(--accent)]" : "bg-surface-muted"
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                  p?.global ? "left-[22px]" : "left-0.5"
                }`}
              />
            </button>
          </div>
          {p?.global && (
            <div className="mt-3 flex items-start justify-between gap-4 border-t border-border pt-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-text">Allow global write</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  Beyond reading, let your agent change budgets, categories, and settings (each write still asks
                  your approval).
                </p>
              </div>
              <button
                role="switch"
                aria-checked={p?.globalWrite ?? false}
                onClick={() => setPref.mutate({ globalWrite: !(p?.globalWrite ?? false) })}
                disabled={setPref.isPending}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                  p?.globalWrite ? "bg-[var(--accent)]" : "bg-surface-muted"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                    p?.globalWrite ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </button>
            </div>
          )}
        </div>
      </div>

      {soloUnsupported ? (
        <div className="mt-4 rounded-lg bg-surface-muted px-4 py-3 text-sm text-text-muted">
          On this phone, agent connections are served by a hub. Use the{" "}
          <strong className="text-text">Hub &amp; phone pairing</strong> card above to set one up on a computer,
          then connect your agent here — or on the hub itself.
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-text-muted">MCP endpoint (Streamable HTTP)</label>
              <code className="block rounded-md bg-surface-muted px-3 py-2 text-sm text-accent">
                {endpoint}/api/mcp
              </code>
            </div>
            <div>
              <label className="mb-1 block text-xs text-text-muted">Agents &amp; tokens</label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-text">
                  {agents.data?.agents.length ?? 0} token{agents.data?.agents.length === 1 ? "" : "s"}
                </span>
                <Button size="sm" variant="secondary" onClick={() => (window.location.href = "/agents")}>
                  Manage in Agents
                </Button>
              </div>
            </div>
          </div>
          <div className="mt-4 rounded-lg bg-surface-muted px-4 py-3 text-xs text-text-muted">
            <p className="font-medium text-text">Example (Hermes / Claude / Cursor):</p>
            <p className="mt-1">
              Create a token on the Agents page (read-only preset), then add an MCP server to your agent with the
              endpoint above and the token. The agent can read budgets/summary immediately; budget edits prompt you
              for approval.
            </p>
          </div>
        </>
      )}
    </Card>
  );
}

// ── Connection Assistant (hub setup — no env editing) ──────────────────────

function HubPanel({ setMsg, setErr }: { setMsg: (s: string | null) => void; setErr: (s: string | null) => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"solo" | "hub">("solo");
  const [hubUrl, setHubUrl] = useState("");

  const diagnostics = useQuery({
    queryKey: ["hub", "diagnostics"],
    queryFn: () =>
      api.get<{
        mode: string;
        savedUrl: string | null;
        bindAddress: string;
        publicUrl: string;
        lanIps: string[];
        tailscaleUp: boolean;
        tailscale: { name: string | null; ip: string | null } | null;
      }>("/api/hub/diagnostics"),
  });
  const detect = useQuery({
    queryKey: ["hub", "detect"],
    queryFn: () =>
      api.get<{ lanIps: string[]; tailscale: { name: string | null; ip: string | null } | null; preferredUrl: string }>(
        "/api/hub/detect"
      ),
  });

  const apply = useMutation({
    mutationFn: () => api.post("/api/hub/apply", { mode, url: mode === "hub" ? hubUrl : "" }),
    onSuccess: () => {
      setMsg("Hub mode saved — restart the app for the new bind address to take effect.");
      qc.invalidateQueries({ queryKey: ["hub"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Failed."),
  });

  const startPairing = useMutation({
    mutationFn: () => api.post<{ code: string; url: string; ttlSeconds: number }>("/api/pairing/start"),
    onSuccess: (d) => {
      setMsg(`Pairing code: ${d.code} — scan the QR or open ${d.url} on your phone (valid ${d.ttlSeconds / 60} min).`);
      qc.invalidateQueries({ queryKey: ["hub"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Failed."),
  });

  const d = diagnostics.data;
  const preferred = detect.data?.preferredUrl ?? "";

  return (
    <Card className="lg:col-span-2">
      <CardTitle>Hub &amp; phone pairing (Connection Assistant)</CardTitle>
      <p className="mt-1 text-sm text-text-muted">
        Run as a solo desktop app, or host for your phone. No env-file editing — it&apos;s a Settings action.
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          onClick={() => setMode("solo")}
          className={`flex-1 rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
            mode === "solo" ? "border-accent bg-accent/5" : "border-border hover:bg-surface-muted"
          }`}
        >
          <p className="font-medium text-text">☝ Solo</p>
          <p className="mt-0.5 text-xs text-text-muted">This machine only — localhost, no network exposure.</p>
        </button>
        <button
          onClick={() => {
            setMode("hub");
            if (!hubUrl && preferred) setHubUrl(preferred);
          }}
          className={`flex-1 rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
            mode === "hub" ? "border-accent bg-accent/5" : "border-border hover:bg-surface-muted"
          }`}
        >
          <p className="font-medium text-text">📱 Host for my phone</p>
          <p className="mt-0.5 text-xs text-text-muted">LAN or Tailscale — pair by QR, sync anywhere.</p>
        </button>
      </div>

      {mode === "hub" && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <label className="mb-1 block text-xs text-text-muted">Hub URL (detected automatically)</label>
              <Input value={hubUrl} onChange={(e) => setHubUrl(e.target.value)} placeholder="http://192.168.x.x:3000" />
            </div>
            <Button onClick={() => apply.mutate()} disabled={apply.isPending || !hubUrl}>
              {apply.isPending ? "Saving…" : "Apply hub mode"}
            </Button>
            <Button variant="secondary" onClick={() => startPairing.mutate()} disabled={startPairing.isPending}>
              {startPairing.isPending ? "Creating…" : "Generate pairing QR"}
            </Button>
          </div>
          {detect.data && (
            <p className="text-xs text-text-muted">
              Detected: LAN {detect.data.lanIps.join(", ") || "—"}
              {detect.data.tailscale
                ? ` · Tailscale ${detect.data.tailscale.name ?? ""} (${detect.data.tailscale.ip ?? ""})`
                : " · Tailscale not found (install for anywhere access)"}
            </p>
          )}
        </div>
      )}

      {d && (
        <div className="mt-4 rounded-lg bg-surface-muted px-4 py-3 text-xs text-text-muted">
          <p>
            Mode: <span className="font-medium text-text">{d.mode}</span> · Bind: {d.bindAddress} · Public URL:{" "}
            {d.publicUrl}
            {d.tailscaleUp ? " · Tailscale: up" : " · Tailscale: down"}
          </p>
          <p className="mt-1">
            LAN IPs: {d.lanIps.join(", ") || "—"}
            {d.savedUrl ? ` · Saved URL: ${d.savedUrl}` : ""}
          </p>
        </div>
      )}
    </Card>
  );
}

// ── Backup & restore ────────────────────────────────────────────────────────

function BackupPanel({ setMsg, setErr }: { setMsg: (s: string | null) => void; setErr: (s: string | null) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  function download() {
    fetch("/api/backup", { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Backup failed.");
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `open-finance-${new Date().toISOString().slice(0, 10)}.ofbak`;
        a.click();
        URL.revokeObjectURL(a.href);
        setMsg("Backup downloaded. Keep it with the same ENCRYPTION_KEY that created it.");
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Backup failed."));
  }

  async function restore() {
    const file = fileRef.current?.files?.[0];
    if (!file || !password) {
      setErr("Choose a backup file and enter your password.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("password", password);
      const res = await fetch("/api/backup/restore", {
        method: "POST",
        credentials: "same-origin",
        headers: { "x-of-request": "1" },
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Restore failed.");
      }
      setMsg("Database restored. A pre-restore backup was saved next to the database. Reloading…");
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Restore failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <Card className="lg:col-span-2">
      <CardTitle>Backup &amp; restore</CardTitle>
      <p className="mt-1 text-sm text-text-muted">
        Download an encrypted snapshot of your whole database. Restoring replaces everything — a safety backup is
        written first, and your password is required. Restore only on a machine with the same ENCRYPTION_KEY.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={download}>
          ⬇ Download backup (.ofbak)
        </Button>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4">
        <div className="min-w-48 flex-1">
          <label className="mb-1 block text-xs text-text-muted">Backup file</label>
          <input ref={fileRef} type="file" accept=".ofbak" className="text-sm text-text-muted" />
        </div>
        <div className="min-w-48 flex-1">
          <label className="mb-1 block text-xs text-text-muted">Confirm password</label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your account password" />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-text-muted">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          I understand this replaces my data
        </label>
        <Button
          variant="secondary"
          className="text-danger"
          disabled={busy || !confirm || !password}
          onClick={restore}
        >
          {busy ? "Restoring…" : "Restore from backup"}
        </Button>
      </div>
    </Card>

    <Card>
      <CardTitle>Setup tour</CardTitle>
      <p className="mt-1 text-sm text-text-muted">
        Replay the first-run walkthrough — Plaid keys, bank linking, and the agent intro. Nothing is
        reset; it just guides you through setup again.
      </p>
      <div className="mt-4">
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              await api.post("/api/onboarding", { action: "reset" });
              window.location.href = "/dashboard";
            } catch (e) {
              setErr(e instanceof Error ? e.message : "Could not restart the tour.");
            }
          }}
        >
          ↻ Restart setup tour
        </Button>
      </div>
    </Card>
    </>
  );
}
