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
import { getRemoteServerStatus } from "@/lib/native-plugins";

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

function HermesSetupCard({ endpoint, solo, setMsg, setErr }: { endpoint: string; solo: boolean; setMsg: (s: string | null) => void; setErr: (s: string | null) => void }) {
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [expiry, setExpiry] = useState("90d");
  const [copied, setCopied] = useState<"config" | "token" | null>(null);
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: () =>
      api.post<{ token: string }>("/api/agent/tokens", {
        name: "Hermes",
        preset: "read-only",
        followSettings: true,
        expiresAt:
          expiry === "never" ? null : new Date(Date.now() + Number(expiry.replace("d", "")) * 86400_000).toISOString().slice(0, 10),
      }),
    onSuccess: (data) => {
      setCreatedToken(data.token);
      setMsg("Hermes token created — copy the configuration now. The token is shown only once.");
      setErr(null);
      qc.invalidateQueries({ queryKey: ["agent-tokens"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Could not create the Hermes connection."),
  });

  const config = createdToken
    ? `mcp_servers:\n  open_finance:\n    url: "${endpoint}/api/mcp"\n    headers:\n      Authorization: "Bearer ${createdToken}"`
    : "";

  async function copy(kind: "config" | "token") {
    const value = kind === "config" ? config : createdToken;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 2200);
    } catch {
      setErr("Copy failed — select the text and copy it manually.");
    }
  }

  return (
    <Card className="border-accent/30">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent" aria-hidden>
          <ShieldCheck size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <CardTitle>Connect to Hermes</CardTitle>
          <p className="mt-1 text-sm text-text-muted">
            Run Hermes on your hub or Mac, where its model provider is configured. Open Finance stays the private finance
            tool server; no provider API key is stored on this phone.
          </p>
        </div>
      </div>
      {solo ? (
        <div className="mt-4 rounded-xl bg-surface-muted p-4">
          <p className="text-sm text-text">
            This phone runs standalone mode. Hermes itself still runs on your hub or Mac — but it connects{" "}
            <strong className="text-text">directly to this phone over Tailscale</strong> (port 8787), so no separate
            Open Finance install on the hub is needed.
          </p>
          <p className="mt-2 text-xs text-text-muted">
            Turn on Direct remote access below, then use the handoff brief to point your agent at this phone.
          </p>
        </div>
      ) : !createdToken ? (
        <div className="mt-4 rounded-xl bg-surface-muted p-4">
          <p className="text-sm text-text">
            This token follows the current Settings access boundaries. If you later change the AI access switches, the
            token&apos;s effective access changes immediately too.
          </p>
          <div className="mt-3 max-w-xs">
            <CustomSelect
              ariaLabel="Hermes token expiration"
              value={expiry}
              onChange={setExpiry}
              options={[
                { value: "30d", label: "Expires in 30 days" },
                { value: "60d", label: "Expires in 60 days" },
                { value: "90d", label: "Expires in 90 days (recommended)" },
                { value: "never", label: "Never expires (not recommended)" },
              ]}
            />
          </div>
          <Button className="mt-3" onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? "Creating secure connection…" : "Create Hermes connection"}
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-text-muted">Paste into ~/.hermes/config.yaml</p>
              <Button size="sm" variant="secondary" onClick={() => copy("config")}>
                <Copy size={13} className="mr-1.5" /> {copied === "config" ? "Copied" : "Copy config"}
              </Button>
            </div>
            <pre className="overflow-x-auto rounded-xl bg-background p-3 text-xs leading-5 text-text"><code>{config}</code></pre>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-text-muted">Token (shown once)</p>
              <Button size="sm" variant="secondary" onClick={() => copy("token")}>
                <Copy size={13} className="mr-1.5" /> {copied === "token" ? "Copied" : "Copy token"}
              </Button>
            </div>
            <code className="block break-all rounded-xl bg-background p-3 text-xs text-accent">{createdToken}</code>
          </div>
          <ol className="list-inside list-decimal space-y-1 text-xs text-text-muted">
            <li>Paste the YAML into Hermes&apos; config and restart Hermes.</li>
            <li>Keep the endpoint private with Tailscale when connecting away from home.</li>
            <li>Ask Hermes to read your Open Finance summary; it will start read-only.</li>
          </ol>
        </div>
      )}
    </Card>
  );
}

