import { NextRequest } from "next/server";
import { ok, parseParam, route } from "@/lib/api";
import { requireSessionOrAgent } from "@/server/authz/agent-auth";
import { createBudgetsService, type BudgetFrame } from "@/server/domain/budgets";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

/** Transactions behind a budget's spend — same frame params as the budgets list. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return route(async (req, ctx) => {
    const auth = await requireSessionOrAgent(req, ["read:budgets"], "get_budget_transactions");
    const id = await parseParam(ctx, "id");
    const reference = req.nextUrl.searchParams.get("referenceDate") ?? req.nextUrl.searchParams.get("reference") ?? undefined;
    const frameKind = req.nextUrl.searchParams.get("frame") ?? "period";
    const start = req.nextUrl.searchParams.get("start") ?? undefined;
    const end = req.nextUrl.searchParams.get("end") ?? undefined;
    const frame: BudgetFrame =
      frameKind === "custom" && start && end
        ? { kind: "custom", start, end }
        : { kind: (["week", "month", "quarter", "year", "period"].includes(frameKind) ? frameKind : "period") as "week" | "month" | "quarter" | "year" | "period" };
    const userId = auth.kind === "agent" ? auth.ctx.userId : auth.userId;
    const includePending = req.nextUrl.searchParams.get("includePending") !== "0";
    const transactions = await createBudgetsService(getDb()).transactions(userId, id, reference, frame, includePending);
    return ok({ transactions });
  })(req, ctx);
}
