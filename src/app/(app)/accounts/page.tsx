"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { CreditCard, Landmark, PiggyBank, TrendingUp, Wallet, CircleHelp, Plus, X } from "lucide-react";
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

const TYPE_ICONS: Record<string, typeof Landmark> = {
  depository: Landmark,
  credit: CreditCard,
  investment: TrendingUp,
  loan: PiggyBank,
  other: Wallet,
};

function typeIcon(type: string | null) {
  return (type && TYPE_ICONS[type]) || CircleHelp;
}

function AccountsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton h-32" />
      ))}
    </div>
  );
}

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
      setShowAdd(false);
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

  return (
    <div className="space-y-6">
      {isLoading || !data ? (
        <AccountsSkeleton />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.accounts.map((a) => {
            const Icon = typeIcon(a.type);
            return (
              <Card key={a.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-text-muted" aria-hidden>
                      <Icon size={20} />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="truncate">{a.name}</CardTitle>
                      <p className="mt-0.5 truncate text-xs text-text-muted">
                        {a.institution_name ?? "Manual"} {a.mask ? `· ••••${a.mask}` : ""}
                      </p>
                    </div>
                  </div>
                  <Badge className={a.item_id ? "bg-accent/10 text-accent" : "bg-surface-muted text-text-muted"}>
                    {a.item_id ? "Connected" : "Manual"}
                  </Badge>
                </div>
                <div className="mt-4 flex items-end justify-between gap-2">
                  <p className="money text-2xl font-bold">
                    <Money cents={a.current_balance_cents ?? 0} currency={a.currency} />
                  </p>
                  {!a.item_id && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm(`Remove "${a.name}"? This cannot be undone.`)) remove.mutate(a.id);
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
          {data.accounts.length === 0 && (
            <Card className="sm:col-span-2 lg:col-span-3">
              <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
                <p className="text-sm text-text-muted">No accounts yet.</p>
                <p className="mt-1 text-sm">
                  <Link href="/settings" className="font-medium text-accent hover:underline">
                    Connect a bank
                  </Link>
                  <span className="text-text-muted"> or add a manual account below.</span>
                </p>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Add-account modal */}
      {showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm md:items-center md:p-6"
          onClick={() => !create.isPending && setShowAdd(false)}
          style={{ paddingBottom: kbdHeight > 0 ? `${kbdHeight}px` : undefined }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Add a manual account"
            onClick={(e) => e.stopPropagation()}
            className="w-full overflow-y-auto rounded-t-3xl border border-border bg-surface p-5 shadow-2xl md:max-w-lg md:rounded-3xl"
            style={{
              paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))",
              maxHeight: `calc(100dvh - ${kbdHeight}px - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 2rem)`,
            }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border md:hidden" />
            <div className="mb-4 flex items-center justify-between">
              <CardTitle>Add a manual account</CardTitle>
              <button
                aria-label="Close"
                onClick={() => !create.isPending && setShowAdd(false)}
                className="flex h-9 w-9 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
              >
                <X size={18} />
              </button>
            </div>
            <p className="mb-4 text-sm text-text-muted">For cash, wallets, or anything not connected through Plaid.</p>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
            >
              <div>
                <label htmlFor="acc-name" className="mb-1 block text-xs font-medium text-text-muted">
                  Name
                </label>
                <Input id="acc-name" placeholder="e.g. Cash wallet" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
              </div>
              <div>
                <label htmlFor="acc-type" className="mb-1 block text-xs font-medium text-text-muted">
                  Type
                </label>
                <Select id="acc-type" value={type} onChange={(e) => setType(e.target.value)}>
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label htmlFor="acc-balance" className="mb-1 block text-xs font-medium text-text-muted">
                  Balance ($)
                </label>
                <Input
                  id="acc-balance"
                  placeholder="0.00"
                  inputMode="decimal"
                  value={balance}
                  onChange={(e) => setBalance(e.target.value)}
                />
              </div>
              {error && (
                <p role="alert" className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={create.isPending || !name}>
                {create.isPending ? "Adding…" : "Add account"}
              </Button>
            </form>
          </div>
        </div>
      )}

      {/* Floating action button — bottom right, above the mobile tab bar */}
      {!showAdd && (
        <button
          aria-label="Add account"
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
