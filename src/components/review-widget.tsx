"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ListChecks } from "lucide-react";
import { api } from "@/lib/api-client";
import { Card, CardLabel, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { Money } from "@/components/money";

interface Category {
  id: string;
  name: string;
  color: string | null;
}

interface ReviewTxn {
  id: string;
  name: string;
  merchantName: string | null;
  amountCents: number;
  date: string;
}

/**
 * ReviewWidget — surfaces the research-backed #1 chore (categorization) as a
 * single one-tap batch action on the dashboard. Shows transactions that a bank/
 * agent pulled but no human has confirmed a category for, lets you pick one
 * category and apply it to all of them at once (or per-row). No auto-categorization
 * engine — the human stays in control.
 */
export function ReviewWidget() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [bulkCategory, setBulkCategory] = useState<string>("");
  const [perRow, setPerRow] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  const review = useQuery({
    queryKey: ["review-queue"],
    queryFn: () => api.get<{ rows: ReviewTxn[]; total: number }>("/api/transactions?review=1&limit=50"),
  });
  const cats = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<{ categories: Category[] }>("/api/categories"),
  });

  const list = review.data?.rows ?? [];
  const catOptions = [
    { value: "", label: "Pick a category…" },
    ...(cats.data?.categories ?? []).map((c) => ({ value: c.id, label: c.name })),
  ];

  const apply = useMutation({
    mutationFn: (body: { ids: string[]; userCategoryId: string | null }) =>
      api.patch("/api/transactions/batch", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      setDone(true);
      setBulkCategory("");
      setPerRow({});
      setTimeout(() => setDone(false), 2500);
    },
  });

  const count = list.length;
  if (!open && count === 0) return null; // nothing to review — stay invisible

  return (
    <Card className="border-accent/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent" aria-hidden>
            <ListChecks size={18} />
          </span>
          <div>
            <CardLabel>Review transactions</CardLabel>
            <p className="text-sm font-medium text-text">
              {count > 0 ? `${count} need a category` : "All caught up"}
            </p>
          </div>
        </div>
        <span className="text-xs text-text-muted">{open ? "Hide" : "Review"}</span>
      </button>

      {open && count > 0 && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1">
              <label className="mb-1 block text-xs text-text-muted">Set all to</label>
              <CustomSelect ariaLabel="Bulk category" value={bulkCategory} onChange={setBulkCategory} options={catOptions} />
            </div>
            <Button
              disabled={!bulkCategory || apply.isPending}
              onClick={() => apply.mutate({ ids: list.map((t) => t.id), userCategoryId: bulkCategory })}
            >
              <Check size={14} className="mr-1.5" />
              {apply.isPending ? "Saving…" : `Apply to all ${count}`}
            </Button>
          </div>

          <div className="divide-y divide-border rounded-xl border border-border">
            {list.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text">{t.merchantName || t.name}</p>
                  <p className="money text-xs text-text-muted">
                    <Money cents={t.amountCents} /> · {t.date}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <CustomSelect
                    ariaLabel={`Category for ${t.name}`}
                    value={perRow[t.id] ?? ""}
                    onChange={(v) => {
                      setPerRow((p) => ({ ...p, [t.id]: v }));
                      if (v) apply.mutate({ ids: [t.id], userCategoryId: v });
                    }}
                    options={[{ value: "", label: "Uncategorized" }, ...(cats.data?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))]}
                  />
                </div>
              </div>
            ))}
          </div>
          {done && <p className="text-xs font-medium text-success">Saved. Refreshed your review queue.</p>}
        </div>
      )}
    </Card>
  );
}
