"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, X, Trash2, ChevronDown, Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Money } from "@/components/money";

interface Txn {
  id: string;
  account_id: string;
  account_name: string;
  amount_cents: number;
  date: string;
  name: string;
  user_category_id: string | null;
  category_name: string | null;
  category_color: string | null;
  exclude_from_budgets: number;
  source: string;
}

interface Account {
  id: string;
  name: string;
}

interface Category {
  id: string;
  name: string;
}

function RowSkeleton() {
  return (
    <div className="space-y-1 divide-y divide-border">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-4">
          <div className="skeleton h-9 flex-1" />
          <div className="skeleton h-6 w-20" />
        </div>
      ))}
    </div>
  );
}

export default function TransactionsPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [accountId, setAccountId] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  // Track the visual viewport (keyboard) so the FAB rises above the keyboard.
  const [kbdHeight, setKbdHeight] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const onResize = () => {
      const vv = window.visualViewport!;
      const delta = Math.max(0, window.innerHeight - vv.height);
      // Ignore tiny jitter; treat a shrink > 100px as keyboard open.
      setKbdHeight(delta > 100 ? delta : 0);
    };
    window.visualViewport.addEventListener("resize", onResize);
    return () => window.visualViewport!.removeEventListener("resize", onResize);
  }, []);

  const params = useMemo(() => {
    const p = new URLSearchParams({ limit: "100" });
    if (q.trim()) p.set("q", q.trim());
    if (accountId) p.set("accountId", accountId);
    return p.toString();
  }, [q, accountId]);

  const { data, isLoading } = useQuery({
    queryKey: ["transactions", params],
    queryFn: () => api.get<{ rows: Txn[]; total: number }>(`/api/transactions?${params}`),
  });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api.get<{ accounts: Account[] }>("/api/accounts") });
  const categories = useQuery({ queryKey: ["categories"], queryFn: () => api.get<{ categories: Category[] }>("/api/categories") });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["summary"] });
    qc.invalidateQueries({ queryKey: ["budgets"] });
  };

  const setCategory = useMutation({
    mutationFn: ({ id, categoryId }: { id: string; categoryId: string | null }) =>
      api.patch(`/api/transactions/${id}`, { userCategoryId: categoryId }),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof Error ? e.message : "Update failed."),
  });

  const toggleExclude = useMutation({
    mutationFn: ({ id, exclude }: { id: string; exclude: boolean }) =>
      api.patch(`/api/transactions/${id}`, { excludeFromBudgets: exclude }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/transactions/${id}`),
    onSuccess: invalidate,
  });

  // Manual add form
  const [addName, setAddName] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [addDate, setAddDate] = useState(new Date().toISOString().slice(0, 10));
  const [addAccount, setAddAccount] = useState("");
  const [addCategory, setAddCategory] = useState("");

  const add = useMutation({
    mutationFn: () =>
      api.post("/api/transactions", {
        accountId: addAccount,
        amountCents: Math.round(parseFloat(addAmount) * 100),
        date: addDate,
        name: addName,
        userCategoryId: addCategory || null,
      }),
    onSuccess: () => {
      setAddName("");
      setAddAmount("");
      setAddCategory("");
      setError(null);
      setShowAdd(false);
      invalidate();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Add failed."),
  });

  return (
    <div className="space-y-6">
      {/* Sticky filter bar */}
      <Card className="sticky top-20 z-20 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-48 flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden />
            <Input
              aria-label="Search transactions"
              placeholder="Search transactions…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9 pr-8"
            />
            {q && (
              <button
                aria-label="Clear search"
                onClick={() => setQ("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:text-text"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="min-w-40">
            <Select aria-label="Filter by account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">All accounts</option>
              {accounts.data?.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
          <span className="text-sm text-text-muted">{data ? `${data.total} transaction${data.total === 1 ? "" : "s"}` : "…"}</span>
        </div>
      </Card>

      {/* Add-transaction modal */}
      {showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm md:items-center md:p-6"
          onClick={() => !add.isPending && setShowAdd(false)}
          style={{ bottom: kbdHeight > 0 ? `${kbdHeight}px` : undefined }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Add a transaction"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-border bg-surface p-5 shadow-2xl md:max-w-lg md:rounded-3xl"
            style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border md:hidden" />
            <div className="mb-4 flex items-center justify-between">
              <CardTitle>Add a transaction</CardTitle>
              <button
                aria-label="Close"
                onClick={() => !add.isPending && setShowAdd(false)}
                className="flex h-9 w-9 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
              >
                <X size={18} />
              </button>
            </div>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                add.mutate();
              }}
            >
              <div>
                <label htmlFor="add-name" className="mb-1 block text-xs font-medium text-text-muted">
                  Name
                </label>
                <Input id="add-name" placeholder="e.g. Coffee" value={addName} onChange={(e) => setAddName(e.target.value)} autoFocus />
              </div>
              <div>
                <label htmlFor="add-amount" className="mb-1 block text-xs font-medium text-text-muted">
                  Amount ($)
                </label>
                <Input
                  id="add-amount"
                  placeholder="0.00"
                  inputMode="decimal"
                  value={addAmount}
                  onChange={(e) => setAddAmount(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="add-date" className="mb-1 block text-xs font-medium text-text-muted">
                  Date
                </label>
                <Input id="add-date" type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} />
              </div>
              <div>
                <label htmlFor="add-account" className="mb-1 block text-xs font-medium text-text-muted">
                  Account
                </label>
                <Select id="add-account" value={addAccount} onChange={(e) => setAddAccount(e.target.value)}>
                  <option value="">Select…</option>
                  {accounts.data?.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label htmlFor="add-category" className="mb-1 block text-xs font-medium text-text-muted">
                  Category
                </label>
                <Select id="add-category" value={addCategory} onChange={(e) => setAddCategory(e.target.value)}>
                  <option value="">Uncategorized</option>
                  {categories.data?.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <p className="text-xs text-text-muted">Expenses are negative, income is positive — e.g. -45.00 for a purchase, 2500.00 for a paycheck.</p>
              {error && (
                <p role="alert" className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={add.isPending || !addName || !addAmount || !addAccount}>
                {add.isPending ? "Adding…" : "Add transaction"}
              </Button>
            </form>
          </div>
        </div>
      )}

      {/* Floating action button — bottom right, above the mobile tab bar.
          Hidden while the add modal is open; rises above the keyboard. */}
      {!showAdd && (
        <button
          aria-label="Add transaction"
          onClick={() => setShowAdd(true)}
          className="fixed right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-foreground)] shadow-lg transition-transform hover:scale-105 active:scale-95"
          style={{
            bottom: `calc(${kbdHeight > 0 ? kbdHeight : 0}px + ${kbdHeight > 0 ? "1rem" : "6rem"} + env(safe-area-inset-bottom))`,
          }}
        >
          <Plus size={26} strokeWidth={2.5} />
        </button>
      )}

      {/* List */}
      <Card className="p-0">
        {isLoading || !data ? (
          <RowSkeleton />
        ) : data.rows.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-text-muted">
              {q || accountId ? "No transactions match your filters." : "No transactions yet."}
            </p>
            {(q || accountId) && (
              <button
                className="mt-1 text-sm font-medium text-accent hover:underline"
                onClick={() => {
                  setQ("");
                  setAccountId("");
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {data.rows.map((t) => {
              const isExpense = t.amount_cents < 0;
              const expanded = expandedId === t.id;
              return (
                <div key={t.id}>
                  {/* summary row — tap to expand */}
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(expanded ? null : t.id)}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-muted/40 md:px-5"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: t.category_color ?? "var(--border)" }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-[15px] font-medium text-text">
                          {t.name}
                          {t.exclude_from_budgets === 1 && (
                            <span className="ml-2 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
                              excluded
                            </span>
                          )}
                        </span>
                        <span className={`money shrink-0 text-[15px] font-semibold ${isExpense ? "text-danger" : "text-success"}`}>
                          <Money cents={t.amount_cents} signed />
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-text-muted">
                        {t.date} · {t.account_name}
                      </span>
                    </span>
                    <ChevronDown
                      size={16}
                      aria-hidden
                      className={`shrink-0 text-text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
                    />
                  </button>

                  {/* expanded details — categorize, exclude, delete */}
                  {expanded && (
                    <div className="flex flex-wrap items-center gap-3 border-t border-border bg-surface-muted/40 px-4 py-3 md:px-5">
                      <label className="flex items-center gap-1.5 text-xs text-text-muted">
                        <input
                          type="checkbox"
                          checked={t.exclude_from_budgets === 1}
                          onChange={(e) => toggleExclude.mutate({ id: t.id, exclude: e.target.checked })}
                          className="h-4 w-4 accent-[var(--accent)]"
                        />
                        Exclude from budgets
                      </label>
                      <Select
                        aria-label={`Category for ${t.name}`}
                        className="h-8 w-40 text-xs"
                        value={t.user_category_id ?? ""}
                        onChange={(e) => setCategory.mutate({ id: t.id, categoryId: e.target.value || null })}
                      >
                        <option value="">Uncategorized</option>
                        {categories.data?.categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                      <div className="flex-1" />
                      {t.source === "manual" && (
                        <button
                          aria-label={`Delete ${t.name}`}
                          title="Delete transaction"
                          onClick={() => {
                            if (window.confirm(`Delete "${t.name}"? This cannot be undone.`)) remove.mutate(t.id);
                          }}
                          className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-text-muted transition-colors hover:bg-[var(--danger-soft)] hover:text-danger"
                        >
                          <Trash2 size={14} />
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