function RemoteAgentBriefCard({ endpoint, solo }: { endpoint: string; solo: boolean }) {
  const [gateway, setGateway] = useState("Telegram");
  const [chat, setChat] = useState("");
  const [model, setModel] = useState("Keep the current Hermes model");
  const [copied, setCopied] = useState(false);
  const [nativeStatus, setNativeStatus] = useState<{ available: boolean; listening: boolean } | null>(null);
  const remote = useQuery({
    queryKey: ["agent-remote"],
    queryFn: () => api.get<{ enabled: boolean; port: number; token: string | null }>("/api/agent/remote"),
    enabled: solo,
    retry: false,
  });
  const remoteEnabled = remote.data?.enabled ?? false;
  const remoteToken = remote.data?.token ?? "";

  useEffect(() => {
    if (!solo || !remoteEnabled) return;
    let cancelled = false;
    (async () => {
      const s = await getRemoteServerStatus();
      if (!cancelled) setNativeStatus(s);
    })();
    return () => {
      cancelled = true;
    };
  }, [solo, remoteEnabled, remote.data?.enabled]);
  const target = solo ? "" : endpoint.replace(/\/$/, "");
  const authLine = remoteToken
    ? "Authenticate every request with the HTTP header:\n   Authorization: Bearer " + remoteToken
    : "Authenticate every request with the HTTP header: Authorization: Bearer <remote access token from the Open Finance Agents page>";
  const brief = solo
    ? `Open Finance remote agent connection request

You are my finance agent running on my trusted agent hub (Hermes on my hub computer or Mac).

Connect DIRECTLY to my Open Finance phone over Tailscale. The phone runs Open Finance itself — there is no separate Open Finance install on a hub to find.

1. Reach the phone at its Tailscale address on port 8787 (find the phone in your Tailscale device list, or ask me to confirm its address). Example base: http://<phone-tailscale-address>:8787
2. ${authLine}
3. The phone answers the standard Open Finance REST API: GET /api/summary, GET /api/accounts, GET /api/transactions, GET /api/budgets, GET /api/categories, GET /api/reports/*.
4. Start read-only: fetch the summary and account list, and confirm what you can see before acting. Ask before any write (categories, budgets, transactions).
5. Gateway: ${gateway} · dedicated chat/topic: ${chat || "[SET CHAT OR TOPIC ID]"} · model preference: ${model} (change it in Hermes on the hub).
6. Keep provider credentials in Hermes on the hub — never store them in Open Finance, on the phone, or in this chat. The phone stores no provider API keys.`
    : `Open Finance remote agent connection request

You are my finance agent running on my trusted Hermes hub.

Open Finance MCP endpoint: ${target}/api/mcp
Gateway: ${gateway}
Dedicated gateway chat/topic: ${chat || "[SET CHAT OR TOPIC ID]"}
Model preference: ${model}

Complete this setup on the trusted hub:
1. Use the hub MCP endpoint above with the Open Finance bearer token I provide separately. Never ask me to paste a provider API key into Open Finance, the phone, or this chat.
2. Fetch ${target}/api/agent/guide and call get_capabilities first.
3. Keep access bounded by the current Open Finance Settings; begin read-only and ask before any write.
4. Configure the gateway to route this dedicated chat/topic (${chat || "the ID I provide"}) to this Hermes session.
5. If I requested a model change, change the model in Hermes on the hub. Do not store provider credentials in Open Finance or on the phone.
6. Confirm the connection with a read-only financial summary and do not modify data.`;
  async function copy() {
    try { await navigator.clipboard.writeText(brief); setCopied(true); window.setTimeout(() => setCopied(false), 2200); } catch { /* select manually */ }
  }
  return (
    <Card>
      <CardTitle>Remote agent handoff</CardTitle>
      {solo ? (
        <p className="mt-1 text-sm text-text-muted">
          Copy this token-free brief and send it through the gateway chat you choose. Your agent connects{" "}
          <strong className="text-text">directly to this phone over Tailscale</strong> (port 8787) — no Open Finance
          install on a hub is needed.
        </p>
      ) : (
        <p className="mt-1 text-sm text-text-muted">
          Copy this token-free brief and send it through the gateway chat you choose. It points your agent at this
          hub&apos;s Open Finance MCP endpoint.
        </p>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <CustomSelect ariaLabel="Agent gateway" value={gateway} onChange={setGateway} options={[{ value: "Telegram", label: "Telegram" }, { value: "Discord", label: "Discord" }, { value: "Slack", label: "Slack" }, { value: "Other", label: "Other" }]} />
        <Input aria-label="Gateway chat or topic ID" placeholder="Chat/topic ID" value={chat} onChange={(e) => setChat(e.target.value)} />
        {solo && (
          <div className="rounded-lg border border-border bg-surface-muted/40 px-3 py-2 text-xs text-text-muted sm:col-span-2">
            {remoteEnabled && nativeStatus?.listening ? (
              <>
                <span className="font-medium text-success">Remote access enabled</span> — the phone listens on{" "}
                <span className="font-mono text-accent">port 8787</span> over Tailscale. Token:{" "}
                <span className="break-all font-mono text-text">{remoteToken || "…"}</span>
              </>
            ) : remoteEnabled ? (
              <>
                Remote access is <span className="font-medium text-text">on</span>, but the server{" "}
                <span className="font-medium text-text">isn&apos;t listening yet</span>. Keep the Open Finance app open
                on this page — it starts on launch and on Enable.
              </>
            ) : (
              <>
                Remote access is <span className="font-medium text-text">off</span>. Turn on{" "}
                <span className="font-medium text-text">Direct remote access above</span> to let your agent reach this
                phone directly over Tailscale.
              </>
            )}
          </div>
        )}
        <Input aria-label="Preferred Hermes model" placeholder="e.g. current Hermes model" value={model} onChange={(e) => setModel(e.target.value)} />
      </div>
      <textarea aria-label="Remote agent handoff text" readOnly value={brief} className="mt-3 min-h-64 w-full resize-y rounded-xl border border-border bg-background p-3 text-xs leading-5 text-text" />
      <div className="mt-3 flex flex-wrap items-center gap-2"><Button onClick={copy}><Copy size={14} /> {copied ? "Copied" : "Copy handoff text"}</Button><span className="text-xs text-text-muted">Gateway and model credentials stay in Hermes.</span></div>
    </Card>
  );
}

/* ── Remote access control (solo phone → agent hub over Tailscale) ───── */

function RemoteAccessCard() {
  const qc = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [nativeReady, setNativeReady] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);

  const remote = useQuery({
    queryKey: ["agent-remote"],
    queryFn: () => api.get<{ enabled: boolean; port: number; token: string | null }>("/api/agent/remote"),
    retry: false,
  });
  const enabled = remote.data?.enabled ?? false;
  const token = remote.data?.token ?? "";

  const refresh = () => qc.invalidateQueries({ queryKey: ["agent-remote"] });

  async function refreshNativeStatus() {
    const s = await getRemoteServerStatus();
    setNativeReady(s.available);
    setListening(s.listening);
  }

  useEffect(() => {
    void refreshNativeStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote.data?.enabled]);

  async function startRemoteServer() {
    const s = await getRemoteServerStatus();
    if (!s.available) {
      setNativeReady(false);
      throw new Error("This build has no native remote server — install the APK release.");
    }
    const w = window as unknown as { RemoteServer?: { start?: (o: { port: number }) => Promise<unknown> } };
    await (w.RemoteServer?.start ?? (async () => {
      throw new Error("Remote server plugin not available on this build.");
    }))({ port: 8787 });
    setNativeReady(true);
  }
  async function stopRemoteServer() {
    const w = window as unknown as { RemoteServer?: { stop?: () => Promise<unknown> } };
    if (w.RemoteServer?.stop) await w.RemoteServer.stop();
  }

  async function enable() {
    setStarting(true);
    setMsg(null);
    try {
      await api.post<{ token: string; port: number }>("/api/agent/remote/enable");
      await startRemoteServer();
      await refresh();
      await refreshNativeStatus();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to enable remote access.");
    } finally {
      setStarting(false);
    }
  }

  async function disable() {
    setStarting(true);
    setMsg(null);
    try {
      await api.post("/api/agent/remote/disable");
      await stopRemoteServer();
      await refresh();
      setListening(false);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to disable remote access.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <Card>
      <CardTitle>Direct remote access (Tailscale)</CardTitle>
      <p className="mt-1 text-sm text-text-muted">
        Lets your agent hub connect <strong className="text-text">directly to this phone</strong> over Tailscale on port
        8787 — the phone itself serves Open Finance, no hub install required. Requests must present the bearer token.
        A foreground service keeps the server reachable even when the app is backgrounded or the screen is off.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button onClick={enabled ? disable : enable} disabled={starting || remote.isLoading}>
          {starting ? "Working…" : enabled ? "Disable remote access" : "Enable remote access"}
        </Button>
        {enabled && listening && (
          <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">● Listening on 8787</span>
        )}
        {enabled && !listening && nativeReady === false && (
          <span className="rounded-full bg-danger/10 px-3 py-1 text-xs font-medium text-danger">● Not listening — rebuild APK</span>
        )}
      </div>
      {enabled && !listening && nativeReady !== false && (
        <p className="mt-2 text-sm text-warning">Token saved, but the server isn’t listening yet — try tapping Enable again, or restart the app.</p>
      )}
      {msg && <p role="alert" className="mt-2 text-sm text-danger">{msg}</p>}
      {enabled && token && (
        <div className="mt-3 rounded-xl bg-surface-muted px-4 py-3 text-xs text-text-muted">
          <p className="font-medium text-text">Bearer token (device-local, like your recovery code):</p>
          <p className="mt-1 break-all font-mono text-text">{token}</p>
          <p className="mt-2">
            Your agent reaches this phone at <span className="font-mono text-accent">http://&lt;phone-tailscale-address&gt;:8787</span>.
            Find the phone in your Tailscale device list — the phone can&apos;t see its own address from here.
          </p>
        </div>
      )}
      <p className="mt-3 text-xs text-text-muted">
        Everything stays on your devices: Tailscale provides the private encrypted route; the token gates access; provider
        credentials stay in Hermes on the hub.
      </p>
    </Card>
  );
}

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

        <HermesSetupCard endpoint={endpoint} solo={solo} setMsg={setMsg} setErr={setErr} />
        {solo && <RemoteAccessCard />}
        <RemoteAgentBriefCard endpoint={endpoint} solo={solo} />

        {solo ? (
          <Card>
            <CardTitle>This phone’s agent connection (direct over Tailscale)</CardTitle>
            <ol className="mt-3 list-inside list-decimal space-y-2 text-sm text-text">
              <li>
                <div className="inline">
                  <strong className="text-text">Install Tailscale on this phone</strong> and on your agent hub (your
                  computer or Mac). The phone then has a private Tailscale address — that is the endpoint your agent
                  reaches. No Open Finance install on the hub is needed; this phone serves Open Finance itself.
                </div>
              </li>
              <li>
                Turn on <strong className="text-text">Direct remote access</strong> above — it starts the phone&apos;s
                listener on port 8787 and shows the bearer token.
              </li>
              <li>
                Point your agent at <span className="font-mono text-accent">http://&lt;phone-tailscale-address&gt;:8787</span>{" "}
                with the bearer token. Tailscale provides the private encrypted route; it does not replace the token.
              </li>
            </ol>
            <div className="mt-4 rounded-xl bg-surface-muted px-4 py-3 text-xs text-text-muted">
              Everything stays on your devices — the phone never leaves your Tailscale network.
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
                  <p className="font-medium text-text">Hermes recommended setup</p>
                  <p className="mt-1">
                    Run Hermes on your hub/Mac and configure its model provider there (Nous Portal, OpenAI-compatible,
                    Ollama, or another supported provider). Add this MCP endpoint and the Open Finance token to Hermes.
                    The phone never needs the model provider key.
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

      <HermesSetupCard endpoint={endpoint} solo={solo} setMsg={setMsg} setErr={setErr} />
      <RemoteAgentBriefCard endpoint={endpoint} solo={solo} />

      {/* Wire another agent right here — no need to go to Settings. */}
      <Card>
        <CardTitle>Wire another agent</CardTitle>
        <p className="mt-1 text-sm text-text-muted">
          Create another token for a second agent (or a replacement) without touching the existing connection. Point
          it at the endpoint above.
        </p>
        <div className="mt-3 space-y-3">
          <Input placeholder="Token name — e.g. trading-bot" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
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
          {created && (
            <div className="rounded-xl border border-success/30 bg-[var(--success-soft)] p-4">
              <p className="text-xs font-medium text-success">Copy your token now — it is shown only once:</p>
              <code className="mt-1 block break-all rounded-lg bg-background px-3 py-2 text-sm text-text">{created.token}</code>
              <Button
                size="sm"
                variant="secondary"
                className="mt-2"
                onClick={() => navigator.clipboard?.writeText(created.token).catch(() => {})}
              >
                <Copy size={13} className="mr-1.5" /> Copy
              </Button>
            </div>
          )}
        </div>
      </Card>

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
