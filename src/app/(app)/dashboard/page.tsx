"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { TrendingDown, TrendingUp, Wallet, Scale, Settings2, ChevronUp, ChevronDown, EyeOff, Eye, RotateCcw } from "lucide-react";
import { api } from "@/lib/api-client";
import { Card, CardLabel, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/badge";
import { Money } from "@/components/money";
import { AgentWidgets } from "@/components/agent-widgets";
import { ReviewWidget } from "@/components/review-widget";
import { useIncludePending } from "@/lib/pending-pref";
import { useDashboardLayout, type DashboardWidgetId } from "@/lib/dashboard-pref";

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

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="skeleton h-28" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-24" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="skeleton h-56" />
        <div className="skeleton h-56" />
      </div>
    </div>
  );
}

function formatShortDate(iso: string) {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const WIDGET_LABELS: Record<DashboardWidgetId, string> = {
  balance: "Total balance",
  stats: "Monthly stats",
  budgets: "Budgets",
  recent: "Recent transactions",
};

function BalanceCard({ s }: { s: Summary }) {
  const netPositive = s.monthNetCents >= 0;
  return (
    <Card
      className="border-accent/20"
      style={{ background: "linear-gradient(135deg, var(--accent-soft), transparent 55%), var(--surface)" }}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <CardLabel>Total balance</CardLabel>
          <p className="money mt-1 text-4xl font-bold tracking-tight">
            <Money cents={s.totalBalanceCents} />
          </p>
          <p className="mt-1.5 text-sm text-text-muted">
            Net this month:{" "}
            <span className={netPositive ? "font-medium text-success" : "font-medium text-danger"}>
              <Money cents={s.monthNetCents} signed />
            </span>
          </p>
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent-text" aria-hidden>
          <Wallet size={24} />
        </div>
      </div>
    </Card>
  );
}

function StatsRow({ s }: { s: Summary }) {
  const netPositive = s.monthNetCents >= 0;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Card>
        <div className="flex items-center gap-2 text-success">
          <TrendingUp size={16} aria-hidden />
          <CardLabel>Income this month</CardLabel>
        </div>
        <p className="money mt-1.5 text-2xl font-bold text-success">
          <Money cents={s.monthIncomeCents} />
        </p>
      </Card>
      <Card>
        <div className="flex items-center gap-2 text-text-muted">
          <TrendingDown size={16} aria-hidden />
          <CardLabel>Spent this month</CardLabel>
        </div>
        <p className="money mt-1.5 text-2xl font-bold">
          <Money cents={s.monthExpenseCents} />
        </p>
      </Card>
      <Card>
        <div className="flex items-center gap-2 text-text-muted">
          <Scale size={16} aria-hidden />
          <CardLabel>Net this month</CardLabel>
        </div>
        <p className={`money mt-1.5 text-2xl font-bold ${netPositive ? "text-success" : "text-danger"}`}>
          <Money cents={s.monthNetCents} signed />
        </p>
      </Card>
    </div>
  );
}

function BudgetsCard({ s }: { s: Summary }) {
  return (
    <Card className="min-w-0">
      <div className="flex items-center justify-between">
        <CardTitle>Budgets</CardTitle>
        <Link href="/budgets" className="text-sm font-medium text-accent-text hover:underline">
          View all
        </Link>
      </div>
      <div className="mt-4 space-y-4">
        {s.budgetOverview.length === 0 && (
          <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
            <p className="text-sm text-text-muted">No budgets yet.</p>
            <Link href="/budgets" className="mt-1 inline-block text-sm font-medium text-accent-text hover:underline">
              Create your first budget →
            </Link>
          </div>
        )}
        {s.budgetOverview.map((b) => (
          <div key={b.id} className="min-w-0">
            <div className="mb-1 flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate font-medium text-text">{b.name}</span>
              <span className={`money shrink-0 ${b.pct > 1 ? "font-medium text-danger" : "text-text-muted"}`}>
                <Money cents={b.spentCents} /> / <Money cents={b.amountCents} />
              </span>
            </div>
            <Progress value={b.pct} />
          </div>
        ))}
      </div>
    </Card>
  );
}

