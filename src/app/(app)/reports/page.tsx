"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api-client";
import { Card, CardLabel, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/money";

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

const TOOLTIP_STYLE = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  color: "var(--foreground)",
  fontSize: 13,
};

function ChartEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-border">
      <p className="text-sm text-text-muted">{children}</p>
    </div>
  );
}

/** Month start ISO for `offset` months relative to now (0 = this month). */
function monthStart(offset: number): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + offset, 1).toISOString().slice(0, 10);
}

/** A reference date inside `offset` months relative to now. */
function refDate(offset: number): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + offset, 15).toISOString().slice(0, 10);
}

interface ProjectionPoint {
  month: string;
  balanceCents: number;
  flag: "danger" | "warning" | "ok";
}
interface Projection {
  baselineCents: number;
  monthlyIncomeCents: number;
  monthlyBillsCents: number;
  monthlyDebtCents: number;
  monthlyGoalCents: number;
  avgMonthlyExpensesCents: number;
  emergencyFund: { recommendedCents: number; monthsCovered: number | null };
  points: ProjectionPoint[];
  dangerMonths: string[];
  warningMonths: string[];
}

export default function ReportsPage() {
  // Selected month: 0 = current (month-to-date), negative = past, positive = future
  const [monthOffset, setMonthOffset] = useState(0);

  const monthLabel = useMemo(() => {
    const d = new Date();
    const m = new Date(d.getFullYear(), d.getMonth() + monthOffset, 1);
    return m.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }, [monthOffset]);

  const byCategory = useQuery({
    queryKey: ["reports", "by-category", monthOffset],
    queryFn: () => {
      const from = monthStart(monthOffset);
      const to = monthStart(monthOffset + 1);
      return api.get<{ rows: Array<{ categoryName: string; spentCents: number; color: string | null }> }>(
        `/api/reports/spending-by-category?from=${from}&to=${to}`
      );
    },
  });

  // Month summary (income / expense / net) for the selected month
  const monthSummary = useQuery({
    queryKey: ["summary", "ref", monthOffset],
    queryFn: () =>
      api.get<{ summary: { monthIncomeCents: number; monthExpenseCents: number; monthNetCents: number } }>(
        `/api/summary?ref=${refDate(monthOffset)}`
      ),
  });

  const cashflow = useQuery({
    queryKey: ["reports", "cashflow"],
    queryFn: () => api.get<{ rows: Array<{ month: string; incomeCents: number; expenseCents: number; netCents: number }> }>("/api/reports/cashflow?months=6"),
  });
  const netWorth = useQuery({
    queryKey: ["reports", "net-worth"],
    queryFn: () => api.get<{ netWorth: { assetsCents: number; liabilitiesCents: number; netCents: number } }>("/api/reports/net-worth"),
  });
  const projection = useQuery({
    queryKey: ["planning", "projection"],
    queryFn: () => api.get<Projection>("/api/planning/projection?months=12"),
  });

  const pieData = (byCategory.data?.rows ?? []).map((r) => ({
    name: r.categoryName,
    value: r.spentCents,
  }));
  const barData = (cashflow.data?.rows ?? []).map((r) => ({
    month: new Date(`${r.month}-01T00:00:00`).toLocaleDateString("en-US", { month: "short" }),
    Income: r.incomeCents / 100,
    Expenses: r.expenseCents / 100,
    Net: r.netCents / 100,
  }));
  const hasCashflow = barData.length > 0 && barData.some((r) => r.Income !== 0 || r.Expenses !== 0 || r.Net !== 0);

  const projData = (projection.data?.points ?? []).map((p) => ({
    month: new Date(`${p.month}-01T00:00:00`).toLocaleDateString("en-US", { month: "short" }),
    Balance: Math.round(p.balanceCents / 100),
  }));
  const hasProjection = projData.length > 0;

  const s = monthSummary.data?.summary;
  const isCurrentMonth = monthOffset === 0;
  const isPast = monthOffset < 0;

  return (
    <div className="space-y-6">
      {/* Month navigator */}
      <Card>
        <div className="flex items-center justify-between gap-3">
          <Button variant="secondary" size="sm" onClick={() => setMonthOffset((o) => o - 1)} aria-label="Previous month">
            <ChevronLeft size={16} />
          </Button>
          <div className="text-center">
            <p className="text-base font-semibold text-text">{monthLabel}</p>
            <p className="text-xs text-text-muted">
              {isPast ? "full month" : isCurrentMonth ? "month to date" : "future month (no transactions yet)"}
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setMonthOffset((o) => o + 1)} aria-label="Next month">
            <ChevronRight size={16} />
          </Button>
        </div>
        {monthOffset !== 0 && (
          <div className="mt-3 text-center">
            <Button variant="secondary" size="sm" onClick={() => setMonthOffset(0)}>
              Jump to current month
            </Button>
          </div>
        )}
      </Card>

      {/* Month summary — one row on desktop, stacked stat cards on phone */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <Card className="p-4 sm:p-6">
          <CardLabel>Income</CardLabel>
          <p className="mt-1 text-xl font-bold text-success sm:text-2xl">
            <Money cents={s?.monthIncomeCents ?? 0} signed />
          </p>
        </Card>
        <Card className="p-4 sm:p-6">
          <CardLabel>Spent</CardLabel>
          <p className="mt-1 text-xl font-bold text-danger sm:text-2xl">
            <Money cents={-(s?.monthExpenseCents ?? 0)} signed />
          </p>
        </Card>
        <Card className="p-4 sm:p-6">
          <CardLabel>Net</CardLabel>
          <p className={`mt-1 text-xl font-bold sm:text-2xl ${(s?.monthNetCents ?? 0) >= 0 ? "text-text" : "text-danger"}`}>
            <Money cents={s?.monthNetCents ?? 0} signed />
          </p>
        </Card>
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Spending by category — {monthLabel}</CardTitle>
          {pieData.length === 0 ? (
            <ChartEmpty>{isCurrentMonth ? "No spending this month yet." : "No spending in this month."}</ChartEmpty>
          ) : (
            <div className="mt-4 h-56 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={2}
                    stroke="var(--surface)"
                    strokeWidth={2}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => `$${(Number(value) / 100).toFixed(2)}`}
                    contentStyle={TOOLTIP_STYLE}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="mt-2 space-y-1">
            {pieData.map((r, i) => (
              <div key={r.name} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2 text-text-muted">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} aria-hidden />
                  <span className="truncate">{r.name}</span>
                </span>
                <span className="money shrink-0 text-text">
                  <Money cents={r.value} />
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardTitle>Cash flow — last 6 months</CardTitle>
          {!hasCashflow ? (
            <ChartEmpty>No cash flow data yet — add transactions to see trends.</ChartEmpty>
          ) : (
            <div className="mt-4 h-56 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: "var(--text-muted)", fontSize: 12 }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fill: "var(--text-muted)", fontSize: 12 }}
                    tickFormatter={(v: number) => `$${v}`}
                    tickLine={false}
                    axisLine={false}
                    width={50}
                  />
                  <Tooltip
                    formatter={(value) => `$${Number(value).toFixed(2)}`}
                    contentStyle={TOOLTIP_STYLE}
                    cursor={{ fill: "var(--surface-muted)" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }} />
                  <Bar dataKey="Income" fill="var(--success)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Expenses" fill="var(--chart-6)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Net" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {/* Future projection */}
      <Card>
        <CardTitle>Projection — next 12 months</CardTitle>
        {!hasProjection ? (
          <ChartEmpty>Add transactions to build a projection.</ChartEmpty>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap gap-4 text-sm">
              <span className="text-text-muted">
                Baseline: <span className="money text-text"><Money cents={projection.data?.baselineCents ?? 0} /></span>
              </span>
              <span className="text-text-muted">
                Est. income/mo: <span className="money text-success"><Money cents={projection.data?.monthlyIncomeCents ?? 0} /></span>
              </span>
              <span className="text-text-muted">
                Est. outflow/mo: <span className="money text-danger"><Money cents={projection.data?.avgMonthlyExpensesCents ?? 0} /></span>
              </span>
              <span className="text-text-muted">
                Emergency fund:{" "}
                <span className="money text-text">
                  {projection.data?.emergencyFund.monthsCovered != null
                    ? `${projection.data.emergencyFund.monthsCovered} months covered`
                    : "—"}
                </span>
              </span>
            </div>
            <div className="mt-4 h-56 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={projData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: "var(--text-muted)", fontSize: 12 }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fill: "var(--text-muted)", fontSize: 12 }}
                    tickFormatter={(v: number) => `$${v}`}
                    tickLine={false}
                    axisLine={false}
                    width={60}
                  />
                  <Tooltip
                    formatter={(value) => `$${Number(value).toFixed(2)}`}
                    contentStyle={TOOLTIP_STYLE}
                  />
                  <Line type="monotone" dataKey="Balance" stroke="var(--accent)" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {(projection.data?.dangerMonths.length ?? 0) > 0 && (
              <p className="mt-3 rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-danger">
                ⚠️ Balance is projected to go negative in: {projection.data?.dangerMonths.join(", ")}.
              </p>
            )}
          </>
        )}
      </Card>

      {/* Net worth — stacked on phone */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <Card className="p-4 sm:p-6">
          <CardLabel>Assets</CardLabel>
          <p className="mt-1 text-xl font-bold sm:text-2xl">
            <Money cents={netWorth.data?.netWorth.assetsCents ?? 0} />
          </p>
        </Card>
        <Card className="p-4 sm:p-6">
          <CardLabel>Liabilities</CardLabel>
          <p className="mt-1 text-xl font-bold text-danger sm:text-2xl">
            <Money cents={netWorth.data?.netWorth.liabilitiesCents ?? 0} />
          </p>
        </Card>
        <Card className="p-4 sm:p-6">
          <CardLabel>Net worth</CardLabel>
          <p className="mt-1 text-xl font-bold sm:text-2xl">
            <Money cents={netWorth.data?.netWorth.netCents ?? 0} />
          </p>
        </Card>
      </div>
    </div>
  );
}
