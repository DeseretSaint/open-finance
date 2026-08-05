import { randomBytes, randomUUID } from "node:crypto";
import { apiErrors } from "@/lib/api";
import { hashSecret } from "@/lib/crypto";
import { getDb, type Db } from "@/server/db/adapter";
import { capScopes, createAgentPrefsService } from "@/server/domain/agent-prefs";

/**
 * BYOA token service — agent tokens (`of_` + 32B base62), SHA-256 hashed at
 * rest, prefix stored for display. Presets resolve to scope sets; any manual
 * change marks the badge "custom (modified)". (Master plan §9.7)
 */

export const TOKEN_PREFIX = "of_";

export const PRESETS: Record<string, string[]> = {
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
    "settings:write",
    "sync:run",
  ],
};

export const ALL_SCOPES = [
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
  "settings:write",
  "sync:run",
  "dev:ui",
];

export interface AgentTokenRow {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  token_prefix: string;
  preset: string;
  scopes: string;
  account_ids: string | null;
  ui_tabs: string | null;
  expires_at: string | null;
  follow_settings: number;
  revoked: boolean;
  created_at: string;
  last_used_at: string | null;
  last_user_agent: string | null;
}

export interface PublicAgentToken {
  id: string;
  name: string;
  tokenPrefix: string;
  preset: string;
  scopes: string[];
  accountIds: string[] | null;
  uiTabs: string[] | null;
  expiresAt: string | null;
  followSettings: boolean;
  revoked: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  lastUserAgent: string | null;
  /** Badge says "custom (modified)" when scopes differ from the preset. */
  custom: boolean;
}

function now(): string {
  return new Date().toISOString();
}

function toPublic(row: AgentTokenRow): PublicAgentToken {
  const scopes = JSON.parse(row.scopes ?? "[]") as string[];
  const preset = row.preset || "read-only";
  const presetScopes = PRESETS[preset] ?? [];
  const custom = scopes.length !== presetScopes.length || scopes.some((s) => !presetScopes.includes(s));
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    preset,
    scopes,
    accountIds: row.account_ids ? (JSON.parse(row.account_ids) as string[]) : null,
    uiTabs: row.ui_tabs ? (JSON.parse(row.ui_tabs) as string[]) : null,
    expiresAt: row.expires_at,
    followSettings: row.follow_settings === 1,
    revoked: row.revoked,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    lastUserAgent: row.last_user_agent,
    custom,
  };
}

export function createAgentTokenService(db: Db = getDb()) {
  return {
    async list(userId: string): Promise<PublicAgentToken[]> {
      const rows = await db.all<AgentTokenRow>(
        "SELECT * FROM agent_tokens WHERE user_id = ? ORDER BY created_at DESC",
        userId
      );
      return rows.map(toPublic);
    },

    async create(
      userId: string,
      input: {
        name: string;
        preset?: string;
        scopes?: string[];
        accountIds?: string[] | null;
        uiTabs?: string[] | null;
        expiresAt?: string | null;
        followSettings?: boolean;
      }
    ): Promise<{ token: string; agent: PublicAgentToken }> {
      const name = input.name.trim().slice(0, 80);
      if (!name) throw apiErrors.badRequest("Token name cannot be empty.");

      const preset = input.preset ?? "read-only";
      if (!(preset in PRESETS) && preset !== "custom") {
        throw apiErrors.badRequest("Preset must be read-only, read-all, read-write, or custom.");
      }
      const scopes = input.followSettings
        ? capScopes(await createAgentPrefsService(db).get(userId))
        : input.scopes && input.scopes.length > 0
          ? input.scopes
          : PRESETS[preset] ?? [];
      for (const s of scopes) {
        if (!ALL_SCOPES.includes(s)) throw apiErrors.badRequest(`Unknown scope: ${s}`);
      }
      if (scopes.length === 0) throw apiErrors.badRequest("A token needs at least one scope.");
      if (input.expiresAt && !/^\d{4}-\d{2}-\d{2}/.test(input.expiresAt)) {
        throw apiErrors.badRequest("Expiry must be a date.");
      }

      const raw = TOKEN_PREFIX + randomBytes(24).toString("base64url").slice(0, 40);
      const id = randomUUID();
      await db.run(
        `INSERT INTO agent_tokens (id, user_id, name, token_hash, token_prefix, preset, scopes,
                                   account_ids, ui_tabs, expires_at, follow_settings, revoked, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        id,
        userId,
        name,
        hashSecret(raw),
        raw.slice(0, 12),
        preset,
        JSON.stringify(scopes),
        input.accountIds && input.accountIds.length > 0 ? JSON.stringify(input.accountIds) : null,
        input.uiTabs && input.uiTabs.length > 0 ? JSON.stringify(input.uiTabs) : null,
        input.expiresAt ?? null,
        input.followSettings ? 1 : 0,
        now()
      );
      const row = await db.get<AgentTokenRow>("SELECT * FROM agent_tokens WHERE id = ?", id);
      return { token: raw, agent: toPublic(row!) };
    },

    async revoke(userId: string, id: string): Promise<void> {
      const r = await db.run("UPDATE agent_tokens SET revoked = 1 WHERE id = ? AND user_id = ?", id, userId);
      if (r.changes === 0) throw apiErrors.notFound("Agent token");
    },

    async remove(userId: string, id: string): Promise<void> {
      const r = await db.run("DELETE FROM agent_tokens WHERE id = ? AND user_id = ?", id, userId);
      if (r.changes === 0) throw apiErrors.notFound("Agent token");
    },

    /**
     * Resolve a raw bearer token → token row (hash lookup, expiry + revocation
     * enforced). Records last_used. Returns null when invalid.
     */
    async authenticate(rawToken: string): Promise<AgentTokenRow | null> {
      if (!rawToken.startsWith(TOKEN_PREFIX)) return null;
      const row = await db.get<AgentTokenRow>("SELECT * FROM agent_tokens WHERE token_hash = ?", hashSecret(rawToken));
      if (!row) return null;
      if (row.revoked) return null;
      if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
      await db.run("UPDATE agent_tokens SET last_used_at = ? WHERE id = ?", now(), row.id);
      return row;
    },
  };
}

export type AgentTokenService = ReturnType<typeof createAgentTokenService>;
