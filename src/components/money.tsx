import { formatCents, formatCentsSigned } from "@/server/domain/money";

export function Money({ cents, currency = "USD", signed = false }: { cents: number; currency?: string; signed?: boolean }) {
  const text = signed ? formatCentsSigned(cents, currency) : formatCents(cents, currency);
  const isPositive = cents > 0;
  const isExpense = cents > 0; // app convention: positive = money out
  return (
    <span
      data-money
      className={
        signed
          ? isPositive
            ? "text-text"
            : "text-success"
          : isExpense
            ? "text-text"
            : "text-success"
      }
    >
      {text}
    </span>
  );
}
