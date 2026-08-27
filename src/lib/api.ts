import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiErrors } from "@/lib/api-error";

export { ApiError, apiErrors } from "@/lib/api-error";

/**
 * Hard cap on a JSON request body (64 MB). The largest legitimate JSON payload
 * is the phone-import `contents` field (50 MB of base64 backup text); every
 * other route takes at most a few KB. The cap exists because buffering a JSON
 * body allocates the whole payload in RAM BEFORE any zod field validation can
 * reject it — without a pre-buffer check a single oversized POST could exhaust
 * server memory (same class as the backup-restore and CSV-import caps).
 */
export const MAX_JSON_BODY_BYTES = 64 * 1024 * 1024;

/**
 * Reject oversized JSON bodies BEFORE buffering them into RAM (declared
 * Content-Length header; the buffered text length is re-checked after reading
 * for chunked/lying headers). Either exceeding MAX_JSON_BODY_BYTES throws 413.
 * A non-numeric Content-Length is ignored here (the length check after reading
 * still applies).
 */
export function assertJsonBodySize(declaredContentLength: string | null, bodyLength: number | null): void {
  const declared = declaredContentLength === null ? NaN : Number(declaredContentLength);
  if (
    (Number.isFinite(declared) && declared > MAX_JSON_BODY_BYTES) ||
    (bodyLength !== null && bodyLength > MAX_JSON_BODY_BYTES)
  ) {
    throw apiErrors.payloadTooLarge("Request body is too large (limit 64 MB).");
  }
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

/** Parse a JSON body against a zod schema; converts ZodError to a 400 ApiError.
 *  Rejects oversized bodies BEFORE buffering (declared Content-Length) and again
 *  after reading the raw text (chunked/lying headers) — see assertJsonBodySize. */
export async function parseBody<T>(schema: z.ZodType<T>, req: Request): Promise<T> {
  assertJsonBodySize(req.headers.get("content-length"), null);
  let text: string;
  try {
    text = await req.text();
  } catch {
    throw apiErrors.badRequest("Request body must be valid JSON.");
  }
  assertJsonBodySize(null, text.length);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw apiErrors.badRequest("Request body must be valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => i.message).join("; ");
    throw apiErrors.badRequest(detail || "Invalid request body.");
  }
  return parsed.data;
}

/** Parse a route param (e.g. sessions/[id]) into a plain string. */
export async function parseParam(ctx: { params: Promise<Record<string, string>> }, name: string): Promise<string> {
  const params = await ctx.params;
  const value = params[name];
  if (!value) throw apiErrors.badRequest(`Missing :${name} parameter.`);
  return value;
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
