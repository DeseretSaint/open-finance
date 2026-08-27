import { ALL_SCOPES } from "@/server/authz/tokens";

/**
 * Route registry — the enforcement truth (master plan Appendix J.2).
 * Every agent-accessible endpoint maps to its required scopes. The
 * registry-completeness test (tests/registry.test.ts) fails if any scope has
 * zero routes, any route is unmapped, or an entry names an unknown scope.
 */

export interface RouteEntry {
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  path: string;
  scopes: string[];
  /** Not agent-accessible (user session only). */
  userOnly?: boolean;
}

export const AGENT_ROUTES: RouteEntry[] = [
  { method: "GET", path: "/api/agent/summary", scopes: ["read:summary"] },
  { method: "GET", path: "/api/accounts", scopes: ["read:banking", "read:investments"] },
  { method: "GET", path: "/api/accounts/:id", scopes: ["read:banking", "read:investments"] },
  { method: "GET", path: "/api/transactions", scopes: ["read:banking", "read:investments"] },
  { method: "GET", path: "/api/transactions/:id", scopes: ["read:banking", "read:investments"] },
  { method: "PATCH", path: "/api/transactions/:id", scopes: ["transactions:edit"] },
  { method: "GET", path: "/api/budgets", scopes: ["read:budgets"] },
  { method: "GET", path: "/api/budgets/:id/progress", scopes: ["read:budgets"] },
  { method: "GET", path: "/api/categories", scopes: ["read:budgets"] },
  { method: "POST", path: "/api/budgets", scopes: ["budgets:write"] },
  { method: "PATCH", path: "/api/budgets/:id", scopes: ["budgets:write"] },
  { method: "DELETE", path: "/api/budgets/:id", scopes: ["budgets:write"] },
  { method: "GET", path: "/api/planning/bills", scopes: ["read:planning"] },
  { method: "GET", path: "/api/planning/debts", scopes: ["read:planning"] },
  { method: "GET", path: "/api/planning/goals", scopes: ["read:planning"] },
  { method: "GET", path: "/api/planning/digest", scopes: ["read:planning"] },
  { method: "GET", path: "/api/planning/projection", scopes: ["read:planning"] },
  { method: "POST", path: "/api/planning/bills", scopes: ["planning:write"] },
  { method: "PATCH", path: "/api/planning/bills/:id", scopes: ["planning:write"] },
  { method: "DELETE", path: "/api/planning/bills/:id", scopes: ["planning:write"] },
  { method: "POST", path: "/api/planning/bills/:id/pay", scopes: ["planning:write"] },
  { method: "POST", path: "/api/planning/debts", scopes: ["planning:write"] },
  { method: "PATCH", path: "/api/planning/debts/:id", scopes: ["planning:write"] },
  { method: "DELETE", path: "/api/planning/debts/:id", scopes: ["planning:write"] },
  { method: "POST", path: "/api/planning/goals", scopes: ["planning:write"] },
  { method: "PATCH", path: "/api/planning/goals/:id", scopes: ["planning:write"] },
  { method: "DELETE", path: "/api/planning/goals/:id", scopes: ["planning:write"] },
  { method: "POST", path: "/api/categories", scopes: ["categories:write"] },
  { method: "PATCH", path: "/api/categories/:id", scopes: ["categories:write"] },
  { method: "DELETE", path: "/api/categories/:id", scopes: ["categories:write"] },
  { method: "GET", path: "/api/reports/spending-by-category", scopes: ["read:reports"] },
  { method: "GET", path: "/api/reports/cashflow", scopes: ["read:reports"] },
  { method: "GET", path: "/api/reports/net-worth", scopes: ["read:reports"] },
  { method: "GET", path: "/api/reports/net-worth/trend", scopes: ["read:reports"] },
  { method: "GET", path: "/api/reports/spending-trend", scopes: ["read:reports"] },
  { method: "POST", path: "/api/transactions/sync", scopes: ["sync:run"] },
  { method: "GET", path: "/api/custom-views", scopes: ["dev:ui"] },
  { method: "POST", path: "/api/custom-views", scopes: ["dev:ui"] },
  { method: "PATCH", path: "/api/custom-views/:id", scopes: ["dev:ui"] },
  { method: "DELETE", path: "/api/custom-views/:id", scopes: ["dev:ui"] },
  // Always available
  { method: "GET", path: "/api/agent/capabilities", scopes: [] },
  { method: "GET", path: "/api/agent/events", scopes: [] },
  { method: "GET", path: "/api/agent/guide", scopes: [] },
  { method: "GET", path: "/api/agent/manual", scopes: [] },
];

