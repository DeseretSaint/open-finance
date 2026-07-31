"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Money } from "@/components/money";

interface Account {
  id: string;
  item_id: string | null;
  name: string;
  type: string | null;
  mask: string | null;
  current_balance_cents: number | null;
  currency: string;
  institution_name: string | null;
}

const TYPES = ["depository", "credit", "investment", "loan", "other"];

export default function AccountsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<{ accounts: Account[] }>("/api/accounts"),
  });

  const [name, setName] = useState("");
  const [type, setType] = useState("depository");
  const [balance, setBalance] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post("/api/accounts", {
        name,
        type,
        currentBalanceCents: balance ? Math.round(parseFloat(balance) * 100) : null,
      }),
    onSuccess: () => {
      setName("");
      setBalance("");
      setError(null);
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Failed to add account."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/accounts/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
    },
  });

  if (isLoading || !data) return <p className="text-text-muted">Loading accounts…</p>;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.accounts.map((a) => (
          <Card key={a.id}>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle>{a.name}</CardTitle>
                <p className="mt-0.5 text-xs text-text-muted">
                  {a.institution_name ?? "Manual"} {a.mask ? `· ••••${a.mask}` : ""}
                </p>
              </div>
              <Badge className="bg-surface-muted text-text-muted">{a.type ?? "other"}</Badge>
            </div>
            <p className="mt-3 text-xl font-bold">
              <Money cents={a.current_balance_cents ?? 0} currency={a.currency} />
            </p>
            {!a.item_id && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-3 text-danger"
                disabled={remove.isPending}
                onClick={() => remove.mutate(a.id)}
              >
                Remove
              </Button>
            )}
          </Card>
        ))}
        {data.accounts.length === 0 && (
          <Card className="sm:col-span-2 lg:col-span-3">
            <p className="text-sm text-text-muted">
              No accounts yet. Add a manual account below, or connect a bank from Settings → Bank connections.
            </p>
          </Card>
        )}
      </div>

      <Card>
        <CardTitle>Add a manual account</CardTitle>
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="min-w-40 flex-1">
            <label className="mb-1 block text-xs text-text-muted">Name</label>
            <Input placeholder="e.g. Cash wallet" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="min-w-32">
            <label className="mb-1 block text-xs text-text-muted">Type</label>
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-w-32">
            <label className="mb-1 block text-xs text-text-muted">Balance ($)</label>
            <Input
              placeholder="0.00"
              inputMode="decimal"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
            />
          </div>
          {error && <p className="w-full text-sm text-danger">{error}</p>}
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Adding…" : "Add account"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
