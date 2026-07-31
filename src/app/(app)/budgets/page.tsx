"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export default function BudgetsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["budgets"],
    queryFn: () => api.get<{ budgets: Budget[] }>("/api/budgets"),
  });
  const categories = useQuery({ queryKey: ["categories"], queryFn: () => api.get<{ categories: Category[] }>("/api/categories") });

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["budgets"] });
    qc.invalidateQueries({ queryKey: ["summary"] });
  };

  const create = useMutation({
    mutationFn: () =>
      api.post("/api/budgets", {
        name,
        amountCents: Math.round(parseFloat(amount) * 100),
        categoryIds,
      }),
    onSuccess: () => {
      setName("");
      setAmount("");
      setCategoryIds([]);
      setError(null);
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

  if (isLoading || !data) return <p className="text-text-muted">Loading budgets…</p>;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.budgets.map((b) => (
          <Card key={b.id}>
            <div className="flex items-start justify-between">
              <CardTitle>{b.name}</CardTitle>
              <button onClick={() => remove.mutate(b.id)} className="text-xs text-text-muted hover:text-danger">
                ✕
              </button>
            </div>
            <p className="mt-0.5 text-xs text-text-muted">
              {b.categoryNames.length > 0 ? b.categoryNames.join(", ") : "Uncategorized"}
            </p>
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-sm">
                <span className={b.pct > 1 ? "font-medium text-danger" : "text-text"}>
                  <Money cents={b.spentCents} /> of <Money cents={b.amount_cents} />
                </span>
                <span className="text-text-muted">
                  {b.remainingCents >= 0 ? (
                    <>
                      <Money cents={b.remainingCents} /> left
                    </>
                  ) : (
                    <span className="text-danger">
                      <Money cents={-b.remainingCents} /> over
                    </span>
                  )}
                </span>
              </div>
              <Progress value={b.pct} />
            </div>
          </Card>
        ))}
        {data.budgets.length === 0 && (
          <Card className="sm:col-span-2 lg:col-span-3">
            <p className="text-sm text-text-muted">No budgets yet — create your first one below.</p>
          </Card>
        )}
      </div>

      <Card>
        <CardTitle>Create a budget</CardTitle>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-40 flex-1">
              <label className="mb-1 block text-xs text-text-muted">Name</label>
              <Input placeholder="e.g. Food" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="min-w-32">
              <label className="mb-1 block text-xs text-text-muted">Monthly amount ($)</label>
              <Input
                placeholder="500.00"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={create.isPending || !name || !amount}>
              {create.isPending ? "Creating…" : "Create budget"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {categories.data?.categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleCategory(c.id)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  categoryIds.includes(c.id)
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border text-text-muted hover:text-text"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
          <p className="text-xs text-text-muted">
            No categories selected = tracks Uncategorized spending.
          </p>
          {error && <p className="text-sm text-danger">{error}</p>}
        </form>
      </Card>
    </div>
  );
}
