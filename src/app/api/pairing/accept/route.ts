import { NextRequest } from "next/server";
import { z } from "zod";
import { apiErrors, ok, parseBody, route } from "@/lib/api";
import { clientIp, pairingLimiter, requireCsrf } from "@/server/auth/service";
import { hashSecret } from "@/lib/crypto";
import { getDb } from "@/server/db/adapter";
import { createSession } from "@/server/auth/sessions";
import { PAIRING_TTL_MS } from "@/lib/pairing";

export const runtime = "nodejs";

const acceptSchema = z.object({
  code: z.string().min(8).max(200),
  deviceLabel: z.string().max(100).optional(),
});

/** Accept a pairing code from a phone: single-use, 10-min TTL, creates a hub session. */
export async function POST(req: NextRequest) {
  return route(async (req) => {
    requireCsrf(req);
    // Unauthenticated session-creation endpoint → throttle brute-force attempts
    // against pairing codes (5/min/IP; codes are single-use + 10-min TTL).
    if (!pairingLimiter.check(clientIp(req)).ok) throw apiErrors.rateLimited(60_000);
    const body = await parseBody(acceptSchema, req);
    const db = getDb();
    const codeHash = hashSecret(body.code);
    const row = await db.get<{ user_id: string; expires_at: string; used: number }>(
      "SELECT user_id, expires_at, used FROM pairing_codes WHERE code_hash = ?",
      codeHash
    );
    if (!row) throw apiErrors.notFound("Pairing code");
    if (row.used) throw apiErrors.badRequest("This pairing code has already been used.");
    if (new Date(row.expires_at).getTime() < Date.now()) throw apiErrors.badRequest("This pairing code has expired.");
    if (new Date(row.expires_at).getTime() < Date.now() - PAIRING_TTL_MS) {
      // stale row cleanup
      await db.run("DELETE FROM pairing_codes WHERE code_hash = ?", codeHash);
      throw apiErrors.badRequest("This pairing code has expired.");
    }
    // Atomic single-use claim: the conditional UPDATE succeeds for exactly one
    // caller. The SELECT above is only for error-message fidelity — without
    // this guard, two concurrent requests with the same code could both pass
    // the used=0 check (there are awaits between SELECT and UPDATE) and each
    // mint a session, breaking the single-use guarantee.
    const claim = await db.run(
      "UPDATE pairing_codes SET used = 1 WHERE code_hash = ? AND used = 0 AND expires_at > ?",
      codeHash,
      new Date().toISOString()
    );
    if (claim.changes !== 1) throw apiErrors.badRequest("This pairing code has already been used.");
    const session = await createSession(row.user_id, "30d", body.deviceLabel ?? "Paired phone", db);
    return ok({ userId: row.user_id, token: session.token, expiresAt: session.expiresAt });
  })(req, { params: Promise.resolve({}) });
}
