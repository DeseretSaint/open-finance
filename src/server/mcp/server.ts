import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createAgentTokenService, type AgentTokenRow } from "@/server/authz/tokens";
import { MCP_TOOLS } from "@/server/authz/route-registry";
import { createPermissionService } from "@/server/authz/permission-requests";
import { createSummaryService } from "@/server/domain/summary";
import { createAccountsService } from "@/server/domain/accounts";
import { createTransactionsService } from "@/server/domain/transactions";
import { createBudgetsService } from "@/server/domain/budgets";
import { createPlanningService } from "@/server/domain/planning";
import { createProjectionService } from "@/server/domain/projection";
import { createReportsService } from "@/server/domain/reports";
import { createCategoriesService } from "@/server/domain/categories";
import { createAgentManualService } from "@/server/domain/agent-manual";
import { createAgentPrefsService, AGENT_TABS } from "@/server/domain/agent-prefs";
import { getDb } from "@/server/db/adapter";

/**
 * Open Finance MCP server (§9) — built on the low-level Server API because the
 * SDK's high-level McpServer types target zod v3 while the app pins zod v4
 * (handoff §6); the protocol layer itself is version-agnostic. Tool inputs are
 * validated here with zod v4; scopes are re-checked per call (denied tools stay
 * visible → attempt → permission prompt, per §9.3).
 */

export interface McpAuth {
  token: AgentTokenRow;
  scopes: string[];
  userId: string;
  accountIds: string[] | null;
}

export class McpUnauthorizedError extends Error {
  constructor(
    public missing: string[],
    public tokenId: string,
    public tokenName: string,
    public tool: string
  ) {
    super(`insufficient_scope: ${missing.join(", ")}`);
    this.name = "McpUnauthorizedError";
  }
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
  parse: () => z.ZodType; // validates with zod v4
  run: (auth: McpAuth, args: unknown) => Promise<unknown>;
}

function scopesFor(tool: string): string[] {
  return MCP_TOOLS.find((t) => t.tool === tool)?.scopes ?? [];
}

function jsonSchema(shape: Record<string, z.ZodType>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [k, v] of Object.entries(shape)) {
    properties[k] = { type: jsonType(v) };
    if (!(v instanceof z.ZodOptional) && !(v instanceof z.ZodDefault)) required.push(k);
  }
  return { type: "object", properties, required };
}

function jsonType(schema: z.ZodType): string {
  if (schema instanceof z.ZodString) return "string";
  if (schema instanceof z.ZodNumber || schema instanceof z.ZodBoolean) return "number";
  if (schema instanceof z.ZodArray) return "array";
  if (schema instanceof z.ZodEnum) return "string";
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    // zod v4 stores the inner type on `_innerType`; fall back to `_def.innerType`.
    const inner =
      (schema as unknown as { _innerType?: z.ZodType })._innerType ??
      (schema as unknown as { _def?: { innerType?: z.ZodType } })._def?.innerType;
    return inner ? jsonType(inner) : "string";
  }
  return "string";
}

const money = z.number().int().positive();
const optional = <T extends z.ZodType>(s: T) => s.optional();

