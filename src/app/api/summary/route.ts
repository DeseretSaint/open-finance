import { NextRequest } from "next/server";
import { ok, route } from "@/lib/api";
import { requireSession } from "@/server/auth/service";
import { createSummaryService } from "@/server/domain/summary";
import { type BudgetFrame } from "@/server/domain/budgets";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

/** GET /api/summary?ref=YYYY-MM-DD&frame=week|month|quarter|year|period&start=&end= */
export async function GET(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    const sp = req.nextUrl.searchParams;
    const ref = sp.get("ref");
    const referenceDate = ref && /^\d{4}-\d{2}-\d{2}$/.test(ref) ? ref : undefined;
    const frameKind = sp.get("frame") ?? "month";
    const start = sp.get("start") ?? undefined;
    const end = sp.get("end") ?? undefined;
    const frame: BudgetFrame =
      frameKind === "custom" && start && end
        ? { kind: "custom", start, end }
        : { kind: (["week", "month", "quarter", "year", "period"].includes(frameKind) ? frameKind : "month") as "week" | "month" | "quarter" | "year" | "period" };
    const summary = await createSummaryService(getDb()).get(session.userId, referenceDate, null, frame);
    return ok({ summary });
  })(req, { params: Promise.resolve({}) });
}
