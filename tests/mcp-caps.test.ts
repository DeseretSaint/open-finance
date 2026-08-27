import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getSqliteDb } from "@/server/db/adapter";
import { createAgentTokenService } from "@/server/authz/tokens";
import { createAgentPrefsService } from "@/server/domain/agent-prefs";
import { authFromToken, createOpenFinanceMcpServer } from "@/server/mcp/server";
import { seedUser } from "./helpers";

/**
 * MCP transport must enforce the SAME access boundary as REST routes:
 * effective scopes = token scopes ∩ the user's current Settings caps
 * (agent-auth.effectiveScopes). Before this fix, authFromToken returned the
 * raw token scopes — so reducing the user's Settings caps did not apply to
 * MCP calls until the token itself was revoked. Verified over the real MCP
 * server + in-memory transport (practice-not-theory).
 */

function migrationFiles(): string[] {
  const dir = path.join(process.cwd(), "migrations");
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
}

beforeAll(() => {
  const db = getSqliteDb();
  for (const sql of migrationFiles()) db.exec(sql);
});

afterAll(() => {
  getSqliteDb().close();
});

async function connectMcp(rawToken: string): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createOpenFinanceMcpServer(() => authFromToken(rawToken));
  await server.connect(serverTransport);
  const client = new Client({ name: "caps-test", version: "1.0" });
  await client.connect(clientTransport);
  return client;
}

describe("MCP transport enforces user Settings caps", () => {
  it("authFromToken intersects token scopes with the user's caps", async () => {
    const db = getSqliteDb();
    const user = await seedUser(db, "mcp-caps-1");
    const { token } = await createAgentTokenService(db).create(user.id, {
      name: "wide-token",
      preset: "custom",
      scopes: ["read:summary", "read:budgets"],
    });

    // User caps allow only the activity tab (read:banking) — budgets off.
    await createAgentPrefsService(db).update(user.id, { tabs: ["activity"], tabsWrite: [] });

    const auth = await authFromToken(token);
    expect(auth.scopes).not.toContain("read:budgets");
    expect(auth.scopes).not.toContain("read:summary");
  });

  it("a capped token gets insufficient_scope over MCP, then works after the user widens caps", async () => {
    const db = getSqliteDb();
    const user = await seedUser(db, "mcp-caps-2");
    const { token } = await createAgentTokenService(db).create(user.id, {
      name: "budget-token",
      preset: "custom",
      scopes: ["read:budgets"],
    });
    await createAgentPrefsService(db).update(user.id, { tabs: ["activity"], tabsWrite: [] });

    const client = await connectMcp(token);

    // Denied: the token has read:budgets but the user's caps don't.
    const denied = await client.callTool({ name: "get_budgets", arguments: {} });
    expect(denied.isError).toBe(true);
    const deniedText = (denied.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? "";
    expect(deniedText).toContain("insufficient_scope");

    // tools/list hides the tool too (visibility uses effective scopes).
    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name)).not.toContain("get_budgets");

    // User enables the budgets tab in Settings → same token works immediately.
    await createAgentPrefsService(db).update(user.id, { tabs: ["activity", "budgets"] });
    const granted = await client.callTool({ name: "get_budgets", arguments: {} });
    expect(granted.isError).toBeFalsy();
    const grantedText = (granted.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? "";
    expect(grantedText).toContain("budgets");

    await client.close();
  });

  it("a follow_settings token tracks the user's caps in both directions", async () => {
    const db = getSqliteDb();
    const user = await seedUser(db, "mcp-caps-3");
    // follow_settings: scopes come from caps at creation (budgets on now)…
    await createAgentPrefsService(db).update(user.id, { tabs: ["budgets"], tabsWrite: [] });
    const { token } = await createAgentTokenService(db).create(user.id, {
      name: "hermes-token",
      preset: "custom",
      followSettings: true,
    });

    let auth = await authFromToken(token);
    expect(auth.scopes).toContain("read:budgets");

    // …and shrink when the user removes the tab (no token regeneration).
    await createAgentPrefsService(db).update(user.id, { tabs: ["activity"] });
    auth = await authFromToken(token);
    expect(auth.scopes).not.toContain("read:budgets");
  });
});
