"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Copy, KeyRound, PlugZap, ShieldCheck, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomSelect } from "@/components/ui/custom-select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { isSoloCandidate } from "@/lib/mobile-mode";

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

const PROVIDERS = [
  { name: "Hermes", note: "MCP server → point at this app's endpoint" },
  { name: "Claude", note: "Claude Desktop → MCP config" },
  { name: "Cursor", note: "Cursor → MCP servers" },
  { name: "Other", note: "Any MCP-capable agent" },
];

/* ── page ──────────────────────────────────────────────────────────────── */

export default function AgentsPage() {
  const qc = useQueryClient();
  const [solo, setSolo] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [endpoint, setEndpoint] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setSolo(isSoloCandidate(window.location.origin));
      setEndpoint(window.location.origin);
    }
  }, []);

  const agents = useQuery({
    queryKey: ["agent-tokens"],
    queryFn: () => api.get<{ agents: AgentToken[] }>("/api/agent/tokens"),
    retry: false,
  });
  const requests = useQuery({
    queryKey: ["agent-requests"],
    queryFn: () => api.get<{ requests: PermissionRequest[] }>("/api/agent/requests?status=pending"),
    enabled: !solo,
    retry: false,
  });
  const audit = useQuery({
    queryKey: ["agent-audit"],
    queryFn: () => api.get<{ rows: AuditRow[] }>("/api/agent/audit"),
    enabled: !solo,
    retry: false,
  });
  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<{ accounts: Array<{ id: string; name: string; type: string | null }> }>("/api/accounts"),
    enabled: !solo,
  });

  const tokensUnavailable = solo || agents.isError;
  const hasAgent = !tokensUnavailable && (agents.data?.agents.length ?? 0) > 0;

  /* create form */
  const [name, setName] = useState("");
  const [preset, setPreset] = useState("read-only");
  const [scopes, setScopes] = useState<string[]>([]);
  const [accountIds, setAccountIds] = useState<string[] | null>(null);
  const [expiresAt, setExpiresAt] = useState("");
  const [created, setCreated] = useState<{ token: string; agent: AgentToken } | null>(null);

  const toggleScope = (s: string) => {
    setPreset("custom");
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  const effectiveScopes = preset === "custom" ? scopes : PRESET_SCOPES[preset] ?? [];

  const createToken = useMutation({
    mutationFn: () =>
      api.post<{ token: string; agent: AgentToken }>("/api/agent/tokens", {
        name,
        preset,
        scopes: preset === "custom" ? scopes : undefined,
        accountIds,
        expiresAt:
          expiresAt === "30d"
            ? new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10)
            : expiresAt === "90d"
              ? new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10)
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

  // Disconnect = revoke every token; the tab returns to the setup guide.
  const disconnectAll = useMutation({
    mutationFn: async () => {
      const ids = (agents.data?.agents ?? []).map((t) => t.id);
      for (const id of ids) {
        await api.del(`/api/agent/tokens/${id}`);
      }
      return ids.length;
    },
    onSuccess: (n) => {
      setMsg(`Disconnected — ${n} token${n === 1 ? "" : "s"} revoked.`);
      setConfirmDisconnect(false);
      qc.invalidateQueries({ queryKey: ["agent-tokens"] });
      qc.invalidateQueries({ queryKey: ["agent-audit"] });
      setCreated(null);
      setName("");
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Failed to disconnect."),
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

  const mcpEndpoint = `${endpoint}/api/mcp`;

  /* ── render: NO agent → setup walkthrough only (issue #13) ── */
  if (tokensUnavailable || !hasAgent) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-text">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent" aria-hidden>
              <Bot size={20} />
            </span>
            Connect your AI agent
          </h1>
          <p className="mt-1.5 text-sm text-text-muted">
            Bring your own agent (Hermes, Claude, Cursor…) to answer money questions and — with your approval —
            act on budgets. Agents start <strong className="text-text">read-only</strong> and ask before any write.
          </p>
        </div>

        {solo ? (
          <Card>
            <CardTitle>On this phone, agents connect through a hub</CardTitle>
            <ol className="mt-3 list-inside list-decimal space-y-2 text-sm text-text">
              <li>
                In <strong className="text-text">Settings → Hub &amp; phone pairing</strong>, scan the QR code from a
                computer running Open Finance (or enter its URL). This pairs your phone to that hub.
              </li>
              <li>
                On the hub (computer), open its <strong className="text-text">Agents</strong> tab and follow this
                walkthrough there — tokens, permissions and the audit log live on the hub.
              </li>
              <li>Point your agent at the hub&apos;s MCP endpoint with the token you created.</li>
            </ol>
            <div className="mt-4 rounded-xl bg-surface-muted px-4 py-3 text-xs text-text-muted">
              Everything stays on your machines — the hub never leaves your network.
            </div>
          </Card>
        ) : (
          <>
            {/* Step 1 — pick your agent */}
            <Card>
              <CardTitle>
                <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent/10 text-xs font-bold text-accent">1</span>
                Pick your agent
              </CardTitle>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {PROVIDERS.map((p) => (
                  <div key={p.name} className="rounded-lg border border-border px-3 py-2.5">
                    <p className="text-sm font-medium text-text">{p.name}</p>
                    <p className="text-xs text-text-muted">{p.note}</p>
                  </div>
                ))}
              </div>
            </Card>

            {/* Step 2 — create a token */}
            <Card>
              <CardTitle>
                <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent/10 text-xs font-bold text-accent">2</span>
                Create a token
              </CardTitle>
              <p className="mt-1 text-sm text-text-muted">Tokens are the keys your agent presents to the app. Start read-only.</p>
              {msg && <p className="mt-2 text-sm font-medium text-success">{msg}</p>}
              {err && <p className="mt-2 text-sm text-danger">{err}</p>}

              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {PRESET_CARDS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setPreset(p.id);
                      setScopes([]);
                    }}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      preset === p.id ? "border-accent bg-accent/5" : "border-border hover:bg-surface-muted"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-sm font-medium text-text">
                      {p.name} {p.recommended && <Badge>Recommended</Badge>}
                    </div>
                    <div className="mt-1 text-xs text-text-muted">{p.blurb}</div>
                  </button>
                ))}
              </div>

              <div className="mt-4 space-y-3">
                <Input placeholder="Token name — e.g. trading-bot" value={name} onChange={(e) => setName(e.target.value)} />
                <div>
                  <p className="mb-1 text-xs font-medium text-text-muted">Scopes</p>
                  {SCOPE_GROUPS.map((g) => (
                    <div key={g.group} className="mb-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="w-12 text-xs text-text-muted">{g.group}</span>
                      {g.scopes.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => toggleScope(s)}
                          className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                            effectiveScopes.includes(s)
                              ? "border-accent bg-accent text-[var(--accent-foreground)]"
                              : "border-border text-text-muted hover:border-accent/50 hover:text-text"
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <CustomSelect
                    ariaLabel="Account scope"
                    value={accountIds === null ? "all" : "custom"}
                    onChange={(v) => setAccountIds(v === "all" ? null : [])}
                    options={[
                      { value: "all", label: "All accounts (default)" },
                      { value: "custom", label: "Choose accounts…" },
                    ]}
                  />
                  <CustomSelect
                    ariaLabel="Token expiry"
                    value={expiresAt}
                    onChange={setExpiresAt}
                    options={[
                      { value: "", label: "Never expires" },
                      { value: "30d", label: "30 days" },
                      { value: "90d", label: "90 days" },
                    ]}
                  />
                </div>
                {accountIds !== null && (
                  <div className="flex flex-wrap gap-1.5">
                    {(accounts.data?.accounts ?? []).map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() =>
                          setAccountIds((prev) => (prev!.includes(a.id) ? prev!.filter((x) => x !== a.id) : [...prev!, a.id]))
                        }
                        className={`rounded-full border px-2.5 py-0.5 text-xs ${
                          accountIds.includes(a.id) ? "border-accent bg-accent text-[var(--accent-foreground)]" : "border-border text-text-muted"
                        }`}
                      >
                        {a.name}
                      </button>
                    ))}
                  </div>
                )}
                <Button onClick={() => createToken.mutate()} disabled={!name.trim() || createToken.isPending}>
                  {createToken.isPending ? "Creating…" : "Create token"}
                </Button>
              </div>

              {created && (
                <div className="mt-4 rounded-xl border border-success/30 bg-[var(--success-soft)] p-4">
                  <p className="text-xs font-medium text-success">Copy your token now — it is shown only once:</p>
                  <code className="mt-1 block break-all rounded-lg bg-background px-3 py-2 text-sm text-text">{created.token}</code>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => navigator.clipboard?.writeText(created.token).catch(() => {})}
                    >
                      <Copy size={13} className="mr-1.5" /> Copy
                    </Button>
                  </div>
                </div>
              )}
            </Card>

            {/* Step 3 — wire it up */}
            <Card>
              <CardTitle>
                <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent/10 text-xs font-bold text-accent">3</span>
                Point your agent at the endpoint
              </CardTitle>
              <div className="mt-3 space-y-3 text-sm">
                <div>
                  <p className="mb-1 text-xs text-text-muted">MCP endpoint (Streamable HTTP)</p>
                  <div className="flex items-center gap-2">
                    <code className="block flex-1 rounded-lg bg-surface-muted px-3 py-2 text-sm text-accent">{mcpEndpoint}</code>
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label="Copy endpoint"
                      onClick={() => navigator.clipboard?.writeText(mcpEndpoint).catch(() => {})}
                    >
                      <Copy size={13} />
                    </Button>
                  </div>
                </div>
                <div className="rounded-xl bg-surface-muted px-4 py-3 text-xs text-text-muted">
                  <p className="font-medium text-text">Example (Hermes / Claude / Cursor):</p>
                  <p className="mt-1">
                    Add an MCP server to your agent with the endpoint above and the token. The agent can read
                    budgets/summary immediately; writes prompt you for approval in the permission inbox.
                  </p>
                </div>
                <p className="text-xs text-text-muted">
                  Fine-tune what your agent can see and write in <strong className="text-text">Settings → AI agent connection</strong> —
                  per-tab read and write toggles, global access, and smart categorization.
                </p>
              </div>
            </Card>
          </>
        )}
      </div>
    );
  }

  /* ── render: agent connected → settings, no wizard, with disconnect ── */
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-text">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-success/10 text-success" aria-hidden>
              <PlugZap size={20} />
            </span>
            Your agent
          </h1>
          <p className="mt-1.5 text-sm text-text-muted">
            {agents.data?.agents.length} token{agents.data?.agents.length === 1 ? "" : "s"} connected · endpoint{" "}
            <code className="rounded bg-surface-muted px-1 text-xs">{mcpEndpoint}</code>
          </p>
        </div>
        <Button variant="outline" className="text-danger" onClick={() => setConfirmDisconnect(true)}>
          <Trash2 size={14} className="mr-1.5" /> Disconnect agent
        </Button>
      </div>

      {msg && <p className="text-sm font-medium text-success">{msg}</p>}
      {err && <p className="text-sm text-danger">{err}</p>}

      {/* Permission inbox */}
      <Card>
        <CardTitle>Permission requests</CardTitle>
        <p className="text-sm text-text-muted">
          When an agent tries something its token cannot do, it asks here. Granting appends the scope (the preset badge then reads
          “custom”).
        </p>
        <div className="mt-3 space-y-2">
          {(requests.data?.requests ?? []).map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <div>
                <p className="text-sm text-text">
                  <span className="font-medium">{r.tokenName}</span> requested <Badge>{r.scope}</Badge>
                </p>
                <p className="text-xs text-text-muted">
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
          {(requests.data?.requests ?? []).length === 0 && <p className="text-sm text-text-muted">No pending requests.</p>}
        </div>
      </Card>

      {/* Token list */}
      <Card>
        <CardTitle>Tokens</CardTitle>
        <div className="mt-3 space-y-2">
          {(agents.data?.agents ?? []).map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <div>
                <p className="flex items-center gap-2 text-sm font-medium text-text">
                  <KeyRound size={14} className="text-text-muted" aria-hidden />
                  {t.name} <Badge>{t.custom ? "custom (modified)" : t.preset}</Badge>
                </p>
                <p className="text-xs text-text-muted">
                  {t.tokenPrefix}… · {t.scopes.length} scope{t.scopes.length === 1 ? "" : "s"} · last used{" "}
                  {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : "never"} ·{" "}
                  {t.expiresAt ? `expires ${new Date(t.expiresAt).toLocaleDateString()}` : "no expiry"}
                </p>
              </div>
              <Button size="sm" variant="outline" className="text-danger" onClick={() => revoke.mutate(t.id)}>
                Revoke
              </Button>
            </div>
          ))}
          {(agents.data?.agents ?? []).length === 0 && <p className="text-sm text-text-muted">No tokens yet.</p>}
        </div>
      </Card>

      {/* Audit */}
      <Card>
        <CardTitle>Audit log</CardTitle>
        <p className="text-sm text-text-muted">Every agent call, including denied ones (403 = scope missing).</p>
        <div className="mt-3 space-y-1">
          {(audit.data?.rows ?? []).slice(0, 25).map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded border border-border px-3 py-1.5 text-sm">
              <span className="text-text">
                <span className="font-medium">{r.tokenName}</span> · {r.tool} · {r.method}
                {r.scope ? ` · ${r.scope}` : ""}
              </span>
              <span className={`text-xs ${r.status >= 400 ? "text-danger" : "text-success"}`}>
                {r.status} · {new Date(r.created_at).toLocaleString()}
              </span>
            </div>
          ))}
          {(audit.data?.rows ?? []).length === 0 && <p className="text-sm text-text-muted">No calls yet.</p>}
        </div>
      </Card>

      {/* Access summary */}
      <Card>
        <CardTitle>Access &amp; privacy</CardTitle>
        <div className="mt-2 flex items-start gap-2.5 text-sm text-text-muted">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-success" aria-hidden />
          <p>
            Read-only by default; every write asks your approval here. Adjust per-tab read/write access anytime in{" "}
            <strong className="text-text">Settings → AI agent connection</strong>. Everything is logged in the audit log above.
          </p>
        </div>
        <p className="mt-3 text-xs text-text-muted">
          To use a different agent later, create a new token and point it at the same endpoint — or disconnect below to start over.
        </p>
      </Card>

      {/* Disconnect confirmation */}
      <ConfirmDialog
        open={confirmDisconnect}
        title="Disconnect your agent?"
        message={`All ${agents.data?.agents.length ?? 0} token(s) will be revoked and your agent will lose access immediately. You can set up a new connection anytime.`}
        confirmLabel="Disconnect"
        busy={disconnectAll.isPending}
        onCancel={() => setConfirmDisconnect(false)}
        onConfirm={() => disconnectAll.mutate()}
      />
    </div>
  );
}
