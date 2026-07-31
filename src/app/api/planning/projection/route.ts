import { NextRequest } from "next/server";
import { z } from "zod";
import { apiErrors, ok, route } from "@/lib/api";
import { requireSession } from "@/server/auth/service";
import { createProjectionService } from "@/server/domain/projection";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const querySchema = z.object({
  months: z.coerce.number().int().min(1).max(60).default(12),
  includeGoals: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
});

export async function GET(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    const raw = Object.fromEntries([...req.nextUrl.searchParams].filter(([, v]) => v !== ""));
    const parsed = querySchema.safeParse(raw);
    if (!parsed.success) {
      throw apiErrors.badRequest(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const projection = await createProjectionService(getDb()).project(
      session.userId,
      parsed.data.months,
      parsed.data.includeGoals
    );
    return ok(projection);
  })(req, { params: Promise.resolve({}) });
}
