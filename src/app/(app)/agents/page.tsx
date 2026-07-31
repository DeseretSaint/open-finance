"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { capabilitySentence } from "@/components/agent-capabilities";

/* ── types ─────────────────────────────────────────────────────────────── */

interface AgentToken {
  id: string;
  name: string;
  tokenPrefix: string;
  preset: string;
  custom: boolean;
  scopes: string[];
  accountIds: string[] | null;
  uiTabs: string[] | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

interface PermissionRequest {
  id: string;
  tokenName: string;
  tokenPrefix: string;
  scope: string;
  tool: string | null;
  status: "pending" | "granted" | "denied";
  created_at: string;
}

interface AuditRow {
  id: string;
  tokenName: string;
  tokenPrefix: string;
  scope: string | null;
  tool: string;
  method: string;
  status: number;
  created_at: string;
}

interface DetectionProbe {
  agent: string;
  present: boolean;
  configured: boolean;
}

/* ── scope vocabulary ──────────────────────────────────────────────────── */

const SCOPE_GROUPS: Array<{ group: string; scopes: string[] }> = [
  { group: "Read", scopes: ["read:summary", "read:banking", "read:investments", "read:budgets", "read:planning", "read:reports"] },
  { group: "Write", scopes: ["transactions:edit", "budgets:write", "planning:write", "categories:write", "settings:write", "sync:run"] },
  { group: "Dev", scopes: ["dev:ui"] },
];

const PRESET_CARDS: Array<{ id: string; name: string; blurb: string; recommended?: boolean }> = [
  { id: "read-only", name: "Read-only", blurb: "See summary, banking, budgets. Cannot change anything.", recommended: true },
  { id: "read-all", name: "Read everything", blurb: "Also investments, planning, reports." },
  { id: "read-write", name: "Read + write", blurb: "Everything, plus editing transactions, budgets, planning." },
  { id: "custom", name: "Custom", blurb: "Pick exact scopes below." },
];

/* ── page ──────────────────────────────────────────────────────────────── */

export default function AgentsPage() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const agents = useQuery({ queryKey: ["agent-tokens"], queryFn: () => api.get<{ agents: AgentToken[] }>("/api/agent/tokens") });
  const requests = useQuery({ queryKey: ["agent-requests"], queryFn: () => api.get<{ requests: PermissionRequest[] }>("/api/agent/requests?status=pending") });
  const audit = useQuery({ queryKey: ["agent-audit"], queryFn: () => api.get<{ rows: AuditRow[] }>("/api/agent/audit") });
  const detect = useQuery({ queryKey: ["agents-detect"], queryFn: () => api.get<{ agents: DetectionProbe[] }>("/api/agents/detect") });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api.get<{ accounts: Array<{ id: string; name: string; type: string | null }> }>("/api/accounts") });

  /* create form */
  const [name, setName] = useState("");
  const [preset, setPreset] = useState("read-only");
  const [scopes, setScopes] = useState<string[]>([]);
  const [accountIds, setAccountIds] = useState<string[] | null>(null);
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [created, setCreated] = useState<{ token: string; agent: AgentToken } | null>(null);

  const toggleScope = (s: string) => {
    setPreset("custom");
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  const effectiveScopes = preset === "custom" ? scopes : PRESET_SCOPES[preset] ?? [];
  const sentence = capabilitySentence(effectiveScopes, accounts.data?.accounts ?? [], accountIds);

  const createToken = useMutation({
    mutationFn: () =>
      api.post<{ token: string; agent: AgentToken }>("/api/agent/tokens", {
        name,
        preset,
        scopes: preset === "custom" ? scopes : undefined,
        accountIds,
        expiresAt: expiresAt === "30d" ? new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10)
          : expiresAt === "90d" ? new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10)
          : null,
      }),
    onSuccess: (data) => {
      setCreated(data);
      setMsg("Token created — copy it now, it is shown only once.");
      setErr(null);
      qc.invalidateQueries({ queryKey: ["agent-tokens"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Failed to create token."),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/api/agent/tokens/${id}`),
    onSuccess: () => {
      setMsg("Token revoked.");
      qc.invalidateQueries({ queryKey: ["agent-tokens"] });
      qc.invalidateQueries({ queryKey: ["agent-audit"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Failed to revoke."),
  });

  const resolveRequest = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "granted" | "denied" }) =>
      api.post(`/api/agent/requests/${id}/resolve`, { decision }),
    onSuccess: () => {
      setMsg("Permission updated.");
      qc.invalidateQueries({ queryKey: ["agent-requests"] });
      qc.invalidateQueries({ queryKey: ["agent-tokens"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Failed."),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Agents</h1>
        <p className="text-sm text-muted-foreground">
          Bring your own agent. Tokens are read-only by default; your agent asks before it looks anywhere new.
        </p>
      </div>

      {msg && <p className="text-sm text-emerald-600">{msg}</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}

      {/* ── detection ── */}
      <Card>
        <CardTitle>Agent detection</CardTitle>
        <p className="text-sm text-muted-foreground">
          Agents found on this machine get a ready-made connection. Detection is read-only — we never run agent binaries or read config contents.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {(detect.data?.agents ?? []).map((p) => (
            <div key={p.agent} className="flex items-center justify-between rounded-md border px-3 py-2">
              <span className="text-sm font-medium">{p.agent}</span>
              <span className="text-xs text-muted-foreground">
                {p.present ? (p.configured ? "present ✓ · already configured" : "present ✓") : "not detected"}
              </span>
            </div>
          ))}
          {detect.isLoading && <p className="text-sm text-muted-foreground">Scanning…</p>}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Configure: point your agent at <code className="rounded bg-muted px-1">node /path/to/scripts/mcp-cli.mjs --url {typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"} --token of_…</code>
        </p>
      </Card>

      {/* ── create token ── */}
      <Card>
        <CardTitle>Create an agent token</CardTitle>
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          {PRESET_CARDS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setPreset(p.id);
                setScopes([]);
              }}
              className={`rounded-lg border p-3 text-left transition-colors ${
                preset === p.id ? "border-primary bg-primary/5" : "hover:border-muted-foreground/40"
              }`}
            >
              <div className="flex items-center gap-1.5 text-sm font-medium">
                {p.name} {p.recommended && <Badge>Recommended</Badge>}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{p.blurb}</div>
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          <Input placeholder="Token name — e.g. trading-bot" value={name} onChange={(e) => setName(e.target.value)} />
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Scopes</p>
            {SCOPE_GROUPS.map((g) => (
              <div key={g.group} className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <span className="w-12 text-xs text-muted-foreground">{g.group}</span>
                {g.scopes.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleScope(s)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                      effectiveScopes.includes(s)
                        ? "border-primary bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:border-muted-foreground/50"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              value={accountIds === null ? "all" : "custom"}
              onChange={(e) => setAccountIds(e.target.value === "all" ? null : [])}
            >
              <option value="all">All accounts (default)</option>
              <option value="custom">Choose accounts…</option>
            </Select>
            {accountIds !== null && (
              <div className="flex flex-wrap gap-1.5">
                {(accounts.data?.accounts ?? []).map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() =>
                      setAccountIds((prev) =>
                        prev!.includes(a.id) ? prev!.filter((x) => x !== a.id) : [...prev!, a.id]
                      )
                    }
                    className={`rounded-full border px-2.5 py-0.5 text-xs ${
                      accountIds.includes(a.id) ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
            )}
            <Select value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}>
              <option value="">Never expires</option>
              <option value="30d">30 days</option>
              <option value="90d">90 days</option>
            </Select>
          </div>
          <p className="text-sm text-muted-foreground">{sentence}</p>
          <Button onClick={() => createToken.mutate()} disabled={!name.trim() || createToken.isPending}>
            {createToken.isPending ? "Creating…" : "Create token"}
          </Button>
        </div>

        {created && (
          <div className="mt-4 rounded-md border border-emerald-600/30 bg-emerald-50 p-3 dark:bg-emerald-950/30">
            <p className="text-xs font-medium text-emerald-700">Copy your token now — it is shown only once:</p>
            <code className="mt-1 block break-all rounded bg-background px-2 py-1 text-sm">{created.token}</code>
            <p className="mt-2 text-xs text-muted-foreground">
              Connect your agent with:
              <code className="ml-1 rounded bg-muted px-1">
                node {typeof window !== "undefined" ? `${window.location.origin.replace(/^https?:\/\//, "")}` : ""}/scripts/mcp-cli.mjs --url {typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"} --token {created.token.slice(0, 8)}…
              </code>
            </p>
          </div>
        )}
      </Card>

      {/* ── permission inbox ── */}
      <Card>
        <CardTitle>Permission requests</CardTitle>
        <p className="text-sm text-muted-foreground">
          When an agent tries something its token cannot do, it asks here. Granting appends the scope (the preset badge then reads “custom”).
        </p>
        <div className="mt-3 space-y-2">
          {(requests.data?.requests ?? []).map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <p className="text-sm">
                  <span className="font-medium">{r.tokenName}</span> requested <Badge>{r.scope}</Badge>
                </p>
                <p className="text-xs text-muted-foreground">
                  {r.tool ?? "unknown tool"} · {new Date(r.created_at).toLocaleString()}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => resolveRequest.mutate({ id: r.id, decision: "denied" })}>
                  Deny
                </Button>
                <Button size="sm" onClick={() => resolveRequest.mutate({ id: r.id, decision: "granted" })}>
                  Grant
                </Button>
              </div>
            </div>
          ))}
          {(requests.data?.requests ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No pending requests.</p>
          )}
        </div>
      </Card>

      {/* ── token list ── */}
      <Card>
        <CardTitle>Tokens</CardTitle>
        <div className="mt-3 space-y-2">
          {(agents.data?.agents ?? []).map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <p className="text-sm font-medium">
                  {t.name} <Badge>{t.custom ? "custom (modified)" : t.preset}</Badge>
                </p>
                <p className="text-xs text-muted-foreground">
                  {t.tokenPrefix}… · {t.scopes.length} scope{t.scopes.length === 1 ? "" : "s"} · last used {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : "never"} ·{" "}
                  {t.expiresAt ? `expires ${new Date(t.expiresAt).toLocaleDateString()}` : "no expiry"}
                </p>
              </div>
              <Button size="sm" variant="outline" className="text-red-600" onClick={() => revoke.mutate(t.id)}>
                Revoke
              </Button>
            </div>
          ))}
          {(agents.data?.agents ?? []).length === 0 && <p className="text-sm text-muted-foreground">No tokens yet.</p>}
        </div>
      </Card>

      {/* ── audit ── */}
      <Card>
        <CardTitle>Audit log</CardTitle>
        <p className="text-sm text-muted-foreground">Every agent call, including denied ones (403 = scope missing).</p>
        <div className="mt-3 space-y-1">
          {(audit.data?.rows ?? []).slice(0, 25).map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded border px-3 py-1.5 text-sm">
              <span>
                <span className="font-medium">{r.tokenName}</span> · {r.tool} · {r.method}
                {r.scope ? ` · ${r.scope}` : ""}
              </span>
              <span className={`text-xs ${r.status >= 400 ? "text-red-600" : "text-emerald-600"}`}>
                {r.status} · {new Date(r.created_at).toLocaleString()}
              </span>
            </div>
          ))}
          {(audit.data?.rows ?? []).length === 0 && <p className="text-sm text-muted-foreground">No calls yet.</p>}
        </div>
      </Card>
    </div>
  );
}

const PRESET_SCOPES: Record<string, string[]> = {
  "read-only": ["read:summary", "read:banking", "read:budgets"],
  "read-all": ["read:summary", "read:banking", "read:investments", "read:budgets", "read:planning", "read:reports"],
  "read-write": [
    "read:summary",
    "read:banking",
    "read:investments",
    "read:budgets",
    "read:planning",
    "read:reports",
    "transactions:edit",
    "budgets:write",
    "planning:write",
    "categories:write",
  ],
  custom: [],
};
