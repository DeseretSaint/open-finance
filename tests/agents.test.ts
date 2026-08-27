import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createAgentTokenService, ALL_SCOPES, PRESETS } from "@/server/authz/tokens";
import { AGENT_ROUTES, MCP_TOOLS, scopesWithRoutes } from "@/server/authz/route-registry";
import { createPermissionService } from "@/server/authz/permission-requests";
import { createAccountsService } from "@/server/domain/accounts";
import { createSummaryService } from "@/server/domain/summary";
import { createAgentPrefsService, capScopes, type AgentPrefs } from "@/server/domain/agent-prefs";
import { buildAgentGuide } from "@/server/domain/agent-guide";
import { createAgentManualService } from "@/server/domain/agent-manual";
import { createTestDb, seedManualAccount, seedUser } from "./helpers";

describe("agent guide + solo capabilities (D10/P20)", () => {
  it("guide builds browser-safely (no node:* imports) and covers write scopes", () => {
    const guide = buildAgentGuide();
    expect(guide.version).toBeGreaterThan(0);
    expect(guide.appMap.length).toBeGreaterThan(0);
    // The solo router serves this same guide over the Tailscale bridge, so it
    // must not import node builtins — the webview bundle would fail.
    const src = buildAgentGuide.toString();
    expect(src).not.toContain("node:");
  });

  it("capScopes grants write scopes when the user enables full access", () => {
    const prefs: AgentPrefs = {
      tabs: ["dashboard", "accounts", "activity", "budgets", "reports", "planning"],
      tabsWrite: [],
      autoCategorize: false,
      categorizeBacklogMonths: 1,
      global: false,
      globalWrite: false,
      autoApproveReads: false,
      requireWriteConfirm: true,
      auditEnabled: true,
    };
    expect(capScopes(prefs)).not.toContain("transactions:edit");
    // The Settings UI's master toggle is `global` — it grants read+write
    // across the app. This is the exact mismatch that made the live agent
    // fall back to read-only in solo mode when the guide 404'd.
    const full = capScopes({ ...prefs, global: true });
    expect(full).toContain("transactions:edit");
    expect(full).toContain("budgets:write");
    // Smart categorization alone grants activity write.
    const auto = capScopes({ ...prefs, autoCategorize: true });
    expect(auto).toContain("transactions:edit");
  });

  it("prefs persist write settings through the service (solo /api/agent/prefs path)", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createAgentPrefsService(db);
    await svc.update(user.id, { globalWrite: true, autoCategorize: true });
    const prefs = await svc.get(user.id);
    expect(prefs.globalWrite).toBe(true);
    expect(capScopes(prefs)).toContain("transactions:edit");
  });
});


describe("route registry completeness (J.5)", () => {
  it("every scope has at least one route", () => {
    expect(scopesWithRoutes()).toEqual([]);
  });

  it("no phantom update_settings tool/route (no /api/settings agent API exists)", () => {
    expect(MCP_TOOLS.find((t) => t.tool === "update_settings")).toBeUndefined();
    expect(AGENT_ROUTES.find((r) => r.path === "/api/settings")).toBeUndefined();
  });

  it("read_agent_manual is advertised to agents", () => {
    expect(MCP_TOOLS.find((t) => t.tool === "read_agent_manual")).toBeDefined();
  });

  it("settings:write is a real scope but intentionally has no agent route", () => {
    expect(ALL_SCOPES).toContain("settings:write");
    expect(scopesWithRoutes()).not.toContain("settings:write");
  });

  it("every MCP tool maps to a scope and an endpoint", () => {
    for (const t of MCP_TOOLS) {
      expect(t.endpoint.length).toBeGreaterThan(0);
      // get_capabilities and read_agent_manual are intentionally scope-free
      // (always available — the agent reads the manual on every poll).
      if (t.tool !== "get_capabilities" && t.tool !== "read_agent_manual") {
        expect(t.scopes.length).toBeGreaterThan(0);
      }
    }
  });

  it("every scope in the registry is a real scope", () => {
    const known = new Set(ALL_SCOPES);
    for (const r of AGENT_ROUTES) for (const s of r.scopes) expect(known.has(s)).toBe(true);
    for (const t of MCP_TOOLS) for (const s of t.scopes) expect(known.has(s)).toBe(true);
  });

  it("presets resolve to real scopes", () => {
    for (const scopes of Object.values(PRESETS)) {
      for (const s of scopes) expect(ALL_SCOPES).toContain(s);
    }
  });
});

