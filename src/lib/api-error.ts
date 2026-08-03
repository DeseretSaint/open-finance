/**
 * ApiError — shared error type used by domain services and the solo router.
 * Lives here (not in @/lib/api) so the webview bundle never pulls in
 * next/server. The HTTP route layer re-exports it for compatibility.
 *
 * NOTE: no "use client" directive — this module is imported by server route
 * handlers AND the webview bundle; a client directive would turn its exports
 * into client references and break server-side calls.
 */

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
  wrongPin: (msg = "Wrong PIN.") => new ApiError(401, "wrong_pin", msg),
  locked: (msg: string) => new ApiError(423, "locked", msg),
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
