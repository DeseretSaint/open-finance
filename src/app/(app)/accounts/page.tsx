"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { CreditCard, Landmark, PiggyBank, TrendingUp, Wallet, CircleHelp, X, ChevronUp, ChevronDown, Pencil, RotateCcw } from "lucide-react";
import { api } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomSelect } from "@/components/ui/custom-select";
import { Money } from "@/components/money";
import { useKeyboardHeight } from "@/lib/use-keyboard-height";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FloatingAddButton } from "@/components/ui/floating-add-button";

interface Account {
  id: string;
  item_id: string | null;
  name: string;
  name_override: string | null;
  official_name: string | null;
  type: string | null;
  subtype: string | null;
  mask: string | null;
  current_balance_cents: number | null;
  currency: string;
  institution_name: string | null;
  is_demo: number;
  include_in_net_worth: number;
  sort_order: number;
  description: string | null;
  deleted_at: string | null;
}

const TYPES = ["depository", "credit", "investment", "loan", "other"];
const TYPE_LABELS: Record<string, string> = {
  depository: "Cash / checking",
  credit: "Credit card",
  investment: "Investment",
  loan: "Loan / debt",
  other: "Other",
};

function isLiability(a: Pick<Account, "type" | "subtype">): boolean {
  return a.type === "credit" || a.type === "loan" || a.subtype === "credit card" || a.subtype === "auto loan";
}

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
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton h-32" />
      ))}
    </div>
  );
}

