import { NextRequest } from "next/server";
import { ok, route } from "@/lib/api";
import { AGENT_ROUTES } from "@/server/authz/route-registry";

export const runtime = "nodejs";

/** OpenAPI 3.1 doc with `x-required-scope` on every agent operation (§9.3). */
export async function GET(req: NextRequest) {
  return route(async () => {
    const paths: Record<string, unknown> = {};
    for (const r of AGENT_ROUTES) {
      const operation = {
        operationId: `${r.method.toLowerCase()}_${r.path.replace(/[^a-zA-Z0-9]/g, "_")}`,
        responses: {
          "200": { description: "OK" },
          "401": { description: "Unauthorized" },
          "403": { description: "Forbidden / insufficient_scope" },
        },
        "x-required-scope": r.scopes,
      };
      if (!paths[r.path]) paths[r.path] = {};
      (paths[r.path] as Record<string, unknown>)[r.method.toLowerCase()] = operation;
    }
    return ok({
      openapi: "3.1.0",
      info: { title: "Open Finance Agent API", version: "0.0.1" },
      servers: [{ url: "/" }],
      paths,
    });
  })(req, { params: Promise.resolve({}) });
}