export const USER_ONLY_ROUTES: string[] = [
  "/api/auth/*",
  "/api/health",
  "/api/hub/*",
  "/api/pairing/*",
  "/api/agents/detect",
  "/api/export",
  "/api/backup",
  "/api/backup/restore",
  "/api/accounts(POST/PATCH/DELETE)",
  "/api/transactions(POST/DELETE)",
];

/**
 * Every scope must have ≥1 agent route (registry-completeness, J.5) — except
 * cap-only scopes that the Settings UI grants but are not yet wired to an agent
 * API. `settings:write` is exactly that: a user can grant it to a token, but
 * there is no `/api/settings` agent route, so it intentionally routes nothing
 * (see the Needs Keaton queue — implement a real subset API or drop the scope).
 */
const CAP_ONLY_SCOPES = new Set<string>(["settings:write"]);

export function scopesWithRoutes(): string[] {
  const covered = new Set<string>();
  for (const r of AGENT_ROUTES) for (const s of r.scopes) covered.add(s);
  return ALL_SCOPES.filter((s) => !covered.has(s) && !CAP_ONLY_SCOPES.has(s));
}

/** MCP tool registry (J.3): tool → scopes → backing endpoint. */
export interface McpToolEntry {
  tool: string;
  scopes: string[];
  endpoint: string;
  write?: boolean;
}

export const MCP_TOOLS: McpToolEntry[] = [
  { tool: "get_financial_summary", scopes: ["read:summary"], endpoint: "/api/agent/summary" },
  { tool: "get_capabilities", scopes: [], endpoint: "/api/agent/capabilities" },
  { tool: "read_agent_manual", scopes: [], endpoint: "/api/agent/manual" },
  { tool: "list_accounts", scopes: ["read:banking", "read:investments"], endpoint: "/api/accounts" },
  { tool: "list_transactions", scopes: ["read:banking", "read:investments"], endpoint: "/api/transactions" },
  { tool: "search_transactions", scopes: ["read:banking", "read:investments"], endpoint: "/api/transactions" },
  { tool: "get_transaction", scopes: ["read:banking", "read:investments"], endpoint: "/api/transactions/:id" },
  { tool: "get_spending_by_category", scopes: ["read:reports"], endpoint: "/api/reports/spending-by-category" },
  { tool: "get_cashflow", scopes: ["read:reports"], endpoint: "/api/reports/cashflow" },
  { tool: "get_net_worth", scopes: ["read:reports"], endpoint: "/api/reports/net-worth" },
  { tool: "get_budgets", scopes: ["read:budgets"], endpoint: "/api/budgets" },
  { tool: "get_budget_progress", scopes: ["read:budgets"], endpoint: "/api/budgets/:id/progress" },
  { tool: "list_categories", scopes: ["read:budgets"], endpoint: "/api/categories" },
  { tool: "get_planning_items", scopes: ["read:planning"], endpoint: "/api/planning/*" },
  { tool: "trigger_sync", scopes: ["sync:run"], endpoint: "/api/transactions/sync", write: true },
  { tool: "set_transaction_category", scopes: ["transactions:edit"], endpoint: "PATCH /api/transactions/:id", write: true },
  { tool: "create_budget", scopes: ["budgets:write"], endpoint: "POST /api/budgets", write: true },
  { tool: "update_budget", scopes: ["budgets:write"], endpoint: "PATCH /api/budgets/:id", write: true },
  { tool: "delete_budget", scopes: ["budgets:write"], endpoint: "DELETE /api/budgets/:id", write: true },
  { tool: "upsert_planning_item", scopes: ["planning:write"], endpoint: "/api/planning/*", write: true },
  { tool: "create_category", scopes: ["categories:write"], endpoint: "POST /api/categories", write: true },
  { tool: "update_category", scopes: ["categories:write"], endpoint: "PATCH /api/categories/:id", write: true },
  { tool: "delete_category", scopes: ["categories:write"], endpoint: "DELETE /api/categories/:id", write: true },
  { tool: "list_custom_views", scopes: ["dev:ui"], endpoint: "/api/custom-views" },
  { tool: "create_custom_view", scopes: ["dev:ui"], endpoint: "POST /api/custom-views", write: true },
  { tool: "update_custom_view", scopes: ["dev:ui"], endpoint: "PATCH /api/custom-views/:id", write: true },
  { tool: "delete_custom_view", scopes: ["dev:ui"], endpoint: "DELETE /api/custom-views/:id", write: true },
];

/** Every MCP tool must map to a scope + endpoint (J.5). */
export function mcpToolsWithoutScopeOrEndpoint(): McpToolEntry[] {
  return MCP_TOOLS.filter((t) => t.scopes.length === 0 && t.tool !== "get_capabilities");
}
