import { NextRequest, NextResponse } from "next/server";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const apiErrors = {
  unauthorized: () => new ApiError(401, "unauthorized", "You must be signed in."),
  forbidden: (msg = "You do not have permission to do that.") => new ApiError(403, "forbidden", msg),
  notFound: (what = "Resource") => new ApiError(404, "not_found", `${what} not found.`),
  badRequest: (msg = "Invalid request.") => new ApiError(400, "bad_request", msg),
  conflict: (msg = "Conflict.") => new ApiError(409, "conflict", msg),
  rateLimited: (retryAfterMs: number) =>
    new ApiError(
      429,
      "rate_limited",
      `Too many requests — retry in ${Math.max(1, Math.ceil(retryAfterMs / 1000))}s.`
    ),
  internal: () => new ApiError(500, "internal", "Something went wrong."),
};

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

/** Wrap a route handler: converts ApiError to the standard error envelope and
 *  guarantees no stack traces / env values ever leak to the client. */
export function route(
  handler: (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<NextResponse>
): (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<NextResponse> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      if (e instanceof ApiError) {
        return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
      }
      console.error("Unhandled route error:", e);
      return NextResponse.json(
        { error: { code: "internal", message: "Something went wrong." } },
        { status: 500 }
      );
    }
  };
}