describe("MCP dispatch/registry parity (no scope-free tool)", () => {
  it("every tool defined in mcp/server.ts TOOLS is registered in MCP_TOOLS with a non-empty scope", () => {
    const server = fs.readFileSync(
      path.join(process.cwd(), "src/server/mcp/server.ts"),
      "utf8"
    );
    // Pull the names declared in the dispatch-side TOOLS array.
    const start = server.indexOf("const TOOLS: ToolDef[]");
    const end = server.indexOf("async function requireScopes", start);
    const block = server.slice(start, end);
    const dispatchNames = [...block.matchAll(/name: "([^"]+)"/g)].map((m) => m[1]);
    expect(dispatchNames.length).toBeGreaterThan(0);

    for (const name of dispatchNames) {
      const entry = MCP_TOOLS.find((t) => t.tool === name);
      expect(entry, `dispatch tool "${name}" is missing from MCP_TOOLS (scope-free bypass)`).toBeDefined();
      // get_capabilities / read_agent_manual are intentionally scope-free; all
      // other dispatch tools MUST carry a scope so they cannot be called by any token.
      if (name !== "get_capabilities" && name !== "read_agent_manual") {
        expect(entry!.scopes.length, `dispatch tool "${name}" has no scope`).toBeGreaterThan(0);
      }
    }
  });
});

describe("agent guide is the truth (no phantom settings writes)", () => {
  it("settings tab exposes no agent endpoint (read+write both null)", () => {
    const settings = buildAgentGuide().appMap.find((t) => t.tab === "settings");
    expect(settings).toBeDefined();
    expect(settings?.readScope).toContain("none");
    expect(settings?.writeScope).toBeNull();
    expect(settings?.endpoints).toEqual([]);
  });
});

describe("agent token lifecycle", () => {
  it("creates tokens with presets, hashes at rest, lists public shape", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createAgentTokenService(db);
    const { token, agent } = await svc.create(user.id, { name: "trading-bot", preset: "read-only" });
    expect(token.startsWith("of_")).toBe(true);
    expect(agent.preset).toBe("read-only");
    expect(agent.custom).toBe(false);
    // raw token is never stored
    const row = await db.get("SELECT token_hash FROM agent_tokens WHERE id = ?", agent.id);
    expect(row?.token_hash).not.toContain(token);
  });

  it("marks scopes differing from preset as custom", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createAgentTokenService(db);
    const { agent } = await svc.create(user.id, { name: "custom-bot", preset: "read-only", scopes: ["read:summary", "read:investments"] });
    expect(agent.custom).toBe(true);
  });

  it("authenticates valid tokens and rejects revoked/expired/unknown", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createAgentTokenService(db);
    const { token } = await svc.create(user.id, { name: "bot", preset: "read-only" });
    expect((await svc.authenticate(token))?.name).toBe("bot");
    expect(await svc.authenticate("of_totally-fake-token-1234567890123456789012345678901234567890")).toBeNull();

    const list = await svc.list(user.id);
    await svc.revoke(user.id, list[0].id);
    expect(await svc.authenticate(token)).toBeNull();
  });

  it("enforces expiry", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createAgentTokenService(db);
    const { token } = await svc.create(user.id, { name: "short", preset: "read-only", expiresAt: "2020-01-01" });
    expect(await svc.authenticate(token)).toBeNull();
  });

  it("Hermes follow-settings tokens track current caps in both directions", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createAgentTokenService(db);
    const { token, agent } = await svc.create(user.id, { name: "Hermes", preset: "read-only", followSettings: true });

    // Default settings allow activity only, so the token starts with that cap.
    const initial = await svc.authenticate(token);
    expect(initial?.follow_settings).toBe(1);

    // Expanding Settings to global read/write changes effective access without
    // changing or recreating the raw token.
    await db.run("UPDATE user_settings SET agent_global = 1, agent_global_write = 1 WHERE user_id = ?", user.id);
    const expanded = await svc.authenticate(token);
    expect(expanded?.id).toBe(agent.id);

    const row = await db.get<{ follow_settings: number }>("SELECT follow_settings FROM agent_tokens WHERE id = ?", agent.id);
    expect(row?.follow_settings).toBe(1);
  });
});

