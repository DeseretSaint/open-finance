import type { Db } from "@/server/db/types";
import { getDb } from "@/server/db/registry";

/**
 * Agent manual (D11) — user-editable, per-domain steering guidance the connected
 * agent reads on every poll (via the read_agent_manual MCP tool). This is how the
 * user updates how the agent handles categorization, budgeting, or anything else,
 * without ever touching the agent's own config. The app is the source of truth;
 * the agent just reads what's here.
 *
 * Domains:
 *   categorization — how to categorize ambiguous charges, merchant rules, etc.
 *   budgeting      — how to build/maintain budgets generally.
 *   general        — anything else (tone, cadence, guardrails beyond the app's).
 *
 * Webview-safe: no node:* imports (mirrors agent-prefs.ts).
 */

export const MANUAL_DOMAINS = ["categorization", "budgeting", "general"] as const;
export type ManualDomain = (typeof MANUAL_DOMAINS)[number];

export interface AgentManual {
  categorization: string;
  budgeting: string;
  general: string;
  updatedAt: string | null;
}

const EMPTY: AgentManual = { categorization: "", budgeting: "", general: "", updatedAt: null };

export function createAgentManualService(db: Db = getDb()) {
  return {
    async get(userId: string): Promise<AgentManual> {
      const row = await db.get<{
        categorization: string | null;
        budgeting: string | null;
        general: string | null;
        updated_at: string | null;
      }>("SELECT categorization, budgeting, general, updated_at FROM agent_manual WHERE user_id = ?", userId);
      if (!row) return EMPTY;
      return {
        categorization: row.categorization ?? "",
        budgeting: row.budgeting ?? "",
        general: row.general ?? "",
        updatedAt: row.updated_at ?? null,
      };
    },

    async update(userId: string, input: Partial<Omit<AgentManual, "updatedAt">>): Promise<AgentManual> {
      const cur = await this.get(userId);
      const next: AgentManual = {
        categorization: input.categorization ?? cur.categorization,
        budgeting: input.budgeting ?? cur.budgeting,
        general: input.general ?? cur.general,
        updatedAt: new Date().toISOString(),
      };
      await db.run(
        `INSERT INTO agent_manual (user_id, categorization, budgeting, general, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           categorization = excluded.categorization,
           budgeting = excluded.budgeting,
           general = excluded.general,
           updated_at = excluded.updated_at`,
        userId,
        next.categorization,
        next.budgeting,
        next.general,
        next.updatedAt
      );
      return next;
    },
  };
}

export type AgentManualService = ReturnType<typeof createAgentManualService>;
