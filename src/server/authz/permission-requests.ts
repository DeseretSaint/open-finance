import { randomUUID } from "node:crypto";
import { apiErrors } from "@/lib/api";
import { getDb, type Db } from "@/server/db/adapter";

/**
 * Permission requests — the ask-to-grant loop (§9.4). When an agent hits an
 * insufficient_scope wall, the route layer calls requestScope() to upsert a
 * pending request (deduped per token+scope, 10-cap), log the denied call, and
 * emit an SSE event. The user resolves Grant/Deny in Settings → Agents.
 */

export interface PermissionRequest {
  id: string;
  tokenId: string;
  tokenName: string;
  scope: string;
  status: "pending" | "granted" | "denied";
  requestedAt: string;
  resolvedAt: string | null;
}

function now(): string {
  return new Date().toISOString();
}

export function createPermissionService(db: Db = getDb()) {
  return {
    /** Record a denied call in the audit log. */
    async logDenied(tokenId: string, scope: string, tool: string, method: string | null, paramsJson: string | null): Promise<void> {
      await db.run(
        `INSERT INTO agent_access_log (id, token_id, scope_used, tool, method, params_json, status, latency_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 403, NULL, ?)`,
        randomUUID(),
        tokenId,
        scope,
        tool,
        method,
        paramsJson,
        now()
      );
    },

    /** Upsert a pending permission request (deduped per token+scope, 10-cap). */
    async requestScope(tokenId: string, scope: string): Promise<PermissionRequest> {
      const existing = await db.get<{ id: string; status: string }>(
        "SELECT id, status FROM agent_permission_requests WHERE token_id = ? AND scope = ? AND status = 'pending'",
        tokenId,
        scope
      );
      if (existing) {
        return this.getRequest(existing.id);
      }
      // Cap pending requests at 10 per token.
      const pending = await db.get<{ c: number }>(
        "SELECT COUNT(*) AS c FROM agent_permission_requests WHERE token_id = ? AND status = 'pending'",
        tokenId
      );
      if ((pending?.c ?? 0) >= 10) {
        throw apiErrors.rateLimited(60_000);
      }
      const id = randomUUID();
      await db.run(
        `INSERT INTO agent_permission_requests (id, token_id, scope, status, requested_at, resolved_at)
         VALUES (?, ?, ?, 'pending', ?, NULL)`,
        id,
        tokenId,
        scope,
        now()
      );
      return this.getRequest(id);
    },

    async getRequest(id: string): Promise<PermissionRequest> {
      const row = await db.get<{
        id: string; token_id: string; scope: string; status: string; requested_at: string; resolved_at: string | null;
        token_name: string;
      }>(
        `SELECT r.*, t.name AS token_name
           FROM agent_permission_requests r
           LEFT JOIN agent_tokens t ON t.id = r.token_id
          WHERE r.id = ?`,
        id
      );
      if (!row) throw apiErrors.notFound("Permission request");
      return {
        id: row.id,
        tokenId: row.token_id,
        tokenName: row.token_name ?? "Unknown token",
        scope: row.scope,
        status: row.status as PermissionRequest["status"],
        requestedAt: row.requested_at,
        resolvedAt: row.resolved_at,
      };
    },

    /** List pending (or all) requests for a user's tokens. */
    async listForUser(userId: string, status?: "pending" | "granted" | "denied"): Promise<PermissionRequest[]> {
      const where = ["t.user_id = ?"];
      const params: unknown[] = [userId];
      if (status) {
        where.push("r.status = ?");
        params.push(status);
      }
      const rows = await db.all<{
        id: string; token_id: string; scope: string; status: string; requested_at: string; resolved_at: string | null;
        token_name: string;
      }>(
        `SELECT r.*, t.name AS token_name
           FROM agent_permission_requests r
           JOIN agent_tokens t ON t.id = r.token_id
          WHERE ${where.join(" AND ")}
          ORDER BY r.requested_at DESC`,
        ...params
      );
      return rows.map((r) => ({
        id: r.id,
        tokenId: r.token_id,
        tokenName: r.token_name,
        scope: r.scope,
        status: r.status as PermissionRequest["status"],
        requestedAt: r.requested_at,
        resolvedAt: r.resolved_at,
      }));
    },

    /** Grant appends the scope to the token (preset badge becomes custom). */
    async resolve(userId: string, id: string, decision: "granted" | "denied"): Promise<PermissionRequest> {
      const req = await db.get<{ id: string; token_id: string; scope: string; status: string }>(
        `SELECT r.id, r.token_id, r.scope, r.status
           FROM agent_permission_requests r
           JOIN agent_tokens t ON t.id = r.token_id
          WHERE r.id = ? AND t.user_id = ?`,
        id,
        userId
      );
      if (!req) throw apiErrors.notFound("Permission request");
      if (req.status !== "pending") throw apiErrors.badRequest("This request was already resolved.");

      if (decision === "granted") {
        const token = await db.get<{ scopes: string; preset: string }>(
          "SELECT scopes, preset FROM agent_tokens WHERE id = ?",
          req.token_id
        );
        const scopes = JSON.parse(token?.scopes ?? "[]") as string[];
        if (!scopes.includes(req.scope)) {
          scopes.push(req.scope);
          await db.run("UPDATE agent_tokens SET scopes = ?, preset = 'custom' WHERE id = ?", JSON.stringify(scopes), req.token_id);
        }
      }
      await db.run(
        "UPDATE agent_permission_requests SET status = ?, resolved_at = ? WHERE id = ?",
        decision,
        now(),
        req.id
      );
      return this.getRequest(req.id);
    },
  };
}

export type PermissionService = ReturnType<typeof createPermissionService>;

/** Simple in-process SSE broadcaster for permission_requested events. */
type SseClient = { send: (event: string, data: unknown) => void };
const sseClients = new Set<SseClient>();

export function subscribeSse(client: SseClient): () => void {
  sseClients.add(client);
  return () => sseClients.delete(client);
}

export function emitSse(event: string, data: unknown): void {
  for (const c of sseClients) {
    try {
      c.send(event, data);
    } catch {
      sseClients.delete(c);
    }
  }
}
