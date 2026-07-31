/**
 * Fetch wrapper: cookie auth + CSRF header + standard error envelope handling.
 * 401 → redirect to /login (session expired / not signed in).
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
  const res = await fetch(path, {
    ...init,
    headers,
    body,
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
