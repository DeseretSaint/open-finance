import { NextRequest, NextResponse } from "next/server";
import { apiErrors, ApiError } from "@/lib/api";
import { createAgentTokenService, type AgentTokenRow } from "@/server/authz/tokens";
import { createAgentPrefsService, capScopes } from "@/server/domain/agent-prefs";
import { getDb } from "@/server/db/adapter";
import { withAllowlist, type AllowlistCtx } from "@/server/db/allowlist";
import { createPermissionService, emitSse } from "@/server/authz/permission-requests";
import { getSessionFromRequest } from "@/server/auth/sessions";

/**
 * Agent authz — Bearer token → scope enforcement. Every agent-accessible route
 * calls requireAgentScope(req, "read:banking") and gets an AgentCtx carrying the
 * resolved token + allowlist. Denied calls throw insufficient_scope (403) with
 * the missing scopes named; agentRoute() upserts a permission request, logs the
 * denied call, and emits an SSE event.
 */

export interface AgentCtx {
  token: AgentTokenRow;
  scopes: string[];
  accountIds: string[] | null;
  allowlist: AllowlistCtx;
  userId: string;
}

/** Extract Bearer token from the Authorization header. */
export function bearerToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  if (!h || !h.toLowerCase().startsWith("bearer ")) return null;
  return h.slice(7).trim() || null;
}

export class InsufficientScopeError extends ApiError {
  constructor(
    public missing: string[],
    public tokenId: string,
    public tokenName: string,
    public tool: string
  ) {
    super(
      403,
      "insufficient_scope",
      `This token (${tokenName}) lacks ${missing.join(", ")}. Ask the user to grant it in Settings → Agents.`
    );
    this.name = "InsufficientScopeError";
  }
}

export function insufficientScope(missing: string[], tokenName: string): ApiError {
  return new ApiError(
    403,
    "insufficient_scope",
    `This token (${tokenName}) lacks ${missing.join(", ")}. Ask the user to grant it in Settings → Agents.`
  );
}

/**
 * Authenticate the request as an agent token and require ALL listed scopes.
 * Returns the agent context. Throws 401 (no/invalid token) or 403
 * insufficient_scope (missing scope — no data in the error).
 *
 * Effective scopes = token scopes ∩ the user's access caps (agent-prefs):
 * an agent token can never see more than the user's settings allow, even if
 * the token itself carries broader scopes (P20).
 */
export async function requireAgentScope(req: NextRequest, requiredScopes: string[], tool: string): Promise<AgentCtx> {
  const raw = bearerToken(req);
  if (!raw) throw apiErrors.unauthorized();
  const svc = createAgentTokenService(getDb());
  const token = await svc.authenticate(raw);
  if (!token) throw apiErrors.unauthorized();

  const scopes = await effectiveScopes(token);
  const missing = requiredScopes.filter((s) => !scopes.includes(s));
  if (missing.length > 0) {
    throw new InsufficientScopeError(missing, token.id, token.name, tool);
  }

  const accountIds = token.account_ids ? (JSON.parse(token.account_ids) as string[]) : null;
  return {
    token,
    scopes,
    accountIds,
    allowlist: { accountIds },
    userId: token.user_id,
  };
}

/**
 * Token scopes intersected with the user's access caps. Reads the user's
 * agent prefs each request so a Settings toggle applies immediately — no
 * token regeneration needed.
 */
async function effectiveScopes(token: { user_id: string; scopes: string; follow_settings?: number }): Promise<string[]> {
  const prefs = await createAgentPrefsService(getDb()).get(token.user_id);
  const caps = capScopes(prefs);
  // A dedicated Hermes token follows the user's current Settings boundary in
  // both directions: reducing access takes effect immediately, and expanding
  // access does not require creating a replacement token.
  if (token.follow_settings === 1) return caps;
  const tokenScopes = JSON.parse(token.scopes ?? "[]") as string[];
  return tokenScopes.filter((s) => caps.includes(s));
}

/**
 * Wrap an agent route handler: converts InsufficientScopeError into the 403
 * envelope AND upserts a permission request + audit row + SSE event so the user
 * sees a Grant/Deny prompt. Other errors go through the standard envelope.
 */
