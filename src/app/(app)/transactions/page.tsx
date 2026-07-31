"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

  if (isLoading || !data) return <p className="text-text-muted">Loading transactions…</p>;

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-48 flex-1">
            <Input placeholder="Search transactions…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="min-w-40">
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">All accounts</option>
              {accounts.data?.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
          <span className="text-sm text-text-muted">{data.total} transactions</span>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-40 flex-1">
            <label className="mb-1 block text-xs text-text-muted">Name</label>
            <Input placeholder="e.g. Coffee" value={addName} onChange={(e) => setAddName(e.target.value)} />
          </div>
          <div className="min-w-28">
            <label className="mb-1 block text-xs text-text-muted">Amount ($)</label>
            <Input
              placeholder="0.00"
              inputMode="decimal"
              value={addAmount}
              onChange={(e) => setAddAmount(e.target.value)}
            />
          </div>
          <div className="min-w-36">
            <label className="mb-1 block text-xs text-text-muted">Date</label>
            <Input type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} />
          </div>
          <div className="min-w-36">
            <label className="mb-1 block text-xs text-text-muted">Account</label>
            <Select value={addAccount} onChange={(e) => setAddAccount(e.target.value)}>
              <option value="">Select…</option>
              {accounts.data?.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-w-36">
            <label className="mb-1 block text-xs text-text-muted">Category</label>
            <Select value={addCategory} onChange={(e) => setAddCategory(e.target.value)}>
              <option value="">Uncategorized</option>
              {categories.data?.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          {error && <p className="w-full text-sm text-danger">{error}</p>}
          <Button
            disabled={add.isPending || !addName || !addAmount || !addAccount}
            onClick={() => add.mutate()}
          >
            {add.isPending ? "Adding…" : "Add transaction"}
          </Button>
        </div>
      </Card>

      <Card className="p-0">
        <div className="divide-y divide-border">
          {data.rows.length === 0 && <p className="p-6 text-sm text-text-muted">No transactions found.</p>}
          {data.rows.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text">{t.name}</p>
                <p className="text-xs text-text-muted">
                  {t.date} · {t.account_name}
                  {t.exclude_from_budgets ? " · excluded from budgets" : ""}
                </p>
              </div>
              {t.source === "manual" && (
                <button
                  onClick={() => remove.mutate(t.id)}
                  className="text-xs text-text-muted hover:text-danger"
                  title="Delete"
                >
                  ✕
                </button>
              )}
              <label className="flex items-center gap-1 text-xs text-text-muted" title="Exclude from budgets">
                <input
                  type="checkbox"
                  checked={t.exclude_from_budgets === 1}
                  onChange={(e) => toggleExclude.mutate({ id: t.id, exclude: e.target.checked })}
                />
                Exclude
              </label>
              <Select
                className="h-8 w-36 text-xs"
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
              <Badge className={t.amount_cents > 0 ? "bg-surface-muted text-text" : "bg-success/10 text-success"}>
                <Money cents={t.amount_cents} signed />
              </Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
