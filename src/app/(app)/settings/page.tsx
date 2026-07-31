"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlaidLink } from "react-plaid-link";
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
  const { accent, setAccent, accents } = useTheme();

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
        <div className="mt-3 flex flex-wrap gap-2">
          {accents.map((c) => (
            <button
              key={c}
              onClick={() => setAccent(c)}
              className="h-8 w-8 rounded-full border-2 transition-transform hover:scale-110"
              style={{
                background: c,
                borderColor: accent === c ? "var(--text)" : "transparent",
              }}
              aria-label={`Accent ${c}`}
            />
          ))}
        </div>
      </Card>

      <HubPanel setMsg={setMsg} setErr={setErr} />
      <BackupPanel setMsg={setMsg} setErr={setErr} />
      <UpdatesCard />

      {msg && <p className="text-sm text-success lg:col-span-2">{msg}</p>}
      {err && <p className="text-sm text-danger lg:col-span-2">{err}</p>}
    </div>
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
  );
}
