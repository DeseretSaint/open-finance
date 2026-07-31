import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createAccountsService } from "@/server/domain/accounts";
import { getDb } from "@/server/db/adapter";

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

export async function GET(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    const accounts = await createAccountsService(getDb()).list(session.userId);
    return ok({ accounts });
  })(req, { params: Promise.resolve({}) });
}

export async function POST(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const body = await parseBody(createSchema, req);
    const account = await createAccountsService(getDb()).createManual(session.userId, body);
    return ok({ account }, { status: 201 });
  })(req, { params: Promise.resolve({}) });
}
