import type { Db } from "@/server/db/types";
import { getDb } from "@/server/db/registry";

/**
 * Agent access preferences (P20). One service shared by the server routes and
 * the solo router — no node:* imports (webview-safe).
 *
 * Lives on user_settings (migrations 006 + 007):
 *   agent_auto_categorize — activity WRITE toggle (smart categorization).
 *     OFF (default): agent may only READ activity (transactions).
 *     ON: agent may also WRITE categories on activity — but still sees NO
 *     overall financial status (summary, net worth, budgets, reports).
 *   agent_global — full-app READ access. OFF (default): activity-only.
 *   agent_global_write — sub-toggle: ON (and global) → every WRITE scope too.
 *
 * These are user-level CAPS: at request time the effective scopes are
 * token scopes ∩ caps (see capScopes below, enforced in agent-auth).
 */

export interface AgentPrefs {
  /** Activity WRITE (smart categorization). Off = activity read-only. */
  autoCategorize: boolean;
  /** Full-app READ access (summary, budgets, planning, reports, investments). */
  global: boolean;
  /** Full-app WRITE access (implies global). */
  globalWrite: boolean;
}

const DEFAULTS: AgentPrefs = {
  autoCategorize: false,
  global: false,
  globalWrite: false,
};

/**
 * The maximum scopes a user's prefs allow. A token may still have fewer
 * (token scopes are the token's own grant); the effective set is the
 * intersection, computed in agent-auth.
 *
 * Baseline (always allowed): read:banking — the agent can watch activity
 * (transactions) as it comes in, but nothing about overall financial status.
 */
export function capScopes(prefs: AgentPrefs): string[] {
  const caps = ["read:banking"]; // activity read — always on
  if (prefs.autoCategorize) caps.push("transactions:edit");
  if (prefs.global) {
    caps.push("read:summary", "read:investments", "read:budgets", "read:planning", "read:reports");
    if (prefs.globalWrite) {
      caps.push("transactions:edit", "budgets:write", "planning:write", "categories:write", "settings:write", "sync:run");
    }
  }
  return caps;
}

export function createAgentPrefsService(db: Db = getDb()) {
  return {
    async get(userId: string): Promise<AgentPrefs> {
      const row = await db.get<{ agent_auto_categorize: number | null; agent_global: number | null; agent_global_write: number | null }>(
        "SELECT agent_auto_categorize, agent_global, agent_global_write FROM user_settings WHERE user_id = ?",
        userId
      );
      if (!row) return DEFAULTS;
      return {
        autoCategorize: row.agent_auto_categorize === 1,
        global: row.agent_global === 1,
        globalWrite: row.agent_global_write === 1,
      };
    },

    async update(userId: string, input: Partial<AgentPrefs>): Promise<AgentPrefs> {
      const cur = await this.get(userId);
      const next: AgentPrefs = {
        autoCategorize: input.autoCategorize ?? cur.autoCategorize,
        global: input.global ?? cur.global,
        globalWrite: input.globalWrite ?? cur.globalWrite,
      };
      await db.run(
        `INSERT INTO user_settings (user_id, agent_auto_categorize, agent_global, agent_global_write, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           agent_auto_categorize = excluded.agent_auto_categorize,
           agent_global = excluded.agent_global,
           agent_global_write = excluded.agent_global_write,
           updated_at = excluded.updated_at`,
        userId,
        next.autoCategorize ? 1 : 0,
        next.global ? 1 : 0,
        next.globalWrite ? 1 : 0,
        new Date().toISOString()
      );
      return next;
    },
  };
}

export type AgentPrefsService = ReturnType<typeof createAgentPrefsService>;
