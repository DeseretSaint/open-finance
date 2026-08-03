/**
 * Fetch wrapper: cookie auth + CSRF header + standard error envelope handling.
 * 401 → redirect to /login (session expired / not signed in).
 *
 * Solo mode (P8b): when the webview runs standalone (no hub), API calls are
 * answered in-process by the solo router instead of HTTP — the same envelope,
 * same shapes, zero changes at call sites.
 */
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
    body:
      init.body && typeof init.body === "string"
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
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body !== undefined && typeof init.body !== "string") {
    headers["Content-Type"] = "application/json";
  }
  if (init.method && init.method !== "GET") {
    headers["x-of-request"] = "1";
  }
  const body: BodyInit | undefined =
    init.body === undefined || typeof init.body === "string" ? init.body : JSON.stringify(init.body);

  const { isSoloCandidate } = await import("@/lib/mobile-mode");
  const useSolo =
    typeof window !== "undefined" && isSoloCandidate(window.location.origin) && path.startsWith("/api/");

  const bodyStr = body as string | undefined;
  const res = useSolo
    ? await soloFetch(path, { ...init, headers, body: bodyStr } as RequestInit)
    : await fetch(path, {
        ...init,
        headers,
        body: bodyStr,
        credentials: "same-origin",
      });

  if (res.status === 401) {
    if (typeof window !== "undefined" && !path.startsWith("/api/auth/")) {
      window.location.href = "/login";
    }
    throw new ApiClientError(401, "unauthorized", "You must be signed in.");
  }

  const contentType = res.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json") ? await res.json() : null;

  if (!res.ok) {
    const code = (data as { error?: { code?: string; message?: string } })?.error?.code ?? "error";
    const message =
      (data as { error?: { code?: string; message?: string } })?.error?.message ??
      `Request failed (${res.status}).`;
    throw new ApiClientError(res.status, code, message);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "POST", body }),
  put: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "PUT", body }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "PATCH", body }),
  del: <T = void>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};
