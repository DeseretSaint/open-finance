"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, X, Trash2 } from "lucide-react";
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
  const [error, setError] = useState<string | null>(null);

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
      invalidate();
      setError(null);
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

      {/* Manual add */}
      <Card>
        <CardTitle>Add a transaction</CardTitle>
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <div className="min-w-40 flex-1">
            <label htmlFor="add-name" className="mb-1 block text-xs font-medium text-text-muted">
              Name
            </label>
            <Input id="add-name" placeholder="e.g. Coffee" value={addName} onChange={(e) => setAddName(e.target.value)} />
          </div>
          <div className="min-w-28">
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
          <div className="min-w-36">
            <label htmlFor="add-date" className="mb-1 block text-xs font-medium text-text-muted">
              Date
            </label>
            <Input id="add-date" type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} />
          </div>
          <div className="min-w-36">
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
          <div className="min-w-36">
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
          <p className="w-full text-xs text-text-muted">Positive amount = expense, negative = income.</p>
          {error && (
            <p role="alert" className="w-full rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" disabled={add.isPending || !addName || !addAmount || !addAccount}>
            {add.isPending ? "Adding…" : "Add transaction"}
          </Button>
        </form>
      </Card>

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
            {data.rows.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3 md:px-5">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: t.category_color ?? "var(--border)" }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text">
                    {t.name}
                    {t.exclude_from_budgets === 1 && (
                      <span className="ml-2 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
                        excluded
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-text-muted">
                    {t.date} · {t.account_name}
                  </p>
                </div>
                <button
                  aria-label={t.exclude_from_budgets === 1 ? "Include in budgets" : "Exclude from budgets"}
                  title={t.exclude_from_budgets === 1 ? "Include in budgets" : "Exclude from budgets"}
                  onClick={() => toggleExclude.mutate({ id: t.id, exclude: t.exclude_from_budgets !== 1 })}
                  className={`hidden h-9 shrink-0 items-center rounded-md border px-2 text-xs transition-colors sm:flex ${
                    t.exclude_from_budgets === 1
                      ? "border-accent text-accent"
                      : "border-border text-text-muted hover:text-text"
                  }`}
                >
                  {t.exclude_from_budgets === 1 ? "Included" : "Excluded"}
                </button>
                <Select
                  aria-label={`Category for ${t.name}`}
                  className="h-9 w-32 shrink-0 text-xs md:w-40"
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
                <span className={`money w-24 shrink-0 text-right text-sm font-semibold ${t.amount_cents > 0 ? "text-text" : "text-success"}`}>
                  <Money cents={t.amount_cents} signed />
                </span>
                {t.source === "manual" && (
                  <button
                    aria-label={`Delete ${t.name}`}
                    title="Delete"
                    onClick={() => remove.mutate(t.id)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-[var(--danger-soft)] hover:text-danger"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
