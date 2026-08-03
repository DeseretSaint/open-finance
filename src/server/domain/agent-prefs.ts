import type { Db } from "@/server/db/types";
import { getDb } from "@/server/db/registry";

/**
 * Agent access preferences (P20–P23). One service shared by the server routes
 * and the solo router — no node:* imports (webview-safe).
 *
 * Lives on user_settings (migrations 006–009):
 *   agent_tabs                   — JSON array of tab keys the agent may READ.
 *   agent_tabs_write             — JSON array of tab keys the agent may WRITE.
 *   agent_auto_categorize        — activity WRITE toggle (smart categorization).
 *   agent_categorize_backlog_months — how far back (months) auto-categorization
 *                                  may reach. Default 1; allowed 1/3/6/12.
 *   agent_global                 — master toggle: READ + WRITE access to
 *                                  everything (supersedes tabs/tabsWrite).
 *
 * Smart categorization is gated on agent_auto_categorize specifically: the
 * agent cannot auto-categorize expenses unless that toggle is on, even if the
 * activity tab has write access (P25).
 *
 * These are user-level CAPS: at request time the effective scopes are
 * token scopes ∩ caps (see capScopes below, enforced in agent-auth).
 */

/** Valid tab keys, in UI order (matches the app's navigation). */
export const AGENT_TABS = ["dashboard", "accounts", "activity", "budgets"] as const;
export type AgentTab = (typeof AGENT_TABS)[number];

/** Allowed categorization-backlog values (months). */
export const CATEGORIZE_BACKLOGS = [1, 3, 6, 12] as const;
export const DEFAULT_CATEGORIZE_BACKLOG = 1;

/** Read scopes granted per tab. */
const TAB_SCOPES: Record<AgentTab, string[]> = {
  dashboard: ["read:summary"],
  // Investments live under the Accounts tab in the UI, so both are granted.
  accounts: ["read:banking", "read:investments"],
  activity: ["read:banking"],
  budgets: ["read:budgets"],
};

/** Write scopes granted per tab. */
const TAB_WRITE_SCOPES: Record<AgentTab, string[]> = {
  dashboard: ["settings:write"],
  accounts: ["sync:run"],
  activity: ["transactions:edit"],
  budgets: ["budgets:write"],
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
  /** Tab keys the agent may WRITE to (subset of tabs; ignored when globalWrite is on). */
  tabsWrite: AgentTab[];
  /** Activity WRITE (smart categorization). Off = activity read-only. */
  autoCategorize: boolean;
  /** How far back (months) auto-categorization may reach. */
  categorizeBacklogMonths: number;
  /** Master toggle: READ access to ALL tabs. */
  global: boolean;
  /** Sub-toggle: WRITE access across the whole app (implies global). */
  globalWrite: boolean;
  /** Guardrail: auto-approve READ permission requests that fall within the user's caps. */
  autoApproveReads: boolean;
  /** Guardrail: destructive agent writes (delete budget/category/planning item) need an explicit Grant. */
  requireWriteConfirm: boolean;
  /** Guardrail: log every agent call to the audit log (recommended on). */
  auditEnabled: boolean;
}

const DEFAULTS: AgentPrefs = {
  tabs: ["activity"],
  tabsWrite: [],
  autoCategorize: false,
  categorizeBacklogMonths: DEFAULT_CATEGORIZE_BACKLOG,
  global: false,
  globalWrite: false,
  autoApproveReads: false,
  requireWriteConfirm: true,
  auditEnabled: true,
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
    // Global access = read AND write across the whole app.
    for (const s of ALL_READ_SCOPES) add(s);
    for (const s of ALL_WRITE_SCOPES) add(s);
    return caps;
  }
  for (const tab of prefs.tabs) {
    for (const s of TAB_SCOPES[tab] ?? []) add(s);
  }
  // Per-tab write scopes (autoCategorize is a shortcut for activity write).
  const writeTabs: AgentTab[] = [...prefs.tabsWrite];
  if (prefs.autoCategorize && !writeTabs.includes("activity")) writeTabs.push("activity");
  for (const tab of writeTabs) {
    for (const s of TAB_WRITE_SCOPES[tab] ?? []) add(s);
  }
  return caps;
}