export default function AccountsPage() {
  const kbdHeight = useKeyboardHeight();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<{ accounts: Account[] }>("/api/accounts"),
  });
  const deleted = useQuery({
    queryKey: ["accounts", "deleted"],
    queryFn: () => api.get<{ accounts: Account[] }>("/api/accounts?deleted=1"),
  });

  const [name, setName] = useState("");
  const [type, setType] = useState("depository");
  const [balance, setBalance] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [editingDesc, setEditingDesc] = useState<string | null>(null);
  const [descDraft, setDescDraft] = useState("");
  const [editingName, setEditingName] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["accounts"] });
    qc.invalidateQueries({ queryKey: ["summary"] });
  };

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
      invalidate();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Failed to add account."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/accounts/${id}`),
    onSuccess: async () => {
      await qc.refetchQueries({ queryKey: ["accounts"] });
      await qc.refetchQueries({ queryKey: ["accounts", "deleted"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
    },
  });

  const restore = useMutation({
    mutationFn: (id: string) => api.post(`/api/accounts/${id}/restore`),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["accounts", "deleted"] });
    },
  });

  const toggleNetWorth = useMutation({
    mutationFn: ({ id, include }: { id: string; include: boolean }) =>
      api.patch(`/api/accounts/${id}`, { includeInNetWorth: include }),
    onSuccess: invalidate,
  });

  const setTypeOverride = useMutation({
    mutationFn: ({ id, type }: { id: string; type: string }) => api.patch(`/api/accounts/${id}`, { type }),
    onSuccess: invalidate,
  });

  const setDescription = useMutation({
    mutationFn: ({ id, description }: { id: string; description: string | null }) =>
      api.patch(`/api/accounts/${id}`, { description }),
    onSuccess: invalidate,
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.patch(`/api/accounts/${id}`, { name }),
    onSuccess: invalidate,
  });

  const reorder = useMutation({
    mutationFn: (orderedIds: string[]) => api.put("/api/accounts/order", { orderedIds }),
    onSuccess: invalidate,
  });

  function moveAccount(index: number, dir: -1 | 1) {
    if (!data) return;
    const ids = data.accounts.map((a) => a.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    reorder.mutate(ids);
  }

  function removeAccount(a: Account) {
    setConfirmDelete({ id: a.id, name: a.name });
  }

  const deletedAccounts = deleted.data?.accounts ?? [];

  return (
    <div className="min-w-0 space-y-6 overflow-x-hidden">
    {isLoading || !data ? (
        <AccountsSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.accounts.map((a, i) => {
            const Icon = typeIcon(a.type);
            const source = a.is_demo ? "Demo data" : a.institution_name ?? (a.item_id ? "Linked institution" : "Manual account");
            const detail = [
              source,
              a.subtype ? a.subtype.replace(/-/g, " ") : null,
              a.mask ? `••••${a.mask}` : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <Card key={a.id} className="min-w-0 overflow-hidden">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-text-muted" aria-hidden>
                      <Icon size={20} />
                    </div>
                    <div className="min-w-0">
                      {editingName === a.id ? (
                        <form className="flex min-w-0 items-center gap-1" onSubmit={(e) => { e.preventDefault(); rename.mutate({ id: a.id, name: nameDraft }); setEditingName(null); }}>
                          <Input aria-label={`Custom name for ${a.name}`} className="h-8 min-w-0" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus />
                          <Button type="submit" size="sm" disabled={rename.isPending}>Save</Button>
                        </form>
                      ) : (
                        <button type="button" className="block max-w-full truncate text-left text-base font-semibold text-text hover:text-accent" onClick={() => { setEditingName(a.id); setNameDraft(a.name); }}>
                          {a.name}
                        </button>
                      )}
                      <p className="mt-0.5 truncate text-xs text-text-muted">{detail}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col">
                    <button
                      aria-label="Move up"
                      disabled={i === 0 || reorder.isPending}
                      onClick={() => moveAccount(i, -1)}
                      className="flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-muted hover:text-text disabled:opacity-30"
                    >
                      <ChevronUp size={16} />
                    </button>
                    <button
                      aria-label="Move down"
                      disabled={i === data.accounts.length - 1 || reorder.isPending}
                      onClick={() => moveAccount(i, 1)}
                      className="flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-muted hover:text-text disabled:opacity-30"
                    >
                      <ChevronDown size={16} />
                    </button>
                  </div>
                </div>
                <div className="mt-4 flex items-end justify-between gap-2">
                  <p className={`money text-2xl font-bold ${isLiability(a) && (a.current_balance_cents ?? 0) < 0 ? "text-danger" : "text-text"}`}>
                    <Money cents={a.current_balance_cents ?? 0} currency={a.currency} signed={isLiability(a)} />
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger"
                    disabled={remove.isPending}
                    onClick={() => removeAccount(a)}
                  >
                    Remove
                  </Button>
                </div>
                {editingDesc === a.id ? (
                  <form
                    className="mt-3 flex items-center gap-2 border-t border-border pt-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setDescription.mutate({ id: a.id, description: descDraft || null });
                      setEditingDesc(null);
                    }}
                  >
                    <Input
                      aria-label={`Description for ${a.name}`}
                      value={descDraft}
                      onChange={(e) => setDescDraft(e.target.value)}
                      placeholder="What is this account for?"
                      maxLength={300}
                      autoFocus
                    />
                    <Button type="submit" size="sm" disabled={setDescription.isPending}>
                      Save
                    </Button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingDesc(a.id);
                      setDescDraft(a.description ?? "");
                    }}
                    className="mt-3 flex w-full items-center gap-1.5 border-t border-border pt-3 text-left text-xs text-text-muted transition-colors hover:text-text"
                  >
                    <Pencil size={12} className="shrink-0" />
                    <span className="truncate">{a.description ? `Notes: ${a.description}` : "Add a note about this account…"}</span>
                  </button>
                )}
                <div className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-2">
                  <CustomSelect
                    ariaLabel={`Type for ${a.name}`}
                    value={a.type ?? "other"}
                    onChange={(value) => setTypeOverride.mutate({ id: a.id, type: value })}
                    options={TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
                  />
                  <span className="self-center text-xs text-text-muted">
                    {isLiability(a) ? "Debt / liability — reduces net worth" : "Asset — increases net worth"}
                  </span>
                </div>
                <label
                  className={`mt-3 flex cursor-pointer items-center gap-2 border-t border-border pt-3 text-xs transition-colors ${
                    a.include_in_net_worth === 1 ? "text-text" : "text-text-muted"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                      a.include_in_net_worth === 1 ? "border-accent bg-accent text-[var(--accent-foreground)]" : "border-border bg-surface"
                    }`}
                  >
                    {a.include_in_net_worth === 1 && (
                      <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 6.5L4.5 9L10 3" />
                      </svg>
                    )}
                  </span>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={a.include_in_net_worth === 1}
                    onChange={(e) => toggleNetWorth.mutate({ id: a.id, include: e.target.checked })}
                  />
                  Include in net worth on Home
                </label>
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

      {/* Recently removed — restore soft-deleted accounts */}
      {deletedAccounts.length > 0 && (
        <Card>
          <div className="mb-2 flex items-center gap-2">
            <RotateCcw size={15} className="text-text-muted" />
            <CardTitle>Recently removed</CardTitle>
          </div>
          <p className="mb-3 text-xs text-text-muted">
            Removed accounts keep their history so they can be brought back. Tap Restore to undo a removal.
          </p>
          <Link href="/reports?includeExcluded=1" className="mb-3 inline-flex text-sm font-medium text-accent hover:underline">
            Review reports including removed-account history →
          </Link>
          <ul className="divide-y divide-border">
            {deletedAccounts.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{a.official_name ?? a.name}</p>
                  <p className="truncate text-xs text-text-muted">
                    {a.institution_name ?? "Manual"} {a.mask ? `· ••••${a.mask}` : ""}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate(a.id)}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </Card>
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
            className="flex w-full max-h-[calc(100dvh-1rem)] flex-col overflow-hidden rounded-t-3xl border border-border bg-surface shadow-2xl md:max-h-[calc(100dvh-3rem)] md:max-w-lg md:rounded-3xl"
            style={{
              maxHeight: `calc(100dvh - ${kbdHeight}px - 1rem)`,
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
          >
            <div className="overflow-y-auto p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
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
                <label id="acc-type-label" className="mb-1 block text-xs font-medium text-text-muted">
                  Type
                </label>
                <CustomSelect
                  ariaLabel="Account type"
                  value={type}
                  onChange={setType}
                  options={TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
                />
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
        </div>
      )}

      {/* Floating action button — bottom right, above the mobile tab bar */}
      <FloatingAddButton label="Add account" onClick={() => setShowAdd(true)} hidden={showAdd} />

      {/* Custom remove confirmation */}
      <ConfirmDialog
        open={confirmDelete !== null}
        title="Remove account?"
        message={confirmDelete ? `"${confirmDelete.name}" will be hidden. You can restore it later from “Recently removed”.` : undefined}
        confirmLabel="Remove"
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
