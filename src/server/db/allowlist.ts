/**
 * withAllowlist — the single choke point for BYOA account allowlists.
 * Every domain query that returns financial data must build its WHERE clause
 * through this helper so allowlists apply to summaries, reports, and net-worth.
 *
 * Returns a SQL fragment + params. `allowlist === null` means "all accounts
 * permitted by the token's scopes" (no restriction).
 */
export interface AllowlistCtx {
  /** Account IDs permitted; null = unrestricted (all accounts allowed by scopes). */
  accountIds: string[] | null;
}

// Identifier allowlist for the `column` argument. Callers pass hardcoded
// literals ("id", "a.id"), but the value is interpolated directly into SQL as
// an identifier (not a bound param), so we reject anything that isn't a valid
// column/qualified name. This is defense-in-depth against future regressions
// at the data-scoping choke point (OSS-publication hardening; cf. solo-backup
// column guard fb911f1).
const COLUMN_IDENT_RE = /^[_A-Za-z][_A-Za-z0-9]*(\.[_A-Za-z][_A-Za-z0-9]*)?$/;

export function withAllowlist(
  ctx: AllowlistCtx | null | undefined,
  column: string = "account_id",
): { clause: string; params: unknown[] } {
  if (!COLUMN_IDENT_RE.test(column)) {
    throw new Error(`withAllowlist: invalid column identifier ${JSON.stringify(column)}`);
  }
  if (!ctx || ctx.accountIds === null) {
    return { clause: "", params: [] };
  }
  const ids = ctx.accountIds;
  if (ids.length === 0) {
    // Empty allowlist = nothing visible.
    return { clause: ` AND 0 = 1`, params: [] };
  }
  const placeholders = ids.map(() => "?").join(", ");
  return { clause: ` AND ${column} IN (${placeholders})`, params: ids };
}

/** True when the given account id passes the allowlist. */
export function allowlistAllows(ctx: AllowlistCtx | null | undefined, accountId: string): boolean {
  if (!ctx || ctx.accountIds === null) return true;
  return ctx.accountIds.includes(accountId);
}
