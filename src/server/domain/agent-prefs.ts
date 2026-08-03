import type { Db } from "@/server/db/types";
import { getDb } from "@/server/db/registry";

/**
 * Agent access preferences (P20/P21). One service shared by the server routes
 * and the solo router — no node:* imports (webview-safe).
 *
 * Lives on user_settings (migrations 006, 007, 008):
 *   agent_tabs            — JSON array of tab keys the agent may READ.
 *                           Keys: dashboard, accounts, activity, budgets,
 *                           reports, planning, investments.
 *   agent_auto_categorize — activity WRITE toggle (smart categorization).
 *   agent_global          — master toggle: READ access to ALL tabs (overrides
 *                           agent_tabs).
 *   agent_global_write    — sub-toggle: WRITE access across the whole app
 *                           (implies global).
 *
 * These are user-level CAPS: at request time the effective scopes are
 * token scopes ∩ caps (see capScopes below, enforced in agent-auth).
 */

/** Valid tab keys, in UI order. */
export const AGENT_TABS = [
  "dashboard",
  "accounts",
  "activity",
  "budgets",
  "reports",
  "planning",
  "investments",
] as const;
export type AgentTab = (typeof AGENT_TABS)[number];

/** Read scopes granted per tab. */
const TAB_SCOPES: Record<AgentTab, string[]> = {
  dashboard: ["read:summary"],
  accounts: ["read:banking"],
  activity: ["read:banking"],
  budgets: ["read:budgets"],
  reports: ["read:reports"],
  planning: ["read:planning"],
  investments: ["read:investments"],
};

const ALL_READ_SCOPES = Array.from(new Set(Object.values(TAB_SCOPES).flat()));
const ALL_WRITE_SCOPES = [
  "transactions:edit",
  "budgets:write",
  "planning:write",
  "categories:write",
  "settings:write",
  "sync:run",
];

export interface AgentPrefs {
  /** Tab keys the agent may READ (ignored when global is on). */
  tabs: AgentTab[];
  /** Activity WRITE (smart categorization). Off = activity read-only. */
  autoCategorize: boolean;
  /** Master toggle: READ access to ALL tabs. */
  global: boolean;
  /** Sub-toggle: WRITE access across the whole app (implies global). */
  globalWrite: boolean;
}

const DEFAULTS: AgentPrefs = {
  tabs: ["activity"],
  autoCategorize: false,
  global: false,
  globalWrite: false,
};

/**
 * The maximum scopes a user's prefs allow. A token may still have fewer
 * (token scopes are the token's own grant); the effective set is the
 * intersection, computed in agent-auth.
 *
 * Baseline: the selected tabs' read scopes (default: activity — watch
 * transactions as they come in, nothing about overall financial status).
 */
export function capScopes(prefs: AgentPrefs): string[] {
  const caps: string[] = [];
  const add = (s: string) => {
    if (!caps.includes(s)) caps.push(s);
  };
  if (prefs.global) {
    for (const s of ALL_READ_SCOPES) add(s);
  } else {
    for (const tab of prefs.tabs) {
      for (const s of TAB_SCOPES[tab] ?? []) add(s);
    }
  }
  if (prefs.autoCategorize) add("transactions:edit");
  if (prefs.globalWrite) {
    for (const s of ALL_WRITE_SCOPES) add(s);
  }
  return caps;
}

export function createAgentPrefsService(db: Db = getDb()) {
  return {
    async get(userId: string): Promise<AgentPrefs> {
      const row = await db.get<{
        agent_tabs: string | null;
        agent_auto_categorize: number | null;
        agent_global: number | null;
        agent_global_write: number | null;
      }>(
        "SELECT agent_tabs, agent_auto_categorize, agent_global, agent_global_write FROM user_settings WHERE user_id = ?",
        userId
      );
      if (!row) return DEFAULTS;
      let tabs: AgentTab[] = DEFAULTS.tabs;
      if (row.agent_tabs) {
        try {
          const parsed = JSON.parse(row.agent_tabs) as unknown;
          if (Array.isArray(parsed)) {
            tabs = parsed.filter((t): t is AgentTab => (AGENT_TABS as readonly string[]).includes(String(t)));
          }
        } catch {
          // Unparseable → keep default.
        }
      }
      return {
        tabs: tabs.length > 0 ? tabs : DEFAULTS.tabs,
        autoCategorize: row.agent_auto_categorize === 1,
        global: row.agent_global === 1,
        globalWrite: row.agent_global_write === 1,
      };
    },

    async update(userId: string, input: Partial<AgentPrefs>): Promise<AgentPrefs> {
      const cur = await this.get(userId);
      const next: AgentPrefs = {
        tabs: input.tabs ?? cur.tabs,
        autoCategorize: input.autoCategorize ?? cur.autoCategorize,
        global: input.global ?? cur.global,
        globalWrite: input.globalWrite ?? cur.globalWrite,
      };
      await db.run(
        `INSERT INTO user_settings (user_id, agent_tabs, agent_auto_categorize, agent_global, agent_global_write, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           agent_tabs = excluded.agent_tabs,
           agent_auto_categorize = excluded.agent_auto_categorize,
           agent_global = excluded.agent_global,
           agent_global_write = excluded.agent_global_write,
           updated_at = excluded.updated_at`,
        userId,
        JSON.stringify(next.tabs),
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
