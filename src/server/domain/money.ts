/** Money helpers — everything is integer cents. */

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
