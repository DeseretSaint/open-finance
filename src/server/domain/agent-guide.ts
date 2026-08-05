/**
 * The agent guide (D10) — a self-contained handbook an agent fetches at
 * connect time. Served at GET /api/agent/guide (Bearer token), mirrored into
 * docs/AGENTS.md, and summarized in agent-manifest.json.
 *
 * Everything here is written FOR the agent: exact endpoints, required scopes,
 * money conventions, the widget recipe, and when to refuse. Keep it accurate —
 * this is the contract the agent plans against.
 */

export interface AgentGuide {
  version: number;
  app: string;
  philosophy: string;
  money: { unit: string; sign: string; example: string };
  appMap: Array<{ tab: string; what: string; endpoints: string[]; readScope: string; writeScope: string | null }>;
  howTo: {
    summarizeFinances: string;
    connectHermes: string;
    createBudget: string;
    categorizeTransactions: string;
    managePlanningItems: string;
    addWidget: string;
  };
  widgetRecipe: {
    scope: string;
    tabs: string[];
    kinds: Record<string, string>;
    rules: string[];
    example: unknown;
  };
  guardrails: Array<{ name: string; what: string; default: string; userCanChange: boolean }>;
  whenToRefuse: string[];
}

export function buildAgentGuide(): AgentGuide {
  return {
    version: 1,
    app: "Open Finance",
    philosophy:
      "Read-only by default. Your effective access is the intersection of your token's scopes and the user's " +
      "current Settings caps, re-checked on every request — a Settings flip applies instantly. Anything outside " +
      "your scope creates a Grant/Deny request in the user's inbox; you cannot grant yourself access. Always " +
      "call get_capabilities first and plan around what it says you have.",
    money: {
      unit: "integer cents everywhere (valueCents, amountCents, spentCents…). $400.00 = 40000.",
      sign: "positive = income (money in), negative = expense (money out). Never flip this.",
      example: "A $42.50 grocery run is amountCents: -4250. A $2,000 paycheck is amountCents: 200000.",
    },
    appMap: [
      {
        tab: "dashboard",
        what: "Total balance, this month's income/spent/net, budget overview, recent transactions.",
        endpoints: ["GET /api/agent/summary", "GET /api/summary"],
        readScope: "read:summary",
        writeScope: "settings:write",
      },
      {
        tab: "accounts",
        what: "Bank/cash/investment accounts with balances (investments included).",
        endpoints: ["GET /api/accounts"],
        readScope: "read:banking / read:investments",
        writeScope: "sync:run",
      },
      {
        tab: "activity",
        what: "Transactions — synced and manual, with categories.",
        endpoints: ["GET /api/transactions", "GET /api/transactions/:id"],
        readScope: "read:banking / read:investments",
        writeScope: "transactions:edit",
      },
      {
        tab: "budgets",
        what: "Budgets with per-period progress; categories.",
        endpoints: ["GET /api/budgets", "GET /api/budgets/:id/progress", "GET /api/categories"],
        readScope: "read:budgets",
        writeScope: "budgets:write / categories:write",
      },
      {
        tab: "plan",
        what: "Bills, debts, goals, and the 12-month projection.",
        endpoints: ["GET /api/planning/bills", "GET /api/planning/debts", "GET /api/planning/goals", "GET /api/planning/projection"],
        readScope: "read:planning",
        writeScope: "planning:write",
      },
      {
        tab: "reports",
        what: "Spending by category, cashflow, net worth, spending trend.",
        endpoints: ["GET /api/reports/spending-by-category", "GET /api/reports/cashflow", "GET /api/reports/net-worth"],
        readScope: "read:reports",
        writeScope: null,
      },
      {
        tab: "agents",
        what: "Agent tokens, permission inbox, audit log. Manage via the UI; your own capabilities via the API.",
        endpoints: ["GET /api/agent/capabilities", "GET /api/agent/guide"],
        readScope: "(none — always available)",
        writeScope: null,
      },
      {
        tab: "settings",
        what: "User preferences. The agent can read a subset and update allowed fields only.",
        endpoints: ["GET /api/settings", "PUT /api/settings"],
        readScope: "read:summary",
        writeScope: "settings:write",
      },
    ],
    howTo: {
      summarizeFinances:
        "Call get_financial_summary (one call: balances + month totals + budgets + recent transactions). " +
        "For anything deeper, list_accounts / list_transactions / get_spending_by_category / get_net_worth.",
      connectHermes:
        "Hermes is an external orchestrator, not a provider credential stored in the app. Run Hermes on the user's hub/Mac, configure its own model provider there, and connect it to this app's /mcp endpoint with a scoped Open Finance bearer token. Prefer a private Tailscale URL; never put provider API keys in the phone APK or Open Finance database.",
      createBudget:
        "1) list_categories → pick category ids (or create_category first). " +
        "2) create_budget { name, amountCents, categoryIds } — cents! " +
        "3) Confirm with get_budget_progress. Renaming/limits: update_budget; removal: delete_budget " +
        "(destructive — the user may be asked to confirm first).",
      categorizeTransactions:
        "Only when get_capabilities shows access.activityWrite = true. Then list_uncategorized_transactions " +
        "(respect access.categorizeBacklogMonths — the window the user chose) and set_transaction_category on " +
        "the ones you are CONFIDENT about. Leave ambiguous ones for the user — never guess on gray-area charges.",
      managePlanningItems:
        "upsert_planning_item { kind: 'bill'|'debt'|'goal', name, ...fields }. Bills: amountCents, frequency, " +
        "dueDay/nextDueDate. Debts: principalCents, aprBps, minPaymentCents. Goals: targetCents, targetDate, currentCents.",
      addWidget:
        "Build a small, glanceable card from data you fetched with the read tools, then create_custom_view. " +
        "Keep it honest: the numbers in the widget must come from real API responses, not estimates. " +
        "See widgetRecipe for the exact JSON shapes.",
    },
    widgetRecipe: {
      scope: "dev:ui (ask the user to grant it — it is never in the default presets)",
      tabs: ["dashboard", "budgets", "reports"],
      kinds: {
        stat: "{ kind:'stat', title, valueCents | valueText, sub?, sentiment?: 'good'|'bad'|'neutral' }",
        progress: "{ kind:'progress', title, spentCents, limitCents }",
        list: "{ kind:'list', title, rows: [{ label, valueCents?, hint? }] (max 10 rows) }",
        line: "{ kind:'line', title, points: [{ label, value }] (2–60 points; value is a plain number, e.g. dollars) }",
        donut: "{ kind:'donut', title, slices: [{ label, valueCents, color? }] (max 12; color optional #rrggbb — defaults harmonize with the app) }",
      },
      rules: [
        "JSON only — no HTML, no JS, no URLs. The app renders it with its own components and design tokens, so it looks native.",
        "Every number must come from a real API response in this session.",
        "One idea per widget. Titles ≤ 60 chars, plain language.",
        "Names are unique per tab — update an existing widget instead of recreating it.",
        "The user can remove any widget inline; never take that personally and never re-add one they removed.",
      ],
      example: {
        tab: "dashboard",
        name: "spending-this-month",
        widget: {
          kind: "donut",
          title: "Spending by category — this month",
          slices: [
            { label: "Groceries", valueCents: 41205 },
            { label: "Dining", valueCents: 18840 },
            { label: "Transport", valueCents: 9600 },
          ],
        },
      },
    },
    guardrails: [
      { name: "Read-only by default", what: "Tokens start with read scopes only; writes are opt-in per tab.", default: "on", userCanChange: true },
      { name: "Permission requests", what: "Out-of-scope attempts ask the user (Grant/Deny inbox). Reads within the user's caps can be auto-approved if they enable it.", default: "ask", userCanChange: true },
      { name: "Audit log", what: "Every one of your calls is logged with tool, scope and status.", default: "on", userCanChange: true },
      { name: "Write confirmation for destructive actions", what: "Deleting budgets, categories or planning items may require the user's explicit Grant first.", default: "on", userCanChange: true },
      { name: "No account deletion", what: "There is no scope that deletes accounts. Not removable.", default: "always", userCanChange: false },
      { name: "No money movement", what: "Open Finance has no payment rails — you can never move money. Structural.", default: "always", userCanChange: false },
      { name: "Categorize backlog window", what: "Auto-categorization reaches back only as far as the user chose (1/3/6/12 months).", default: "1 month", userCanChange: true },
      { name: "Token expiry", what: "Tokens expire on the date the user set; an expired token just stops working.", default: "set at creation", userCanChange: true },
    ],
    whenToRefuse: [
      "Never claim to have moved, sent, or invested money — the app cannot; say so plainly.",
      "Never attempt to edit the app's code or suggest MCP can — UI changes happen as widgets (dev:ui) only. " +
        'If the user wants a whole new tab or feature, say: "That needs a code change — the repo is ' +
        'github.com/DeseretSaint/open-finance — meanwhile I can add it as a widget to your dashboard."',
      "Never categorize gray-area transactions when smart categorization is on — confidence only.",
      "Never retry a denied permission in a loop — ask the user once, then wait for the Grant.",
    ],
  };
}
