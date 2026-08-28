import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const src = readFileSync(join(root, "src/app/(app)/budgets/page.tsx"), "utf8");

describe("budget card header is clickable to expand/collapse", () => {
  it("wires the budget title header to the same expand toggle as the chevron", () => {
    // the CardTitle must sit inside a real <button> that toggles expandedId,
    // so mobile/click users (not just the small chevron) can open the txn list
    expect(src).toContain(
      'onClick={() => setExpandedId(expanded ? null : b.id)}',
    );
    expect(src).toContain('<CardTitle className="truncate">{b.name}</CardTitle>');
    // header button carries both aria-expanded + a matching Collapse/Expand label
    expect(src).toContain("aria-expanded={expanded}");
    expect(src).toContain("`Collapse ${b.name}` : `Expand ${b.name}`");
    // the original chevron toggle also got aria-expanded parity
    const chevron = src.includes(
      'aria-label={expanded ? `Collapse ${b.name} transactions` : `Expand ${b.name} transactions`}\n                      aria-expanded={expanded}',
    );
    expect(chevron).toBe(true);
  });
});