const TOOLS: ToolDef[] = [
  {
    name: "get_financial_summary",
    description: "One-call briefing over the accounts this token can see (read:summary).",
    inputSchema: jsonSchema({}),
    parse: () => z.object({}),
    run: async (auth) => {
      const summary = await createSummaryService(getDb()).get(auth.userId, undefined, { accountIds: auth.accountIds });
      return { summary };
    },
  },
  {
    name: "get_capabilities",
    description: "What this token can do and what's missing (always available).",
    inputSchema: jsonSchema({}),
    parse: () => z.object({}),
    run: async (auth) => {
      const tools = MCP_TOOLS.filter((t) => t.scopes.length === 0 || t.scopes.some((s) => auth.scopes.includes(s))).map(
        (t) => t.tool
      );
      const prefs = await createAgentPrefsService(getDb()).get(auth.userId);
      return {
        preset: auth.token.preset,
        scopes: auth.scopes,
        tools,
        access: {
          // Tabs the agent may read (all of them when global is on).
          tabs: prefs.global ? AGENT_TABS : prefs.tabs,
          // Tabs the agent may write to (all of them when global is on).
          tabsWrite: prefs.globalWrite || prefs.global ? AGENT_TABS : prefs.tabsWrite,
          // Global = full read + write access.
          global: prefs.global,
          // Write on activity only when smart categorization is enabled.
          activityWrite: prefs.autoCategorize,
          // How far back (months) auto-categorization may reach.
          categorizeBacklogMonths: prefs.categorizeBacklogMonths,
        },
        // The agent handbook — fetch it once at connect time.
        guide: "/api/agent/guide",
        // The user's live steering manual — read_agent_manual with ?since=
        // returns changed:false (no text) unless the version moved.
        manual: "/api/agent/manual",
        // Current manual version — compare against your last seen value before
        // calling read_agent_manual to avoid re-reading identical instructions.
        manualVersion: (await createAgentManualService(getDb()).get(auth.userId)).version,
      };
    },
  },
  {
    name: "read_agent_manual",
    description: "The user's live AI steering manual — per-domain guidance (categorization, budgeting, general) that overrides or extends this handbook. Pass since=<version you last saw>; when nothing changed you get changed:false and no text (saves tokens). If you have never read it, omit since. Always available (no scope needed).",
    inputSchema: jsonSchema({ since: z.number().int().min(0).optional() }),
    parse: () => z.object({ since: z.number().int().min(0).optional() }),
    run: async (auth, args) => {
      const { since } = args as { since?: number };
      const manual = await createAgentManualService(getDb()).get(auth.userId);
      if (since !== undefined && since === manual.version) {
        // Unchanged — nothing to re-read; do not send the manual text.
        return { changed: false, version: manual.version };
      }
      return { changed: true, version: manual.version, manual };
    },
  },
  {
    name: "list_accounts",
    description: "Accounts visible to this token (read:banking / read:investments per account type + allowlist).",
    inputSchema: jsonSchema({}),
    parse: () => z.object({}),
    run: async (auth) => {
      const accounts = await createAccountsService(getDb()).listForAgent(auth.userId, auth.scopes, auth.accountIds);
      return { accounts };
    },
  },
  {
    name: "list_transactions",
    description: "Recent transactions on allowed accounts (read:banking / read:investments). Params: limit (default 50).",
    inputSchema: jsonSchema({ limit: z.number().int().min(1).max(200).optional() }),
    parse: () => z.object({ limit: z.number().int().min(1).max(200).optional() }),
    run: async (auth, args) => {
      const { limit } = args as { limit?: number };
      const { rows } = await createTransactionsService(getDb()).list(auth.userId, {
        limit: limit ?? 50,
        offset: 0,
        accountIds: auth.accountIds,
      });
      return { transactions: rows };
    },
  },
  {
    name: "search_transactions",
    description: "Search transactions by text query on allowed accounts (read:banking / read:investments).",
    inputSchema: jsonSchema({ q: z.string().min(1), limit: z.number().int().min(1).max(200).optional() }),
    parse: () => z.object({ q: z.string().min(1), limit: z.number().int().min(1).max(200).optional() }),
    run: async (auth, args) => {
      const { q, limit } = args as { q: string; limit?: number };
      const { rows } = await createTransactionsService(getDb()).list(auth.userId, {
        q,
        limit: limit ?? 50,
        offset: 0,
        accountIds: auth.accountIds,
      });
      return { transactions: rows };
    },
  },
  {
    name: "get_transaction",
    description: "Get a single transaction by id on allowed accounts (read:banking / read:investments). Params: transactionId.",
    inputSchema: jsonSchema({ transactionId: z.string().min(1) }),
    parse: () => z.object({ transactionId: z.string().min(1) }),
    run: async (auth, args) => {
      const { transactionId } = args as { transactionId: string };
      const transaction = await createTransactionsService(getDb()).get(auth.userId, transactionId);
      return { transaction };
    },
  },
  {
    name: "list_uncategorized_transactions",
    description:
      "Transactions with no category yet, or with a generic/unclear name (for smart categorization). " +
      "When the user has enabled 'smart categorization', use set_transaction_category for the ones you are confident " +
      "about and LEAVE the ambiguous ('gray area') ones alone. A categorization backlog window is optional: with " +
      "access.categorizeBacklogMonths = 0 the user wants you to work on NEW transactions moving forward (no history " +
      "reach-back); otherwise only transactions within that many months back are returned (default 1). " +
      "Params: limit (default 50), includeGeneric (default true).",
    inputSchema: jsonSchema({
      limit: z.number().int().min(1).max(200).optional(),
      includeGeneric: z.boolean().optional(),
    }),
    parse: () => z.object({ limit: z.number().int().min(1).max(200).optional(), includeGeneric: z.boolean().optional() }),
    run: async (auth, args) => {
      const { limit, includeGeneric } = args as { limit?: number; includeGeneric?: boolean };
      const prefs = await createAgentPrefsService(getDb()).get(auth.userId);
      // Smart categorization is gated on its own toggle (P25): even with
      // activity read/write scopes, no auto-categorization unless enabled.
      if (!prefs.autoCategorize) {
        return {
          uncategorized: [],
          generic: [],
          backlogMonths: prefs.categorizeBacklogMonths,
          note: "Smart categorization is off. The user must enable it in Settings → AI agent connection.",
        };
      }
      const txns = createTransactionsService(getDb());
      const filters: {
        categoryId: null;
        from?: string;
        limit: number;
        offset: number;
        accountIds?: string[] | null;
      } = {
        categoryId: null,
        limit: limit ?? 50,
        offset: 0,
        accountIds: auth.accountIds,
      };
      // backlogMonths 0 = moving-forward mode: no history window, list the
      // newest uncategorized transactions so the agent can categorize as they
      // come in. Otherwise restrict to the user's backlog window.
      if (prefs.categorizeBacklogMonths > 0) {
        const since = new Date();
        since.setMonth(since.getMonth() - prefs.categorizeBacklogMonths);
        filters.from = since.toISOString().slice(0, 10);
      }
      const { rows } = await txns.list(auth.userId, filters);
      const generic = includeGeneric === false ? [] : rows.filter((r) => /^(purchase|payment|pos|debit|card|withdrawal|transfer|misc|other|internet|online)\b/i.test(r.name));
      return { uncategorized: rows, generic: generic.map((r) => r.id), backlogMonths: prefs.categorizeBacklogMonths };
    },
  },
  {
    name: "get_budgets",
    description: "Budgets with progress for the current month (read:budgets).",
    inputSchema: jsonSchema({}),
    parse: () => z.object({}),
    run: async (auth) => {
      const budgets = await createBudgetsService(getDb()).list(auth.userId);
      return { budgets };
    },
  },
  {
    name: "get_budget_progress",
    description: "Current-month progress per budget: spent, remaining, pct (read:budgets).",
    inputSchema: jsonSchema({}),
    parse: () => z.object({}),
    run: async (auth) => {
      const budgets = await createBudgetsService(getDb()).list(auth.userId);
      const progress = budgets.map((b) => ({
        id: b.id,
        name: b.name,
        amountCents: b.amount_cents,
        spentCents: b.spentCents,
        remainingCents: b.remainingCents,
        pct: b.pct,
        overBudget: b.pct > 1,
        categoryNames: b.categoryNames,
      }));
      return { progress };
    },
  },
  {
    name: "get_planning_items",
    description:
      "Bills, debts, goals (savings + one-off expenses with their contribution plans), the manual payday schedule and the 12-month projection (read:planning).",
    inputSchema: jsonSchema({}),
    parse: () => z.object({}),
    run: async (auth) => {
      const planning = createPlanningService(getDb());
      const [bills, debts, goals, paydays, projection] = await Promise.all([
        planning.listBills(auth.userId),
        planning.listDebts(auth.userId),
        planning.listGoals(auth.userId),
        planning.getPaydays(auth.userId),
        createProjectionService(getDb()).project(auth.userId),
      ]);
      return { bills, debts, goals, paydays, projection };
    },
  },
  {
    name: "get_spending_by_category",
    description: "Spending by category for a date range (read:reports). Params: from, to (YYYY-MM-DD).",
    inputSchema: jsonSchema({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    parse: () => z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    run: async (auth, args) => {
      const { from, to } = args as { from: string; to: string };
      const rows = await createReportsService(getDb()).spendingByCategory(auth.userId, from, to);
      return { rows };
    },
  },
  {
    name: "get_cashflow",
    description: "Monthly income/expense/net for the last N months (read:reports). Params: months (default 6).",
    inputSchema: jsonSchema({ months: z.number().int().min(1).max(36).optional() }),
    parse: () => z.object({ months: z.number().int().min(1).max(36).optional() }),
    run: async (auth, args) => {
      const { months } = args as { months?: number };
      const rows = await createReportsService(getDb()).cashflow(auth.userId, months ?? 6);
      return { rows };
    },
  },
  {
    name: "get_net_worth",
    description: "Net worth: assets, liabilities, net (read:reports).",
    inputSchema: jsonSchema({}),
    parse: () => z.object({}),
    run: async (auth) => {
      const netWorth = await createReportsService(getDb()).netWorth(auth.userId);
      return { netWorth };
    },
  },
  {
    name: "set_transaction_category",
    description: "Set the category on an existing transaction (transactions:edit). Params: transactionId, categoryId (nullable).",
    inputSchema: jsonSchema({ transactionId: z.string(), categoryId: z.string().nullable() }),
    parse: () => z.object({ transactionId: z.string(), categoryId: z.string().nullable() }),
    run: async (auth, args) => {
      const { transactionId, categoryId } = args as { transactionId: string; categoryId: string | null };
      const transaction = await createTransactionsService(getDb()).update(auth.userId, transactionId, {
        userCategoryId: categoryId,
      });
      return { transaction };
    },
  },
  {
    name: "create_budget",
    description: "Create a budget (budgets:write). Params: name, amountCents, categoryIds (optional).",
    inputSchema: jsonSchema({
      name: z.string().min(1),
      amountCents: money,
      categoryIds: z.array(z.string()).optional(),
    }),
    parse: () => z.object({ name: z.string().min(1), amountCents: money, categoryIds: z.array(z.string()).optional() }),
    run: async (auth, args) => {
      const { name, amountCents, categoryIds } = args as { name: string; amountCents: number; categoryIds?: string[] };
      const budget = await createBudgetsService(getDb()).create(auth.userId, { name, amountCents, categoryIds });
      return { budget };
    },
  },
  {
    name: "update_budget",
    description: "Update an existing budget: rename, change amount, or set categories (budgets:write). Params: budgetId + any of name, amountCents, categoryIds.",
    inputSchema: jsonSchema({
      budgetId: z.string().min(1),
      name: z.string().min(1).optional(),
      amountCents: money.optional(),
      categoryIds: z.array(z.string()).optional(),
    }),
    parse: () =>
      z.object({
        budgetId: z.string().min(1),
        name: z.string().min(1).optional(),
        amountCents: money.optional(),
        categoryIds: z.array(z.string()).optional(),
      }),
    run: async (auth, args) => {
      const { budgetId, name, amountCents, categoryIds } = args as {
        budgetId: string;
        name?: string;
        amountCents?: number;
        categoryIds?: string[];
      };
      const budget = await createBudgetsService(getDb()).update(auth.userId, budgetId, { name, amountCents, categoryIds });
      return { budget };
    },
  },
  {
    name: "delete_budget",
    description: "Delete a budget (budgets:write). Params: budgetId.",
    inputSchema: jsonSchema({ budgetId: z.string().min(1) }),
    parse: () => z.object({ budgetId: z.string().min(1) }),
    run: async (auth, args) => {
      const { budgetId } = args as { budgetId: string };
      await createBudgetsService(getDb()).remove(auth.userId, budgetId);
      return { ok: true, deleted: budgetId };
    },
  },
  {
    name: "upsert_planning_item",
    description: "Create a bill, debt, or goal (planning:write). Params: kind (bill|debt|goal) + fields.",
    inputSchema: jsonSchema({
      kind: z.enum(["bill", "debt", "goal"]),
      name: z.string().min(1),
      amountCents: optional(money),
      frequency: z.enum(["weekly", "biweekly", "monthly", "quarterly", "yearly", "one-time"]).optional(),
      dueDay: z.number().int().min(1).max(31).optional(),
      nextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      principalCents: optional(money),
      aprBps: z.number().int().nonnegative().optional(),
      minPaymentCents: z.number().int().nonnegative().optional(),
      targetCents: optional(money),
      targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      currentCents: z.number().int().nonnegative().optional(),
    }),
    parse: () =>
      z.object({
        kind: z.enum(["bill", "debt", "goal"]),
        name: z.string().min(1),
        amountCents: optional(money),
        frequency: z.enum(["weekly", "biweekly", "monthly", "quarterly", "yearly", "one-time"]).optional(),
        dueDay: z.number().int().min(1).max(31).optional(),
        nextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        principalCents: optional(money),
        aprBps: z.number().int().nonnegative().optional(),
        minPaymentCents: z.number().int().nonnegative().optional(),
        targetCents: optional(money),
        targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        currentCents: z.number().int().nonnegative().optional(),
      }),
    run: async (auth, args) => {
      const a = args as {
        kind: "bill" | "debt" | "goal";
        name: string;
        amountCents?: number;
        frequency?: string;
        dueDay?: number;
        nextDueDate?: string;
        principalCents?: number;
        aprBps?: number;
        minPaymentCents?: number;
        targetCents?: number;
        targetDate?: string;
        currentCents?: number;
      };
      const planning = createPlanningService(getDb());
      let item: unknown;
      if (a.kind === "bill") {
        item = await planning.createBill(auth.userId, {
          name: a.name,
          amountCents: a.amountCents ?? 0,
          frequency: a.frequency as never,
          dueDay: a.dueDay ?? null,
          nextDueDate: a.nextDueDate ?? null,
        });
      } else if (a.kind === "debt") {
        item = await planning.createDebt(auth.userId, {
          name: a.name,
          principalCents: a.principalCents ?? 0,
          aprBps: a.aprBps,
          minPaymentCents: a.minPaymentCents,
        });
      } else {
        item = await planning.createGoal(auth.userId, {
          name: a.name,
          targetCents: a.targetCents ?? 0,
          targetDate: a.targetDate ?? null,
          currentCents: a.currentCents,
        });
      }
      return { [a.kind]: item };
    },
  },
  {
    name: "create_category",
    description: "Create a category (categories:write). Params: name, color (optional), plaidPaths (optional).",
    inputSchema: jsonSchema({ name: z.string().min(1), color: z.string().optional(), plaidPaths: z.string().optional() }),
    parse: () => z.object({ name: z.string().min(1), color: z.string().optional(), plaidPaths: z.string().optional() }),
    run: async (auth, args) => {
      const { name, color, plaidPaths } = args as { name: string; color?: string; plaidPaths?: string };
      const category = await createCategoriesService(getDb()).create(auth.userId, { name, color, plaidPaths });
      return { category };
    },
  },
  {
    name: "list_categories",
    description: "List all categories (read:budgets). Includes id/name/color — use ids when creating budgets.",
    inputSchema: jsonSchema({}),
    parse: () => z.object({}),
    run: async (auth) => {
      const categories = await createCategoriesService(getDb()).list(auth.userId);
      return { categories };
    },
  },
  {
    name: "update_category",
    description: "Rename or recolor a category (categories:write). System categories cannot be edited. Params: categoryId + any of name, color, plaidPaths.",
    inputSchema: jsonSchema({
      categoryId: z.string().min(1),
      name: z.string().min(1).optional(),
      color: z.string().optional(),
      plaidPaths: z.string().optional(),
    }),
    parse: () =>
      z.object({
        categoryId: z.string().min(1),
        name: z.string().min(1).optional(),
        color: z.string().optional(),
        plaidPaths: z.string().optional(),
      }),
    run: async (auth, args) => {
      const { categoryId, name, color, plaidPaths } = args as {
        categoryId: string;
        name?: string;
        color?: string;
        plaidPaths?: string;
      };
      const category = await createCategoriesService(getDb()).update(auth.userId, categoryId, { name, color, plaidPaths });
      return { category };
    },
  },
  {
    name: "delete_category",
    description: "Delete a category (categories:write). System categories cannot be deleted. Params: categoryId.",
    inputSchema: jsonSchema({ categoryId: z.string().min(1) }),
    parse: () => z.object({ categoryId: z.string().min(1) }),
    run: async (auth, args) => {
      const { categoryId } = args as { categoryId: string };
      await createCategoriesService(getDb()).remove(auth.userId, categoryId);
      return { ok: true, deleted: categoryId };
    },
  },
  {
    name: "trigger_sync",
    description: "Trigger a Plaid sync for all items (sync:run). Manual data is never touched.",
    inputSchema: jsonSchema({}),
    parse: () => z.object({}),
    run: async () => ({ message: "Sync queued (Plaid items only — manual data never touched)." }),
  },
  {
    name: "list_custom_views",
    description:
      "List the custom widgets on the user's tabs (dev:ui). Widgets are declarative JSON cards the app renders natively on the dashboard, budgets, and reports tabs.",
    inputSchema: jsonSchema({ tab: z.enum(["dashboard", "budgets", "reports"]).optional() }),
    parse: () => z.object({ tab: z.enum(["dashboard", "budgets", "reports"]).optional() }),
    run: async (auth, args) => {
      const { tab } = args as { tab?: "dashboard" | "budgets" | "reports" };
      const { createCustomViewsService } = await import("@/server/domain/custom-views");
      const views = await createCustomViewsService(getDb()).list(auth.userId, tab);
      return { views };
    },
  },
  {
    name: "create_custom_view",
    description:
      "Add a widget to a tab (dev:ui). Params: tab (dashboard|budgets|reports), name, widget — a declarative JSON definition: " +
      "{ kind: 'stat', title, valueCents | valueText, sub?, sentiment? } · " +
      "{ kind: 'progress', title, spentCents, limitCents } · " +
      "{ kind: 'list', title, rows: [{ label, valueCents?, hint? }] } · " +
      "{ kind: 'line', title, points: [{ label, value }] } · " +
      "{ kind: 'donut', title, slices: [{ label, valueCents, color? }] }. " +
      "Fetch the numbers with the read tools first; the widget only displays them. Money is integer cents (positive = income, negative = expense).",
    inputSchema: jsonSchema({
      tab: z.enum(["dashboard", "budgets", "reports"]),
      name: z.string().min(1),
      widget: z.record(z.string(), z.unknown()),
    }),
    parse: () =>
      z.object({
        tab: z.enum(["dashboard", "budgets", "reports"]),
        name: z.string().min(1),
        widget: z.record(z.string(), z.unknown()),
      }),
    run: async (auth, args) => {
      const { tab, name, widget } = args as { tab: "dashboard" | "budgets" | "reports"; name: string; widget: unknown };
      const { createCustomViewsService } = await import("@/server/domain/custom-views");
      const view = await createCustomViewsService(getDb()).create(auth.userId, auth.token.id, { tab, name, widget });
      return { view, note: "The widget now renders on the user's " + tab + " tab. They can remove it anytime." };
    },
  },
  {
    name: "update_custom_view",
    description: "Update a widget's definition, name, position, or enabled state (dev:ui). Params: viewId + any of name, widget, position, enabled.",
    inputSchema: jsonSchema({
      viewId: z.string().min(1),
      name: z.string().min(1).optional(),
      widget: z.record(z.string(), z.unknown()).optional(),
      position: z.number().int().optional(),
      enabled: z.boolean().optional(),
    }),
    parse: () =>
      z.object({
        viewId: z.string().min(1),
        name: z.string().min(1).optional(),
        widget: z.record(z.string(), z.unknown()).optional(),
        position: z.number().int().optional(),
        enabled: z.boolean().optional(),
      }),
    run: async (auth, args) => {
      const { viewId, name, widget, position, enabled } = args as {
        viewId: string;
        name?: string;
        widget?: unknown;
        position?: number;
        enabled?: boolean;
      };
      const { createCustomViewsService } = await import("@/server/domain/custom-views");
      const view = await createCustomViewsService(getDb()).update(auth.userId, viewId, { name, widget, position, enabled });
      return { view };
    },
  },
  {
    name: "delete_custom_view",
    description: "Remove a widget from a tab (dev:ui). Params: viewId.",
    inputSchema: jsonSchema({ viewId: z.string().min(1) }),
    parse: () => z.object({ viewId: z.string().min(1) }),
    run: async (auth, args) => {
      const { viewId } = args as { viewId: string };
      const { createCustomViewsService } = await import("@/server/domain/custom-views");
      await createCustomViewsService(getDb()).remove(auth.userId, viewId);
      return { ok: true, deleted: viewId };
    },
  },
];

async function requireScopes(auth: McpAuth, toolName: string, scopes: string[]): Promise<void> {
  // Tools like list_accounts/list_transactions are ANY-of (read:banking OR
  // read:investments); the domain query then filters by account type.
  const missing = scopes.length > 0 && !scopes.some((s) => auth.scopes.includes(s)) ? scopes : [];
  if (missing.length > 0) {
    const perms = createPermissionService(getDb());
    for (const s of missing) {
      await perms.requestScope(auth.token.id, s).catch(() => {});
      await perms.logDenied(auth.token.id, s, toolName, "mcp", null).catch(() => {});
    }
    throw new McpUnauthorizedError(missing, auth.token.id, auth.token.name, toolName);
  }
}

export function createOpenFinanceMcpServer(getAuth: () => Promise<McpAuth>): Server {
  const server = new Server({ name: "open-finance", version: "0.0.1" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const auth = await getAuth().catch(() => null);
    const visible = TOOLS.filter(
      (t) => t.name === "get_capabilities" || scopesFor(t.name).length === 0 || scopesFor(t.name).some((s) => auth?.scopes.includes(s))
    );
    return {
      tools: visible.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    const auth = await getAuth();
    try {
      await requireScopes(auth, name, scopesFor(name));
    } catch (e) {
      if (e instanceof McpUnauthorizedError) {
        // Tool-level error result (the SDK's JSON transport finalizes only
        // result messages; errors also read better as isError:true results).
        // The permission request was already upserted + logged above.
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `insufficient_scope: this token (${auth.token.name}) lacks ${e.missing.join(", ")}. A permission request has been created — ask the user to grant it in Settings → Agents, then retry.`,
            },
          ],
        };
      }
      throw e;
    }
    const args = tool.parse().safeParse(request.params.arguments ?? {});
    if (!args.success) {
      throw new McpError(ErrorCode.InvalidParams, args.error.issues.map((i) => i.message).join("; "));
    }
    const result = await tool.run(auth, args.data);
    // Guardrail (D4): the audit log is user-toggleable (default on). Denied
    // calls are always logged (agent-auth); successful tool calls land here.
    try {
      const prefs = await createAgentPrefsService(getDb()).get(auth.userId);
      if (prefs.auditEnabled) {
        const { randomUUID } = await import("node:crypto");
        await getDb().run(
          `INSERT INTO agent_access_log (id, token_id, scope_used, tool, method, params_json, status, latency_ms, created_at)
           VALUES (?, ?, ?, ?, 'mcp', NULL, 200, NULL, ?)`,
          randomUUID(),
          auth.token.id,
          scopesFor(name)[0] ?? null,
          name,
          new Date().toISOString()
        );
      }
    } catch {
      // Audit must never break the tool call.
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });

  return server;
}

export { McpError, ErrorCode };

/** Build auth from a raw bearer token (used by the HTTP transport + CLI). */
export async function authFromToken(raw: string): Promise<McpAuth> {
  const token = await createAgentTokenService(getDb()).authenticate(raw);
  if (!token) throw new Error("invalid token");
  return {
    token,
    scopes: JSON.parse(token.scopes ?? "[]") as string[],
    userId: token.user_id,
    accountIds: token.account_ids ? (JSON.parse(token.account_ids) as string[]) : null,
  };
}
