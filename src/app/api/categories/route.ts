import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { requireCsrf, requireSession } from "@/server/auth/service";
import { createCategoriesService } from "@/server/domain/categories";
import { getDb } from "@/server/db/adapter";

export const runtime = "nodejs";

const createSchema = z.object({
  name: z.string().min(1, "Category name is required.").max(50),
  color: z.string().max(20).nullable().optional(),
  plaidPaths: z.string().max(2000).nullable().optional(),
});

export async function GET(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    const service = createCategoriesService(getDb());
    await service.ensureSystem(session.userId);
    const categories = req.nextUrl.searchParams.get("all") === "1" ? await service.listAll(session.userId) : await service.list(session.userId);
    return ok({ categories });
  })(req, { params: Promise.resolve({}) });
}

export async function POST(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    requireCsrf(req);
    const body = await parseBody(createSchema, req);
    const category = await createCategoriesService(getDb()).create(session.userId, body);
    return ok({ category }, { status: 201 });
  })(req, { params: Promise.resolve({}) });
}
