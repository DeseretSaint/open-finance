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
import { createBudgetsService, type BudgetFrame } from "@/server/domain/budgets";
import { createSummaryService } from "@/server/domain/summary";
import { createReportsService } from "@/server/domain/reports";
import { createPlanningService } from "@/server/domain/planning";
import { createProjectionService } from "@/server/domain/projection";
import { seedSoloDemo } from "@/lib/solo-demo-seed";
import { createOnboardingService } from "@/server/domain/onboarding";
import { createAgentPrefsService, type AgentTab } from "@/server/domain/agent-prefs";

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

    // Device status for the landing page: does a real (non-demo) account
    // already exist on this device? Drives "Create account" vs "Unlock".
    if (method === "GET" && path === "/api/device/status") {
      const bootstrapped = await h.solo.isBootstrapped();
      let exists = false;
      if (bootstrapped) {
        const row = await db.get<{ is_demo: number }>("SELECT is_demo FROM users WHERE id = ?", await h.deviceUserId());
        exists = !row || row.is_demo !== 1;
      }
      return ok({ exists, bootstrapped });
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
    if (method === "POST" && path === "/api/device-lock/biometric") {
      // Native BiometricPrompt already verified the fingerprint/face — this
      // confirms the pref and clears the lockout.
      const userId = await h.deviceUserId();
      await h.deviceLock.unlockWithBiometric(userId);
      return ok({ ok: true });
    }
    if (method === "POST" && path === "/api/device-lock/biometric/enable") {
      const userId = await h.deviceUserId();
      await h.deviceLock.setBiometric(userId, true);
      return ok({ ok: true });
    }
    if (method === "POST" && path === "/api/device-lock/biometric/disable") {
      const userId = await h.deviceUserId();
      await h.deviceLock.setBiometric(userId, false);
      return ok({ ok: true });
    }

    // ── Accounts (manual) ───────────────────────────────────────────────
    if (method === "GET" && path === "/api/accounts") {
      const userId = await h.deviceUserId();
      if (query.get("deleted") === "1") {
        const rows = await h.accounts.listDeleted(userId);
        return ok({ accounts: rows });
      }
      const rows = await h.accounts.list(userId);
      return ok({ accounts: rows });
    }
    if (method === "PUT" && path === "/api/accounts/order") {
      const userId = await h.deviceUserId();
      const orderedIds = Array.isArray(B?.orderedIds) ? B.orderedIds.map(String) : [];
      if (orderedIds.length === 0) throw apiErrors.badRequest("orderedIds is required.");
      await h.accounts.reorder(userId, orderedIds);
      return ok({ ok: true });
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
      // Keep solo mode behavior identical to the server route: first access
      // creates the standard categories so Plaid transactions have a useful
      // picker immediately after linking.
      await h.categories.ensureSystem(userId);
      return ok({ categories: query.get("all") === "1" ? await h.categories.listAll(userId) : await h.categories.list(userId) });
    }
    if (method === "POST" && path === "/api/categories") {
      const userId = await h.deviceUserId();
      const category = await h.categories.create(userId, {
        name: typeof B?.name === "string" ? B.name : "",
        color: typeof B?.color === "string" ? B.color : null,
      });
      return ok({ category }, 201);
    }
    if (method === "PATCH" && path.startsWith("/api/categories/")) {
      const userId = await h.deviceUserId();
      const id = path.slice("/api/categories/".length);
      const category = await h.categories.update(userId, id, {
        enabled: typeof B?.enabled === "boolean" ? B.enabled : undefined,
      });
      return ok({ category });
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
        excludeFromBudgets: B?.excludeFromBudgets === true,
      });
      return ok({ transaction }, 201);
    }

    // ── Budgets ─────────────────────────────────────────────────────────
    if (method === "GET" && path === "/api/budgets") {
      const userId = await h.deviceUserId();
      const reference = query.get("referenceDate") ?? query.get("reference") ?? undefined;
      const frameKind = query.get("frame") ?? "period";
      const start = query.get("start") ?? undefined;
      const end = query.get("end") ?? undefined;
      const frame: BudgetFrame =
        frameKind === "custom" && start && end
          ? { kind: "custom", start, end }
          : { kind: (["week", "month", "quarter", "year", "period"].includes(frameKind) ? frameKind : "period") as "week" | "month" | "quarter" | "year" | "period" };
      return ok({ budgets: await h.budgets.list(userId, reference, frame) });
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
      const ref = req.query.get("ref");
      const referenceDate = ref && /^\d{4}-\d{2}-\d{2}$/.test(ref) ? ref : undefined;
      const frameKind = req.query.get("frame") ?? "month";
      const start = req.query.get("start") ?? undefined;
      const end = req.query.get("end") ?? undefined;
      const frame: BudgetFrame =
        frameKind === "custom" && start && end
          ? { kind: "custom", start, end }
          : { kind: (["week", "month", "quarter", "year", "period"].includes(frameKind) ? frameKind : "month") as "week" | "month" | "quarter" | "year" | "period" };
      return ok({ summary: await h.summary.get(userId, referenceDate, null, frame, query.get("includeExcluded") === "1") });
    }
    if (method === "GET" && path === "/api/reports/spending-by-category") {
      const userId = await h.deviceUserId();
      const today = new Date().toISOString().slice(0, 10);
      const firstOfMonth = today.slice(0, 8) + "01";
      // Same envelope as the HTTP route: { rows: [...] } (issue #11 — the
      // reports page was blank on-device because the raw array was returned).
      const rows = await h.reports.spendingByCategory(
        userId,
        query.get("from") ?? firstOfMonth,
        query.get("to") ?? today,
        undefined,
        query.get("includeExcluded") === "1"
      );
      return ok({ rows });
    }
    if (method === "GET" && path === "/api/reports/cashflow") {
      const userId = await h.deviceUserId();
      const rows = await h.reports.cashflow(
        userId,
        Number(query.get("months") ?? 6),
        null,
        query.get("from") ?? undefined,
        query.get("to") ?? undefined,
        query.get("includeExcluded") === "1"
      );
      return ok({ rows });
    }
    if (method === "GET" && path === "/api/reports/net-worth") {
      const userId = await h.deviceUserId();
      const netWorth = await h.reports.netWorth(userId, null, query.get("includeExcluded") === "1");
      return ok({ netWorth });
    }
    if (method === "GET" && path === "/api/reports/spending-trend") {
      const userId = await h.deviceUserId();
      const rows = await h.reports.spendingTrend(userId, Number(query.get("months") ?? 6));
      return ok({ rows });
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
      if (!creds) {
        throw apiErrors.badRequest(
          "No Plaid keys saved yet — add them in Settings → Bank connections, or keep tracking manually (linking a bank is optional)."
        );
      }
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
      let accountDetails: Array<{ id: string; currentBalanceCents: number | null; availableBalanceCents: number | null; currency: string }> = [];
      try {
        const res = await client.getAccounts({ ...creds, environment: env }, accessToken);
        accounts = res.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type ?? null,
          mask: a.mask ?? null,
        }));
        accountDetails = res.map((a) => ({
          id: a.id,
          currentBalanceCents: a.currentBalanceCents,
          availableBalanceCents: a.availableBalanceCents,
          currency: a.currency,
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
      // Import transaction history immediately so the wizard's link step
      // populates the Activity log (P23). Best-effort; never fails the link.
      const userId = await h.deviceUserId();
      let synced = 0;
      try {
        const { syncSoloItem } = await import("@/lib/solo-plaid-sync");
        const { setSoloPlaidItemCursor } = await import("@/lib/solo-plaid-store");
        const { createSoloSyncClient } = await import("@/server/plaid/native");
        const result = await syncSoloItem({
          db,
          userId,
          itemId,
          institutionName: typeof B?.institutionName === "string" ? B.institutionName : null,
          environment: env,
          creds: { ...creds, environment: env },
          accountDetails,
          accessToken,
          accounts,
          client: createSoloSyncClient(),
          cursor: null,
        });
        synced = result.ok ? result.added + result.modified : 0;
        // Persist the cursor so later "Sync now" runs are incremental.
        if (result.ok) setSoloPlaidItemCursor(itemId, result.nextCursor);
      } catch {
        synced = 0;
      }
      return ok({ ok: true, itemId, synced });
    }

    // Re-sync all linked Plaid items (Settings → "Sync now"). Pulls new /
    // changed transactions since the stored cursor (the Kotlin proxy follows
    // has_more, so the full history is covered even on first link).
    if (method === "POST" && path === "/api/transactions/sync") {
      const { getSoloPlaidCreds, getSoloPlaidItems, setSoloPlaidItemCursor } = await import("@/lib/solo-plaid-store");
      const { createNativePlaidClient, createSoloSyncClient } = await import("@/server/plaid/native");
      const { syncSoloItem } = await import("@/lib/solo-plaid-sync");
      const userId = await h.deviceUserId();
      const creds = getSoloPlaidCreds();
      if (!creds) throw apiErrors.badRequest("No Plaid keys saved on this phone.");
      const items = getSoloPlaidItems();
      const client = createNativePlaidClient();
      const results: Array<{ itemId: string; institution_name: string | null; added: number; modified: number; removed: number; ok: boolean; error?: string }> = [];
      for (const item of items) {
        const env = item.environment === "production" ? "production" : "sandbox";
        // Refresh balances alongside transactions so the Accounts tab stays current.
        let accountDetails: Array<{ id: string; currentBalanceCents: number | null; availableBalanceCents: number | null; currency: string }> = [];
        try {
          const fresh = await client.getAccounts({ ...creds, environment: env as "production" | "sandbox" }, item.accessToken);
          accountDetails = fresh.map((a) => ({
            id: a.id,
            currentBalanceCents: a.currentBalanceCents,
            availableBalanceCents: a.availableBalanceCents,
            currency: a.currency,
          }));
        } catch {
          /* balances are best-effort on re-sync */
        }
        const res = await syncSoloItem({
          db,
          userId,
          itemId: item.id,
          institutionName: item.institutionName,
          environment: env,
          creds: { ...creds, environment: env as "production" | "sandbox" },
          accountDetails,
          accessToken: item.accessToken,
          accounts: item.accounts,
          client: createSoloSyncClient(),
          cursor: item.cursor ?? null,
        });
        if (res.ok) setSoloPlaidItemCursor(item.id, res.nextCursor);
        results.push({
          itemId: item.id,
          institution_name: item.institutionName,
          added: res.added,
          modified: res.modified,
          removed: res.removed,
          ok: res.ok,
          error: res.error,
        });
      }
      return ok({ results });
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

    // ── Phone backup & restore (solo: encrypted JSON dump, PIN-confirmed) ──
    if (method === "POST" && path === "/api/backup") {
      const { createSoloBackupService } = await import("@/server/domain/solo-backup");
      const { getSoloPlaidCreds, getSoloPlaidItems } = await import("@/lib/solo-plaid-store");
      const userId = await h.deviceUserId();
      const pin = typeof B?.pin === "string" ? B.pin : "";
      const transfer = B?.includePlaid === true ? { creds: getSoloPlaidCreds(), items: getSoloPlaidItems().map((item) => ({ ...item, plaidItemId: item.plaidItemId ?? item.id })) } : undefined;
      const result = await createSoloBackupService(db).exportBackup(userId, pin, transfer);
      return ok(result);
    }
    if (method === "POST" && path === "/api/backup/restore") {
      const { createSoloBackupService } = await import("@/server/domain/solo-backup");
      const userId = await h.deviceUserId();
      const pin = typeof B?.pin === "string" ? B.pin : "";
      const contents = typeof B?.contents === "string" ? B.contents : "";
      if (!contents) throw apiErrors.badRequest("Choose a backup file first.");
      const result = await createSoloBackupService(db).restoreBackup(userId, pin, contents);
      return ok(result);
    }

    // ── Updates (solo: GitHub check + dismiss; no self-update on APK) ───
    if (path === "/api/updates") {
      const { createSoloUpdatesService } = await import("@/server/domain/updates-solo");
      const svc = createSoloUpdatesService(db);
      if (method === "POST") {
        const result = await svc.check();
        return ok({ found: result.found, status: result.status });
      }
      return ok(await svc.status());
    }

    if (method === "POST" && path === "/api/updates/decide") {
      const { createSoloUpdatesService } = await import("@/server/domain/updates-solo");
      const svc = createSoloUpdatesService(db);
      const action = typeof B?.action === "string" ? B.action : "";
      switch (action) {
        case "dismiss":
          await svc.dismiss();
          return ok({ dismissed: true });
        case "remind":
          await svc.remind();
          return ok({ reminded: true });
        case "cancel":
          await svc.cancelSchedule();
          return ok({ cancelled: true });
        case "now":
        case "scheduled":
          return svc.rejectInPlace();
        default:
          throw apiErrors.badRequest("Unknown action.");
      }
    }

    // ── Notification + biometric preferences ────────────────────────────
    if (path === "/api/notifications/prefs") {
      const { createNotificationsService } = await import("@/server/domain/notifications");
      const userId = await h.deviceUserId();
      const svc = createNotificationsService(db);
      if (method === "GET") {
        return ok(await svc.get(userId));
      }
      if (method === "PUT") {
        const patch: Record<string, unknown> = {};
        for (const key of [
          "notifEnabled",
          "notifFrequency",
          "notifTime",
          "emailEnabled",
          "emailAddress",
          "emailFrequency",
          "biometricEnabled",
        ] as const) {
          if (B?.[key] !== undefined) patch[key] = B[key];
        }
        return ok(await svc.update(userId, patch));
      }
    }

    // ── Agent preferences (smart categorization) ────────────────────────
    if (path === "/api/agent/prefs") {
      const userId = await h.deviceUserId();
      const svc = createAgentPrefsService(db);
      if (method === "GET") {
        return ok({ prefs: await svc.get(userId) });
      }
      if (method === "PUT") {
        const patch: Partial<{
          tabs: AgentTab[];
          tabsWrite: AgentTab[];
          autoCategorize: boolean;
          categorizeBacklogMonths: number;
          global: boolean;
          globalWrite: boolean;
          autoApproveReads: boolean;
          requireWriteConfirm: boolean;
          auditEnabled: boolean;
        }> = {};
        if (Array.isArray(B?.tabs)) {
          patch.tabs = B.tabs.filter((t: unknown) => typeof t === "string") as AgentTab[];
        }
        if (Array.isArray(B?.tabsWrite)) {
          patch.tabsWrite = B.tabsWrite.filter((t: unknown) => typeof t === "string") as AgentTab[];
        }
        if (typeof B?.autoCategorize === "boolean") patch.autoCategorize = B.autoCategorize;
        if (typeof B?.categorizeBacklogMonths === "number") patch.categorizeBacklogMonths = B.categorizeBacklogMonths;
        if (typeof B?.global === "boolean") patch.global = B.global;
        if (typeof B?.globalWrite === "boolean") patch.globalWrite = B.globalWrite;
        if (typeof B?.autoApproveReads === "boolean") patch.autoApproveReads = B.autoApproveReads;
        if (typeof B?.requireWriteConfirm === "boolean") patch.requireWriteConfirm = B.requireWriteConfirm;
        if (typeof B?.auditEnabled === "boolean") patch.auditEnabled = B.auditEnabled;
        return ok({ prefs: await svc.update(userId, patch) });
      }
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
      const days = Number(query.get("days") ?? 30);
      const until = query.get("until") ?? undefined;
      return ok(await h.planning.digest(userId, days, until));
    }

    // ── Planning CRUD (solo) — bills / debts / goals / paydays ───────────
    // These were missing (issue: "Route not found in solo mode" when adding
    // a goal/bill/debt from the Plan tab on-device). Mirrors the web routes.
    if (method === "POST" && path === "/api/planning/bills") {
      const userId = await h.deviceUserId();
      const bill = await h.planning.createBill(userId, {
        name: String(B?.name ?? ""),
        amountCents: Math.round(Number(B?.amountCents) || 0),
        frequency: (String(B?.frequency ?? "monthly") || "monthly") as "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly" | "one-time",
        dueDay: B?.dueDay == null ? null : parseInt(String(B.dueDay), 10),
        nextDueDate: B?.nextDueDate == null ? null : String(B.nextDueDate),
        categoryId: B?.categoryId == null ? null : String(B.categoryId),
        accountId: B?.accountId == null ? null : String(B.accountId),
        notes: B?.notes == null ? null : String(B.notes),
      });
      return ok({ bill }, 201);
    }
    if (method === "PATCH" && path.startsWith("/api/planning/bills/")) {
      const userId = await h.deviceUserId();
      const id = parseId(path, "/api/planning/bills/");
      const patch: Record<string, unknown> = {};
      if (B?.name !== undefined) patch.name = String(B.name);
      if (B?.amountCents !== undefined) patch.amountCents = Math.round(Number(B.amountCents));
      if (B?.frequency !== undefined) patch.frequency = String(B.frequency);
      if (B?.nextDueDate !== undefined) patch.nextDueDate = B.nextDueDate == null ? null : String(B.nextDueDate);
      if (B?.active !== undefined) patch.active = B.active === true;
      const bill = await h.planning.updateBill(userId, id, patch as Parameters<typeof h.planning.updateBill>[2]);
      return ok({ bill });
    }
    if (method === "DELETE" && path.startsWith("/api/planning/bills/")) {
      const userId = await h.deviceUserId();
      const id = parseId(path, "/api/planning/bills/");
      await h.planning.removeBill(userId, id);
      return ok({ ok: true });
    }
    if (method === "POST" && path === "/api/planning/debts") {
      const userId = await h.deviceUserId();
      const debt = await h.planning.createDebt(userId, {
        name: String(B?.name ?? ""),
        principalCents: Math.round(Number(B?.principalCents) || 0),
        aprBps: Math.round(Number(B?.aprBps) || 0),
        minPaymentCents: Math.round(Number(B?.minPaymentCents) || 0),
        type: String(B?.type ?? "other"),
        notes: B?.notes == null ? null : String(B.notes),
      });
      return ok({ debt }, 201);
    }
    if (method === "PATCH" && path.startsWith("/api/planning/debts/")) {
      const userId = await h.deviceUserId();
      const id = parseId(path, "/api/planning/debts/");
      const patch: Record<string, unknown> = {};
      if (B?.name !== undefined) patch.name = String(B.name);
      if (B?.principalCents !== undefined) patch.principalCents = Math.round(Number(B.principalCents));
      if (B?.aprBps !== undefined) patch.aprBps = Math.round(Number(B.aprBps));
      if (B?.minPaymentCents !== undefined) patch.minPaymentCents = Math.round(Number(B.minPaymentCents));
      const debt = await h.planning.updateDebt(userId, id, patch as Parameters<typeof h.planning.updateDebt>[2]);
      return ok({ debt });
    }
    if (method === "DELETE" && path.startsWith("/api/planning/debts/")) {
      const userId = await h.deviceUserId();
      const id = parseId(path, "/api/planning/debts/");
      await h.planning.removeDebt(userId, id);
      return ok({ ok: true });
    }
    if (method === "POST" && path === "/api/planning/goals") {
      const userId = await h.deviceUserId();
      const goal = await h.planning.createGoal(userId, {
        name: String(B?.name ?? ""),
        type: String(B?.type ?? "savings"),
        category: B?.category == null ? "general" : String(B.category),
        targetCents: Math.round(Number(B?.targetCents) || 0),
        targetDate: B?.targetDate == null ? null : String(B.targetDate),
        currentCents: Math.round(Number(B?.currentCents) || 0),
        monthlyContributionCents: B?.monthlyContributionCents == null ? null : Math.round(Number(B.monthlyContributionCents)),
        contributionMode: B?.contributionMode == null ? undefined : String(B.contributionMode),
        contributionInterval: B?.contributionInterval == null ? null : String(B.contributionInterval),
        contributionDays: Array.isArray(B?.contributionDays) ? (B.contributionDays as unknown[]).map((d) => Number(d)) : undefined,
        accountId: B?.accountId == null ? null : String(B.accountId),
        notes: B?.notes == null ? null : String(B.notes),
      });
      return ok({ goal }, 201);
    }
    if (method === "PATCH" && path.startsWith("/api/planning/goals/")) {
      const userId = await h.deviceUserId();
      const id = parseId(path, "/api/planning/goals/");
      const patch: Record<string, unknown> = {};
      if (B?.name !== undefined) patch.name = String(B.name);
      if (B?.type !== undefined) patch.type = String(B.type);
      if (B?.targetCents !== undefined) patch.targetCents = Math.round(Number(B.targetCents));
      if (B?.targetDate !== undefined) patch.targetDate = B.targetDate == null ? null : String(B.targetDate);
      if (B?.currentCents !== undefined) patch.currentCents = Math.round(Number(B.currentCents));
      if (B?.monthlyContributionCents !== undefined) patch.monthlyContributionCents = B.monthlyContributionCents == null ? null : Math.round(Number(B.monthlyContributionCents));
      if (B?.contributionMode !== undefined) patch.contributionMode = String(B.contributionMode);
      if (B?.contributionInterval !== undefined) patch.contributionInterval = B.contributionInterval == null ? null : String(B.contributionInterval);
      if (B?.contributionDays !== undefined) patch.contributionDays = (B.contributionDays as unknown[]).map((d) => Number(d));
      const goal = await h.planning.updateGoal(userId, id, patch as Parameters<typeof h.planning.updateGoal>[2]);
      return ok({ goal });
    }
    if (method === "DELETE" && path.startsWith("/api/planning/goals/")) {
      const userId = await h.deviceUserId();
      const id = parseId(path, "/api/planning/goals/");
      await h.planning.removeGoal(userId, id);
      return ok({ ok: true });
    }
    if (method === "GET" && path === "/api/planning/paydays") {
      const userId = await h.deviceUserId();
      return ok({ paydays: await h.planning.getPaydays(userId) });
    }
    if (method === "PUT" && path === "/api/planning/paydays") {
      const userId = await h.deviceUserId();
      const paydays = await h.planning.setPaydays(userId, {
        mode: B?.mode == null ? "auto" : String(B.mode),
        interval: B?.interval == null ? null : String(B.interval),
        days: Array.isArray(B?.days) ? (B.days as unknown[]).map((d) => Number(d)) : undefined,
      });
      return ok({ paydays });
    }
    if (method === "POST" && path === "/api/agent/categorize-now") {
      // Smart-categorization "Apply" (solo): mirrors the web route.
      const userId = await h.deviceUserId();
      const { autoCategorize } = await import("@/server/domain/categorizer");
      const connected = await db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM agent_tokens WHERE user_id = ? AND revoked = 0",
        userId
      );
      if (!connected || connected.n === 0) {
        throw apiErrors.badRequest("No agent connected — wire one in the Agents tab first.");
      }
      const prefs = await createAgentPrefsService(db).get(userId);
      if (!prefs.autoCategorize) {
        throw apiErrors.badRequest("Smart categorization is off — enable it above, then apply.");
      }
      const result = await autoCategorize(db, userId, prefs.categorizeBacklogMonths);
      return ok(result);
    }

    // ── Idempotent DELETE for transactions/[id] etc. ────────────────────
    if (method === "PATCH" && path.startsWith("/api/transactions/")) {
      const userId = await h.deviceUserId();
      const id = parseId(path, "/api/transactions/");
      const patch: {
        userCategoryId?: string | null;
        excludeFromBudgets?: boolean;
        userNote?: string | null;
      } = {};
      if (B?.userCategoryId !== undefined) patch.userCategoryId = B.userCategoryId == null ? null : String(B.userCategoryId);
      if (B?.excludeFromBudgets !== undefined) patch.excludeFromBudgets = B.excludeFromBudgets === true;
      if (B?.userNote !== undefined) patch.userNote = B.userNote == null ? null : String(B.userNote);
      if (Object.keys(patch).length === 0) throw apiErrors.badRequest("Nothing to update.");
      const transaction = await h.transactions.update(userId, id, patch);
      return ok({ transaction });
    }
    if (method === "POST" && path.startsWith("/api/accounts/") && path.endsWith("/restore")) {
      const userId = await h.deviceUserId();
      const id = parseId(path.replace(/\/restore$/, ""), "/api/accounts/");
      const account = await h.accounts.restore(userId, id);
      return ok({ account });
    }
    if (method === "PATCH" && path.startsWith("/api/accounts/")) {
      const userId = await h.deviceUserId();
      const id = parseId(path, "/api/accounts/");
      const account =
        typeof B?.description === "string" || B?.description === null
          ? await h.accounts.setDescription(userId, id, B.description)
          : typeof B?.type === "string"
            ? await h.accounts.setType(userId, id, B.type)
            : typeof B?.includeInNetWorth === "boolean"
              ? await h.accounts.setNetWorthInclusion(userId, id, B.includeInNetWorth)
              : typeof B?.name === "string"
                ? await h.accounts.rename(userId, id, B.name)
                : (() => {
                    throw apiErrors.badRequest("Nothing to update.");
                  })();
      return ok({ account });
    }
    if (method === "DELETE" && path.startsWith("/api/accounts/")) {
      const userId = await h.deviceUserId();
      await h.accounts.remove(userId, parseId(path, "/api/accounts/"));
      return { status: 204, data: null };
    }
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
