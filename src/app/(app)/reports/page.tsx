"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api-client";
import { Card, CardLabel, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/money";

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

export default function ReportsPage() {
  const byCategory = useQuery({
    queryKey: ["reports", "by-category"],
    queryFn: () => {
      const now = new Date();
      const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 10);
      return api.get<{ rows: Array<{ categoryName: string; spentCents: number; color: string | null }> }>(
        `/api/reports/spending-by-category?from=${from}&to=${to}`
      );
    },
  });
  const cashflow = useQuery({
    queryKey: ["reports", "cashflow"],
    queryFn: () => api.get<{ rows: Array<{ month: string; incomeCents: number; expenseCents: number; netCents: number }> }>("/api/reports/cashflow?months=6"),
  });
  const netWorth = useQuery({
    queryKey: ["reports", "net-worth"],
    queryFn: () => api.get<{ netWorth: { assetsCents: number; liabilitiesCents: number; netCents: number } }>("/api/reports/net-worth"),
  });

  const pieData = (byCategory.data?.rows ?? []).map((r) => ({
    name: r.categoryName,
    value: r.spentCents,
  }));
  const barData = (cashflow.data?.rows ?? []).map((r) => ({
    month: r.month,
    Income: r.incomeCents / 100,
    Expenses: r.expenseCents / 100,
    Net: r.netCents / 100,
  }));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardLabel>Assets</CardLabel>
          <p className="mt-1 text-2xl font-bold">
            <Money cents={netWorth.data?.netWorth.assetsCents ?? 0} />
          </p>
        </Card>
        <Card>
          <CardLabel>Liabilities</CardLabel>
          <p className="mt-1 text-2xl font-bold text-danger">
            <Money cents={netWorth.data?.netWorth.liabilitiesCents ?? 0} />
          </p>
        </Card>
        <Card>
          <CardLabel>Net worth</CardLabel>
          <p className="mt-1 text-2xl font-bold">
            <Money cents={netWorth.data?.netWorth.netCents ?? 0} />
          </p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Spending by category — this month</CardTitle>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={2}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) => `$${(Number(value) / 100).toFixed(2)}`}
                  contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 space-y-1">
            {pieData.length === 0 && <p className="text-sm text-text-muted">No spending this month.</p>}
            {pieData.map((r) => (
              <div key={r.name} className="flex justify-between text-sm">
                <span className="text-text-muted">{r.name}</span>
                <span className="text-text">
                  <Money cents={r.value} />
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardTitle>Cash flow — last 6 months</CardTitle>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fill: "var(--text-muted)", fontSize: 12 }} />
                <YAxis tick={{ fill: "var(--text-muted)", fontSize: 12 }} />
                <Tooltip
                  formatter={(value) => `$${Number(value).toFixed(2)}`}
                  contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12 }}
                />
                <Bar dataKey="Income" fill="var(--success)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Expenses" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Net" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}
