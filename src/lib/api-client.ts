/**
 * Fetch wrapper: cookie auth + CSRF header + standard error envelope handling.
 * 401 → redirect to /login (session expired / not signed in).
 *
 * Solo mode (P8b): when the webview runs standalone (no hub), API calls are
 * answered in-process by the solo router instead of HTTP — the same envelope,
 * same shapes, zero changes at call sites.
 */
import { hasWindow, isNativeString, withBase } from "@/lib/browser-env";

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function soloFetch(path: string, init: RequestInit): Promise<Response> {
  const { soloDispatch } = await import("@/lib/solo-router");
  const url = new URL(path, "http://solo.local");
  const result = await soloDispatch({
    method: init.method ?? "GET",
    path: url.pathname,
    query: url.searchParams,
    // SAFETY: body was JSON.stringify'd before dispatch; parse back to unknown for the solo router.
    body:
      init.body && isNativeString(init.body)
        ? (JSON.parse(init.body) as unknown)
        : undefined,
  });
  return new Response(
    result.data === null ? "" : JSON.stringify(result.data),
    {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    }
  );
}

export async function apiFetch<T = unknown>(
  path: string,
  init: Omit<RequestInit, "body"> & { body?: unknown } = {}
): Promise<T> {
  // SAFETY: init.headers is typed Omit<RequestInit,"body">&{body?:unknown}; values are string-keyed.
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body !== undefined && !isNativeString(init.body)) {
    headers["Content-Type"] = "application/json";
  }
  if (init.method && init.method !== "GET") {
    headers["x-of-request"] = "1";
  }
  const body: BodyInit | undefined =
    init.body === undefined || isNativeString(init.body) ? init.body : JSON.stringify(init.body);

  const { isSoloCandidate } = await import("@/lib/mobile-mode");
  const useSolo =
    hasWindow() && isSoloCandidate(window.location.origin) && path.startsWith("/api/");

  // SAFETY: body is BodyInit|undefined; narrow to string|undefined for the solo bridge.
  const bodyStr = body as string | undefined;
  // SAFETY: soloDispatch takes a plain object; cast the RequestInit-shaped argument.
  const res = useSolo
    ? await soloFetch(path, { ...init, headers, body: bodyStr } as RequestInit)
    : await fetch(path, {
        ...init,
        headers,
        body: bodyStr,
        credentials: "same-origin",
      });

  if (res.status === 401) {
    if (hasWindow() && !path.startsWith("/api/auth/")) {
      window.location.href = withBase("/login");
    }
    throw new ApiClientError(401, "unauthorized", "You must be signed in.");
  }

  const contentType = res.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json") ? await res.json() : null;

  if (!res.ok) {
    // SAFETY: non-JSON/empty responses leave data=null; the error shape exists only on failure.
    const code = (data as { error?: { code?: string; message?: string } })?.error?.code ?? "error";
    // SAFETY: same failure-shape narrowing as the code lookup above.
    const message =
      (data as { error?: { code?: string; message?: string } })?.error?.message ??
      `Request failed (${res.status}).`;
    throw new ApiClientError(res.status, code, message);
  }
  // SAFETY: data is unknown; callers supply T and the endpoint contract guarantees the shape.
  return data as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "POST", body }),
  put: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "PUT", body }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "PATCH", body }),
  del: <T = void>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};
