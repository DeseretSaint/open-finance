"use client";

/**
 * Solo router (P8b) — the in-process API surface for the standalone webview.
 *
 * When the APK runs in solo mode (no hub), the UI's `/api/*` calls must be
 * answered without a server. This router mirrors the route layer: it parses
 * the same zod schemas, calls the SAME domain services (constructed with a
 * CapSqliteDb over the device's local SQLite), and returns the SAME
 * `{ data }` / `{ error: { code, message } }` envelope the HTTP routes use —
 * so every api-client call site works unchanged.
 *
 * The "session" in solo mode is the device user created by solo-bootstrap;
 * there is no cookie, no CSRF (nothing cross-origin), and no rate limiting
 * (local device). Plaid calls route to the native PlaidProxy plugin.
 */

import { ApiError, apiErrors } from "@/lib/api-error";
import type { Db } from "@/server/db/types";
import { CapSqliteDb } from "@/server/db/cap-sqlite";
import { registerDbProvider } from "@/server/db/registry";
import { SOLO_MIGRATIONS } from "@/server/db/migrations-bundle";
import { createSoloBootstrapService } from "@/server/domain/solo-bootstrap";
import { createDeviceLockService } from "@/server/domain/device-lock";
import { createAccountsService } from "@/server/domain/accounts";
import { createCategoriesService } from "@/server/domain/categories";
import { createTransactionsService } from "@/server/domain/transactions";
import { createBudgetsService } from "@/server/domain/budgets";
import { createSummaryService } from "@/server/domain/summary";
import { createReportsService } from "@/server/domain/reports";
import { createPlanningService } from "@/server/domain/planning";
import { createProjectionService } from "@/server/domain/projection";
import { seedSoloDemo } from "@/lib/solo-demo-seed";
import { createOnboardingService } from "@/server/domain/onboarding";

export interface SoloRequest {
  method: string;
  path: string; // pathname only, no query string
  query: URLSearchParams;
  body: unknown;
}

export interface SoloResponse {
  status: number;
  data: unknown;
}

let _db: CapSqliteDb | null = null;

/** Lazily created singleton: local SQLite + full schema. */
export async function getSoloDb(): Promise<CapSqliteDb> {
  if (!_db) {
    _db = new CapSqliteDb();
    await _db.migrate(SOLO_MIGRATIONS);
    // Domain services call getDb() from the registry — point it at the device DB.
    registerDbProvider(() => _db as unknown as Db);
  }
  return _db;
}

/** For tests: reset the singleton between cases. */
export function resetSoloDb(): void {
  _db = null;
}

function toApiError(e: unknown): { status: number; code: string; message: string } {
  if (e instanceof ApiError) {
    return { status: e.status, code: e.code, message: e.message };
  }
  // Local-only app: surface the real message so on-device debugging is
  // possible (the server route layer keeps the generic "Something went
  // wrong." for remote clients; here there is no remote client).
  const msg = e instanceof Error ? e.message : String(e);
  console.error("Unhandled solo router error:", e);
  return { status: 500, code: "internal", message: msg || "Something went wrong." };
}

function ok(data: unknown, status = 200): SoloResponse {
  return { status, data };
}

function notFound(): SoloResponse {
  return { status: 404, data: { error: { code: "not_found", message: "Route not found in solo mode." } } };
}

/** All services are constructed per-request against the shared solo Db. */
async function handlers(db: Db) {
  const solo = createSoloBootstrapService(db);
  const deviceLock = createDeviceLockService(db);
  const accounts = createAccountsService(db);
  const categories = createCategoriesService(db);
  const transactions = createTransactionsService(db);
  const budgets = createBudgetsService(db);
  const summary = createSummaryService(db);
  const reports = createReportsService(db);
  const planning = createPlanningService(db);
  const projection = createProjectionService(db);
  const onboarding = createOnboardingService(db);

  async function deviceUserId(): Promise<string> {
    const user = await solo.getDeviceUser();
    if (!user) throw new ApiError(401, "unauthorized", "Set up this device first.");
    return user.id;
  }

  return {
    solo,
    deviceLock,
    accounts,
    categories,
    transactions,
    budgets,
    summary,
    reports,
    planning,
    projection,
    onboarding,
    deviceUserId,
  };
}

