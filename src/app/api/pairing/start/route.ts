import { randomBytes, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { ok, parseBody, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { hashSecret } from "@/lib/crypto";
import { getDb } from "@/server/db/adapter";
import { env } from "@/lib/env";
import { PAIRING_TTL_MS } from "@/lib/pairing";
import { z } from "zod";

export const runtime = "nodejs";

/** Start a pairing session: returns the raw code (shown once, hashed at rest). */
const startSchema = z.object({
  baseUrl: z.string().url().optional(),
});

export async function POST(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const body = await parseBody(startSchema, req).catch(() => ({ baseUrl: undefined }));
    const code = `ofp_${randomBytes(9).toString("base64url")}`;
    const db = getDb();
    await db.run(
      "INSERT INTO pairing_codes (code_hash, user_id, expires_at, used) VALUES (?, ?, ?, 0)",
      hashSecret(code),
      session.userId,
      new Date(Date.now() + PAIRING_TTL_MS).toISOString()
    );
    const base = (body.baseUrl ?? env.PUBLIC_URL).replace(/\/$/, "");
    return ok({ code, url: `${base}/pair?code=${encodeURIComponent(code)}`, ttlSeconds: PAIRING_TTL_MS / 1000 });
  })(req, { params: Promise.resolve({}) });
}

/** List active pairing codes (for the settings UI to show/regenerate). */
export async function GET(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    const rows = await getDb().all<{ code_hash: string; expires_at: string; used: number }>(
      "SELECT code_hash, expires_at, used FROM pairing_codes WHERE user_id = ? AND expires_at > ? ORDER BY expires_at DESC",
      session.userId,
      new Date().toISOString()
    );
    return ok({
      active: rows.filter((r) => !r.used).map((r) => ({ hash: r.code_hash.slice(0, 12), expiresAt: r.expires_at })),
    });
  })(req, { params: Promise.resolve({}) });
}

export { randomUUID };
