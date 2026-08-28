"use client";

import { useRef, useState } from "react";
import { usePageTitle } from "@/lib/use-page-title";
import { useEscapeToClose } from "@/lib/use-escape-to-close";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, CalendarRange, ChevronDown, Pencil, Trash2, X } from "lucide-react";
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
  frameAmountCents: number;
  pct: number;
  categoryIds: string[];
  categoryNames: string[];
}

interface BudgetTxn {
  id: string;
  name: string;
  date: string;
  amount_cents: number;
  account_name: string | null;
  category_name: string | null;
  pending?: number;
}

interface Category {
  id: string;
  name: string;
}

type FrameKind = "period" | "week" | "month" | "quarter" | "year" | "30d" | "custom";

const FRAME_LABELS = {
  period: "Per-budget period",
  week: "This week",
  month: "This month",
  quarter: "This quarter",
  year: "This year",
  "30d": "Past 30 days",
  custom: "Custom range",
} satisfies Record<FrameKind, string>;

/** Short labels for the segmented control (custom stays out of the pills). */
const FRAME_PILLS: Array<{ kind: FrameKind; label: string }> = [
  { kind: "period", label: "Period" },
  { kind: "week", label: "Week" },
  { kind: "month", label: "Month" },
  { kind: "quarter", label: "Quarter" },
  { kind: "year", label: "Year" },
  { kind: "30d", label: "30d" },
];

function BudgetsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-busy="true" aria-label="Loading your budgets">
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton h-36" />
      ))}
    </div>
  );
}