function parseId(path: string, prefix: string): string {
  const rest = path.slice(prefix.length);
  return rest.replace(/^\//, "").replace(/\/$/, "");
}

/** Dispatch a solo API request. Returns the standard envelope. */
export async function soloDispatch(req: SoloRequest): Promise<SoloResponse> {
  try {
    const db = await getSoloDb();
    const h = await handlers(db);
    const { method, path, query, body } = req;
    const B = body as Record<string, unknown> | undefined;

    // ── Auth / bootstrap ────────────────────────────────────────────────
    if (method === "POST" && path === "/api/auth/register") {
      const result = await h.solo.bootstrap({
        displayName: typeof B?.display_name === "string" ? B.display_name : undefined,
        pin: typeof B?.pin === "string" ? B.pin : undefined,
      });
      return ok(
        {
          user: {
            id: result.user.id,
            username: result.user.username,
            display_name: result.user.display_name,
            email: null,
            is_demo: false,
            created_at: result.user.created_at,
          },
          recoveryCode: result.recoveryCode,
          hasPin: result.hasPin,
        },
        201
      );
    }

    if (method === "GET" && path === "/api/auth/me") {
      const userId = await h.deviceUserId();
      const user = await h.solo.getDeviceUser();
      const row = await db.get<{ is_demo: number }>("SELECT is_demo FROM users WHERE id = ?", userId);
      return ok({
        user: {
          id: userId,
          username: user?.username ?? null,
          display_name: user?.display_name ?? "This phone",
          email: null,
          is_demo: row?.is_demo === 1,
        },
      });
    }

    if (method === "POST" && path === "/api/auth/logout") {
      return ok({ ok: true });
    }

    if (method === "POST" && path === "/api/auth/demo") {
      // Solo demo: bootstrap a throwaway device (no PIN) + seed sample data,
      // mirroring the server demo experience entirely on-device. Demo users
      // skip the onboarding wizard.
      if (!(await h.solo.isBootstrapped())) {
        await h.solo.bootstrap({ displayName: "Demo phone", pin: undefined, isDemo: true });
      }
      const userId = await h.deviceUserId();
      await seedSoloDemo(db, userId);
      await h.onboarding.complete(userId);
      return ok({ ok: true });
    }

    if (method === "POST" && path === "/api/auth/recovery") {
      // Solo recovery: verify code → reset PIN (no password in solo).
      const code = typeof B?.recovery_code === "string" ? B.recovery_code : "";
      if (typeof B?.new_pin === "string") {
        await h.solo.resetPin(code, B.new_pin);
        return ok({ ok: true });
      }
      const valid = await h.solo.verifyRecoveryCode(code);
      return ok({ ok: valid });
    }

    // ── Onboarding (first-run walkthrough) ──────────────────────────────
    if (method === "GET" && path === "/api/onboarding") {
      const userId = await h.deviceUserId();
      return ok(await h.onboarding.get(userId));
    }
    if (method === "POST" && path === "/api/onboarding") {
      const userId = await h.deviceUserId();
      if (B?.action === "reset") {
        return ok(await h.onboarding.reset(userId));
      }
      return ok(await h.onboarding.complete(userId));
    }

    // ── Device lock (PIN) ───────────────────────────────────────────────
    if (method === "GET" && path === "/api/device-lock") {
      const userId = await h.deviceUserId();
      return ok(await h.deviceLock.state(userId));
    }
    if (method === "POST" && path === "/api/device-lock/pin") {
      const userId = await h.deviceUserId();
      const pin = typeof B?.pin === "string" ? B.pin : "";
      await h.deviceLock.setPin(userId, pin);
      return ok({ ok: true });
    }
    if (method === "POST" && path === "/api/device-lock/unlock") {
      const userId = await h.deviceUserId();
      const pin = typeof B?.pin === "string" ? B.pin : "";
      await h.deviceLock.unlock(userId, pin);
      return ok({ ok: true });
    }

    // ── Accounts (manual) ───────────────────────────────────────────────
    if (method === "GET" && path === "/api/accounts") {
      const userId = await h.deviceUserId();
      const rows = await h.accounts.list(userId);
      return ok({ accounts: rows });
    }
    if (method === "POST" && path === "/api/accounts") {
      const userId = await h.deviceUserId();
      const account = await h.accounts.createManual(userId, {
        name: typeof B?.name === "string" ? B.name : "",
        type: typeof B?.type === "string" ? B.type : "depository",
        currentBalanceCents: typeof B?.current_balance_cents === "number" ? B.current_balance_cents : 0,
      });
      return ok({ account }, 201);
    }

    // ── Categories ──────────────────────────────────────────────────────
    if (method === "GET" && path === "/api/categories") {
      const userId = await h.deviceUserId();
      return ok({ categories: await h.categories.list(userId) });
    }
    if (method === "POST" && path === "/api/categories") {
      const userId = await h.deviceUserId();
      const category = await h.categories.create(userId, {
        name: typeof B?.name === "string" ? B.name : "",
        color: typeof B?.color === "string" ? B.color : null,
      });
      return ok({ category }, 201);
    }

    // ── Transactions (manual entry) ─────────────────────────────────────
    if (method === "GET" && path === "/api/transactions") {
      const userId = await h.deviceUserId();
      const filters = {
        accountId: query.get("accountId") ?? undefined,
        from: query.get("from") ?? undefined,
        to: query.get("to") ?? undefined,
        categoryId: query.get("categoryId") ?? undefined,
        q: query.get("q") ?? undefined,
        limit: Number(query.get("limit") ?? 50),
        offset: Number(query.get("offset") ?? 0),
      };
      const result = await h.transactions.list(userId, filters);
      return ok(result);
    }
    if (method === "POST" && path === "/api/transactions") {
      const userId = await h.deviceUserId();
      const transaction = await h.transactions.createManual(userId, {
        accountId: typeof B?.accountId === "string" ? B.accountId : "",
        amountCents: typeof B?.amountCents === "number" ? B.amountCents : 0,
        date: typeof B?.date === "string" ? B.date : "",
        name: typeof B?.name === "string" ? B.name : "",
        userCategoryId: B?.userCategoryId == null ? null : String(B.userCategoryId),
        userNote: B?.userNote == null ? null : String(B.userNote),
      });
      return ok({ transaction }, 201);
    }

    // ── Budgets ─────────────────────────────────────────────────────────
    if (method === "GET" && path === "/api/budgets") {
      const userId = await h.deviceUserId();
      return ok({ budgets: await h.budgets.list(userId, query.get("reference") ?? undefined) });
    }
    if (method === "POST" && path === "/api/budgets") {
      const userId = await h.deviceUserId();
      const budget = await h.budgets.create(userId, {
        name: typeof B?.name === "string" ? B.name : "",
        amountCents: typeof B?.amount_cents === "number" ? B.amount_cents : typeof B?.amountCents === "number" ? B.amountCents : 0,
        period: typeof B?.period === "string" ? B.period : "monthly",
        categoryIds: Array.isArray(B?.category_ids) ? (B.category_ids as string[]) : [],
      });
      return ok({ budget }, 201);
    }

    // ── Summary / reports ───────────────────────────────────────────────
    if (method === "GET" && path === "/api/summary") {
      const userId = await h.deviceUserId();
      return ok({ summary: await h.summary.get(userId) });
    }
    if (method === "GET" && path === "/api/reports/spending-by-category") {
      const userId = await h.deviceUserId();
      const today = new Date().toISOString().slice(0, 10);
      const firstOfMonth = today.slice(0, 8) + "01";
      const result = await h.reports.spendingByCategory(
        userId,
        query.get("from") ?? firstOfMonth,
        query.get("to") ?? today
      );
      return ok(result);
    }
    if (method === "GET" && path === "/api/reports/cashflow") {
      const userId = await h.deviceUserId();
      return ok(await h.reports.cashflow(userId, Number(query.get("months") ?? 6)));
    }
    if (method === "GET" && path === "/api/reports/net-worth") {
      const userId = await h.deviceUserId();
      return ok(await h.reports.netWorth(userId));
    }
    if (method === "GET" && path === "/api/reports/spending-trend") {
      const userId = await h.deviceUserId();
      return ok(await h.reports.spendingTrend(userId, Number(query.get("months") ?? 6)));
    }

    // ── Plaid (solo: native proxy + localStorage creds) ────────────────
    if (method === "GET" && path === "/api/plaid/credentials") {
      const { getSoloPlaidCreds } = await import("@/lib/solo-plaid-store");
      const creds = getSoloPlaidCreds();
      const environments = [
        {
          environment: "sandbox",
          hasKeys: creds?.environment === "sandbox",
          updatedAt: creds?.environment === "sandbox" ? creds.updatedAt : null,
        },
        {
          environment: "production",
          hasKeys: creds?.environment === "production",
          updatedAt: creds?.environment === "production" ? creds.updatedAt : null,
        },
      ];
      return ok({ environments });
    }

    if (method === "PUT" && path === "/api/plaid/credentials") {
      const { setSoloPlaidCreds } = await import("@/lib/solo-plaid-store");
      const { createNativePlaidClient } = await import("@/server/plaid/native");
      const clientId = typeof B?.clientId === "string" ? B.clientId.trim() : "";
      const secret = typeof B?.secret === "string" ? B.secret.trim() : "";
      const environment = B?.environment === "production" ? "production" : "sandbox";
      if (!clientId || !secret) {
        throw apiErrors.badRequest("Client ID and secret are required.");
      }
      const creds = { clientId, secret, environment } as const;
      // Validate against Plaid before persisting (matches the hub behavior).
      const client = createNativePlaidClient();
      const check = await client.testCredentials(creds);
      if (!check.ok) {
        throw apiErrors.badRequest(check.message || "Plaid rejected these credentials.");
      }
      setSoloPlaidCreds({ ...creds, updatedAt: new Date().toISOString() });
      return ok({ ok: true });
    }

    if (method === "GET" && path === "/api/plaid/link-token") {
      const { getSoloPlaidCreds } = await import("@/lib/solo-plaid-store");
      const { createNativePlaidClient } = await import("@/server/plaid/native");
      const userId = await h.deviceUserId();
      const creds = getSoloPlaidCreds();
      if (!creds) throw apiErrors.badRequest("Save your Plaid keys first.");
      const env = query.get("environment") === "production" ? "production" : creds.environment;
      const client = createNativePlaidClient();
      const linkToken = await client.createLinkToken({ ...creds, environment: env }, userId);
      return ok({ linkToken });
    }

    if (method === "POST" && path === "/api/plaid/exchange") {
      const { getSoloPlaidCreds, addSoloPlaidItem } = await import("@/lib/solo-plaid-store");
      const { createNativePlaidClient } = await import("@/server/plaid/native");
      const publicToken = typeof B?.publicToken === "string" ? B.publicToken : "";
      if (!publicToken) throw apiErrors.badRequest("Missing public token.");
      const creds = getSoloPlaidCreds();
      if (!creds) throw apiErrors.badRequest("Save your Plaid keys first.");
      const env = B?.environment === "production" ? "production" : creds.environment;
      const client = createNativePlaidClient();
      const { accessToken, itemId } = await client.exchangePublicToken(
        { ...creds, environment: env },
        publicToken
      );
      // Fetch accounts so the item has display data.
      let accounts: Array<{ id: string; name: string; type: string | null; mask: string | null }> = [];
      try {
        const res = await client.getAccounts({ ...creds, environment: env }, accessToken);
        accounts = res.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type ?? null,
          mask: a.mask ?? null,
        }));
      } catch {
        // accounts fetch is best-effort; the item is still linked
      }
      addSoloPlaidItem({
        id: itemId,
        institutionName: typeof B?.institutionName === "string" ? B.institutionName : null,
        environment: env,
        accessToken,
        linkedAt: new Date().toISOString(),
        accounts,
      });
      return ok({ ok: true, itemId });
    }

    if (method === "GET" && path === "/api/plaid/items") {
      const { getSoloPlaidItems } = await import("@/lib/solo-plaid-store");
      const items = getSoloPlaidItems().map((i) => ({
        id: i.id,
        institution_name: i.institutionName,
        environment: i.environment,
        status: "linked",
        accounts: i.accounts,
      }));
      return ok({ items });
    }

    // ── Planning ────────────────────────────────────────────────────────
    if (method === "GET" && path === "/api/planning/bills") {
      const userId = await h.deviceUserId();
      return ok({ bills: await h.planning.listBills(userId) });
    }
    if (method === "GET" && path === "/api/planning/debts") {
      const userId = await h.deviceUserId();
      return ok({ debts: await h.planning.listDebts(userId) });
    }
    if (method === "GET" && path === "/api/planning/goals") {
      const userId = await h.deviceUserId();
      return ok({ goals: await h.planning.listGoals(userId) });
    }
    if (method === "GET" && path === "/api/planning/projection") {
      const userId = await h.deviceUserId();
      return ok(await h.projection.project(userId));
    }
    if (method === "GET" && path === "/api/planning/digest") {
      const userId = await h.deviceUserId();
      return ok(await h.planning.digest(userId));
    }

    // ── Idempotent DELETE for transactions/[id] etc. ────────────────────
    if (method === "DELETE" && path.startsWith("/api/transactions/")) {
      const userId = await h.deviceUserId();
      await h.transactions.removeManual(userId, parseId(path, "/api/transactions/"));
      return { status: 204, data: null };
    }
    if (method === "DELETE" && path.startsWith("/api/budgets/")) {
      const userId = await h.deviceUserId();
      await h.budgets.remove(userId, parseId(path, "/api/budgets/"));
      return { status: 204, data: null };
    }
    if (method === "DELETE" && path.startsWith("/api/categories/")) {
      const userId = await h.deviceUserId();
      await h.categories.remove(userId, parseId(path, "/api/categories/"));
      return { status: 204, data: null };
    }

    return notFound();
  } catch (e) {
    const err = toApiError(e);
    return { status: err.status, data: { error: { code: err.code, message: err.message } } };
  }
}
