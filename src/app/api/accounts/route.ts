import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { requireSessionOrAgent, agentRoute } from "@/server/authz/agent-auth";
import { createAccountsService } from "@/server/domain/accounts";
import { getDb } from "@/server/db/adapter";
import { repairAccountRows } from "@/server/domain/account-repair";

export const runtime = "nodejs";

const createSchema = z.object({
  name: z.string().min(1, "Account name is required."),
  type: z.string().optional(),
  subtype: z.string().nullable().optional(),
  mask: z.string().nullable().optional(),
  currentBalanceCents: z.number().int().nullable().optional(),
  availableBalanceCents: z.number().int().nullable().optional(),
  currency: z.string().optional(),
});

/** Accounts — user session, or agent token scoped by read:banking/read:investments + allowlist. */
export async function GET(req: NextRequest) {
  return agentRoute(async (req) => {
    const auth = await requireSessionOrAgent(req, ["read:banking", "read:investments"], "list_accounts");
    if (auth.kind === "session") {
      const url = new URL(req.url);
      if (url.searchParams.get("deleted") === "1") {
        const accounts = await createAccountsService(getDb()).listDeleted(auth.userId);
        return ok({ accounts });
      }
      await repairAccountRows(getDb(), auth.userId);
      const accounts = await createAccountsService(getDb()).list(auth.userId);
      return ok({ accounts });
    }
    const accounts = await createAccountsService(getDb()).listForAgent(auth.ctx.userId, auth.ctx.scopes, auth.ctx.accountIds);
    return ok({ accounts });
  })(req, { params: Promise.resolve({}) });
}

/** Manual account create — user session only (registry: not agent-accessible). */
export async function POST(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const body = await parseBody(createSchema, req);
    const account = await createAccountsService(getDb()).createManual(session.userId, body);
    return ok({ account }, { status: 201 });
  })(req, { params: Promise.resolve({}) });
}
