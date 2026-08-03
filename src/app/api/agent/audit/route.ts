import { NextRequest } from "next/server";
import { z } from "zod";
import { apiErrors, ok, route } from "@/lib/api";
import { requireSession } from "@/server/auth/service";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const querySchema = z.object({
  tokenId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** User session: audit viewer — every agent call (scope, tool, status, latency). */
export async function GET(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    const raw = Object.fromEntries([...req.nextUrl.searchParams].filter(([, v]) => v !== ""));
    const parsed = querySchema.safeParse(raw);
    if (!parsed.success) throw apiErrors.badRequest(parsed.error.issues.map((i) => i.message).join("; "));
    const db = getDb();

    const where = ["l.token_id IN (SELECT id FROM agent_tokens WHERE user_id = ?)"];
    const params: unknown[] = [session.userId];
    if (parsed.data.tokenId) {
      where.push("l.token_id = ?");
      params.push(parsed.data.tokenId);
    }

    const total = await db.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM agent_access_log l WHERE ${where.join(" AND ")}`,
      ...params
    );
    const rows = await db.all<{
      id: string; token_id: string; token_name: string; scope_used: string; tool: string;
      method: string | null; status: number; latency_ms: number | null; created_at: string;
    }>(
      `SELECT l.id, l.token_id, t.name AS token_name, l.scope_used, l.tool, l.method, l.status,
              l.latency_ms, l.created_at
         FROM agent_access_log l
         JOIN agent_tokens t ON t.id = l.token_id
        WHERE ${where.join(" AND ")}
        ORDER BY l.created_at DESC
        LIMIT ? OFFSET ?`,
      ...params,
      parsed.data.limit,
      parsed.data.offset
    );
    return ok({ rows, total: total?.c ?? 0 });
  })(req, { params: Promise.resolve({}) });
}
