"use client";

import { useEffect, useRef, useState } from "react";
import { useEscapeToClose } from "@/lib/use-escape-to-close";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import jsQR from "jsqr";
import { Moon, Sun, ExternalLink, QrCode, X } from "lucide-react";
import { api } from "@/lib/api-client";
import { hasWindow } from "@/lib/browser-env";
import { usePageTitle } from "@/lib/use-page-title";
import { Card, CardTitle } from "@/components/ui/card";
import { SettingsGroup } from "@/components/ui/settings-group";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { CustomSelect } from "@/components/ui/custom-select";
import { CustomTimePicker } from "@/components/ui/custom-time-picker";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useTheme } from "@/components/providers";
import { isSoloCandidate } from "@/lib/mobile-mode";
import { storeHubUrl } from "@/lib/mobile-storage";
import { UpdatesCard } from "@/components/updates-card";
import { PlaidLinkLauncher } from "@/components/plaid-link-launcher";

interface Me {
  user: { display_name: string; username: string | null; email: string | null };
}

export default function SettingsPage() {
  usePageTitle("Settings");
  const qc = useQueryClient();
  const { accent, setAccent, accents, dark, setDark, density, setDensity, densities } = useTheme();
  const [solo, setSolo] = useState(false);

  const me = useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/api/auth/me") });
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => api.get<{ sessions: Array<{ id: string; device_label: string; created_at: string; current: boolean }> }>("/api/auth/sessions") });
  const creds = useQuery({ queryKey: ["plaid-creds"], queryFn: () => api.get<{ environments: Array<{ environment: string; hasKeys: boolean; updatedAt: string }> }>("/api/plaid/credentials") });
  const items = useQuery({ queryKey: ["plaid-items"], queryFn: () => api.get<{ items: Array<{ id: string; institution_name: string | null; environment: string; status: string; accounts: Array<{ name: string }> }> }>("/api/plaid/items") });

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmLogoutAll, setConfirmLogoutAll] = useState(false);
  const [confirmRemoveItem, setConfirmRemoveItem] = useState<string | null>(null);
  // Density draft: the slider only previews; Apply commits it (issue: it used
  // to resize the live environment while dragging).
  const [densityDraft, setDensityDraft] = useState<number>(density);

  useEffect(() => {
    if (hasWindow()) setSolo(isSoloCandidate(window.location.origin));
  }, []);

  // Issue #21: status messages auto-dismiss and never linger across visits.
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 5000);
    return () => clearTimeout(t);
  }, [msg]);

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
  const [reconnectItemId, setReconnectItemId] = useState<string | null>(null);
  const [reconnectingItem, setReconnectingItem] = useState<string | null>(null);
  const [showPlaidHelp, setShowPlaidHelp] = useState(false);
  useEscapeToClose(() => setShowPlaidHelp(false), showPlaidHelp);

  const saveCreds = useMutation({
    mutationFn: () => api.put("/api/plaid/credentials", { clientId, secret, environment }),
    onSuccess: () => {
      setClientId("");
      setSecret("");
      setMsg("Connection keys saved and checked.");
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

  // Pull new/changed transactions (and fresh balances) from Plaid now.
  const syncNow = useMutation({
    mutationFn: () =>
      api.post<{ results: Array<{ institution_name: string | null; added: number; modified: number; removed: number; ok: boolean; error?: string }> }>(
        "/api/transactions/sync"
      ),
    onSuccess: (d) => {
      const changed = d.results.reduce((n, r) => n + r.added + r.modified, 0);
      const failed = d.results.filter((r) => !r.ok);
      if (failed.length > 0) {
        setErr(`Sync finished with errors on ${failed.map((f) => `${f.institution_name ?? "an institution"}${f.error ? `: ${f.error}` : ""}`).join("; ")}.`);
      } else {
        setMsg(`Sync complete — ${changed === 0 ? "nothing new" : `${changed} transaction(s) updated`}.`);
      }
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      qc.invalidateQueries({ queryKey: ["plaid-items"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Sync failed."),
  });

  // Re-import a single item's FULL transaction history from Plaid (cursor
  // reset → Plaid re-delivers everything it has, typically up to 24 months).
  const [resyncingItem, setResyncingItem] = useState<string | null>(null);
  const resyncItem = useMutation({
    mutationFn: async (id: string) => {
      setResyncingItem(id);
      setErr(null);
      try {
        const r = await api.post<{ ok: boolean; added: number; modified: number; removed: number; error?: string | null; note?: string }>(
          "/api/plaid/resync",
          { itemId: id }
        );
        if (r.ok) {
          const total = r.added + r.modified;
          setMsg(r.note ?? `Re-imported — ${total === 0 ? "no new transactions" : `${total} transaction(s) added/updated`}.`);
        } else {
          setErr(r.error ? `Re-import failed: ${r.error}` : "Re-import failed.");
        }
      } finally {
        setResyncingItem(null);
      }
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      qc.invalidateQueries({ queryKey: ["plaid-items"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Re-import failed."),
  });

  // Backfill OLDER history removed (v0.3.39): duplicated "Re-import history"
  // — both pull what Plaid has, and institutions that cap at ~90 days return
  // the same window either way. Keep just Re-import + the CSV import panel.

  return (
    <div className="space-y-8">
      <p className="text-xs text-text-muted">Build {process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}</p>

      <SettingsGroup title="Account" description="Your identity and active sessions.">
        <Card>
          <CardTitle>Profile</CardTitle>
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              saveName.mutate();
            }}
          >
            <Input aria-label={"Display name"} placeholder="Display name" value={displayName || (me.data?.user.display_name ?? "")} onChange={(e) => setDisplayName(e.target.value)} />
            <Button type="submit" disabled={saveName.isPending || !displayName}>
              Save display name
            </Button>
          </form>

          {solo ? (
            <div className="mt-6 rounded-xl bg-surface-muted px-4 py-3 text-xs text-text-muted">
              This phone is protected by your <strong className="text-text">device PIN</strong> (and optionally
              fingerprint / face) instead of a password. To change it, use{" "}
              <strong className="text-text">Reset PIN</strong> in Notifications &amp; security below — you&apos;ll need
              your recovery code.
            </div>
          ) : (
            <>
              <h4 className="mt-6 text-sm font-semibold text-text">Change password</h4>
              <form
                className="mt-2 space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  changePassword.mutate();
                }}
              >
                <PasswordInput aria-label={"Current password"} placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} />
                <PasswordInput aria-label={"New password"} placeholder="New password" value={next} onChange={(e) => setNext(e.target.value)} />
                <Button type="submit" variant="secondary" disabled={changePassword.isPending || !cur || !next}>
                  Change password
                </Button>
              </form>
            </>
          )}
        </Card>

        <Card>
          <CardTitle>Sessions</CardTitle>
          <div className="mt-4 space-y-2">
            {sessions.data?.sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm">
                <span className="text-text">
                  {s.device_label || "Unknown device"}
                  {s.current && <Badge className="ml-2 bg-accent/10 text-accent-text">current</Badge>}
                </span>
                {!s.current && (
                  <button onClick={() => revoke.mutate(s.id)} className="text-xs text-text-muted hover:text-danger">
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="mt-3 text-danger" onClick={() => setConfirmLogoutAll(true)}>
            Sign out everywhere
          </Button>
        </Card>
      </SettingsGroup>

      <SettingsGroup title="Security" description="Device lock, notifications, and account recovery.">
        <NotificationsSecurityCard setMsg={setMsg} setErr={setErr} />
      </SettingsGroup>

      <SettingsGroup title="Connections" description="Banks, pay schedule, and linking this device to a hub.">
        {/* Bank connections card continues below */}

      <Card className="lg:col-span-2">
        <CardTitle>Bank connections</CardTitle>
        <p className="mt-1 text-sm text-text-muted">
          Open Finance connects to your bank through Plaid. Paste your free connection keys — they&apos;re encrypted on
          this device and only ever leave it to talk to your bank. No keys? No problem — track everything manually and
          add banks later.
        </p>

        {/* Issue #19: optional guided setup with the correct links */}
        <div className="mt-3">
          {!showPlaidHelp ? (
            <button
              type="button"
              onClick={() => setShowPlaidHelp(true)}
              className="flex items-center gap-1.5 text-sm font-medium text-accent-text transition-colors hover:underline"
            >
              <ExternalLink size={14} aria-hidden /> Need keys? Walk me through getting them
            </button>
          ) : (
            <div className="rounded-xl border border-border bg-surface-muted/50 p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium text-text">Getting free Plaid keys</p>
                <button
                  type="button"
                  onClick={() => setShowPlaidHelp(false)}
                  className="text-xs text-text-muted transition-colors hover:text-text"
                >
                  Hide
                </button>
              </div>
              <ol className="mt-2 list-inside list-decimal space-y-1.5 text-text-muted">
                <li>
                  Create a free account at{" "}
                  <a href="https://dashboard.plaid.com/signup" target="_blank" rel="noreferrer" className="font-medium text-accent-text">
                    dashboard.plaid.com/signup
                  </a>{" "}
                  (Plaid is free for development; production keys need a quick approval).
                </li>
                <li>
                  Open{" "}
                  <a href="https://dashboard.plaid.com/developers/keys" target="_blank" rel="noreferrer" className="font-medium text-accent-text">
                    Dashboard → Developers → Keys
                  </a>{" "}
                  (dashboard.plaid.com/developers/keys).
                </li>
                <li>
                  Copy the <strong className="text-text">Client ID</strong> and the{" "}
                  <strong className="text-text">Secret</strong> for the environment you want — the{" "}
                  <strong className="text-text">Sandbox</strong> secret starts with &ldquo;sandbox_&rdquo;, the{" "}
                  <strong className="text-text">Production</strong> secret starts with &ldquo;production_&rdquo;.
                </li>
                <li>Paste them below and pick the matching environment, then tap &ldquo;Save &amp; check keys&rdquo;.</li>
              </ol>
              <p className="mt-2 text-xs text-text-muted">
                Don&apos;t want to link a bank at all? Skip this entirely — manual tracking works everywhere and you can
                add keys any time.
              </p>
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <label className="mb-1 block text-xs text-text-muted">Client ID</label>
            <Input aria-label={"Plaid client ID"} placeholder="6543a1b2…" value={clientId} onChange={(e) => setClientId(e.target.value)} />
          </div>
          <div className="min-w-48 flex-1">
            <label className="mb-1 block text-xs text-text-muted">Secret</label>
            <PasswordInput aria-label={"Plaid secret"} placeholder="sandbox_… / production_…" value={secret} onChange={(e) => setSecret(e.target.value)} />
          </div>
          <div className="min-w-32">
            <label id="plaid-env-label" className="mb-1 block text-xs text-text-muted">
              Environment
            </label>
            <CustomSelect
              ariaLabel="Plaid environment"
              value={environment}
              // SAFETY: the only options are "sandbox" | "production", so v is one of the two literals.
              onChange={(v) => setEnvironment(v as "sandbox" | "production")}
              options={[
                { value: "sandbox", label: "Sandbox", hint: "test data" },
                { value: "production", label: "Production", hint: "real banks" },
              ]}
            />
          </div>
          <Button
            variant="secondary"
            disabled={saveCreds.isPending || !clientId || !secret}
            onClick={() => saveCreds.mutate()}
          >
            {saveCreds.isPending ? "Checking…" : "Save & check keys"}
          </Button>
        </div>
        <div className="mt-2 text-xs text-text-muted">
          {creds.data?.environments.map((e) => (
            <span key={e.environment} className="mr-3">
              {e.environment}: {e.hasKeys ? "keys saved" : "no keys"}
            </span>
          ))}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <Button disabled={linking} onClick={startLink}>
            {linking ? "Opening…" : "+ Connect a bank"}
          </Button>
          {items.data && items.data.items.length > 0 && (
            <Button variant="secondary" disabled={syncNow.isPending} onClick={() => syncNow.mutate()}>
              {syncNow.isPending ? "Syncing…" : "Sync now"}
            </Button>
          )}
          {linkToken && (
            <PlaidLinkLauncher
              token={linkToken}
              onSuccess={async (publicToken, institutionName) => {
                await api.post("/api/plaid/exchange", {
                  publicToken,
                  environment,
                  institutionId: null,
                  institutionName: institutionName ?? null,
                  updateItemId: reconnectItemId ?? undefined,
                });
                setLinkToken(null);
                setReconnectItemId(null);
                setLinking(false);
                qc.invalidateQueries({ queryKey: ["plaid-items"] });
                qc.invalidateQueries({ queryKey: ["accounts"] });
                qc.invalidateQueries({ queryKey: ["summary"] });
                qc.invalidateQueries({ queryKey: ["transactions"] });
                setMsg(
                  reconnectItemId
                    ? "Bank re-connected — run a sync to pull the latest transactions."
                    : "Bank connected — run a sync to pull transactions."
                );
              }}
              onExit={() => {
                setLinkToken(null);
                setReconnectItemId(null);
                setLinking(false);
              }}
            />
          )}
        </div>
        <div className="mt-4 space-y-2">
          {items.data?.items.map((it) => (
            <div key={it.id} className="flex items-center justify-between rounded-lg bg-surface-muted px-4 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="block truncate text-text">
                  {it.institution_name ?? (it.accounts?.length ? it.accounts.map((a) => a.name).join(", ") : "Institution")}{" "}
                  <span className="text-text-muted">· {it.environment}</span>
                </span>
                {!it.institution_name && it.accounts?.length > 0 && (
                  <span className="block text-xs text-text-muted">Bank name not captured — shows account names</span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <Badge className={it.status === "active" || it.status === "linked" ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}>
                  {it.status}
                </Badge>
                {it.status !== "active" && it.status !== "linked" && (
                  <button
                    onClick={async () => {
                      setReconnectingItem(it.id);
                      setErr(null);
                      try {
                        const res = await api.get<{ linkToken: string }>(
                          `/api/plaid/link-token?environment=${it.environment}&updateItemId=${it.id}`
                        );
                        setLinkToken(res.linkToken);
                        setReconnectItemId(it.id);
                      } catch (e) {
                        setErr(e instanceof Error ? e.message : "Could not start re-connect.");
                      } finally {
                        setReconnectingItem(null);
                      }
                    }}
                    disabled={reconnectingItem === it.id}
                    className="text-xs text-accent-text hover:underline disabled:opacity-50"
                  >
                    {reconnectingItem === it.id ? "Opening…" : "Reconnect"}
                  </button>
                )}
                <button
                  onClick={() => resyncItem.mutate(it.id)}
                  disabled={resyncingItem === it.id}
                  className="text-xs text-text-muted hover:text-accent-text disabled:opacity-50"
                  title="Re-import full transaction history from this bank (up to ~24 months)"
                >
                  {resyncingItem === it.id ? "Importing…" : "Re-import history"}
                </button>
                <button onClick={() => setConfirmRemoveItem(it.id)} className="text-xs text-text-muted hover:text-danger">
                  Remove
                </button>
              </span>
            </div>
          ))}
        </div>
      </Card>

      <PaydaysCard setMsg={setMsg} setErr={setErr} />
      <HubPanel setMsg={setMsg} setErr={setErr} />
      <PhoneImportPanel setMsg={setMsg} setErr={setErr} />
      {!solo && <SetupTourCard setErr={setErr} />}
      </SettingsGroup>

      <SettingsGroup title="Appearance" description="Theme, accent, and interface density.">
        <Card className="lg:col-span-2">
          <CardTitle>Personalize</CardTitle>
        <p className="mt-1 text-sm text-text-muted">Make it yours — applied instantly, everywhere.</p>

        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Accent color</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {accents.map((c) => (
                <button
                  key={c}
                  onClick={() => setAccent(c)}
                  className="h-9 w-9 rounded-full border-2 transition-transform hover:scale-110"
                  style={{ background: c, borderColor: accent.toLowerCase() === c.toLowerCase() ? "var(--foreground)" : "transparent" }}
                  aria-label={`Accent ${c}`}
                  aria-pressed={accent.toLowerCase() === c.toLowerCase()}
                />
              ))}
              <label
                className="relative h-9 w-9 cursor-pointer overflow-hidden rounded-full border-2 border-dashed border-border"
                title="Custom color"
              >
                <input
                  type="color"
                  value={accent}
                  onChange={(e) => setAccent(e.target.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  aria-label="Custom accent color"
                />
                <span className="flex h-full w-full items-center justify-center text-xs text-text-muted">+</span>
              </label>
            </div>
            <p className="mt-1.5 text-xs text-text-muted">Charts harmonize with your accent automatically.</p>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setDark(!dark)}
                className="flex h-9 items-center gap-2 rounded-full border border-border px-3 text-xs font-medium text-text-muted transition-colors hover:text-text"
                aria-pressed={dark}
              >
                {dark ? <Sun size={14} aria-hidden /> : <Moon size={14} aria-hidden />}
                {dark ? "Light mode" : "Dark mode"}
              </button>
              {/* Density — slider with set intervals (issue #20). The slider
                  only previews inside the preview window; Apply commits it
                  app-wide so the user sees the effect before it sticks. */}
              <div className="mt-4">
                <div className="flex items-center justify-between text-xs font-medium text-text-muted">
                  {densities.map((d) => (
                    <span key={d.value} className={densityDraft === d.value ? "text-accent-text" : undefined}>
                      {d.label}
                    </span>
                  ))}
                </div>
                <input
                  type="range"
                  min={0}
                  max={densities.length - 1}
                  step={1}
                  value={densities.findIndex((d) => d.value === densityDraft)}
                  onChange={(e) => setDensityDraft(densities[Number(e.target.value)].value)}
                  aria-label="Interface density"
                  className="mt-1 h-2 w-full cursor-pointer appearance-none rounded-full bg-surface-muted accent-[var(--accent)]"
                />
                <div className="mt-1 flex items-center gap-2">
                  <p className="flex-1 text-xs text-text-muted">
                    {densityDraft === density ? (
                      <>
                        Applied: <strong className="text-text">{densities.find((d) => d.value === density)?.label}</strong>{" "}
                        ({density === 1 ? "default" : `${Math.round((1 - density) * 100)}% more compact`})
                      </>
                    ) : (
                      <>
                        Previewing <strong className="text-text">{densities.find((d) => d.value === densityDraft)?.label}</strong> —
                        not applied yet
                      </>
                    )}
                  </p>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={densityDraft === density}
                    onClick={() => {
                      setDensity(densityDraft);
                      setMsg("Density applied — the whole app scales together, so nothing overlaps.");
                    }}
                  >
                    Apply
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Live preview — renders sample UI at the SELECTED density only */}
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Preview</p>
            <div className="mt-2 rounded-xl border border-border bg-background p-3">
              <div style={{ zoom: densityDraft }}>
                <div className="rounded-lg border border-border bg-surface p-3 shadow-[var(--shadow-card)]">
                <div className="flex items-center gap-2">
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold"
                    style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}
                  >
                    {(me.data?.user.display_name || "Y").trim().charAt(0).toUpperCase()}
                  </span>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-text-muted">Total balance</p>
                    <p className="money text-sm font-bold text-text">$2,570.36</p>
                  </div>
                </div>
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                  <div className="h-full w-2/3 rounded-full" style={{ background: "var(--accent)" }} />
                </div>
                <div className="mt-1.5 flex justify-between text-[11px]">
                  <span className="text-text-muted">Groceries</span>
                  <span className="money text-text">$268 / $400</span>
                </div>
                <button
                  className="mt-2.5 w-full rounded-lg py-1.5 text-xs font-semibold"
                  style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}
                >
                  Primary action
                </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card>

      </SettingsGroup>

      <SettingsGroup title="AI agent" description="What your assistant can see and do.">
        <AgentWiringCard setMsg={setMsg} setErr={setErr} />
        <CategoriesCard setMsg={setMsg} setErr={setErr} />
      </SettingsGroup>

      <SettingsGroup title="Backup & Updates" description="Backups and app updates.">
        <BackupPanel setMsg={setMsg} setErr={setErr} />
        <UpdatesCard />
      </SettingsGroup>

      <p className="pb-2 text-center text-xs text-text-muted lg:col-span-2">
        Open Finance v{process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0"} · MIT · self-hosted
      </p>

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

      {/* Custom confirmations */}
      <ConfirmDialog
        open={confirmLogoutAll}
        title="Sign out everywhere?"
        message="Every device and browser session will be signed out. You'll need your password (or recovery code on the phone) to get back in."
        confirmLabel="Sign out everywhere"
        busy={logoutAll.isPending}
        onCancel={() => setConfirmLogoutAll(false)}
        onConfirm={() => {
          setConfirmLogoutAll(false);
          logoutAll.mutate();
        }}
      />
      <ConfirmDialog
        open={confirmRemoveItem !== null}
        title="Remove this bank connection?"
        message="The link to this institution will be removed. Synced transactions stay in the app."
        confirmLabel="Remove"
        busy={removeItem.isPending}
        onCancel={() => setConfirmRemoveItem(null)}
        onConfirm={() => {
          if (confirmRemoveItem) removeItem.mutate(confirmRemoveItem);
          setConfirmRemoveItem(null);
        }}
      />
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
    const cap = window.Capacitor;
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
        // SAFETY: patch is a Partial of the same solo-prefs shape, so the spread yields the asserted type.
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
              <CustomSelect
                ariaLabel="Notification frequency"
                className="w-36"
                value={p.notifFrequency}
                // SAFETY: the only options are "daily" | "weekly", so v is one of the two literals.
                onChange={(v) => save({ notifFrequency: v as "daily" | "weekly" })}
                options={[
                  { value: "daily", label: "Daily" },
                  { value: "weekly", label: "Weekly" },
                ]}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-text-muted">
              Time
              <CustomTimePicker ariaLabel="Notification time" className="w-36" value={p.notifTime} onChange={(v) => save({ notifTime: v })} />
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
            <Input aria-label={"Digest email address"}
              type="email"
              placeholder="you@example.com"
              value={p.emailAddress ?? ""}
              onChange={(e) => save({ emailAddress: e.target.value })}
              className="max-w-56"
            />
            <label className="flex items-center gap-2 text-sm text-text-muted">
              Frequency
              <CustomSelect
                ariaLabel="Email digest frequency"
                className="w-36"
                value={p.emailFrequency}
                // SAFETY: the only options are "daily" | "weekly", so v is one of the two literals.
                onChange={(v) => save({ emailFrequency: v as "daily" | "weekly" })}
                options={[
                  { value: "daily", label: "Daily" },
                  { value: "weekly", label: "Weekly" },
                ]}
              />
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
            <Input aria-label={"Recovery code"}
              placeholder="Recovery code"
              value={resetCode}
              onChange={(e) => setResetCode(e.target.value)}
              className="min-w-40 flex-1 font-mono"
            />
            <Input aria-label={"New PIN"}
              type="password"
              inputMode="numeric"
              autoComplete="off"
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

// ── Categories ─────────────────────────────────────────────────────────────

function CategoriesCard({ setMsg, setErr }: { setMsg: (s: string | null) => void; setErr: (s: string | null) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  useEscapeToClose(() => setShowAdd(false), showAdd);
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<{ categories: Array<{ id: string; name: string; is_system: number; enabled: number }> }>("/api/categories?all=1"),
  });
  const create = useMutation({
    mutationFn: () => api.post("/api/categories", { name }),
    onSuccess: () => {
      setName("");
      setShowAdd(false);
      qc.invalidateQueries({ queryKey: ["categories"] });
      setMsg("Category added.");
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Could not add category."),
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.patch(`/api/categories/${id}`, { enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Could not update category."),
  });
  const rows = categories.data?.categories ?? [];
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div>
          <CardTitle>Categories</CardTitle>
          <p className="mt-1 text-sm text-text-muted">Default categories are created automatically. Add your own for more precise transaction and budget tracking.</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setShowAdd((v) => !v)}>{showAdd ? "Cancel" : "Add category"}</Button>
      </div>
      {showAdd && (
        <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Input aria-label="New category name" placeholder="e.g. Kids activities" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <Button type="submit" disabled={!name.trim() || create.isPending}>Save</Button>
        </form>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {rows.map((c) => (
          <span key={c.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-muted px-3 py-1 text-xs text-text">
            {c.name}
            <button type="button" onClick={() => toggle.mutate({ id: c.id, enabled: !c.enabled })} className="ml-1 text-text-muted hover:text-accent-text">
              {c.enabled ? "Disable" : "Enable"}
            </button>
          </span>
        ))}
      </div>
    </Card>
  );
}

// ── Agent wiring (P12) ─────────────────────────────────────────────────────

function AgentWiringCard({ setMsg, setErr }: { setMsg: (s: string | null) => void; setErr: (s: string | null) => void }) {
  const [endpoint, setEndpoint] = useState("");
  const qc = useQueryClient();
  useEffect(() => {
    if (hasWindow()) setEndpoint(window.location.origin);
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
      api.get<{
        prefs: {
          tabs: string[];
          tabsWrite: string[];
          autoCategorize: boolean;
          categorizeBacklogMonths: number;
          global: boolean;
          globalWrite: boolean;
          autoApproveReads: boolean;
          requireWriteConfirm: boolean;
          auditEnabled: boolean;
        };
      }>("/api/agent/prefs"),
    retry: false,
  });
  const p = prefs.data?.prefs;
  const setPref = useMutation({
    mutationFn: (patch: {
      tabs?: string[];
      tabsWrite?: string[];
      autoCategorize?: boolean;
      categorizeBacklogMonths?: number;
      global?: boolean;
      globalWrite?: boolean;
      autoApproveReads?: boolean;
      requireWriteConfirm?: boolean;
      auditEnabled?: boolean;
    }) => api.put("/api/agent/prefs", patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-prefs"] }),
  });

  // "Apply — start categorizing now": runs the app-side categorizer over the
  // backlog immediately (same rules the agent would use). Returns a status
  // breakdown so we can show a progress bar (categorized vs total).
  const [catProgress, setCatProgress] = useState<{
    done: number;
    total: number;
    categorized: number;
    leftForAgent: number;
    totalUncategorized: number;
    backlogMonths: number;
  } | null>(null);
  const categorizeNow = useMutation({
    mutationFn: () =>
      api.post<{
        alreadyCategorized: number;
        categorized: number;
        leftForAgent: number;
        totalUncategorized: number;
        total: number;
        done: number;
        backlogMonths: number;
      }>("/api/agent/categorize-now"),
    onSuccess: (res) => {
      setCatProgress({
        done: res.done,
        total: res.total,
        categorized: res.categorized,
        leftForAgent: res.leftForAgent,
        totalUncategorized: res.totalUncategorized,
        backlogMonths: res.backlogMonths,
      });
      if (res.categorized > 0) {
        setMsg(
          `Categorized ${res.categorized} transaction${res.categorized === 1 ? "" : "s"} in the last ${
            res.backlogMonths === 0 ? "range" : `${res.backlogMonths} month${res.backlogMonths === 1 ? "" : "s"}`
          }${res.leftForAgent > 0 ? ` — ${res.leftForAgent} need your review in Activity.` : "."}`
        );
      } else {
        setMsg(
          res.totalUncategorized === 0
            ? "Everything in that range is already categorized."
            : `${res.leftForAgent} transaction${res.leftForAgent === 1 ? "" : "s"} need your review — tap any uncategorized transaction in Activity to categorize it.`
        );
      }
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: (e) => {
      setCatProgress(null);
      setErr(e instanceof Error ? e.message : "Categorization failed.");
    },
  });

  const [guideCopied, setGuideCopied] = useState(false);
  async function copyGuide() {
    try {
      // The guide endpoint needs an agent token; for the user's own agent we
      // fetch a compact, human-readable version built from the same content.
      const text =
        "You are connected to Open Finance — a self-hosted personal finance app.\n" +
        "Fetch your full handbook at GET /api/agent/guide (Bearer token). Key rules:\n" +
        "- Money is integer cents. Positive = income, negative = expense.\n" +
        "- Call get_capabilities first; plan around what it says you have.\n" +
        "- Read-only by default; out-of-scope calls create a permission request for the user.\n" +
        "- To add a UI widget, use create_custom_view (dev:ui scope) with a declarative JSON definition.\n" +
        "- Never claim to have moved money — the app has no payment rails.";
      await navigator.clipboard.writeText(text);
      setGuideCopied(true);
      setTimeout(() => setGuideCopied(false), 2500);
    } catch {
      setGuideCopied(false);
    }
  }

  const TAB_LABELS: Record<string, string> = {
    dashboard: "Home",
    accounts: "Accounts",
    activity: "Activity",
    budgets: "Budgets",
    reports: "Reports",
    planning: "Plan",
    agents: "Agents",
    settings: "Settings",
  };
  const TAB_ORDER = ["dashboard", "accounts", "activity", "budgets", "reports", "planning", "agents", "settings"];
  const tabs = p?.tabs ?? ["activity"];
  const tabsWrite = p?.tabsWrite ?? [];

  function toggleTab(tab: string) {
    const next = tabs.includes(tab) ? tabs.filter((t) => t !== tab) : [...tabs, tab];
    setPref.mutate({ tabs: next.length > 0 ? next : ["activity"] });
  }

  function toggleWrite(tab: string) {
    // Reports + Agents are read-only tabs — no write scope exists for them.
    if (tab === "reports" || tab === "agents") return;
    const next = tabsWrite.includes(tab) ? tabsWrite.filter((t) => t !== tab) : [...tabsWrite, tab];
    setPref.mutate({ tabsWrite: next });
  }

  return (
    <Card className="lg:col-span-2">
      <CardTitle>Your AI assistant</CardTitle>
      <p className="mt-1 text-sm text-text-muted">
        Connect an AI assistant (Hermes, Claude, Cursor…) to answer money questions and — with your approval —
        help with budgets. It can look, but can&apos;t touch, by default, and it always asks before changing anything.
      </p>

      {/* Access tiers — per-tab read selection + global master + write */}
      <div className="mt-4 space-y-3">
        <div className="rounded-xl border border-border p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-text">What your AI can see</p>
              <p className="mt-0.5 text-xs text-text-muted">
                Choose the parts it may look at — e.g. Activity + Budgets and nothing else. It can never see the ones
                you leave off.
              </p>
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            {TAB_ORDER.map((tab) => {
              const readOn = p?.global || tabs.includes(tab);
              const writeOn = p?.global || tabsWrite.includes(tab);
              const readOnly = tab === "reports" || tab === "agents";
              return (
                <div
                  key={tab}
                  className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
                    readOn ? "border-border bg-surface" : "border-border/60 bg-surface-muted/40 opacity-70"
                  }`}
                >
                  <span className={`min-w-0 truncate text-sm ${readOn ? "font-medium text-text" : "text-text-muted"}`}>
                    {TAB_LABELS[tab]}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      disabled={!!p?.global}
                      onClick={() => toggleTab(tab)}
                      aria-pressed={readOn}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
                        readOn
                          ? "border-accent bg-accent/10 text-accent-text"
                          : "border-border text-text-muted hover:text-text"
                      }`}
                    >
                      Read
                    </button>
                    <button
                      type="button"
                      disabled={!!p?.global || readOnly}
                      onClick={() => toggleWrite(tab)}
                      aria-pressed={writeOn}
                      title={readOnly ? `${TAB_LABELS[tab]} is read-only` : "Allow the agent to write here (with approval)"}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
                        writeOn
                          ? "border-accent bg-accent text-[var(--accent-foreground)]"
                          : readOnly
                            ? "border-border/50 text-text-muted/50"
                            : "border-border text-text-muted hover:text-text"
                      }`}
                    >
                      Write
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-text-muted">
            {p?.global
              ? "Full access is on — it can see and change everything."
              : `Reads: ${tabs.map((t) => TAB_LABELS[t]).join(", ") || "none"} · Writes: ${tabsWrite.map((t) => TAB_LABELS[t]).join(", ") || "none (asks approval for each)"}`}
          </p>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-xl border border-border p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text">Smart categorization</p>
            <p className="mt-0.5 text-xs text-text-muted">
              Let your agent categorize unclear expenses — a purchase labeled &ldquo;POS DEBIT&rdquo; or an unnamed
              charge. It categorizes the ones it&apos;s confident about and leaves the gray-area ones for you. You can
              always change any category manually in the Activity tab.
            </p>
            {p?.autoCategorize && (
              <div className="mt-3">
                <label className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                  Categorize back:
                  <CustomSelect
                    ariaLabel="Categorization backlog"
                    className="w-52"
                    value={String(p?.categorizeBacklogMonths ?? 1)}
                    onChange={(v) => setPref.mutate({ categorizeBacklogMonths: Number(v) })}
                    options={[
                      { value: "0", label: "None — just new ones", hint: "moving forward" },
                      { value: "1", label: "1 month", hint: "recommended" },
                      { value: "3", label: "3 months" },
                      { value: "6", label: "6 months" },
                      { value: "12", label: "1 year" },
                    ]}
                  />
                  <span className="max-w-56">
                    Backlog is optional — with &ldquo;None&rdquo; the agent only categorizes new transactions as they
                    come in.
                  </span>
                </label>
                {/* Apply: runs the app-side categorizer over the selected range
                    immediately (same rules the agent would use). It is purely
                    local — it uses your own category rules and does NOT need an
                    agent connected, so it is never gated on agent connection. */}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => categorizeNow.mutate()}
                    disabled={categorizeNow.isPending || !p?.autoCategorize}
                    title={!p?.autoCategorize ? "Enable smart categorization above first" : "Start categorizing the backlog now"}
                  >
                    {categorizeNow.isPending ? "Categorizing…" : "Apply — start categorizing now"}
                  </Button>
                  {!p?.autoCategorize && (
                    <span className="text-xs text-text-muted">Enable smart categorization above first.</span>
                  )}
                  {/* Inline confirmation so the user gets feedback even when
                      scrolled down on this long page (the global banner renders
                      at the top and auto-clears). Shows the last run's outcome. */}
                  {categorizeNow.isSuccess && catProgress && (
                    <span className="text-xs font-medium text-success">
                      {catProgress.categorized > 0
                        ? `Categorized ${catProgress.categorized} transaction${catProgress.categorized === 1 ? "" : "s"}${catProgress.leftForAgent > 0 ? ` · ${catProgress.leftForAgent} left for you to review` : ""}.`
                        : catProgress.totalUncategorized === 0
                          ? "Everything in that range is already categorized."
                          : `${catProgress.leftForAgent} need${catProgress.leftForAgent === 1 ? "s" : ""} your review — tap any transaction in Activity to categorize it.`}
                    </span>
                  )}
                </div>
                {catProgress && catProgress.total > 0 && (
                  <div className="mt-2">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
                      <div
                        className="h-full rounded-full bg-[var(--accent)] transition-all"
                        style={{ width: `${Math.round((catProgress.done / catProgress.total) * 100)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-text-muted">
                      {catProgress.done} of {catProgress.total} in range categorized
                      {catProgress.leftForAgent > 0 ? ` · ${catProgress.leftForAgent} need your review` : ""}
                    </p>
                  </div>
                )}
              </div>
            )}
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
              <p className="text-sm font-medium text-text">Full access (everything)</p>
              <p className="mt-0.5 text-xs text-text-muted">
                One switch for everything — your AI can see <strong className="text-text">and change</strong> the whole
                app: balances, budgets, categories. Each change still asks your approval.
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
        </div>

        {/* AI guardrails (D4) — advanced safety rails with plain-language risk copy */}
        <div className="rounded-xl border border-border p-4">
          <p className="text-sm font-medium text-text">AI guardrails</p>
          <p className="mt-0.5 text-xs text-text-muted">
            Safety rails your agent runs under. Two can&apos;t be turned off: your agent can never delete accounts,
            and it can never move money (Open Finance has no payment rails — structural).
          </p>
          <div className="mt-3 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-text">Auto-approve read requests</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  When your agent asks to <em>read</em> something your settings already allow, grant it instantly
                  instead of filling your inbox. Writes always still ask.
                  {p?.autoApproveReads && (
                    <span className="mt-0.5 block text-warning">On: read requests inside your caps skip the inbox.</span>
                  )}
                </p>
              </div>
              <button
                role="switch"
                aria-checked={p?.autoApproveReads ?? false}
                onClick={() => setPref.mutate({ autoApproveReads: !(p?.autoApproveReads ?? false) })}
                disabled={setPref.isPending}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                  p?.autoApproveReads ? "bg-[var(--accent)]" : "bg-surface-muted"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                    p?.autoApproveReads ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-text">Confirm before destructive writes</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  Deleting a budget, category, bill, debt or goal needs your explicit OK first.
                  {!p?.requireWriteConfirm && (
                    <span className="mt-0.5 block text-danger">
                      Off: your AI can delete budgets, categories and planning items without asking.
                    </span>
                  )}
                </p>
              </div>
              <button
                role="switch"
                aria-checked={p?.requireWriteConfirm ?? true}
                onClick={() => setPref.mutate({ requireWriteConfirm: !(p?.requireWriteConfirm ?? true) })}
                disabled={setPref.isPending}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                  p?.requireWriteConfirm ?? true ? "bg-[var(--accent)]" : "bg-surface-muted"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                    p?.requireWriteConfirm ?? true ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-text">Audit log</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  Record every call your agent makes. Recommended on — it&apos;s how you see exactly what it did.
                  {!p?.auditEnabled && (
                    <span className="mt-0.5 block text-warning">
                      Off: new agent calls won&apos;t be recorded. You lose the trail of what your AI did.
                    </span>
                  )}
                </p>
              </div>
              <button
                role="switch"
                aria-checked={p?.auditEnabled ?? true}
                onClick={() => setPref.mutate({ auditEnabled: !(p?.auditEnabled ?? true) })}
                disabled={setPref.isPending}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                  p?.auditEnabled ?? true ? "bg-[var(--accent)]" : "bg-surface-muted"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                    p?.auditEnabled ?? true ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="mt-4 border-t border-border pt-3">
            <Button variant="secondary" size="sm" onClick={copyGuide}>
              {guideCopied ? "Copied" : "Give your AI its bearings"}
            </Button>
            <p className="mt-1.5 text-xs text-text-muted">
              Copies a short brief to paste into your agent — what Open Finance is, the money rules, and where its
              full handbook lives (<code className="text-accent-text">/api/agent/guide</code>).
            </p>
          </div>
        </div>
      </div>

      {soloUnsupported ? (
        <div className="mt-4 rounded-lg bg-surface-muted px-4 py-3 text-sm text-text-muted">
          On this phone, your AI connects through your computer (your base). Use the{" "}
          <strong className="text-text">Connect your phone &amp; computer</strong> card above to set one up on a computer,
          then connect your agent here — or on the hub itself.
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-text-muted">Connection address</label>
              <code className="block rounded-md bg-surface-muted px-3 py-2 text-sm text-accent-text">
                {endpoint}/api/mcp
              </code>
            </div>
            <div>
              <label className="mb-1 block text-xs text-text-muted">AI access keys</label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-text">
                  {agents.data?.agents.length ?? 0} key{agents.data?.agents.length === 1 ? "" : "s"}
                </span>
                <Button size="sm" variant="secondary" onClick={() => (window.location.href = "/agents")}>
                  Manage
                </Button>
              </div>
            </div>
          </div>
          <div className="mt-4 rounded-lg bg-surface-muted px-4 py-3 text-xs text-text-muted">
            <p className="font-medium text-text">Getting started (Hermes / Claude / Cursor):</p>
            <p className="mt-1">
              Create an access key on the Agents page (start with &ldquo;can look, can&apos;t touch&rdquo;), then connect your AI
              with the address above and that key. It can read right away; changes always ask you first.
            </p>
          </div>
          <details className="mt-3 rounded-lg border border-border px-4 py-3 text-xs text-text-muted">
            <summary className="cursor-pointer font-medium text-text">Technical details</summary>
            <div className="mt-2 space-y-1.5 font-mono">
              <p>MCP (Streamable HTTP): <span className="text-accent-text">{endpoint}/api/mcp</span></p>
              <p>MCP (stdio): <span className="text-accent-text">node scripts/mcp-cli.mjs --url {endpoint} --token &lt;key&gt;</span></p>
              <p>REST: <span className="text-accent-text">GET {endpoint}/api/agent/summary</span> (Bearer)</p>
              <p>OpenAPI: <span className="text-accent-text">{endpoint}/api/openapi.json</span></p>
              <p>Agent handbook: <span className="text-accent-text">GET /api/agent/guide</span></p>
              <p>Key format: <span className="text-accent-text">of_…</span> (shown once at creation)</p>
              <p>curl: <span className="text-accent-text">curl -H &quot;Authorization: Bearer of_…&quot; {endpoint}/api/agent/capabilities</span></p>
            </div>
          </details>
        </>
      )}
    </Card>
  );
}

// ── Paydays (012) — manual payday schedule for accurate projections ────────

function PaydaysCard({ setMsg, setErr }: { setMsg: (s: string | null) => void; setErr: (s: string | null) => void }) {
  const qc = useQueryClient();
  const paydays = useQuery({
    queryKey: ["planning", "paydays"],
    queryFn: () =>
      api.get<{ paydays: { mode: string; interval: string | null; days: number[] } }>("/api/planning/paydays"),
    retry: false,
  });
  const save = useMutation({
    mutationFn: (patch: { mode?: string; interval?: string | null; days?: number[] }) =>
      api.put("/api/planning/paydays", patch),
    onSuccess: () => {
      setMsg("Paydays saved — the Plan tab and projections now use your schedule.");
      setErr(null);
      qc.invalidateQueries({ queryKey: ["planning", "paydays"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Failed to save paydays."),
  });

  const pd = paydays.data?.paydays ?? { mode: "auto", interval: null, days: [] };
  // Optimistic draft so picking a mode renders its controls before the save round-trips.
  const [draft, setDraft] = useState<typeof pd | null>(null);
  const eff = draft ?? pd;

  function toggleDay(d: number) {
    const next = eff.days.includes(d) ? eff.days.filter((x) => x !== d) : [...eff.days, d].sort((a, b) => a - b);
    setDraft({ ...eff, mode: "days_of_month", days: next });
    if (next.length > 0) save.mutate({ mode: "days_of_month", days: next });
  }

  function pickMode(mode: string) {
    // SAFETY: pickMode is only called with a value from the mode option set, so mode narrows to typeof eff.mode.
    setDraft({ ...eff, mode: mode as typeof eff.mode });
    // Only save immediately when the mode is complete — auto saves alone;
    // interval/days_of_month wait for a value so server validation can't
    // fire a spurious error that then lingers.
    if (mode === "auto") save.mutate({ mode });
    else if (mode === "interval" && eff.interval) save.mutate({ mode, interval: eff.interval });
    else if (mode === "days_of_month" && eff.days.length > 0) save.mutate({ mode, days: eff.days });
  }

  function pickInterval(iv: string) {
    // SAFETY: pickInterval is only called with a value from the interval option set, narrowing to typeof eff.interval.
    setDraft({ ...eff, mode: "interval", interval: iv as typeof eff.interval });
    save.mutate({ mode: "interval", interval: iv });
  }

  return (
    <Card className="lg:col-span-2">
      <CardTitle>Paydays</CardTitle>
      <p className="mt-1 text-sm text-text-muted">
        Tell the app when you get paid so the Plan tab&apos;s &ldquo;Next paycheck&rdquo; horizon and the 12-month
        projection are accurate — especially if you track manually. Auto mode guesses from your income transactions.
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {(
          [
            ["auto", "Auto — detect from income"],
            ["interval", "Regular interval"],
            ["days_of_month", "Specific days of the month"],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            onClick={() => pickMode(mode)}
            disabled={save.isPending}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              eff.mode === mode ? "border-accent bg-accent/10 text-accent-text" : "border-border text-text-muted hover:text-text"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {eff.mode === "interval" && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(["weekly", "biweekly", "monthly"] as const).map((iv) => (
            <button
              key={iv}
              type="button"
              onClick={() => pickInterval(iv)}
              disabled={save.isPending}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                eff.interval === iv ? "border-accent bg-accent/10 font-medium text-accent-text" : "border-border text-text-muted hover:text-text"
              }`}
            >
              {iv === "biweekly" ? "Every 2 weeks" : iv === "weekly" ? "Every week" : "Every month"}
            </button>
          ))}
        </div>
      )}

      {eff.mode === "days_of_month" && (
        <div className="mt-3">
          <div className="flex flex-wrap gap-1.5">
            {[1, 5, 10, 15, 20, 25, 30].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                disabled={save.isPending}
                className={`h-9 w-9 rounded-full border text-xs transition-colors ${
                  eff.days.includes(d) ? "border-accent bg-accent/10 font-medium text-accent-text" : "border-border text-text-muted hover:text-text"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-text-muted">
            {eff.days.length > 0 ? `Paid on the ${eff.days.join(" & ")} of each month` : "Pick the days you get paid"}
          </p>
        </div>
      )}
    </Card>
  );
}

// ── Connection Assistant (hub setup — no env editing) ──────────────────────

function HubPanel({ setMsg, setErr }: { setMsg: (s: string | null) => void; setErr: (s: string | null) => void }) {
  const qc = useQueryClient();
  const [solo, setSolo] = useState(false);
  const [mode, setMode] = useState<"solo" | "hub">("solo");
  const [hubUrl, setHubUrl] = useState("");
  // Phone → computer hub pairing (issue #16): camera QR scan.
  const [scanning, setScanning] = useState(false);
  const scannerA11yRef = useDialogA11y(scanning);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scanErr, setScanErr] = useState<string | null>(null);

  useEffect(() => {
    if (hasWindow()) setSolo(isSoloCandidate(window.location.origin));
  }, []);

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
      setMsg("Saved — restart the app for the change to take effect.");
      qc.invalidateQueries({ queryKey: ["hub"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Failed."),
  });

  const startPairing = useMutation({
    mutationFn: () =>
      api.post<{ code: string; url: string; ttlSeconds: number }>("/api/pairing/start", {
        baseUrl: hubUrl.trim() || preferred || undefined,
      }),
    onSuccess: (d) => {
      setMsg(`Connection code: ${d.code} — scan the QR or open ${d.url} on your phone (good for ${d.ttlSeconds / 60} min).`);
      qc.invalidateQueries({ queryKey: ["hub"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Failed."),
  });

  /** Connect this phone to a hub: remember its URL, then load its /pair page. */
  function connectToHub(url: string) {
    const trimmed = url.trim().replace(/\/+$/, "");
    if (!/^https?:\/\/.+\..+/.test(trimmed)) {
      setErr("That doesn't look like a hub URL — it should start with http:// and include the port, e.g. http://192.168.1.20:3000");
      return;
    }
    setErr(null);
    void storeHubUrl(trimmed);
    // The hub serves its own /pair page; accept runs on the hub's origin, so
    // the session cookie + stored hub URL wire the app into connected mode.
    window.location.href = `${trimmed}/pair`;
  }

  // Camera QR scan loop (jsQR) — scans the QR shown on the computer hub.
  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        tick();
      } catch {
        setScanErr("Camera unavailable — type the hub URL below instead.");
        setScanning(false);
      }
    }

    function tick() {
      if (stopped) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState >= 2) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0);
          const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const qr = jsQR(image.data, image.width, image.height);
          if (qr && qr.data.includes("/pair")) {
            const match = qr.data.match(/^(https?:\/\/[^/]+)\/pair/);
            if (match) {
              stopped = true;
              setScanning(false);
              connectToHub(match[1]);
              return;
            }
          }
        }
      }
      raf = requestAnimationFrame(tick);
    }

    start();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  const d = diagnostics.data;
  const preferred = detect.data?.preferredUrl ?? "";

  /* Phone (solo) view: connect this standalone phone to a computer hub. */
  if (solo) {
    return (
      <Card className="lg:col-span-2">
        <CardTitle>Connect your phone to a computer hub</CardTitle>
        <p className="mt-1 text-sm text-text-muted">
          Right now this phone runs <strong className="text-text">fully standalone</strong> — everything lives on the
          device. To pair with a hub (your computer running Open Finance), scan the QR code it shows under Settings →
          Connect your phone &amp; computer:
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={() => setScanning(true)} disabled={scanning}>
            {scanning ? "Scanning…" : (<><QrCode size={15} aria-hidden /> Scan QR from your computer</>)}
          </Button>
          <span className="text-sm text-text-muted">or</span>
          <div className="min-w-64 flex-1">
            <Input
              value={hubUrl}
              onChange={(e) => setHubUrl(e.target.value)}
              placeholder="http://192.168.x.x:3000"
              inputMode="url"
              aria-label="Hub URL"
            />
          </div>
          <Button variant="secondary" onClick={() => connectToHub(hubUrl)} disabled={!hubUrl}>
            Connect
          </Button>
        </div>
        {scanErr && <p className="mt-2 text-sm text-danger">{scanErr}</p>}
        {preferred && (
          <p className="mt-2 text-xs text-text-muted">
            Detected your computer at <strong className="text-text">{preferred}</strong> — you can paste that above.
          </p>
        )}

        {/* Camera scanner modal */}
        {scanning && (
          <div
            ref={scannerA11yRef}
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4"
            onClick={() => setScanning(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Scan hub QR code"
          >
            <div
              className="w-full max-w-sm overflow-hidden rounded-3xl border border-border bg-surface p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-text">Scan the hub&apos;s QR code</p>
                <button
                  type="button"
                  aria-label="Close scanner"
                  onClick={() => setScanning(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-muted hover:text-text"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-black">
                <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
                <canvas ref={canvasRef} className="hidden" />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="h-40 w-40 rounded-2xl border-2 border-[var(--accent)] opacity-80" />
                </div>
              </div>
              <p className="mt-3 text-center text-xs text-text-muted">
                Point the camera at the QR shown on your computer. It opens the hub&apos;s pairing page automatically.
              </p>
            </div>
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card className="lg:col-span-2">
      <CardTitle>Connect your phone &amp; computer</CardTitle>
      <p className="mt-1 text-sm text-text-muted">
        Use Open Finance just on this computer, or let it be the base your phone talks to. Pick one — no technical setup needed.
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          onClick={() => setMode("solo")}
          className={`flex-1 rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
            mode === "solo" ? "border-accent bg-accent/5" : "border-border hover:bg-surface-muted"
          }`}
        >
          <p className="font-medium text-text">This computer only</p>
          <p className="mt-0.5 text-xs text-text-muted">Just here — nothing leaves this computer.</p>
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
          <p className="font-medium text-text">Share with my phone</p>
          <p className="mt-0.5 text-xs text-text-muted">Your phone connects over your Wi-Fi or from anywhere — scan a code to link them.</p>
        </button>
      </div>

      {mode === "hub" && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <label className="mb-1 block text-xs text-text-muted">This computer&apos;s address (found automatically)</label>
              <Input aria-label={"Hub URL"} value={hubUrl} onChange={(e) => setHubUrl(e.target.value)} placeholder="http://192.168.x.x:3000" />
            </div>
            <Button onClick={() => apply.mutate()} disabled={apply.isPending || !hubUrl}>
              {apply.isPending ? "Saving…" : "Save"}
            </Button>
            <Button variant="secondary" onClick={() => startPairing.mutate()} disabled={startPairing.isPending}>
              {startPairing.isPending ? "Creating…" : "Show connection code"}
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
  const [solo, setSolo] = useState(false);

  useEffect(() => {
    if (hasWindow()) {
      import("@/lib/mobile-mode").then((m) => setSolo(m.isSoloCandidate(window.location.origin)));
    }
  }, []);

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

  if (solo) return <SoloBackupPanel setMsg={setMsg} setErr={setErr} />;

  return (
    <Card className="lg:col-span-2">
      <CardTitle>Backup &amp; restore</CardTitle>
      <p className="mt-1 text-sm text-text-muted">
        Download an encrypted snapshot of your whole database. To move standalone phone data to a new hub, export the encrypted phone backup and use the hub’s “Pair an existing standalone phone” option. Restoring replaces everything — a safety backup is
        written first, and your password is required. Restore only on a machine with the same ENCRYPTION_KEY.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={download}>
          Download backup (.ofbak)
        </Button>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4">
        <div className="min-w-48 flex-1">
          <label className="mb-1 block text-xs text-text-muted">Backup file</label>
          <input ref={fileRef} type="file" accept=".ofbak" className="text-sm text-text-muted" />
        </div>
        <div className="min-w-48 flex-1">
          <label className="mb-1 block text-xs text-text-muted">Confirm password</label>
          <PasswordInput aria-label={"Account password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your account password" />
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
  );
}

// ── Setup tour (restart the first-run walkthrough) ──────────────────────────

function SetupTourCard({ setErr }: { setErr: (s: string | null) => void }) {
  return (
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
          Restart setup tour
        </Button>
      </div>
    </Card>
  );
}

// ── Import from standalone phone (hub — additive, no relink) ─────────────────

function PhoneImportPanel({ setMsg, setErr }: { setMsg: (s: string | null) => void; setErr: (s: string | null) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  async function importPhone() {
    const file = fileRef.current?.files?.[0];
    if (!file || !pin) { setErr("Choose the encrypted phone backup and enter the phone PIN."); return; }
    setBusy(true); setErr(null);
    try {
      const contents = await file.text();
      const res = await api.post<{ imported: Record<string, number>; plaidItems: number; additive: boolean }>("/api/phone-import", { pin, contents });
      const counts = Object.entries(res.imported).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(", ");
      setMsg(`Phone data added: ${counts || "nothing new"}; ${res.plaidItems} Plaid connection(s) preserved. The phone was not changed.`);
      setPin("");
    } catch (e) { setErr(e instanceof Error ? e.message : "Phone import failed."); }
    finally { setBusy(false); }
  }
  return (
    <Card className="lg:col-span-2 border-accent/30">
      <CardTitle>Import an existing standalone phone</CardTitle>
      <p className="mt-1 text-sm text-text-muted">Already linked your banks on your phone? Export the encrypted phone backup from its Settings, then import it here. This is additive and deduplicates Plaid accounts and transactions. It does not clear the phone, disconnect Plaid, or replace hub data.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3 sm:items-end">
        <div className="sm:col-span-1"><label className="mb-1 block text-xs text-text-muted">Phone backup (.ofbak.json)</label><input ref={fileRef} type="file" accept=".json,.ofbak.json" className="w-full text-sm text-text-muted" /></div>
        <div><label htmlFor="phone-device-pin" className="mb-1 block text-xs text-text-muted">Phone device PIN</label><Input id="phone-device-pin" aria-label="Phone device PIN" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))} placeholder="PIN used on phone" /></div>
        <Button onClick={importPhone} disabled={busy || !pin}>{busy ? "Importing…" : "Add phone data"}</Button>
      </div>
    </Card>
  );
}

// ── Phone backup & restore (solo — encrypted JSON dump, PIN-confirmed) ──────

function SoloBackupPanel({ setMsg, setErr }: { setMsg: (s: string | null) => void; setErr: (s: string | null) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function download() {
    if (!pin) {
      setErr("Enter your device PIN to encrypt the backup.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await api.post<{ filename: string; contents: string }>("/api/backup", { pin, includePlaid: true });
      const blob = new Blob([res.contents], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(a.href);
      setMsg("Backup downloaded. It's encrypted with your device PIN — you'll need that PIN to restore it.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Backup failed.");
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    const file = fileRef.current?.files?.[0];
    if (!file || !pin) {
      setErr("Choose a backup file and enter the PIN it was made with.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const contents = await file.text();
      const res = await api.post<{ restored: true; tables: number; rows: number }>("/api/backup/restore", {
        pin,
        contents,
      });
      setMsg(`Restored ${res.rows.toLocaleString()} rows across ${res.tables} tables. Reloading…`);
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
        Download an encrypted copy of everything on this phone. It&apos;s protected with your device PIN — keep the
        file somewhere safe (Files, Drive, a computer). Restoring replaces what&apos;s on the phone with the backup —
        nothing is merged.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <label className="mb-1 block text-xs text-text-muted">Device PIN</label>
          <Input aria-label={"Unlock PIN"}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9]*"
            maxLength={12}
            placeholder="Your unlock PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))}
          />
        </div>
        <Button variant="secondary" onClick={download} disabled={busy || !pin}>
          {busy ? "Working…" : "Download backup"}
        </Button>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4">
        <div className="min-w-48 flex-1">
          <label className="mb-1 block text-xs text-text-muted">Backup file</label>
          <input ref={fileRef} type="file" accept=".json,.ofbak.json,application/json" className="text-sm text-text-muted" />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-text-muted">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          I understand this replaces the data on this phone
        </label>
        <Button
          variant="secondary"
          className="text-danger"
          disabled={busy || !confirm || !pin}
          onClick={restore}
        >
          {busy ? "Restoring…" : "Restore from backup"}
        </Button>
      </div>
    </Card>

    <Card>
      <CardTitle>Setup tour</CardTitle>
      <p className="mt-1 text-sm text-text-muted">
        Replay the first-run walkthrough — bank linking and the agent intro. Nothing is reset; it just guides you
        through setup again.
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
          Restart setup tour
        </Button>
      </div>
    </Card>
    </>
  );
}
