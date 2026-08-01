import { formatCents, formatCentsSigned } from "@/server/domain/money";

export function Money({ cents, currency = "USD", signed = false }: { cents: number; currency?: string; signed?: boolean }) {
  const text = signed ? formatCentsSigned(cents, currency) : formatCents(cents, currency);
  const isPositive = cents > 0;
  // signed (transactions): positive = money out → neutral, negative = income → success.
  // unsigned (balances): positive = you have it → neutral, negative = a liability → danger.
  const cls = signed ? (isPositive ? "text-text" : "text-success") : isPositive ? "text-text" : "text-danger";
  return (
    <span data-money className={cls}>
      {text}
    </span>
  );
}