export function agentRoute(
  handler: (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<NextResponse>
): (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<NextResponse> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      if (e instanceof InsufficientScopeError) {
        try {
          const perms = createPermissionService(getDb());
          // Guardrail (D4): "auto-approve reads within caps". When the user
          // enabled it, a READ-scope miss that the user's own caps already
          // allow is granted immediately (appended to the token) instead of
          // sitting in the inbox. Writes are NEVER auto-approved — they ask.
          const tokenRow = await getDb().get<{ user_id: string; scopes: string }>(
            "SELECT user_id, scopes FROM agent_tokens WHERE id = ?",
            e.tokenId
          );
          const prefs = await createAgentPrefsService(getDb()).get(tokenRow?.user_id ?? "");
          const caps = capScopes(prefs);
          const autoGrantable = prefs.autoApproveReads
            ? e.missing.filter((s) => s.startsWith("read:") && caps.includes(s))
            : [];
          const stillMissing = e.missing.filter((s) => !autoGrantable.includes(s));

          if (autoGrantable.length > 0 && tokenRow) {
            const scopes = JSON.parse(tokenRow.scopes ?? "[]") as string[];
            let changed = false;
            for (const s of autoGrantable) {
              if (!scopes.includes(s)) {
                scopes.push(s);
                changed = true;
              }
              // Recorded in the audit trail as a denied-then-auto-granted call.
              await perms.logDenied(e.tokenId, s, e.tool, req.method, null);
            }
            if (changed) {
              await getDb().run("UPDATE agent_tokens SET scopes = ? WHERE id = ?", JSON.stringify(scopes), e.tokenId);
            }
          }

          for (const scope of stillMissing) {
            await perms.requestScope(e.tokenId, scope);
            await perms.logDenied(e.tokenId, scope, e.tool, req.method, null);
          }
          if (stillMissing.length === 0) {
            // Everything missing was auto-granted — the caller can retry now.
            return NextResponse.json(
              { error: { code: "auto_granted", message: `Granted ${autoGrantable.join(", ")} within your caps — retry the call.`, missing: [] } },
              { status: 409 }
            );
          }
          emitSse("permission_requested", {
            tokenId: e.tokenId,
            tokenName: e.tokenName,
            missing: stillMissing,
            tool: e.tool,
          });
        } catch {
          // Side effects must never mask the 403.
        }
        return NextResponse.json(
          { error: { code: e.code, message: e.message, missing: e.missing } },
          { status: e.status }
        );
      }
      if (e instanceof ApiError) {
        return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
      }
      console.error("Unhandled agent route error:", e);
      return NextResponse.json(
        { error: { code: "internal", message: "Something went wrong." } },
        { status: 500 }
      );
    }
  };
}

/**
 * Dual auth for read endpoints shared by UI + agents: accepts either a user
 * session cookie OR an agent Bearer token. Returns {kind:'session', userId} or
 * {kind:'agent', ctx}. Throws 401 when neither is valid.
 */
export async function requireSessionOrAgent(
  req: NextRequest,
  requiredScopes: string[],
  tool: string
): Promise<{ kind: "session"; userId: string } | { kind: "agent"; ctx: AgentCtx }> {
  const session = await getSessionFromRequest(req);
  if (session) return { kind: "session", userId: session.userId };
  const ctx = await requireAnyAgentScope(req, requiredScopes, tool);
  return { kind: "agent", ctx };
}

/**
 * Require ANY of the listed scopes (e.g. read:banking OR read:investments).
 * The per-account type filtering then happens inside the domain query.
 */
export async function requireAnyAgentScope(req: NextRequest, anyOf: string[], tool: string): Promise<AgentCtx> {
  const raw = bearerToken(req);
  if (!raw) throw apiErrors.unauthorized();
  const svc = createAgentTokenService(getDb());
  const token = await svc.authenticate(raw);
  if (!token) throw apiErrors.unauthorized();
  const scopes = await effectiveScopes(token);
  if (anyOf.length > 0 && !anyOf.some((s) => scopes.includes(s))) {
    throw new InsufficientScopeError(anyOf, token.id, token.name, tool);
  }
  const accountIds = token.account_ids ? (JSON.parse(token.account_ids) as string[]) : null;
  return {
    token,
    scopes,
    accountIds,
    allowlist: { accountIds },
    userId: token.user_id,
  };
}

/** True when the ctx token holds the scope (used for optional-scope routes). */
export function hasScope(ctx: AgentCtx, scope: string): boolean {
  return ctx.scopes.includes(scope);
}

export { withAllowlist };