function RecentCard({ s }: { s: Summary }) {
  return (
    <Card className="min-w-0">
      <div className="flex items-center justify-between">
        <CardTitle>Recent transactions</CardTitle>
        <Link href="/transactions" className="text-sm font-medium text-accent-text hover:underline">
          View all
        </Link>
      </div>
      <div className="mt-2 divide-y divide-border">
        {s.recentTransactions.length === 0 && (
          <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
            <p className="text-sm text-text-muted">Nothing here yet.</p>
            <p className="mt-1 text-sm">
              <Link href="/settings" className="font-medium text-accent-text hover:underline">
                Connect a bank
              </Link>
              <span className="text-text-muted"> or </span>
              <Link href="/transactions" className="font-medium text-accent-text hover:underline">
                add a transaction manually
              </Link>
            </p>
          </div>
        )}
        {s.recentTransactions.map((t) => (
          <div key={t.id} className="flex min-w-0 items-center justify-between gap-3 py-2.5">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: t.categoryColor ?? "var(--border)" }}
                aria-hidden
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-text">{t.name}</p>
                <p className="truncate text-xs text-text-muted">
                  {t.categoryName ?? "Uncategorized"} · {t.accountName} · {formatShortDate(t.date)}
                </p>
              </div>
            </div>
            <span className={`money shrink-0 text-sm font-semibold ${t.amountCents < 0 ? "text-danger" : "text-success"}`}>
              <Money cents={t.amountCents} signed />
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function LayoutControls({
  id,
  index,
  count,
  hidden,
  onMove,
  onToggleHidden,
}: {
  id: DashboardWidgetId;
  index: number;
  count: number;
  hidden: boolean;
  onMove: (id: DashboardWidgetId, dir: -1 | 1) => void;
  onToggleHidden: (id: DashboardWidgetId) => void;
}) {
  const label = WIDGET_LABELS[id];
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onMove(id, -1)}
        disabled={index === 0}
        aria-label={`Move ${label} up`}
        className="rounded-lg p-1.5 text-text-muted hover:bg-surface-muted hover:text-text disabled:opacity-30"
      >
        <ChevronUp size={16} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => onMove(id, 1)}
        disabled={index === count - 1}
        aria-label={`Move ${label} down`}
        className="rounded-lg p-1.5 text-text-muted hover:bg-surface-muted hover:text-text disabled:opacity-30"
      >
        <ChevronDown size={16} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => onToggleHidden(id)}
        aria-label={hidden ? `Show ${label}` : `Hide ${label}`}
        aria-pressed={hidden}
        className="rounded-lg p-1.5 text-text-muted hover:bg-surface-muted hover:text-text"
      >
        {hidden ? <Eye size={16} aria-hidden /> : <EyeOff size={16} aria-hidden />}
      </button>
    </div>
  );
}

export default function DashboardPage() {
  const [includePending] = useIncludePending();
  const { layout, move, toggleHidden, reset } = useDashboardLayout();
  const [customizing, setCustomizing] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["summary", includePending],
    queryFn: () =>
      api.get<{ summary: Summary }>(`/api/summary${includePending ? "" : "?includePending=0"}`),
  });

  if (isLoading || !data) return <DashboardSkeleton />;
  const s = data.summary;

  const widgets: Record<DashboardWidgetId, ReactNode> = {
    balance: <BalanceCard s={s} />,
    stats: <StatsRow s={s} />,
    budgets: <BudgetsCard s={s} />,
    recent: <RecentCard s={s} />,
  };

  const visible = layout.order.filter((id) => !layout.hidden.includes(id));
  // Budgets + recent render side-by-side (as before) when adjacent in the
  // user's order; a reordered widget becomes a full-width block.
  const blocks: ReactNode[] = [];
  for (let i = 0; i < visible.length; i++) {
    const id = visible[i];
    const next = visible[i + 1];
    const isPair =
      (id === "budgets" && next === "recent") || (id === "recent" && next === "budgets");
    if (isPair) {
      blocks.push(
        <div key={`pair-${id}`} className="grid gap-6 lg:grid-cols-2">
          <div className="min-w-0">{widgets[id]}</div>
          <div className="min-w-0">{widgets[next]}</div>
        </div>,
      );
      i++;
    } else {
      blocks.push(<div key={id}>{widgets[id]}</div>);
    }
  }

  return (
    <div className="space-y-6 overflow-x-clip">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setCustomizing((c) => !c)}
          aria-pressed={customizing}
          aria-label={customizing ? "Done customizing dashboard layout" : "Customize dashboard layout"}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium ${
            customizing ? "bg-accent/10 text-accent-text" : "text-text-muted hover:bg-surface-muted hover:text-text"
          }`}
        >
          <Settings2 size={16} aria-hidden />
          {customizing ? "Done" : "Customize"}
        </button>
      </div>

      {/* Widgets your AI added (dev:ui) — removable inline */}
      <AgentWidgets tab="dashboard" />

      {/* One-tap review of transactions that still need a human-set category */}
      <ReviewWidget />

      {customizing && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Dashboard layout</CardTitle>
            <button
              type="button"
              onClick={reset}
              aria-label="Reset dashboard layout to default"
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-text-muted hover:bg-surface-muted hover:text-text"
            >
              <RotateCcw size={14} aria-hidden />
              Reset layout
            </button>
          </div>
          <div className="mt-3 divide-y divide-border">
            {layout.order.map((id, i) => {
              const hidden = layout.hidden.includes(id);
              return (
                <div key={id} className="flex items-center justify-between gap-3 py-2">
                  <span className={`text-sm font-medium ${hidden ? "text-text-muted line-through" : "text-text"}`}>
                    {WIDGET_LABELS[id]}
                  </span>
                  <LayoutControls
                    id={id}
                    index={i}
                    count={layout.order.length}
                    hidden={hidden}
                    onMove={move}
                    onToggleHidden={toggleHidden}
                  />
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {blocks}
    </div>
  );
}
