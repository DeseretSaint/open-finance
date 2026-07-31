import { NextResponse } from "next/server";
import { getDb } from "@/server/db/adapter";
import { currentVersion } from "@/server/domain/updates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDb().get("SELECT 1 AS ok");
    return NextResponse.json({
      ok: true,
      db: true,
      version: currentVersion(),
    });
  } catch (e) {
    console.error("Health check failed:", e);
    return NextResponse.json({ ok: false, db: false }, { status: 503 });
  }
}
