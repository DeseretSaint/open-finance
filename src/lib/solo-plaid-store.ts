"use client";

/**
 * Solo Plaid state (P8b) — device-local credential + item storage.
 *
 * In solo mode there is no server to encrypt/store Plaid keys, so they live
 * in the device's localStorage (the same trust boundary as the local SQLite
 * DB — keys never leave the phone). The native PlaidProxy plugin does the
 * actual Plaid REST calls with creds passed per-call.
 *
 * Items are stored as a lightweight list (id, institution, environment,
 * access token) so the UI can show what's linked and re-sync via the proxy.
 */

export interface SoloPlaidCreds {
  clientId: string;
  secret: string;
  environment: "sandbox" | "production";
  updatedAt: string;
}

export interface SoloPlaidItem {
  id: string;
  plaidItemId?: string;
  institutionName: string | null;
  environment: string;
  accessToken: string;
  linkedAt: string;
  /** "active" normally; "login_required" when Plaid reports ITEM_LOGIN_REQUIRED (re-auth needed). */
  status?: "active" | "login_required";
  /** Transactions-sync cursor (Plaid incremental sync); persisted so re-syncs only pull new/changed rows. */
  cursor?: string | null;
  accounts: Array<{ id: string; name: string; type: string | null; mask: string | null }>;
}

const CREDS_KEY = "of-solo-plaid-creds";
const ITEMS_KEY = "of-solo-plaid-items";

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    // SAFETY: raw JSON was written by this module's own write<T> path, so its shape matches T.
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / private mode — ignore */
  }
}

export function getSoloPlaidCreds(): SoloPlaidCreds | null {
  return read<SoloPlaidCreds>(CREDS_KEY);
}

export function setSoloPlaidCreds(creds: SoloPlaidCreds): void {
  write(CREDS_KEY, creds);
}

export function getSoloPlaidItems(): SoloPlaidItem[] {
  return read<SoloPlaidItem[]>(ITEMS_KEY) ?? [];
}

export function getSoloPlaidItem(id: string): SoloPlaidItem | null {
  return getSoloPlaidItems().find((i) => i.id === id) ?? null;
}

export function addSoloPlaidItem(item: SoloPlaidItem): void {
  const items = getSoloPlaidItems().filter((i) => i.id !== item.id);
  items.unshift(item);
  write(ITEMS_KEY, items);
}

export function removeSoloPlaidItem(id: string): void {
  write(ITEMS_KEY, getSoloPlaidItems().filter((i) => i.id !== id));
}

/** Persist the sync cursor for an item (incremental sync state). */
export function setSoloPlaidItemCursor(id: string, cursor: string | null): void {
  write(ITEMS_KEY, getSoloPlaidItems().map((i) => (i.id === id ? { ...i, cursor } : i)));
}

/** Mark an item as needing re-auth (Plaid ITEM_LOGIN_REQUIRED) so the UI shows Reconnect. */
export function markSoloPlaidItemLoginRequired(id: string): void {
  write(ITEMS_KEY, getSoloPlaidItems().map((i) => (i.id === id ? { ...i, status: "login_required" } : i)));
}

/** Clear the re-auth flag after a successful reconnect. */
export function clearSoloPlaidItemLoginRequired(id: string): void {
  write(ITEMS_KEY, getSoloPlaidItems().map((i) => (i.id === id ? { ...i, status: "active" } : i)));
}