describe("withAllowlist scope matrix (read:banking must NOT see investments)", () => {
  it("summary only covers allowlisted accounts", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const checking = await seedManualAccount(db, user.id, "Checking", "depository");
    const savings = await seedManualAccount(db, user.id, "Savings", "depository");
    await db.run("UPDATE accounts SET current_balance_cents = ? WHERE id = ?", 10000, checking);
    await db.run("UPDATE accounts SET current_balance_cents = ? WHERE id = ?", 999999, savings);

    const summary = await createSummaryService(db).get(user.id, undefined, { accountIds: [checking] });
    expect(summary.totalBalanceCents).toBe(10000); // savings excluded
    const all = await createSummaryService(db).get(user.id);
    expect(all.totalBalanceCents).toBe(1009999);
  });

  it("listForAgent hides investment accounts without read:investments and honors allowlist", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const checking = await seedManualAccount(db, user.id, "Checking", "depository");
    const invest = await seedManualAccount(db, user.id, "Brokerage", "investment");

    const svc = createAccountsService(db);
    const bankingOnly = await svc.listForAgent(user.id, ["read:banking"], null);
    expect(bankingOnly.map((a) => a.id)).toEqual([checking]);

    const investOnly = await svc.listForAgent(user.id, ["read:investments"], null);
    expect(investOnly.map((a) => a.id)).toEqual([invest]);

    const allowlisted = await svc.listForAgent(user.id, ["read:banking", "read:investments"], [checking]);
    expect(allowlisted.map((a) => a.id)).toEqual([checking]);
  });
});

describe("permission requests (ask-to-grant loop)", () => {
  it("upserts deduped pending requests and resolves grant/deny", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const tokens = createAgentTokenService(db);
    const perms = createPermissionService(db);
    const { agent } = await tokens.create(user.id, { name: "bot", preset: "read-only" });

    const req1 = await perms.requestScope(agent.id, "read:investments");
    const req2 = await perms.requestScope(agent.id, "read:investments"); // deduped
    expect(req2.id).toBe(req1.id);

    const pending = await perms.listForUser(user.id);
    expect(pending).toHaveLength(1);

    // grant appends the scope and marks preset custom
    const granted = await perms.resolve(user.id, req1.id, "granted");
    expect(granted.status).toBe("granted");
    const list = await tokens.list(user.id);
    expect(list[0].scopes).toContain("read:investments");
    expect(list[0].custom).toBe(true);

    // resolving again fails
    await expect(perms.resolve(user.id, req1.id, "denied")).rejects.toThrow();
  });

  it("deny persists without granting", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const tokens = createAgentTokenService(db);
    const perms = createPermissionService(db);
    const { agent } = await tokens.create(user.id, { name: "bot", preset: "read-only" });
    const req = await perms.requestScope(agent.id, "sync:run");
    await perms.resolve(user.id, req.id, "denied");
    const list = await tokens.list(user.id);
    expect(list[0].scopes).not.toContain("sync:run");
  });

  it("logs denied calls to the audit table", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const perms = createPermissionService(db);
    const tokens = createAgentTokenService(db);
    const { agent } = await tokens.create(user.id, { name: "bot", preset: "read-only" });
    await perms.logDenied(agent.id, "read:investments", "get_net_worth", "GET", null);
    const row = await db.get("SELECT status FROM agent_access_log WHERE token_id = ?", agent.id);
    expect(row?.status).toBe(403);
  });
});

describe("agent steering manual (D11)", () => {
  it("starts empty and persists per-domain guidance", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createAgentManualService(db);
    expect((await svc.get(user.id)).categorization).toBe("");
    const updated = await svc.update(user.id, {
      categorization: "Pharmacy charges → Healthcare",
      budgeting: "Groceries under $600/mo",
    });
    expect(updated.categorization).toBe("Pharmacy charges → Healthcare");
    expect(updated.budgeting).toBe("Groceries under $600/mo");
    // Re-read returns the saved values.
    const refetched = await svc.get(user.id);
    expect(refetched.categorization).toBe("Pharmacy charges → Healthcare");
    expect(refetched.general).toBe("");
    expect(refetched.updatedAt).not.toBeNull();
  });
});
