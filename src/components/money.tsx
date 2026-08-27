import { formatCents, formatCentsSigned } from "@/server/domain/money";

/**
 * Money display. IMPORTANT color convention (matches the domain: positive =
 * money out / expense, negative = money in / income):
 *   - unsigned (balances, plan amounts): positive → neutral, negative → danger
 *   - signed (transaction rows): NO color — the caller wraps with its own
 *     color (expense → text-danger, income → text-success). Never set a color
 *     here for signed mode: callers must own the semantic color.
 */
export function Money({ cents, currency = "USD", signed = false }: { cents: number; currency?: string; signed?: boolean }) {
  const text = signed ? formatCentsSigned(cents, currency) : formatCents(cents, currency);
  const cls = !signed ? (cents < 0 ? "money text-danger" : "money") : "money";
  return (
    <span data-money className={cls}>
      {text}
    </span>
  );
}
