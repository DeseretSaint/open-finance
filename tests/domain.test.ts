import { describe, expect, it } from "vitest";
import { dollarsToCents, formatCents, formatCentsSigned } from "@/server/domain/money";
import { addDaysISO, addMonthsISO, daysBetween, monthlyEquivalent, monthsBetween } from "@/server/domain/dates";

describe("money", () => {
  it("converts dollars to cents without float drift", () => {
    expect(dollarsToCents(12.45)).toBe(1245);
    expect(dollarsToCents(0.1)).toBe(10);
  });

  it("formats cents with currency", () => {
    expect(formatCents(124532)).toBe("$1,245.32");
    expect(formatCents(-8500)).toBe("-$85.00");
  });

  it("formats signed cents", () => {
    expect(formatCentsSigned(320000)).toContain("+");
    expect(formatCentsSigned(-1250)).toContain("-");
  });
});

describe("dates", () => {
  it("adds days across month boundaries", () => {
    expect(addDaysISO("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysISO("2026-12-30", 5)).toBe("2027-01-04");
  });

  it("adds months with day clamping (leap years, short months)", () => {
    expect(addMonthsISO("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsISO("2024-01-31", 1)).toBe("2024-02-29"); // leap year
    expect(addMonthsISO("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonthsISO("2026-07-15", 6)).toBe("2027-01-15");
  });

  it("computes days and months between", () => {
    expect(daysBetween("2026-01-01", "2026-01-08")).toBe(7);
    expect(monthsBetween("2026-01-15", "2026-06-15")).toBe(5);
    expect(monthsBetween("2025-07-01", "2026-07-01")).toBe(12);
  });

  it("returns monthly equivalents for bill frequencies", () => {
    expect(monthlyEquivalent("weekly")).toBeCloseTo(4.345);
    expect(monthlyEquivalent("biweekly")).toBeCloseTo(2.175);
    expect(monthlyEquivalent("monthly")).toBe(1);
    expect(monthlyEquivalent("quarterly")).toBeCloseTo(1 / 3);
    expect(monthlyEquivalent("yearly")).toBeCloseTo(1 / 12);
    expect(monthlyEquivalent("one-time")).toBe(0);
  });
});
