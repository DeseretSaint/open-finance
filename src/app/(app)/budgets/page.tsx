"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, Plus, X } from "lucide-react";
import { api } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/money";

interface Budget {
  id: string;
  name: string;
  amount_cents: number;
  period: string;
  spentCents: number;
  remainingCents: number;
  pct: number;
  categoryIds: string[];
  categoryNames: string[];
}

interface Category {
  id: string;
  name: string;
}

type FrameKind = "period" | "week" | "month" | "quarter" | "year" | "custom";

const FRAME_LABELS: Record<FrameKind, string> = {
  period: "Per-budget period",
  week: "This week",
  month: "This month",
  quarter: "This quarter",
  year: "This year",
  custom: "Custom range",
};

function BudgetsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton h-36" />
      ))}
    </div>
  );
}

export default function BudgetsPage() {
  const qc = useQueryClient();
  const [frame, setFrame] = useState<FrameKind>("period");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const params = new URLSearchParams({ frame });
  if (frame === "custom") {
    if (customStart) params.set("start", customStart);
    if (customEnd) params.set("end", customEnd);
  }

  const { data, isLoading } = useQuery({
    queryKey: ["budgets", frame, customStart, customEnd],
    queryFn: () => api.get<{ budgets: Budget[] }>(`/api/budgets?${params.toString()}`),
  });
  const categories = useQuery({ queryKey: ["categories"], queryFn: () => api.get<{ categories: Category[] }>("/api/categories") });
  const summary = useQuery({
    queryKey: ["summary", frame, customStart, customEnd],
    queryFn: () =>
      api.get<{ summary: { monthIncomeCents: number; monthExpenseCents: number; monthNetCents: number } }>(
        `/api/summary?${params.toString()}`
      ),
  });

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState<"weekly" | "monthly" | "yearly">("monthly");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [kbdHeight, setKbdHeight] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const onResize = () => {
      const vv = window.visualViewport!;
      const delta = Math.max(0, window.innerHeight - vv.height);
      setKbdHeight(delta > 100 ? delta : 0);
    };
    window.visualViewport.addEventListener("resize", onResize);
    return () => window.visualViewport!.removeEventListener("resize", onResize);
  }, []);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["budgets"] });
    qc.invalidateQueries({ queryKey: ["summary"] });
  };

  const create = useMutation({
    mutationFn: () =>
      api.post("/api/budgets", {
        name,
        amountCents: Math.round(parseFloat(amount) * 100),
        period,
        categoryIds,
      }),
    onSuccess: () => {
      setName("");
      setAmount("");
      setCategoryIds([]);
      setError(null);
      setShowAdd(false);
      invalidate();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Failed to create budget."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/budgets/${id}`),
    onSuccess: invalidate,
  });

  function toggleCategory(id: string) {
    setCategoryIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  return (
    <div className="space-y-6">
      {/* Time-frame selector */}
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1 rounded-xl bg-surface-muted p-1">
            {(Object.keys(FRAME_LABELS) as FrameKind[]).map((k) => (
              <button
                key={k}
                onClick={() => setFrame(k)}
                className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  frame === k ? "bg-surface font-medium text-text shadow-sm" : "text-text-muted hover:text-text"
                }`}
              >
                {FRAME_LABELS[k]}
              </button>
            ))}
          </div>
          {frame === "custom" && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="w-40" aria-label="From" />
              <span className="text-text-muted">→</span>
              <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="w-40" aria-label="To" />
            </div>
          )}
        </div>
      </Card>

      {/* Monthly pool — this month's income, dwindling as you spend */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <CardTitle>
              {frame === "period" ? "This month's pool" : `${FRAME_LABELS[frame]} pool`}
            </CardTitle>
            <p className="mt-1 text-xs text-text-muted">
              Income in the period, minus what you&apos;ve spent — it dwindles as expenses come in.
            </p>
          </div>
          {summary.data && (
            <div className="flex w-full flex-wrap items-end gap-x-6 gap-y-2 sm:w-auto sm:flex-nowrap">
              <div className="min-w-0">
                <p className="text-xs text-text-muted">Income</p>
                <p className="money truncate text-lg font-bold text-success">
                  <Money cents={summary.data.summary.monthIncomeCents} signed />
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-xs text-text-muted">Spent</p>
                <p className="money truncate text-lg font-bold text-danger">
                  <Money cents={-summary.data.summary.monthExpenseCents} signed />
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-xs text-text-muted">Remaining</p>
                <p className={`money truncate text-xl font-bold sm:text-2xl ${summary.data.summary.monthNetCents >= 0 ? "text-text" : "text-danger"}`}>
                  <Money cents={summary.data.summary.monthNetCents} signed />
                </p>
              </div>
            </div>
          )}
        </div>
        {summary.data && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-text-muted">
              <span>{Math.round((summary.data.summary.monthExpenseCents / Math.max(1, summary.data.summary.monthIncomeCents)) * 100)}% of income used</span>
              <span>{(summary.data.summary.monthNetCents / Math.max(1, summary.data.summary.monthIncomeCents)) >= 0 ? "left to spend" : "over income"}</span>
            </div>
            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-surface-muted">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, (summary.data.summary.monthExpenseCents / Math.max(1, summary.data.summary.monthIncomeCents)) * 100)}%`,
                  background:
                    summary.data.summary.monthNetCents >= 0 ? "var(--accent)" : "var(--danger)",
                }}
              />
            </div>
          </div>
        )}
      </Card>

      {isLoading || !data ? (
        <BudgetsSkeleton />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.budgets.map((b) => {
            const over = b.pct > 1;
            const periodLabel = b.period === "weekly" ? "/week" : b.period === "yearly" ? "/year" : "/mo";
            return (
              <Card key={b.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="truncate">{b.name}</CardTitle>
                    <p className="mt-0.5 truncate text-xs text-text-muted">
                      {b.categoryNames.length > 0 ? b.categoryNames.join(", ") : "Uncategorized"}
                    </p>
                  </div>
                  <button
                    aria-label={`Delete budget ${b.name}`}
                    title="Delete budget"
                    onClick={() => {
                      if (window.confirm(`Delete budget "${b.name}"?`)) remove.mutate(b.id);
                    }}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-[var(--danger-soft)] hover:text-danger"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="mt-4">
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 text-sm">
                    <span className={`money min-w-0 ${over ? "font-medium text-danger" : "text-text"}`}>
                      <Money cents={b.spentCents} /> of <Money cents={b.amount_cents} />
                      <span className="text-xs text-text-muted">{periodLabel}</span>
                    </span>
                    <span className="money shrink-0 text-text-muted">
                      {b.remainingCents >= 0 ? (
                        <>
                          <Money cents={b.remainingCents} /> left
                        </>
                      ) : (
                        <span className="font-medium text-danger">
                          <Money cents={-b.remainingCents} /> over
                        </span>
                      )}
                    </span>
                  </div>
                  <Progress value={b.pct} />
                </div>
              </Card>
            );
          })}
          {data.budgets.length === 0 && (
            <Card className="sm:col-span-2 lg:col-span-3">
              <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
                <p className="text-sm text-text-muted">No budgets yet — create your first one below.</p>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Create-budget modal */}
      {showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm md:items-center md:p-6"
          onClick={() => !create.isPending && setShowAdd(false)}
          style={{ paddingBottom: kbdHeight > 0 ? `${kbdHeight}px` : undefined }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Create a budget"
            onClick={(e) => e.stopPropagation()}
            className="w-full overflow-y-auto rounded-t-3xl border border-border bg-surface p-5 shadow-2xl md:max-w-lg md:rounded-3xl"
            style={{
              paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))",
              maxHeight: `calc(100dvh - ${kbdHeight}px - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 2rem)`,
            }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border md:hidden" />
            <div className="mb-4 flex items-center justify-between">
              <CardTitle>Create a budget</CardTitle>
              <button
                aria-label="Close"
                onClick={() => !create.isPending && setShowAdd(false)}
                className="flex h-9 w-9 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
              >
                <X size={18} />
              </button>
            </div>
            <p className="mb-4 text-sm text-text-muted">Track spending in one or more categories per period.</p>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
            >
              <div>
                <label htmlFor="budget-name" className="mb-1 block text-xs font-medium text-text-muted">
                  Name
                </label>
                <Input id="budget-name" placeholder="e.g. Groceries" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </div>
              <div>
                <label htmlFor="budget-amount" className="mb-1 block text-xs font-medium text-text-muted">
                  Amount ($)
                </label>
                <Input
                  id="budget-amount"
                  placeholder="0.00"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="budget-period" className="mb-1 block text-xs font-medium text-text-muted">
                  Period
                </label>
                <select
                  id="budget-period"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value as "weekly" | "monthly" | "yearly")}
                  className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-text outline-none focus:border-[var(--accent)]"
                >
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-text-muted">Categories (optional — leave empty to track uncategorized)</p>
                <div className="flex flex-wrap gap-2">
                  {categories.data?.categories.map((c) => {
                    const active = categoryIds.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => toggleCategory(c.id)}
                        className={`rounded-full px-3 py-1 text-sm transition-colors ${
                          active ? "bg-[var(--accent)] text-white" : "bg-surface-muted text-text-muted hover:text-text"
                        }`}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              {error && (
                <p role="alert" className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={create.isPending || !name || !amount}>
                {create.isPending ? "Creating…" : "Create budget"}
              </Button>
            </form>
          </div>
        </div>
      )}

      {/* Floating action button — bottom right, above the mobile tab bar */}
      {!showAdd && (
        <button
          aria-label="Create budget"
          onClick={() => setShowAdd(true)}
          className="fixed right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-foreground)] shadow-lg transition-transform hover:scale-105 active:scale-95"
          style={{
            bottom: `calc(${kbdHeight > 0 ? kbdHeight : 0}px + ${kbdHeight > 0 ? "1rem" : "6rem"} + env(safe-area-inset-bottom))`,
          }}
        >
          <Plus size={26} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
