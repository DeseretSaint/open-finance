"use client";

import { useMemo, useState } from "react";
import { useEscapeToClose } from "@/lib/use-escape-to-close";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, X, Trash2, ChevronDown, RefreshCw, Upload } from "lucide-react";
import { api } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomDatePicker } from "@/components/ui/custom-date-picker";
import { CustomSelect } from "@/components/ui/custom-select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FloatingAddButton } from "@/components/ui/floating-add-button";
import { Money } from "@/components/money";
import { useKeyboardHeight } from "@/lib/use-keyboard-height";

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
  pending: number;
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
  const kbdHeight = useKeyboardHeight();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [accountId, setAccountId] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  useEscapeToClose(() => { if (!add.isPending) setShowAdd(false); }, showAdd);
  const addDialogA11yRef = useDialogA11y(showAdd);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [limit, setLimit] = useState(200);

  const params = useMemo(() => {
    const p = new URLSearchParams({ limit: String(limit) });
    if (q.trim()) p.set("q", q.trim());
    if (accountId) p.set("accountId", accountId);
    if (pendingOnly) p.set("pending", "1");
    return p.toString();
  }, [q, accountId, pendingOnly, limit]);

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
    // Categorizing here must refresh the dashboard's review queue — otherwise
    // "N need a category" shows transactions already categorized in this tab.
    qc.invalidateQueries({ queryKey: ["review-queue"] });
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

  // Manual refresh: pull posted + pending transactions straight from the bank.
  // Works in solo mode (native Plaid proxy) and on the hub. In solo mode the
  // sync also fires the global "of:data-synced" event, but we invalidate here
  // too so hub-mode refreshes update the list immediately.
  const syncNow = useMutation({
    mutationFn: () => api.post<{ results: Array<{ institution_name: string | null; added: number; modified: number; removed: number; ok: boolean; error?: string }> }>("/api/transactions/sync"),
    onSuccess: (d) => {
      const changed = d.results.reduce((n, r) => n + r.added + r.modified, 0);
      const failed = d.results.filter((r) => !r.ok);
      if (failed.length > 0) {
        const needsLogin = failed.some((f) => /ITEM_LOGIN_REQUIRED|login details of this item have changed|user login is required/i.test(f.error ?? ""));
        if (needsLogin) {
          setError(
            `Some banks need you to sign in again. Go to Settings → Bank connections and tap “Reconnect” on the institution that needs it, then sync again. (${
              failed.map((f) => f.institution_name ?? "an institution").join("; ")
            })`
          );
        } else {
          setError(`Refresh finished with errors: ${failed.map((f) => `${f.institution_name ?? "an institution"}${f.error ? `: ${f.error}` : ""}`).join("; ")}`);
        }
      } else {
        setError(null);
        setRefreshMsg(changed === 0 ? "Up to date — nothing new." : `Synced — ${changed} transaction${changed === 1 ? "" : "s"} updated.`);
      }
      invalidate();
      qc.invalidateQueries({ queryKey: ["reports"] });
      qc.invalidateQueries({ queryKey: ["planning"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Refresh failed."),
    });

    // Pull FULL history from Plaid for every linked bank (cursor reset → Plaid
    // re-delivers everything it has). Reports the OLDEST date per bank so the
    // user can see which banks have deeper history (older link dates) vs which
    // are genuinely capped by Plaid. Plaid only serves history from when each
    // bank was first linked — there is no API to retrieve older transactions.
    const [historyMsg, setHistoryMsg] = useState<string | null>(null);
    const [historyDetail, setHistoryDetail] = useState<Array<{ name: string; oldest: string | null; added: number; ok: boolean; linkedAt: string | null }>>([]);
    // After "Pull full history", if the banks returned nothing new (institution
    // caps history at ~90 days through Plaid), pop up a suggestion to import
    // older history from bank-downloaded CSV files instead.
    const [showCsvSuggestion, setShowCsvSuggestion] = useState(false);
    useEscapeToClose(() => setShowCsvSuggestion(false), showCsvSuggestion);
    const csvSuggestionA11yRef = useDialogA11y(showCsvSuggestion);
    const pullHistory = useMutation({
      mutationFn: async () => {
        setHistoryMsg(null);
        setError(null);
        setHistoryDetail([]);
        setShowCsvSuggestion(false);
        const items = await api.get<{ items: Array<{ id: string; institution_name: string | null; linkedAt: string | null; accounts: Array<{ name: string }> }> }>("/api/plaid/items").catch(() => ({ items: [] as Array<{ id: string; institution_name: string | null; linkedAt: string | null; accounts: Array<{ name: string }> }> }));
        const detail: Array<{ name: string; oldest: string | null; added: number; ok: boolean; linkedAt: string | null }> = [];
        let oldest: string | null = null;
        let totalAdded = 0;
        let failed = 0;
        for (const it of items.items) {
          const label = it.institution_name ?? it.accounts?.[0]?.name ?? "Bank";
          const r = await api.post<{ ok: boolean; added: number; oldestDate: string | null; error?: string | null }>(
            "/api/plaid/resync",
            { itemId: it.id }
          ).catch(() => ({ ok: false, added: 0, oldestDate: null as string | null, error: "request failed" }));
          if (r.ok) {
            totalAdded += r.added;
            if (r.oldestDate && (oldest === null || r.oldestDate < oldest)) oldest = r.oldestDate;
          } else {
            failed++;
          }
          detail.push({ name: label, oldest: r.oldestDate ?? null, added: r.added, ok: r.ok, linkedAt: it.linkedAt ?? null });
        }
        setHistoryDetail(detail);
        setHistoryMsg(
          items.items.length === 0
            ? "No banks linked yet."
            : oldest
              ? `Full history pulled — earliest across all banks is ${oldest}. Check each bank below: banks with older link dates should reach further back; if one stops early, its re-import may have failed (${failed} failed).`
              : `Full history pulled — ${totalAdded} transaction(s) updated.`
        );
        // Nothing new came back from any bank → the institutions are serving
        // their full window (typically ~90 days). Suggest the CSV import path.
        if (items.items.length > 0 && totalAdded === 0 && failed === 0) {
          setShowCsvSuggestion(true);
        }
        invalidate();
        qc.invalidateQueries({ queryKey: ["plaid-items"] });
      },
      onError: (e) => setError(e instanceof Error ? e.message : "History pull failed."),
    });

    // GLOBAL older-history backfill REMOVED (v0.3.39): it duplicated "Pull full
    // history" — both pull what Plaid has, and institutions that cap at ~90 days
    // return the same window either way. Kept only "Pull full history".

    // Manual add form
    const [addName, setAddName] = useState("");
    const [addAmount, setAddAmount] = useState("");
    const [addDate, setAddDate] = useState(new Date().toISOString().slice(0, 10));
    const [addAccount, setAddAccount] = useState("");
    const [addCategory, setAddCategory] = useState("");
    const [addExclude, setAddExclude] = useState(false);

  // Inline amount validation (run-59 budgets pattern): catch non-numeric /
  // zero amounts before they round-trip to the server's generic 400. Number()
  // — not parseFloat — so "1,000" is rejected as invalid instead of silently
  // recording $1.00 (parseFloat stops at the comma). Server stays authoritative
  // for the final int + non-zero checks.
  const addAmountNum = Number(addAmount);
  const addAmountError =
    addAmount !== "" && (!Number.isFinite(addAmountNum) || addAmountNum === 0)
      ? !Number.isFinite(addAmountNum)
        ? "Enter a valid amount."
        : "Amount cannot be zero."
      : null;

  const add = useMutation({
    mutationFn: () =>
      api.post("/api/transactions", {
        accountId: addAccount,
        amountCents: Math.round(addAmountNum * 100),
        date: addDate,
        name: addName,
        userCategoryId: addCategory || null,
        excludeFromBudgets: addExclude,
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

  // Bank CSV import (manual older-history): user downloads a CSV from their
  // bank's website, picks the account it belongs to, and we parse + dedupe +
  // insert. This is the built-in path for history the bank won't serve through
  // Plaid (institution ~90-day caps).
  const [showImport, setShowImport] = useState(false);
  useEscapeToClose(() => { if (!importCsv.isPending) setShowImport(false); }, showImport);
  const importDialogA11yRef = useDialogA11y(showImport);
  const [importAccount, setImportAccount] = useState("");
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const importCsv = useMutation({
    mutationFn: ({ accountId, contents }: { accountId: string; contents: string }) =>
      api.post<{ imported: number; skipped: number; totalParsed: number; firstImported: string[] }>("/api/import/csv", {
        accountId,
        contents,
      }),
    onSuccess: (res) => {
      setImportMsg(
        `Imported ${res.imported} transaction${res.imported === 1 ? "" : "s"}${res.skipped > 0 ? ` · ${res.skipped} already in the app (skipped)` : ""}.`
      );
      setImportAccount("");
      invalidate();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "CSV import failed."),
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
            <CustomSelect
              ariaLabel="Filter by account"
              value={accountId}
              onChange={setAccountId}
              placeholder="All accounts"
              options={(accounts.data?.accounts ?? []).map((a) => ({ value: a.id, label: a.name }))}
            />
          </div>
          <button
            type="button"
            aria-pressed={pendingOnly}
            onClick={() => setPendingOnly((v) => !v)}
            className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${
              pendingOnly
                ? "border-accent bg-accent/15 text-accent-text"
                : "border-border bg-surface text-text-muted hover:text-text"
            }`}
          >
            {pendingOnly && (
              <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 6.5L4.5 9L10 3" />
              </svg>
            )}
            Pending
          </button>
          <button
            type="button"
            onClick={() => {
              setRefreshMsg(null);
              syncNow.mutate();
            }}
            disabled={syncNow.isPending}
            title="Refresh from your bank (posted + pending)"
            className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${
              syncNow.isPending
                ? "cursor-wait border-border bg-surface text-text-muted"
                : "border-border bg-surface text-text-muted hover:text-text"
            }`}
          >
            <RefreshCw size={14} className={syncNow.isPending ? "animate-spin" : ""} />
            {syncNow.isPending ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => pullHistory.mutate()}
            disabled={pullHistory.isPending}
            className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${
              pullHistory.isPending
                ? "cursor-wait border-border bg-surface text-text-muted"
                : "border-border bg-surface text-text-muted hover:text-text"
            }`}
            title="Re-pull the full history Plaid has for every linked bank (up to ~24 months from link date)"
          >
            <RefreshCw size={14} className={pullHistory.isPending ? "animate-spin" : ""} />
            {pullHistory.isPending ? "Pulling…" : "Pull full history"}
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setImportMsg(null);
              setShowImport(true);
            }}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-text-muted transition-colors hover:text-text"
            title="Import older transactions from a bank CSV file (for history your bank won't serve through Plaid)"
          >
            <Upload size={14} />
            Import CSV
          </button>
          <span className="text-sm text-text-muted">{data ? `${data.total} transaction${data.total === 1 ? "" : "s"}` : "…"}</span>
        </div>
        {(refreshMsg || error || historyMsg) && (
          <div className={`mt-2 px-1 text-xs ${error ? "text-red-500" : "text-text-muted"}`}>
            {error ?? refreshMsg ?? historyMsg}
            {historyDetail.length > 0 && (
              <ul className="mt-2 space-y-1">
                {historyDetail.map((d) => (
                  <li key={d.name} className="flex items-center justify-between gap-2">
                    <span className="truncate">{d.name}</span>
                    <span className={d.ok ? "text-text-muted" : "text-red-500"}>
                      {d.ok
                        ? d.oldest
                          ? `linked ${d.linkedAt ? d.linkedAt.slice(0, 10) : "?"} → back to ${d.oldest}`
                          : `${d.added} updated`
                        : "failed"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      {/* Add-transaction modal */}
      {showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm md:items-center md:p-6"
          onClick={() => !add.isPending && setShowAdd(false)}
          style={{ paddingBottom: kbdHeight > 0 ? `${kbdHeight}px` : undefined }}
        >
          <div
            ref={addDialogA11yRef}
            role="dialog"
            aria-modal="true"
            aria-label="Add a transaction"
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
                  aria-invalid={!!addAmountError}
                />
                {addAmountError && (
                  <p role="alert" className="mt-1 text-xs text-danger">{addAmountError}</p>
                )}
              </div>
              <div>
                <label htmlFor="add-date" className="mb-1 block text-xs font-medium text-text-muted">
                  Date
                </label>
                <CustomDatePicker ariaLabel="Transaction date" value={addDate} onChange={setAddDate} max={new Date().toISOString().slice(0, 10)} />
              </div>
              <div>
                <label id="add-account-label" className="mb-1 block text-xs font-medium text-text-muted">
                  Account
                </label>
                <CustomSelect
                  ariaLabel="Account"
                  value={addAccount}
                  onChange={setAddAccount}
                  placeholder="Select…"
                  options={(accounts.data?.accounts ?? []).map((a) => ({ value: a.id, label: a.name }))}
                />
              </div>
              <div>
                <label id="add-category-label" className="mb-1 block text-xs font-medium text-text-muted">
                  Category
                </label>
                <CustomSelect
                  ariaLabel="Category"
                  value={addCategory}
                  onChange={setAddCategory}
                  placeholder="Uncategorized"
                  options={(categories.data?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))}
                />
              </div>
              <p className="text-xs text-text-muted">Expenses are negative, income is positive — e.g. -45.00 for a purchase, 2500.00 for a paycheck.</p>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-text select-none">
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 items-center justify-center rounded border transition-colors ${
                    addExclude ? "border-accent bg-accent text-[var(--accent-foreground)]" : "border-border bg-surface"
                  }`}
                >
                  {addExclude && (
                    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 6.5L4.5 9L10 3" />
                    </svg>
                  )}
                </span>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={addExclude}
                  onChange={(e) => setAddExclude(e.target.checked)}
                />
                Keep this transaction out of budgets
              </label>
              {error && (
                <p role="alert" className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={add.isPending || !addName || !addAmount || !addAccount || !!addAmountError}>
                {add.isPending ? "Adding…" : "Add transaction"}
              </Button>
            </form>
            </div>
          </div>
        </div>
      )}

      {/* CSV import modal — the built-in path for older history that banks
          won't serve through Plaid (~90-day caps). User picks the account,
          uploads the bank's CSV, and we parse/dedupe/insert. */}
      {showImport && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm md:items-center md:p-6"
          onClick={() => !importCsv.isPending && setShowImport(false)}
        >
          <div
            ref={importDialogA11yRef}
            role="dialog"
            aria-modal="true"
            aria-label="Import bank CSV"
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-h-[calc(100dvh-1rem)] flex-col overflow-hidden rounded-t-3xl border border-border bg-surface shadow-2xl md:max-h-[calc(100dvh-3rem)] md:max-w-lg md:rounded-3xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="overflow-y-auto p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border md:hidden" />
            <div className="mb-4 flex items-center justify-between">
              <CardTitle>Import bank CSV</CardTitle>
              <button
                aria-label="Close"
                onClick={() => !importCsv.isPending && setShowImport(false)}
                className="flex h-9 w-9 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
              >
                <X size={18} />
              </button>
            </div>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                const file = (e.currentTarget.elements.namedItem("csv-file") as HTMLInputElement | null)?.files?.[0];
                if (!importAccount || !file) return;
                file.text().then((contents) => {
                  setImportMsg(null);
                  importCsv.mutate({ accountId: importAccount, contents });
                });
              }}
            >
              <p className="text-sm text-text-muted">
                Download a statement export (CSV) from your bank&apos;s website, then pick the account it
                belongs to here. We import older transactions your bank won&apos;t serve through Plaid —
                duplicates are skipped automatically.
              </p>
              <div>
                <label htmlFor="import-account" className="mb-1 block text-xs font-medium text-text-muted">
                  Account
                </label>
                <CustomSelect
                  ariaLabel="Import account"
                  value={importAccount}
                  onChange={setImportAccount}
                  placeholder="Select…"
                  options={(accounts.data?.accounts ?? []).map((a) => ({ value: a.id, label: a.name }))}
                />
              </div>
              <div>
                <label htmlFor="csv-file" className="mb-1 block text-xs font-medium text-text-muted">
                  Bank CSV file
                </label>
                <input
                  id="csv-file"
                  name="csv-file"
                  type="file"
                  accept=".csv,text/csv"
                  className="block w-full text-sm text-text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--accent)] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-[var(--accent-foreground)]"
                />
              </div>
              <p className="text-xs text-text-muted">
                Works with the common bank layouts: Date, Description, Amount — or Date, Description,
                Debit/Credit. Pick the right account so totals stay correct.
              </p>
              {importMsg && (
                <p role="status" className="rounded-lg bg-[var(--success-soft)] px-3 py-2 text-sm text-success">
                  {importMsg}
                </p>
              )}
              {error && (
                <p role="alert" className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={importCsv.isPending || !importAccount}>
                {importCsv.isPending ? "Importing…" : "Import transactions"}
              </Button>
            </form>
            </div>
          </div>
        </div>
      )}

      {/* CSV import suggestion — shown after "Pull full history" when the banks
          returned nothing new (institution ~90-day Plaid cap). */}
      {showCsvSuggestion && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm md:items-center md:p-6"
          onClick={() => setShowCsvSuggestion(false)}
        >
          <div
            ref={csvSuggestionA11yRef}
            role="dialog"
            aria-modal="true"
            aria-label="Import older history"
            onClick={(e) => e.stopPropagation()}
            className="flex w-full flex-col overflow-hidden rounded-t-3xl border border-border bg-surface shadow-2xl md:max-w-md md:rounded-3xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <CardTitle>No older history from your banks</CardTitle>
                <button
                  aria-label="Close"
                  onClick={() => setShowCsvSuggestion(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
                >
                  <X size={18} />
                </button>
              </div>
              <p className="text-sm text-text-muted">
                Your banks only serve the last ~90 days through Plaid, so there&apos;s nothing older to pull.
                To bring in earlier transactions, download a CSV statement from each bank&apos;s website and
                import it here — we&apos;ll skip anything already in the app.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setShowCsvSuggestion(false)}>
                  Not now
                </Button>
                <Button
                  onClick={() => {
                    setShowCsvSuggestion(false);
                    setError(null);
                    setImportMsg(null);
                    setShowImport(true);
                  }}
                >
                  Import bank files
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating action button — bottom right, above the mobile tab bar.
          Hidden while the add modal is open; rises above the keyboard. */}
      <FloatingAddButton label="Add transaction" onClick={() => setShowAdd(true)} hidden={showAdd} />

      {/* Custom delete confirmation (replaces the stock Android dialog) */}
      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete transaction?"
        message={confirmDelete ? `"${confirmDelete.name}" will be permanently removed. This cannot be undone.` : undefined}
        confirmLabel="Delete"
        busy={remove.isPending}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) remove.mutate(confirmDelete.id);
          setConfirmDelete(null);
        }}
      />

      {/* List */}
      <Card className="p-0">
        {isLoading || !data ? (
          <RowSkeleton />
        ) : data.rows.length === 0 ? (
          <div className="px-6 py-12 text-center">
            {q || accountId || pendingOnly ? (
              <>
                <p className="text-sm text-text-muted">No transactions match your filters.</p>
                <button
                  className="mt-1 text-sm font-medium text-accent-text hover:underline"
                  onClick={() => {
                    setQ("");
                    setAccountId("");
                    setPendingOnly(false);
                  }}
                >
                  Clear filters
                </button>
              </>
            ) : (accounts.data?.accounts ?? []).length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-8">
                <p className="text-sm text-text-muted">No transactions yet.</p>
                <p className="mt-1 text-sm">
                  <Link href="/settings" className="font-medium text-accent-text hover:underline">
                    Connect a bank
                  </Link>
                  <span className="text-text-muted">
                    {" "}or add an account first — then add transactions with the + button or import a CSV.
                  </span>
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border px-4 py-8">
                <p className="text-sm text-text-muted">No transactions yet.</p>
                <p className="mt-1 text-sm text-text-muted">
                  Add one with the + button, or{" "}
                  <button
                    type="button"
                    className="font-medium text-accent-text hover:underline"
                    onClick={() => {
                      setError(null);
                      setImportMsg(null);
                      setShowImport(true);
                    }}
                  >
                    import your bank&apos;s CSV
                  </button>
                  .
                </p>
              </div>
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
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 truncate text-[15px] font-medium text-text">{t.name}</span>
                          {t.pending === 1 && (
                            <span className="shrink-0 rounded bg-[var(--warning-soft)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--warning)]">
                              pending
                            </span>
                          )}
                          {t.exclude_from_budgets === 1 && (
                            <span className="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
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
                      <label
                        className={`flex cursor-pointer select-none items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                          t.exclude_from_budgets === 1
                            ? "border-accent bg-accent/15 text-accent-text"
                            : "border-border bg-surface text-text"
                        }`}
                      >
                        <span
                          role="switch"
                          aria-checked={t.exclude_from_budgets === 1}
                          className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors ${
                            t.exclude_from_budgets === 1 ? "bg-accent" : "bg-surface-muted"
                          }`}
                        >
                          <span
                            className={`absolute top-[2px] h-3.5 w-3.5 rounded-full bg-white transition-all ${
                              t.exclude_from_budgets === 1 ? "left-4" : "left-0.5"
                            }`}
                          />
                        </span>
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={t.exclude_from_budgets === 1}
                          onChange={(e) => toggleExclude.mutate({ id: t.id, exclude: e.target.checked })}
                        />
                        Exclude from budgets
                      </label>
                      <CustomSelect
                        ariaLabel={`Category for ${t.name}`}
                        className="w-44"
                        value={t.user_category_id ?? ""}
                        onChange={(v) => setCategory.mutate({ id: t.id, categoryId: v || null })}
                        placeholder="Uncategorized"
                        options={(categories.data?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))}
                      />
                      <div className="flex-1" />
                      {t.source === "manual" && (
                        <button
                          aria-label={`Delete ${t.name}`}
                          title="Delete transaction"
                          onClick={() => setConfirmDelete({ id: t.id, name: t.name })}
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
            {data.rows.length < data.total && (
              <button
                type="button"
                onClick={() => setLimit((l) => l + 200)}
                className="mt-2 w-full rounded-lg border border-border bg-surface py-2.5 text-sm font-medium text-text-muted transition-colors hover:text-text"
              >
                Load more ({data.total - data.rows.length} more)
              </button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
