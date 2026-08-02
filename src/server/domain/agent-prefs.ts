import type { Db } from "@/server/db/types";
import { getDb } from "@/server/db/registry";

/**
 * Agent smart-categorization preference (P18). One service shared by the
 * server routes and the solo router — no node:* imports (webview-safe).
 *
 * Lives on user_settings (migration 006):
 *   agent_auto_categorize — when ON, the connected agent may auto-categorize
 *   uncategorized / generically-named expenses it is confident about, and may
 *   leave ambiguous ("gray area") ones untouched. When OFF (default), the
 *   agent only suggests and the user categorizes manually.
 */

export interface AgentPrefs {
  autoCategorize: boolean;
}

const DEFAULTS: AgentPrefs = {
  autoCategorize: false,
};

export function createAgentPrefsService(db: Db = getDb()) {
  return {
    async get(userId: string): Promise<AgentPrefs> {
      const row = await db.get<{ agent_auto_categorize: number | null }>(
        "SELECT agent_auto_categorize FROM user_settings WHERE user_id = ?",
        userId
      );
      if (!row) return DEFAULTS;
      return {
        autoCategorize: row.agent_auto_categorize === 1,
      };
    },

    async update(userId: string, input: { autoCategorize: boolean }): Promise<AgentPrefs> {
      await db.run(
        `INSERT INTO user_settings (user_id, agent_auto_categorize, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET agent_auto_categorize = excluded.agent_auto_categorize, updated_at = excluded.updated_at`,
        userId,
        input.autoCategorize ? 1 : 0,
        new Date().toISOString()
      );
      return { autoCategorize: input.autoCategorize };
    },
  };
}

export type AgentPrefsService = ReturnType<typeof createAgentPrefsService>;
