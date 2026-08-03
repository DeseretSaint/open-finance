import { NextRequest } from "next/server";
import { apiErrors, ok, route } from "@/lib/api";
import { requireSession } from "@/server/auth/service";
import { detectAgents } from "@/server/detect/detect";
import { createRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";

/** 10/min/user — detection scans the machine, so it's throttled. */
const detectLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

const cache = new Map<string, { at: number; probes: unknown }>();
const CACHE_MS = 60_000;

/** Read-only agent scan: {agent, present, configured} — no exec, no secrets, no file contents. */
export async function GET(req: NextRequest) {
  return route(async (req) => {
    const session = await requireSession(req);
    const rl = detectLimiter.check(session.userId);
    if (!rl.ok) throw apiErrors.rateLimited(rl.retryAfterMs);

    const cached = cache.get(session.userId);
    if (cached && Date.now() - cached.at < CACHE_MS) {
      return ok({ agents: cached.probes, cached: true });
    }
    const probes = await detectAgents();
    cache.set(session.userId, { at: Date.now(), probes });
    return ok({ agents: probes, cached: false });
  })(req, { params: Promise.resolve({}) });
}
