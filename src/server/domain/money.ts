/** Money helpers — everything is integer cents. */
import { apiErrors } from "@/lib/api-error";

/**
 * Upper bound on any stored money value (1e14 cents = $1 trillion). Personal
 * finance magnitudes never approach this; it exists to reject precision-loss /
 * accidental-extreme values (e.g. NaN, non-integers, or far-out-of-range inputs
 * that would corrupt aggregates) before they reach the DB. Well below
 * Number.MAX_SAFE_INTEGER (9e15) so no float rounding is possible.
 */
export const MAX_AMOUNT_CENTS = 1_000_000_000_000_000;

/** Throw a 400 if `cents` is not a finite integer within [-MAX, MAX]. */
export function assertValidCents(cents: number, label = "Amount"): void {
  if (!Number.isInteger(cents) || Math.abs(cents) > MAX_AMOUNT_CENTS) {
    throw apiErrors.badRequest(`${label} must be a whole number of cents within ±${(MAX_AMOUNT_CENTS / 100).toLocaleString("en-US")}.`);
  }
}

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}

export function formatCents(cents: number, currency = "USD"): string {
  const value = centsToDollars(cents);
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
  });
  const body = formatter.format(abs);
  return `${sign}${body}`;
}

export function formatCentsSigned(cents: number, currency = "USD"): string {
  const value = centsToDollars(cents);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    signDisplay: "always",
  }).format(value);
}