/** Lazy-loaded transaction list shown when a budget card is expanded. */
function BudgetTxnList({
  budgetId,
  params,
  frameKey,
}: {
  budgetId: string;
  params: URLSearchParams;
  frameKey: unknown[];
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["budget-transactions", budgetId, ...frameKey],
    queryFn: () =>
      api.get<{ transactions: BudgetTxn[] }>(`/api/budgets/${budgetId}/transactions?${params.toString()}`),
  });

  if (isLoading) {
    return <div className="mt-3 space-y-2 border-t border-border pt-3"><div className="skeleton h-10" /><div className="skeleton h-10" /></div>;
  }
  if (error) {
    return (
      <p role="alert" className="mt-3 border-t border-border pt-3 text-xs text-danger">
        Couldn&apos;t load transactions.
      </p>
    );
  }
  const txns = data?.transactions ?? [];
  if (txns.length === 0) {
    return (
      <p className="mt-3 border-t border-border pt-3 text-xs text-text-muted">
        No transactions in this period.
      </p>
    );
  }
  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="mb-2 text-xs font-medium text-text-muted">Transactions</p>
      <ul className="space-y-1.5">
        {txns.map((t) => (
          <li key={t.id} className="flex min-w-0 items-center justify-between gap-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-text">{t.name}</span>
              <span className="block truncate text-xs text-text-muted">
                {t.date}
                {t.account_name ? ` · ${t.account_name}` : ""}
                {t.category_name ? ` · ${t.category_name}` : ""}
                {t.pending ? " · pending" : ""}
              </span>
            </span>
            <span className="money shrink-0 text-text">
              −<Money cents={-t.amount_cents} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function BudgetsPage() {
  usePageTitle("Budgets");
  const kbdHeight = useKeyboardHeight();
  const qc = useQueryClient();
  const [frame, setFrame] = useState<FrameKind>("period");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [includePending] = useIncludePending();

  // Keyboard navigation for the "Budget time frame" ARIA tablist (WAI-ARIA APG
  // pattern): only the active tab sits in the tab sequence (tabIndex 0); Arrow
  // Left/Right/Up/Down + Home/End move focus AND select. The custom-range pill
  // is the last tab in the order.
  const FRAME_ORDER: FrameKind[] = [...FRAME_PILLS.map((p) => p.kind), "custom"];
  const frameTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const onFrameKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
    let next = idx;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % FRAME_ORDER.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + FRAME_ORDER.length) % FRAME_ORDER.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = FRAME_ORDER.length - 1;
    else return;
    e.preventDefault();
    const kind = FRAME_ORDER[next];
    setFrame(kind);
    frameTabRefs.current[next]?.focus();
  };

  const params = new URLSearchParams({ frame });
  if (frame === "custom") {
    if (customStart) params.set("start", customStart);
    if (customEnd) params.set("end", customEnd);
  }
  if (!includePending) params.set("includePending", "0");

  const budgetsQuery = useQuery({
    queryKey: ["budgets", frame, customStart, customEnd, includePending],
    queryFn: () => api.get<{ budgets: Budget[] }>(`/api/budgets?${params.toString()}`),
  });
  const { data, isLoading } = budgetsQuery;
  const categories = useQuery({ queryKey: ["categories"], queryFn: () => api.get<{ categories: Category[] }>("/api/categories") });
  const summary = useQuery({
    queryKey: ["summary", frame, customStart, customEnd, includePending],
    queryFn: () =>
      api.get<{ summary: { monthIncomeCents: number; monthExpenseCents: number; monthNetCents: number } }>(
        `/api/summary?${params.toString()}`
      ),
  });

  // Surface fetch failures instead of leaving the user on BudgetsSkeleton forever.
  // Gated on no-data so a background refetch error never blanks already-rendered budgets.
  const failedQueries = [budgetsQuery, categories, summary].filter((q) => q.isError && !q.data);
  const hasFailed = failedQueries.length > 0;
  const isRetrying = failedQueries.some((q) => q.isFetching);
  const retry = () => failedQueries.forEach((q) => q.refetch());

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [period, setPeriod] = useState<"weekly" | "monthly" | "yearly">("monthly");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const dialogA11yRef = useDialogA11y(showAdd, closeModal);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string; error?: string } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);


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
    onSuccess: () => {
      invalidate();
      setConfirmDelete(null);
    },
    onError: (e) =>
      setConfirmDelete((c) => (c ? { ...c, error: e instanceof Error ? e.message : "Failed to delete budget." } : c)),
  });

  const update = useMutation({
    mutationFn: () =>
      api.patch(`/api/budgets/${editingId}`, {
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
      setEditingId(null);
      invalidate();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Failed to update budget."),
  });

  function openEdit(b: Budget) {
    setName(b.name);
    setAmount((b.amount_cents / 100).toFixed(2));
    setAmountTouched(false);
    // SAFETY: Budget.period is only "weekly"|"monthly"|"yearly" per the schema; the else branch routes to "monthly".
    setPeriod((b.period === "weekly" || b.period === "yearly" ? b.period : "monthly") as "weekly" | "monthly" | "yearly");
    setCategoryIds(b.categoryIds);
    setError(null);
    setEditingId(b.id);
    setShowAdd(true);
  }

  function closeModal() {
    if (create.isPending || update.isPending) return;
    setShowAdd(false);
    setEditingId(null);
    setName("");
    setAmount("");
    setAmountTouched(false);
    setCategoryIds([]);
    setError(null);
  }
  useEscapeToClose(closeModal, showAdd);

  function toggleCategory(id: string) {
    setCategoryIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  // Inline guard so a non-numeric / zero / negative amount is caught before it
  // round-trips to the server (which rejects with a generic 400). Server stays
  // authoritative for the final int().positive() check.
  const amountNum = Number(amount);
  const amountError =
    amount !== "" && (!Number.isFinite(amountNum) || amountNum <= 0)
      ? "Enter an amount greater than 0"
      : null;

  return (
    <div className="space-y-6">
      <h1 className="sr-only">Budgets</h1>
      {/* Widgets your AI added (dev:ui) */}
      <AgentWidgets tab="budgets" />

      {hasFailed && (
        <Card className="border-danger/30 bg-[var(--danger-soft)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="alert" className="text-sm text-danger">
              Couldn&apos;t load your budgets —{" "}
              {failedQueries.flatMap((q) => (q.error instanceof Error ? [q.error.message] : [])).join("; ") ||
                "Request failed"}
            </p>
            <Button variant="outline" disabled={isRetrying} onClick={retry}>
              {isRetrying ? "Retrying…" : "Try again"}
            </Button>
          </div>
        </Card>
      )}

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
              {FRAME_PILLS.map(({ kind, label }, i) => (
                <button
                  key={kind}
                  ref={(el) => { frameTabRefs.current[i] = el; }}
                  role="tab"
                  aria-selected={frame === kind}
                  tabIndex={frame === kind ? 0 : -1}
                  onClick={() => setFrame(kind)}
                  onKeyDown={(e) => onFrameKeyDown(e, i)}
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
              ref={(el) => { frameTabRefs.current[FRAME_PILLS.length] = el; }}
              role="tab"
              aria-selected={frame === "custom"}
              tabIndex={frame === "custom" ? 0 : -1}
              onClick={() => setFrame(frame === "custom" ? "month" : "custom")}
              onKeyDown={(e) => onFrameKeyDown(e, FRAME_PILLS.length)}
              className={`h-9 rounded-xl border px-3.5 text-sm transition-colors ${
                frame === "custom"
                  ? "border-accent bg-accent/10 font-medium text-accent-text"
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
              Income in the period, minus what you&apos;ve spent — it dwindles as expenses come in. This is your safe-to-spend pool.
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
                <p className="text-xs text-text-muted">Safe to spend</p>
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
            <div
              className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-surface-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(Math.min(100, (summary.data.summary.monthExpenseCents / Math.max(1, summary.data.summary.monthIncomeCents)) * 100))}
              aria-label="Percentage of this period's income spent"
            >
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, (summary.data.summary.monthExpenseCents / Math.max(1, summary.data.summary.monthIncomeCents)) * 100)}%`,
                  background:
                    summary.data.summary.monthNetCents < 0
                      ? "var(--danger)"
                      : summary.data.summary.monthExpenseCents / Math.max(1, summary.data.summary.monthIncomeCents) >= 0.85
                        ? "var(--warning)"
                        : "var(--accent)",
                }}
              />
            </div>
            {summary.data.summary.monthNetCents >= 0 && (frame === "month" || frame === "period") && (
              (() => {
                const daysLeft = Math.max(1, new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() - new Date().getDate() + 1);
                const perDayCents = Math.floor(summary.data!.summary.monthNetCents / daysLeft);
                return (
                  <p className="mt-2 text-xs text-text-muted">
                    About <span className="font-medium text-text"><Money cents={perDayCents} /></span> per day left this month.
                  </p>
                );
              })()
            )}
          </div>
        )}
      </Card>

      {isLoading || !data ? (
        <BudgetsSkeleton />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.budgets.map((b) => {
            const over = b.pct > 1;
            const near = !over && b.pct >= 0.85;
            const periodLabel = b.period === "weekly" ? "/week" : b.period === "yearly" ? "/year" : "/mo";
            const expanded = expandedId === b.id;
            return (
              <Card key={b.id}>
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : b.id)}
                    aria-expanded={expanded}
                    aria-label={expanded ? `Collapse ${b.name}` : `Expand ${b.name}`}
                    className="min-w-0 rounded-md text-left transition-opacity hover:opacity-80"
                  >
                    <CardTitle className="truncate">{b.name}</CardTitle>
                    <p className="mt-0.5 truncate text-xs text-text-muted">
                      {b.categoryNames.length > 0 ? b.categoryNames.join(", ") : "Uncategorized"}
                    </p>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      aria-label={expanded ? `Collapse ${b.name} transactions` : `Expand ${b.name} transactions`}
                      aria-expanded={expanded}
                      title={expanded ? "Collapse" : "See transactions"}
                      onClick={() => setExpandedId(expanded ? null : b.id)}
                      className={`flex h-9 w-9 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-muted hover:text-text ${
                        expanded ? "rotate-180 bg-surface-muted text-text" : ""
                      }`}
                    >
                      <ChevronDown size={15} />
                    </button>
                    <button
                      aria-label={`Edit budget ${b.name}`}
                      title="Edit budget"
                      onClick={() => openEdit(b)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      aria-label={`Delete budget ${b.name}`}
                      title="Delete budget"
                      onClick={() => setConfirmDelete({ id: b.id, name: b.name })}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-[var(--danger-soft)] hover:text-danger"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                <div className="mt-4">
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 text-sm">
                  <span className={`money min-w-0 ${over ? "font-medium text-danger" : near ? "font-medium text-[var(--warning)]" : "text-text"}`}>
                    <Money cents={b.spentCents} /> of <Money cents={b.frameAmountCents} />
                    <span className="text-xs text-text-muted">{frame !== "period" ? ` (${b.period} prorated)` : periodLabel}</span>
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
                <Progress value={b.pct} label={`${b.name} budget usage`} />
                {over && (
                  <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-danger">
                    <AlertTriangle size={13} aria-hidden className="shrink-0" />
                    Over budget — {Math.round(b.pct * 100)}% used.
                  </p>
                )}
                {near && (
                  <p className="mt-1.5 flex items-center gap-1 text-xs text-[var(--warning)]">
                    <AlertCircle size={13} aria-hidden className="shrink-0" />
                    Near limit — {Math.round(b.pct * 100)}% used.
                  </p>
                )}
                </div>
                {expanded && (
                  <BudgetTxnList
                    budgetId={b.id}
                    params={params}
                    frameKey={[frame, customStart, customEnd, includePending]}
                  />
                )}
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

      {/* Create/edit-budget modal */}
      {showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm md:items-center md:p-6"
          onClick={closeModal}
          style={{ paddingBottom: kbdHeight > 0 ? `${kbdHeight}px` : undefined }}
        >
          <div
            ref={dialogA11yRef}
            role="dialog"
            aria-modal="true"
            aria-label={editingId ? "Edit budget" : "Create a budget"}
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
              <CardTitle>{editingId ? "Edit budget" : "Create a budget"}</CardTitle>
              <button
                aria-label="Close"
                onClick={closeModal}
                className="flex h-9 w-9 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
              >
                <X size={18} />
              </button>
            </div>
            <p className="mb-4 text-sm text-text-muted">
              {editingId ? "Update the name, amount, period, or categories." : "Track spending in one or more categories per period."}
            </p>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (editingId) update.mutate();
                else create.mutate();
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
                  enterKeyHint="done"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  onBlur={() => setAmountTouched(true)}
                  aria-invalid={amountTouched && !!amountError}
                />
                {amountTouched && amountError && (
                  <p role="alert" className="mt-1 text-xs text-danger">{amountError}</p>
                )}
              </div>
              <div>
                <label id="budget-period-label" className="mb-1 block text-xs font-medium text-text-muted">
                  Period
                </label>
                <CustomSelect
                  ariaLabel="Budget period"
                  value={period}
                  // SAFETY: the only options are the three period literals, so v is one of them.
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
                          active ? "bg-[var(--accent)] text-[var(--accent-foreground)]" : "bg-surface-muted text-text-muted hover:text-text"
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
              <Button type="submit" disabled={create.isPending || update.isPending || !name || !amount || !!amountError}>
                {create.isPending || update.isPending
                  ? editingId ? "Saving…" : "Creating…"
                  : editingId ? "Save changes" : "Create budget"}
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
        message={confirmDelete ? `Budget "${confirmDelete.name}" and its category links will be removed.${confirmDelete.error ? ` ${confirmDelete.error}` : ""}` : undefined}
        confirmLabel="Delete"
        busy={remove.isPending}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) remove.mutate(confirmDelete.id);
        }}
      />
    </div>
  );
}
