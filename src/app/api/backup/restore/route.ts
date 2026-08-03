import { NextRequest } from "next/server";
import { apiErrors, ok, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createBackupService } from "@/server/domain/backup";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

export const maxDuration = 60;

/**
 * Restore from an encrypted .ofbak upload. Password-confirmed; writes a
 * pre-restore auto-backup first; wrong key → clean 400. Agent tokens can never
 * call this (session cookie + CSRF + password required).
 */
export async function POST(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const form = await req.formData().catch(() => {
      throw apiErrors.badRequest("Expected multipart form (file + password).");
    });
    const file = form.get("file");
    const password = form.get("password");
    if (!(file instanceof Blob) || !password || typeof password !== "string") {
      throw apiErrors.badRequest("Backup file and confirm password are required.");
    }
    const envelope = Buffer.from(await file.arrayBuffer());
    const result = await createBackupService(getDb()).restoreBackup(session.userId, envelope, password);
    return ok(result);
  })(req, { params: Promise.resolve({}) });
}
