import { randomBytes, randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { hashSecret } from "@/lib/crypto";
import { getDb, type Db } from "@/server/db/adapter";

export const SESSION_COOKIE = "of_session";
export const SESSION_TOKEN_PREFIX = "of_sess_";

export const DURATIONS = {
  "1h": 3600,
  "1d": 86400,
  "7d": 604800,
  "30d": 2592000,
  forever: null,
} as const;

export type Duration = keyof typeof DURATIONS;

export const FOREVER_IDLE_HOURS = 2160; // 90 days without use → auto-revoke
const COOKIE_MAX_AGE_CAP = 400 * 24 * 3600; // browser Max-Age limit

export interface SessionUser {
  id: string;
  username: string | null;
  display_name: string;
  email: string | null;
  is_demo: boolean;
}

export interface SessionInfo {
  id: string;
  userId: string;
  deviceLabel: string;
  createdAt: string;
  expiresAt: string | null;
  lastSeenAt: string;
  user: SessionUser;
}

export function isHttps(): boolean {
  return env.PUBLIC_URL.startsWith("https://");
}

export function newSessionToken(): string {
  return SESSION_TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

function now(): string {
  return new Date().toISOString();
}

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function getSessionToken(req: Request): string | null {
  const cookies = parseCookies(req.headers.get("cookie") ?? "");
  return cookies[SESSION_COOKIE] ?? null;
}

/** Create a session row; returns the raw token (shown once, hashed at rest). */
export async function createSession(
  userId: string,
  duration: Duration,
  deviceLabel: string,
  db: Db = getDb()
): Promise<{ token: string; expiresAt: string | null; idleTimeoutH: number | null }> {
  const token = newSessionToken();
  const seconds = DURATIONS[duration];
  const expiresAt = seconds ? new Date(Date.now() + seconds * 1000).toISOString() : null;
  const idleTimeoutH = duration === "forever" ? FOREVER_IDLE_HOURS : null;
  await db.run(
    `INSERT INTO sessions (id, user_id, token_hash, device_label, created_at, expires_at, idle_timeout_h, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    randomUUID(),
    userId,
    hashSecret(token),
    deviceLabel,
    now(),
    expiresAt,
    idleTimeoutH,
    now()
  );
  return { token, expiresAt, idleTimeoutH };
}

/** Validate a session from its raw token. Returns null if invalid/expired/revoked. */
export async function getSessionFromToken(
  token: string,
  db: Db = getDb()
): Promise<SessionInfo | null> {
  const row = await db.get<{
    id: string;
    user_id: string;
    device_label: string;
    created_at: string;
    expires_at: string | null;
    idle_timeout_h: number | null;
    last_seen_at: string;
    u_id: string;
    u_username: string | null;
    u_display_name: string;
    u_email: string | null;
    u_is_demo: number;
  }>(
    `SELECT s.id, s.user_id, s.device_label, s.created_at, s.expires_at, s.idle_timeout_h, s.last_seen_at,
            u.id AS u_id, u.username AS u_username, u.display_name AS u_display_name,
            u.email AS u_email, u.is_demo AS u_is_demo
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
    hashSecret(token)
  );
  if (!row) return null;

  const nowMs = Date.now();
  if (row.expires_at && new Date(row.expires_at).getTime() <= nowMs) return null;
  if (
    row.idle_timeout_h &&
    new Date(row.last_seen_at).getTime() + row.idle_timeout_h * 3600_000 <= nowMs
  ) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    deviceLabel: row.device_label,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    user: {
      id: row.u_id,
      username: row.u_username,
      display_name: row.u_display_name,
      email: row.u_email,
      is_demo: row.u_is_demo === 1,
    },
  };
}

export async function getSessionFromRequest(req: Request, db: Db = getDb()): Promise<SessionInfo | null> {
  const token = getSessionToken(req);
  if (!token) return null;
  const session = await getSessionFromToken(token, db);
  if (session) await touchSession(session.id, db);
  return session;
}

/** Throttled last_seen update (max once per 5 min per session). */
const touched = new Map<string, number>();
export async function touchSession(sessionId: string, db: Db = getDb()): Promise<void> {
  const nowMs = Date.now();
  if ((touched.get(sessionId) ?? 0) + 300_000 > nowMs) return;
  touched.set(sessionId, nowMs);
  await db.run("UPDATE sessions SET last_seen_at = ? WHERE id = ?", now(), sessionId);
}

export function sessionCookieMaxAge(duration: Duration): number {
  const seconds = DURATIONS[duration];
  return seconds ? Math.min(seconds, COOKIE_MAX_AGE_CAP) : COOKIE_MAX_AGE_CAP;
}
