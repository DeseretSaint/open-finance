"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, Trash2, X } from "lucide-react";
import { api } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomDatePicker } from "@/components/ui/custom-date-picker";
import { CustomSelect } from "@/components/ui/custom-select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FloatingAddButton } from "@/components/ui/floating-add-button";
import { Money } from "@/components/money";
import { AgentWidgets } from "@/components/agent-widgets";
import { useKeyboardHeight } from "@/lib/use-keyboard-height";
import { useIncludePending } from "@/lib/pending-pref";

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

/** Short labels for the segmented control (custom stays out of the pills). */
const FRAME_PILLS: Array<{ kind: FrameKind; label: string }> = [
  { kind: "period", label: "Period" },
  { kind: "week", label: "Week" },
  { kind: "month", label: "Month" },
  { kind: "quarter", label: "Quarter" },
  { kind: "year", label: "Year" },
];

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
  const kbdHeight = useKeyboardHeight();
  const qc = useQueryClient();
  const [frame, setFrame] = useState<FrameKind>("period");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [includePending] = useIncludePending();

  const params = new URLSearchParams({ frame });
  if (frame === "custom") {
    if (customStart) params.set("start", customStart);
    if (customEnd) params.set("end", customEnd);
  }
  if (!includePending) params.set("includePending", "0");

  const { data, isLoading } = useQuery({
    queryKey: ["budgets", frame, customStart, customEnd, includePending],
    queryFn: () => api.get<{ budgets: Budget[] }>(`/api/budgets?${params.toString()}`),
  });
  const categories = useQuery({ queryKey: ["categories"], queryFn: () => api.get<{ categories: Category[] }>("/api/categories") });
  const summary = useQuery({
    queryKey: ["summary", frame, customStart, customEnd, includePending],
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
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);


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
      {/* Widgets your AI added (dev:ui) */}
      <AgentWidgets tab="budgets" />

      {/* Time-frame selector */}
      <Card>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-muted text-text-muted" aria-hidden>
              <CalendarRange size={16} />
            </span>
            <div>
              <p className="text-sm font-medium text-text">Time frame</p>
              <p className="text-xs text-text-muted">
                {frame === "custom"
                  ? customStart && customEnd
                    ? `${customStart} → ${customEnd}`
                    : "Pick a start and end date"
                  : FRAME_LABELS[frame]}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="flex flex-wrap gap-1 rounded-xl bg-surface-muted p-1"
              role="tablist"
              aria-label="Budget time frame"
            >
              {FRAME_PILLS.map(({ kind, label }) => (
                <button
                  key={kind}
                  role="tab"
                  aria-selected={frame === kind}
                  onClick={() => setFrame(kind)}
                  className={`h-9 rounded-lg px-3.5 text-sm transition-colors ${
                    frame === kind
                      ? "bg-surface font-medium text-text shadow-sm"
                      : "text-text-muted hover:text-text"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              role="tab"
              aria-selected={frame === "custom"}
              onClick={() => setFrame(frame === "custom" ? "month" : "custom")}
              className={`h-9 rounded-xl border px-3.5 text-sm transition-colors ${
                frame === "custom"
                  ? "border-accent bg-accent/10 font-medium text-accent"
                  : "border-border text-text-muted hover:text-text"
              }`}
            >
              Custom
            </button>
          </div>
        </div>
        {frame === "custom" && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
            <CustomDatePicker ariaLabel="From" value={customStart} onChange={setCustomStart} className="w-40" />
            <span className="text-text-muted" aria-hidden>→</span>
            <CustomDatePicker ariaLabel="To" value={customEnd} onChange={setCustomEnd} className="w-40" />
            {(customStart || customEnd) && (
              <button
                type="button"
                onClick={() => {
                  setCustomStart("");
                  setCustomEnd("");
                }}
                className="flex h-10 items-center gap-1.5 rounded-md px-2.5 text-xs text-text-muted transition-colors hover:text-text"
              >
                <X size={14} /> Clear
              </button>
            )}
          </div>
        )}
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
                    onClick={() => setConfirmDelete({ id: b.id, name: b.name })}
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
            className="flex w-full max-h-[calc(100dvh-1rem)] flex-col overflow-hidden rounded-t-3xl border border-border bg-surface shadow-2xl md:max-h-[calc(100dvh-3rem)] md:max-w-lg md:rounded-3xl"
            style={{
              maxHeight: `calc(100dvh - ${kbdHeight}px - 1rem)`,
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
          >
            <div className="overflow-y-auto p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
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
                <label id="budget-period-label" className="mb-1 block text-xs font-medium text-text-muted">
                  Period
                </label>
                <CustomSelect
                  ariaLabel="Budget period"
                  value={period}
                  onChange={(v) => setPeriod(v as "weekly" | "monthly" | "yearly")}
                  options={[
                    { value: "weekly", label: "Weekly" },
                    { value: "monthly", label: "Monthly" },
                    { value: "yearly", label: "Yearly" },
                  ]}
                />
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
        </div>
      )}

      {/* Floating action button — bottom right, above the mobile tab bar */}
      <FloatingAddButton label="Create budget" onClick={() => setShowAdd(true)} hidden={showAdd} />

      {/* Custom delete confirmation */}
      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete budget?"
        message={confirmDelete ? `Budget "${confirmDelete.name}" and its category links will be removed.` : undefined}
        confirmLabel="Delete"
        busy={remove.isPending}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) remove.mutate(confirmDelete.id);
          setConfirmDelete(null);
        }}
      />
    </div>
  );
}