function parseTabs(raw: string | null | undefined, fallback: AgentTab[]): AgentTab[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const valid = parsed.filter((t): t is AgentTab => (AGENT_TABS as readonly string[]).includes(String(t)));
      return valid.length > 0 ? valid : fallback;
    }
  } catch {
    // Unparseable → keep default.
  }
  return fallback;
}

export function createAgentPrefsService(db: Db = getDb()) {
  return {
    async get(userId: string): Promise<AgentPrefs> {
      const row = await db.get<{
        agent_tabs: string | null;
        agent_tabs_write: string | null;
        agent_auto_categorize: number | null;
        agent_categorize_backlog_months: number | null;
        agent_global: number | null;
        agent_global_write: number | null;
        agent_auto_approve_reads: number | null;
        agent_require_write_confirm: number | null;
        agent_audit_enabled: number | null;
      }>(
        "SELECT agent_tabs, agent_tabs_write, agent_auto_categorize, agent_categorize_backlog_months, agent_global, agent_global_write, agent_auto_approve_reads, agent_require_write_confirm, agent_audit_enabled FROM user_settings WHERE user_id = ?",
        userId
      );
      if (!row) return DEFAULTS;
      const tabs = parseTabs(row.agent_tabs, DEFAULTS.tabs);
      const tabsWrite = parseTabs(row.agent_tabs_write, DEFAULTS.tabsWrite);
      let backlog = Number(row.agent_categorize_backlog_months ?? DEFAULT_CATEGORIZE_BACKLOG);
      if (!(CATEGORIZE_BACKLOGS as readonly number[]).includes(backlog)) backlog = DEFAULT_CATEGORIZE_BACKLOG;
      return {
        tabs,
        tabsWrite,
        autoCategorize: row.agent_auto_categorize === 1,
        categorizeBacklogMonths: backlog,
        global: row.agent_global === 1,
        globalWrite: row.agent_global_write === 1,
        autoApproveReads: row.agent_auto_approve_reads === 1,
        // Default ON even on pre-011 rows (null) — the safe posture.
        requireWriteConfirm: row.agent_require_write_confirm !== 0,
        auditEnabled: row.agent_audit_enabled !== 0,
      };
    },

    async update(userId: string, input: Partial<AgentPrefs>): Promise<AgentPrefs> {
      const cur = await this.get(userId);
      const next: AgentPrefs = {
        tabs: input.tabs ?? cur.tabs,
        tabsWrite: input.tabsWrite ?? cur.tabsWrite,
        autoCategorize: input.autoCategorize ?? cur.autoCategorize,
        categorizeBacklogMonths: input.categorizeBacklogMonths ?? cur.categorizeBacklogMonths,
        global: input.global ?? cur.global,
        globalWrite: input.globalWrite ?? cur.globalWrite,
        autoApproveReads: input.autoApproveReads ?? cur.autoApproveReads,
        requireWriteConfirm: input.requireWriteConfirm ?? cur.requireWriteConfirm,
        auditEnabled: input.auditEnabled ?? cur.auditEnabled,
      };
      await db.run(
        `INSERT INTO user_settings
           (user_id, agent_tabs, agent_tabs_write, agent_auto_categorize, agent_categorize_backlog_months,
            agent_global, agent_global_write, agent_auto_approve_reads, agent_require_write_confirm,
            agent_audit_enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           agent_tabs = excluded.agent_tabs,
           agent_tabs_write = excluded.agent_tabs_write,
           agent_auto_categorize = excluded.agent_auto_categorize,
           agent_categorize_backlog_months = excluded.agent_categorize_backlog_months,
           agent_global = excluded.agent_global,
           agent_global_write = excluded.agent_global_write,
           agent_auto_approve_reads = excluded.agent_auto_approve_reads,
           agent_require_write_confirm = excluded.agent_require_write_confirm,
           agent_audit_enabled = excluded.agent_audit_enabled,
           updated_at = excluded.updated_at`,
        userId,
        JSON.stringify(next.tabs),
        JSON.stringify(next.tabsWrite),
        next.autoCategorize ? 1 : 0,
        next.categorizeBacklogMonths,
        next.global ? 1 : 0,
        next.globalWrite ? 1 : 0,
        next.autoApproveReads ? 1 : 0,
        next.requireWriteConfirm ? 1 : 0,
        next.auditEnabled ? 1 : 0,
        new Date().toISOString()
      );
      return next;
    },
  };
}

export type AgentPrefsService = ReturnType<typeof createAgentPrefsService>;
