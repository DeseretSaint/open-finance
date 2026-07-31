"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Card, CardLabel, CardTitle } from "@/components/ui/card";
import { Badge, Progress } from "@/components/ui/badge";
import { Money } from "@/components/money";

interface Summary {
  totalBalanceCents: number;
  byType: Record<string, number>;
  monthIncomeCents: number;
  monthExpenseCents: number;
  monthNetCents: number;
  budgetOverview: Array<{ id: string; name: string; spentCents: number; amountCents: number; pct: number }>;
  recentTransactions: Array<{
    id: string;
    accountName: string;
    amountCents: number;
    date: string;
    name: string;
    categoryName: string | null;
    categoryColor: string | null;
  }>;
}

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["summary"],
    queryFn: () => api.get<{ summary: Summary }>("/api/summary"),
  });

  if (isLoading || !data) return <p className="text-text-muted">Loading dashboard…</p>;
  const s = data.summary;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardLabel>Total balance</CardLabel>
          <p className="mt-1 text-2xl font-bold">
            <Money cents={s.totalBalanceCents} />
          </p>
        </Card>
        <Card>
          <CardLabel>Income this month</CardLabel>
          <p className="mt-1 text-2xl font-bold text-success">
            <Money cents={s.monthIncomeCents} />
          </p>
        </Card>
        <Card>
          <CardLabel>Spent this month</CardLabel>
          <p className="mt-1 text-2xl font-bold">
            <Money cents={s.monthExpenseCents} />
          </p>
        </Card>
        <Card>
          <CardLabel>Net this month</CardLabel>
          <p className={`mt-1 text-2xl font-bold ${s.monthNetCents >= 0 ? "text-success" : "text-danger"}`}>
            <Money cents={s.monthNetCents} signed />
          </p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Budgets</CardTitle>
          <div className="mt-4 space-y-4">
            {s.budgetOverview.length === 0 && (
              <p className="text-sm text-text-muted">No budgets yet — add one on the Budgets tab.</p>
            )}
            {s.budgetOverview.map((b) => (
              <div key={b.id}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium text-text">{b.name}</span>
                  <span className="text-text-muted">
                    <Money cents={b.spentCents} /> / <Money cents={b.amountCents} />
                  </span>
                </div>
                <Progress value={b.pct} />
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardTitle>Recent transactions</CardTitle>
          <div className="mt-4 divide-y divide-border">
            {s.recentTransactions.length === 0 && (
              <p className="text-sm text-text-muted">
                Nothing here yet — connect a bank or add a transaction manually.
              </p>
            )}
            {s.recentTransactions.map((t) => (
              <div key={t.id} className="flex items-center justify-between py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text">{t.name}</p>
                  <p className="text-xs text-text-muted">
                    {t.accountName} · {t.categoryName ?? "Uncategorized"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {t.categoryName && (
                    <Badge
                      className="text-text-muted"
                      style={{ background: "color-mix(in srgb, var(--accent) 12%, transparent)" }}
                    >
                      {t.categoryName}
                    </Badge>
                  )}
                  <span className="text-sm">
                    <Money cents={t.amountCents} signed />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
