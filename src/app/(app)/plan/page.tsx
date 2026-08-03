"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { CalendarClock, X } from "lucide-react";
import { api } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomDatePicker } from "@/components/ui/custom-date-picker";
import { CustomSelect } from "@/components/ui/custom-select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FloatingAddButton } from "@/components/ui/floating-add-button";
import { useKeyboardHeight } from "@/lib/use-keyboard-height";
import { Money } from "@/components/money";

interface Bill {
  id: string;
  name: string;
  amount_cents: number;
  frequency: string;
  next_due_date: string | null;
  last_paid_amount_cents: number | null;
  active: boolean;
  category_name: string | null;
}

interface Debt {
  id: string;
  name: string;
  principal_cents: number;
  apr_bps: number;
  min_payment_cents: number;
  amortization: { monthlyPaymentCents: number; monthsToPayoff: number | null; totalInterestCents: number; payoffDate: string | null };
}

interface Goal {
  id: string;
  name: string;
  type: string;
  target_cents: number;
  target_date: string | null;
  current_cents: number;
  monthly_contribution_cents: number | null;
  contribution_mode: string;
  contribution_interval: string | null;
  contribution_days: string | null;
  pct: number;
  requiredMonthlyCents: number | null;
  projectedCompletionDate: string | null;
}

interface PaydaySettings {
  mode: "auto" | "interval" | "days_of_month";
  interval: "weekly" | "biweekly" | "monthly" | null;
  days: number[];
}

interface Projection {
  baselineCents: number;
  monthlyIncomeCents: number;
  monthlyBillsCents: number;
  monthlyDebtCents: number;
  monthlyGoalCents: number;
  avgMonthlyExpensesCents: number;
  emergencyFund: { recommendedCents: number; monthsCovered: number | null };
  points: Array<{ month: string; balanceCents: number; flag: "danger" | "warning" | "ok" }>;
  dangerMonths: string[];
  warningMonths: string[];
}

const FREQUENCIES = ["weekly", "biweekly", "monthly", "quarterly", "yearly", "one-time"];

/** Horizon presets for the upcoming-bills digest (issue #9 — no more hardcoded 30 days). */
type Horizon = "7d" | "30d" | "eom" | "paycheck" | "custom";

const HORIZONS: Array<{ id: Horizon; label: string }> = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "eom", label: "End of month" },
  { id: "paycheck", label: "Next paycheck" },
  { id: "custom", label: "Custom" },
];

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export default function PlanPage() {
  const qc = useQueryClient();
  const kbdHeight = useKeyboardHeight();

  // ── Digest horizon (issue #9: user-selectable look-ahead) ──────────────
  const [horizon, setHorizon] = useState<Horizon>("30d");
  const [customUntil, setCustomUntil] = useState("");
  const [paycheckDate, setPaycheckDate] = useState<string | null>(null);
  const [showPaydays, setShowPaydays] = useState(false);

  // Manual payday schedule (012) — used for "Next paycheck" + projections.
  const paydays = useQuery({
    queryKey: ["planning", "paydays"],
    queryFn: () => api.get<{ paydays: PaydaySettings }>("/api/planning/paydays"),
    retry: false,
  });
  // Optimistic draft so picking a mode renders its controls before the save
  // round-trips (the server validates days/interval only on save).
  const [paydayDraft, setPaydayDraft] = useState<PaydaySettings | null>(null);
  const effectivePaydays = paydayDraft ?? paydays.data?.paydays ?? { mode: "auto", interval: null, days: [] };
  const setPaydays = useMutation({
    mutationFn: (patch: Partial<PaydaySettings>) => api.put("/api/planning/paydays", patch),
    onSuccess: () => {
      // Don't close the editor — the user may be picking several days /
      // intervals. They close it with "Done". Also clear any stale error.
      qc.invalidateQueries({ queryKey: ["planning", "paydays"] });
      setPaydayDraft(null);
      setErr(null);
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Failed to save paydays."),
  });

  // Find the next future income transaction ("before next paycheck").
  const paycheckProbe = useQuery({
    queryKey: ["planning", "paycheck-probe"],
    queryFn: async () => {
      const today = iso(new Date());
      const to = iso(addDays(new Date(), 120));
      const res = await api.get<{ rows: Array<{ amount_cents: number; date: string }> }>(
        `/api/transactions?from=${today}&to=${to}&limit=200`
      );
      const incomeDates = (res.rows ?? [])
        .filter((t) => t.amount_cents > 0 && t.date >= today)
        .map((t) => t.date)
        .sort();
      return incomeDates[0] ?? null;
    },
    retry: false,
  });

  // Manual schedule wins over the income probe; both fall back to EOM.
  const manualPayday = useMemo<string | null>(() => {
    const pd = paydays.data?.paydays;
    if (!pd || pd.mode === "auto") return null;
    const today = new Date();
    if (pd.mode === "interval" && pd.interval) {
      if (pd.interval === "weekly") return iso(addDays(today, 7));
      if (pd.interval === "biweekly") return iso(addDays(today, 14));
      if (pd.interval === "monthly") {
        const d = new Date(today.getFullYear(), today.getMonth() + 1, today.getDate());
        return iso(d);
      }
    }
    if (pd.mode === "days_of_month" && pd.days.length > 0) {
      const year = today.getFullYear();
      const month = today.getMonth();
      const last = new Date(year, month + 1, 0).getDate();
      const upcoming = pd.days
        .filter((d) => d >= today.getDate())
        .map((d) => new Date(year, month, Math.min(d, last)))
        .filter((d) => d >= today)
        .sort((a, b) => a.getTime() - b.getTime());
      const next = upcoming[0] ?? new Date(year, month + 1, Math.min(pd.days[0], new Date(year, month + 2, 0).getDate()));
      return iso(next);
    }
    return null;
  }, [paydays.data]);

  const horizonUntil = useMemo<{ days?: number; until?: string }>(() => {
    if (horizon === "7d") return { days: 7 };
    if (horizon === "30d") return { days: 30 };
    if (horizon === "eom") {
      const now = new Date();
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { until: iso(last) };
    }
    if (horizon === "paycheck") {
      const d = manualPayday ?? paycheckDate ?? paycheckProbe.data ?? null;
      if (d) return { until: d };
      // No future income found → fall back to end of month with a note.
      const now = new Date();
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { until: iso(last) };
    }
    if (horizon === "custom" && customUntil) return { until: customUntil };
    return { days: 30 };
  }, [horizon, customUntil, paycheckDate, manualPayday, paycheckProbe.data]);

  useEffect(() => {
    if (paycheckProbe.data) setPaycheckDate(paycheckProbe.data);
  }, [paycheckProbe.data]);

  const digestParams = new URLSearchParams();
  if (horizonUntil.until) digestParams.set("until", horizonUntil.until);
  else digestParams.set("days", String(horizonUntil.days ?? 30));

  const digest = useQuery({
    queryKey: ["planning", "digest", horizon, customUntil, paycheckDate],
    queryFn: () =>
      api.get<{ days: number; until: string | null; upcomingBills: Bill[]; overdueBills: Bill[]; totalUpcomingCents: number }>(
        `/api/planning/digest?${digestParams.toString()}`
      ),
  });
  const bills = useQuery({ queryKey: ["planning", "bills"], queryFn: () => api.get<{ bills: Bill[] }>("/api/planning/bills") });
  const debts = useQuery({ queryKey: ["planning", "debts"], queryFn: () => api.get<{ debts: Debt[] }>("/api/planning/debts") });
  const goals = useQuery({ queryKey: ["planning", "goals"], queryFn: () => api.get<{ goals: Goal[] }>("/api/planning/goals") });
  const projection = useQuery({
    queryKey: ["planning", "projection"],
    queryFn: () => api.get<Projection>("/api/planning/projection?months=12"),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["planning"] });
  };

  // ── Add sheet (FAB) ──
  const [showAdd, setShowAdd] = useState(false);
  const [addKind, setAddKind] = useState<"bill" | "debt" | "goal" | "expense" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // ── Bill form ──
  const [billName, setBillName] = useState("");
  const [billAmount, setBillAmount] = useState("");
  const [billFrequency, setBillFrequency] = useState("monthly");
  const [billDueDate, setBillDueDate] = useState("");
  const [billError, setBillError] = useState<string | null>(null);
  const createBill = useMutation({
    mutationFn: () =>
      api.post("/api/planning/bills", {
        name: billName,
        amountCents: Math.round(parseFloat(billAmount) * 100),
        frequency: billFrequency,
        // Calendar-picked due date (issue #10): store the picked date as the
        // next occurrence AND derive the recurring day-of-month from it.
        nextDueDate: billDueDate || null,
        dueDay: billDueDate ? parseInt(billDueDate.slice(8, 10), 10) : null,
      }),
    onSuccess: () => {
      setBillName("");
      setBillAmount("");
      setBillDueDate("");
      setBillError(null);
      setShowAdd(false);
      setAddKind(null);
      invalidate();
    },
    onError: (e) => setBillError(e instanceof Error ? e.message : "Failed to create bill."),
  });
  const payBill = useMutation({
    mutationFn: (id: string) => api.post(`/api/planning/bills/${id}/pay`),
    onSuccess: invalidate,
  });
  const removeBill = useMutation({ mutationFn: (id: string) => api.del(`/api/planning/bills/${id}`), onSuccess: invalidate });

  // ── Debt form ──
  const [debtName, setDebtName] = useState("");
  const [debtPrincipal, setDebtPrincipal] = useState("");
  const [debtApr, setDebtApr] = useState("");
  const [debtMinPayment, setDebtMinPayment] = useState("");
  const [debtError, setDebtError] = useState<string | null>(null);
  const createDebt = useMutation({
    mutationFn: () =>
      api.post("/api/planning/debts", {
        name: debtName,
        principalCents: Math.round(parseFloat(debtPrincipal) * 100),
        aprBps: Math.round((parseFloat(debtApr) || 0) * 100),
        minPaymentCents: Math.round((parseFloat(debtMinPayment) || 0) * 100),
      }),
    onSuccess: () => {
      setDebtName("");
      setDebtPrincipal("");
      setDebtApr("");
      setDebtMinPayment("");
      setDebtError(null);
      setShowAdd(false);
      setAddKind(null);
      invalidate();
    },
    onError: (e) => setDebtError(e instanceof Error ? e.message : "Failed to create debt."),
  });
  const removeDebt = useMutation({ mutationFn: (id: string) => api.del(`/api/planning/debts/${id}`), onSuccess: invalidate });

  // ── Goal form (savings) ──
  const [goalName, setGoalName] = useState("");
  const [goalTarget, setGoalTarget] = useState("");
  const [goalCurrent, setGoalCurrent] = useState("");
  const [goalContribution, setGoalContribution] = useState("");
  const [goalDate, setGoalDate] = useState("");
  const [goalError, setGoalError] = useState<string | null>(null);
  const createGoal = useMutation({
    mutationFn: () =>
      api.post("/api/planning/goals", {
        name: goalName,
        type: "savings",
        targetCents: Math.round(parseFloat(goalTarget) * 100),
        currentCents: Math.round((parseFloat(goalCurrent) || 0) * 100),
        monthlyContributionCents: goalContribution ? Math.round(parseFloat(goalContribution) * 100) : null,
        targetDate: goalDate || null,
      }),
    onSuccess: () => {
      setGoalName("");
      setGoalTarget("");
      setGoalCurrent("");
      setGoalContribution("");
      setGoalDate("");
      setGoalError(null);
      setShowAdd(false);
      setAddKind(null);
      invalidate();
    },
    onError: (e) => setGoalError(e instanceof Error ? e.message : "Failed to create goal."),
  });

  // ── Upcoming expense form (one-off bill with an optional set-aside plan) ──
  const [expName, setExpName] = useState("");
  const [expAmount, setExpAmount] = useState("");
  const [expDate, setExpDate] = useState("");
  const [expSaved, setExpSaved] = useState("");
  const [expSetAside, setExpSetAside] = useState(true);
  const [expMode, setExpMode] = useState<"interval" | "days_of_month" | "agent">("interval");
  const [expInterval, setExpInterval] = useState<"weekly" | "biweekly" | "monthly">("monthly");
  const [expContribution, setExpContribution] = useState("");
  const [expDays, setExpDays] = useState<number[]>([]);
  const [expDayInput, setExpDayInput] = useState("");
  const [expError, setExpError] = useState<string | null>(null);

  function toggleExpDay(d: number) {
    setExpDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)));
  }

  const createExpense = useMutation({
    mutationFn: () =>
      api.post("/api/planning/goals", {
        name: expName,
        type: "expense",
        targetCents: Math.round(parseFloat(expAmount) * 100),
        targetDate: expDate || null,
        currentCents: Math.round((parseFloat(expSaved) || 0) * 100),
        monthlyContributionCents: expSetAside && expContribution ? Math.round(parseFloat(expContribution) * 100) : null,
        contributionMode: expSetAside ? expMode : "none",
        contributionInterval: expSetAside && expMode === "interval" ? expInterval : null,
        contributionDays: expSetAside && expMode === "days_of_month" ? expDays : undefined,
      }),
    onSuccess: () => {
      setExpName("");
      setExpAmount("");
      setExpDate("");
      setExpSaved("");
      setExpContribution("");
      setExpDays([]);
      setExpDayInput("");
      setExpError(null);
      setShowAdd(false);
      setAddKind(null);
      invalidate();
    },
    onError: (e) => setExpError(e instanceof Error ? e.message : "Failed to create expense."),
  });
  const removeGoal = useMutation({ mutationFn: (id: string) => api.del(`/api/planning/goals/${id}`), onSuccess: invalidate });

  // ── Custom delete confirmations ──
  const [confirmDelete, setConfirmDelete] = useState<{ kind: "bill" | "debt" | "goal"; id: string; name: string } | null>(null);

  const chartData = (projection.data?.points ?? []).map((p) => ({ month: p.month, Balance: p.balanceCents / 100 }));

  const horizonCaption =
    horizon === "paycheck" && manualPayday
      ? `through your next payday (${manualPayday})`
      : horizon === "paycheck" && !paycheckDate && paycheckProbe.isLoading
        ? "looking for your next paycheck…"
        : horizon === "paycheck" && !paycheckDate
          ? "no future income found — showing to end of month (set your paydays 💰)"
          : horizon === "custom" && !customUntil
            ? "pick an end date below"
            : horizonUntil.until
              ? `through ${horizonUntil.until}`
              : `next ${horizonUntil.days ?? 30} days`;

  return (
    <div className="space-y-6">
      {err && <p className="text-sm text-danger">{err}</p>}
      {/* Upcoming bills digest */}
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-muted text-text-muted" aria-hidden>
              <CalendarClock size={16} />
            </span>
            <div>
              <CardTitle>Upcoming bills</CardTitle>
              <p className="text-xs text-text-muted">{horizonCaption}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {HORIZONS.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => setHorizon(h.id)}
                className={`h-8 rounded-full border px-3 text-xs font-medium transition-colors ${
                  horizon === h.id
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border text-text-muted hover:text-text"
                }`}
              >
                {h.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowPaydays((s) => !s)}
              className={`h-8 rounded-full border px-3 text-xs font-medium transition-colors ${
                showPaydays || (paydays.data?.paydays.mode ?? "auto") !== "auto"
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-text-muted hover:text-text"
              }`}
              title="Set your payday schedule for accurate projections"
            >
              💰 Paydays
            </button>
          </div>
        </div>
        {showPaydays && (
          <div className="mt-3 space-y-3 border-t border-border pt-3">
            <p className="text-xs text-text-muted">
              Tell the app when you get paid so the &ldquo;Next paycheck&rdquo; horizon and projections are accurate.{" "}
              {manualPayday && <span className="text-accent">Next payday: {manualPayday}.</span>}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["auto", "Auto (from income)"],
                  ["interval", "Regular interval"],
                  ["days_of_month", "Specific days"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setPaydayDraft({ ...effectivePaydays, mode });
                    // Only save immediately when the mode is complete: auto
                    // saves alone; interval/days_of_month wait for a value so
                    // the server's validation can't fire a spurious error.
                    if (mode === "auto") setPaydays.mutate({ mode });
                    else if (mode === "interval" && effectivePaydays.interval) {
                      setPaydays.mutate({ mode, interval: effectivePaydays.interval });
                    } else if (mode === "days_of_month" && effectivePaydays.days.length > 0) {
                      setPaydays.mutate({ mode, days: effectivePaydays.days });
                    }
                  }}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    effectivePaydays.mode === mode
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border text-text-muted hover:text-text"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {effectivePaydays.mode === "interval" && (
              <div className="flex flex-wrap gap-1.5">
                {(["weekly", "biweekly", "monthly"] as const).map((iv) => (
                  <button
                    key={iv}
                    type="button"
                    onClick={() => {
                      setPaydayDraft({ ...effectivePaydays, mode: "interval", interval: iv });
                      setPaydays.mutate({ mode: "interval", interval: iv });
                    }}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      effectivePaydays.interval === iv
                        ? "border-accent bg-accent/10 font-medium text-accent"
                        : "border-border text-text-muted hover:text-text"
                    }`}
                  >
                    {iv === "biweekly" ? "Every 2 weeks" : iv === "weekly" ? "Every week" : "Every month"}
                  </button>
                ))}
              </div>
            )}
            {effectivePaydays.mode === "days_of_month" && (
              <div>
                <div className="flex flex-wrap gap-1.5">
                  {[1, 5, 10, 15, 20, 25, 30].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        const cur = effectivePaydays.days;
                        const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b);
                        setPaydayDraft({ ...effectivePaydays, mode: "days_of_month", days: next });
                        if (next.length > 0) setPaydays.mutate({ mode: "days_of_month", days: next });
                      }}
                      className={`h-8 w-8 rounded-full border text-xs transition-colors ${
                        effectivePaydays.days.includes(d)
                          ? "border-accent bg-accent/10 font-medium text-accent"
                          : "border-border text-text-muted hover:text-text"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-text-muted">
                  {effectivePaydays.days.length > 0
                    ? `Paid on the ${effectivePaydays.days.join(" & ")} of each month`
                    : "Pick the days you get paid"}
                </p>
              </div>
            )}
            {setPaydays.isError && <p className="text-sm text-danger">Couldn&apos;t save paydays — try again.</p>}
            <button
              type="button"
              onClick={() => setShowPaydays(false)}
              className="text-xs font-medium text-accent transition-colors hover:underline"
            >
              Done
            </button>
          </div>
        )}
        {horizon === "custom" && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <CustomDatePicker ariaLabel="Look ahead until" value={customUntil} onChange={setCustomUntil} min={new Date().toISOString().slice(0, 10)} className="w-44" />
            {customUntil && (
              <button
                type="button"
                onClick={() => setCustomUntil("")}
                className="flex h-10 items-center gap-1.5 rounded-md px-2.5 text-xs text-text-muted transition-colors hover:text-text"
              >
                <X size={14} /> Clear
              </button>
            )}
          </div>
        )}
        {digest.data && digest.data.upcomingBills.length === 0 && digest.data.overdueBills.length === 0 && (
          <p className="mt-2 text-sm text-text-muted">
            Nothing due {horizon === "paycheck" && paycheckDate ? `until your next paycheck (${paycheckDate})` : horizonCaption}.
          </p>
        )}
        {digest.data && digest.data.overdueBills.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-danger">Overdue</p>
            {digest.data.overdueBills.map((b) => (
              <div key={b.id} className="flex items-center justify-between text-sm">
                <span className="text-text">
                  {b.name} <span className="text-text-muted">· due {b.next_due_date}</span>
                </span>
                <Money cents={b.amount_cents} />
              </div>
            ))}
          </div>
        )}
        {digest.data && digest.data.upcomingBills.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Due {horizonCaption}</p>
            {digest.data.upcomingBills.map((b) => (
              <div key={b.id} className="flex items-center justify-between text-sm">
                <span className="text-text">
                  {b.name} <span className="text-text-muted">· {b.next_due_date}</span>
                </span>
                <Money cents={b.amount_cents} />
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-border pt-2 text-sm font-medium">
              <span className="text-text">Total due</span>
              <Money cents={digest.data.totalUpcomingCents} />
            </div>
          </div>
        )}
      </Card>

      {/* Projection */}
      <Card>
        <CardTitle>12-month projection</CardTitle>
        <div className="mt-1 flex flex-wrap gap-4 text-xs text-text-muted">
          <span>
            Income <Money cents={projection.data?.monthlyIncomeCents ?? 0} />/mo
          </span>
          <span>
            Bills <Money cents={projection.data?.monthlyBillsCents ?? 0} />/mo
          </span>
          <span>
            Debt <Money cents={projection.data?.monthlyDebtCents ?? 0} />/mo
          </span>
          <span>
            Goals <Money cents={projection.data?.monthlyGoalCents ?? 0} />/mo
          </span>
        </div>
        {projection.data && projection.data.dangerMonths.length > 0 && (
          <p className="mt-2 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            Balance is projected to go negative in: {projection.data.dangerMonths.join(", ")}.
          </p>
        )}
        {projection.data && projection.data.dangerMonths.length === 0 && projection.data.warningMonths.length > 0 && (
          <p className="mt-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
            Balance dips below one month of expenses in: {projection.data.warningMonths.join(", ")}.
          </p>
        )}
        {projection.data && (
          <p className="mt-2 text-xs text-text-muted">
            Emergency fund: <Money cents={projection.data.emergencyFund.recommendedCents} /> recommended (
            {projection.data.emergencyFund.monthsCovered ?? "—"} months covered). <em>Estimate — all things constant.</em>
          </p>
        )}
        <div className="mt-4 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
              <Tooltip formatter={(v) => `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
              <Line type="monotone" dataKey="Balance" stroke="var(--accent)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Bills */}
        <Card>
          <CardTitle>Bills</CardTitle>
          <div className="mt-3 space-y-2">
            {(bills.data?.bills ?? []).map((b) => (
              <div key={b.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <div>
                  <p className="font-medium text-text">
                    {b.name}
                    {!b.active && <span className="ml-2 text-xs text-text-muted">(paid)</span>}
                  </p>
                  <p className="text-xs text-text-muted">
                    {b.frequency}
                    {b.next_due_date ? ` · due ${b.next_due_date}` : ""}
                    {b.last_paid_amount_cents !== null ? ` · last paid ${(b.last_paid_amount_cents / 100).toFixed(2)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Money cents={b.amount_cents} />
                  {b.active && (
                    <Button size="sm" variant="ghost" onClick={() => payBill.mutate(b.id)}>
                      Paid
                    </Button>
                  )}
                  <button
                    onClick={() => setConfirmDelete({ kind: "bill", id: b.id, name: b.name })}
                    className="text-xs text-text-muted hover:text-danger"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
            {(bills.data?.bills ?? []).length === 0 && <p className="text-sm text-text-muted">No bills yet.</p>}
          </div>
        </Card>

        {/* Debts */}
        <Card>
          <CardTitle>Debts</CardTitle>
          <div className="mt-3 space-y-2">
            {(debts.data?.debts ?? []).map((d) => (
              <div key={d.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-text">{d.name}</p>
                  <div className="flex items-center gap-2">
                    <Money cents={d.principal_cents} />
                    <button
                      onClick={() => setConfirmDelete({ kind: "debt", id: d.id, name: d.name })}
                      className="text-xs text-text-muted hover:text-danger"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <p className="mt-0.5 text-xs text-text-muted">
                  {(d.apr_bps / 100).toFixed(2)}% APR · min <Money cents={d.min_payment_cents} /> · pays off in{" "}
                  {d.amortization.monthsToPayoff ? `${d.amortization.monthsToPayoff} mo` : "—"} ·{" "}
                  <Money cents={d.amortization.totalInterestCents} /> interest
                </p>
              </div>
            ))}
            {(debts.data?.debts ?? []).length === 0 && <p className="text-sm text-text-muted">No debts yet.</p>}
          </div>
        </Card>
      </div>

      {/* Upcoming expenses — one-off bills with optional set-aside plans */}
      <Card>
        <CardTitle>Upcoming expenses</CardTitle>
        <p className="mt-1 text-xs text-text-muted">One-off bills you&apos;re planning for — with any money being set aside.</p>
        <div className="mt-3 space-y-2">
          {(goals.data?.goals ?? []).filter((g) => g.type === "expense").map((g) => (
            <div key={g.id} className="rounded-lg border border-border px-3 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-text">{g.name}</p>
                  <p className="text-xs text-text-muted">
                    Due {g.target_date ?? "someday"} · <Money cents={g.target_cents} />
                    {g.current_cents > 0 ? ` · ${Math.round((g.current_cents / g.target_cents) * 100)}% set aside` : ""}
                  </p>
                </div>
                <button
                  onClick={() => setConfirmDelete({ kind: "goal", id: g.id, name: g.name })}
                  className="text-xs text-text-muted hover:text-danger"
                  aria-label={`Delete expense ${g.name}`}
                >
                  ✕
                </button>
              </div>
              <p className="mt-1.5 text-xs text-text-muted">
                {g.contribution_mode === "none" && "No set-aside — pay it when it's due."}
                {g.contribution_mode === "interval" && (
                  <>
                    Setting aside <Money cents={g.monthly_contribution_cents ?? 0} />{" "}
                    {g.contribution_interval === "weekly" ? "every week" : g.contribution_interval === "biweekly" ? "every 2 weeks" : "every month"}
                    {g.projectedCompletionDate ? ` · paid off by ${g.projectedCompletionDate}` : ""}
                  </>
                )}
                {g.contribution_mode === "days_of_month" && g.contribution_days && (
                  <>
                    Setting aside <Money cents={g.monthly_contribution_cents ?? 0} /> on the{" "}
                    {JSON.parse(g.contribution_days).join(" & ")} of each month
                  </>
                )}
                {g.contribution_mode === "agent" && "Agent will schedule payments to fit your cash flow."}
              </p>
            </div>
          ))}
          {(goals.data?.goals ?? []).filter((g) => g.type === "expense").length === 0 && (
            <p className="text-sm text-text-muted">No upcoming expenses yet — add one with the + button (one-off bill).</p>
          )}
        </div>
      </Card>

      {/* Goals */}
      <Card>
        <CardTitle>Goals</CardTitle>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(goals.data?.goals ?? []).filter((g) => g.type !== "expense").map((g) => (
            <div key={g.id} className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-text">{g.name}</p>
                  <p className="text-xs text-text-muted">
                    <Money cents={g.current_cents} /> of <Money cents={g.target_cents} />
                    {g.target_date ? ` · by ${g.target_date}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => setConfirmDelete({ kind: "goal", id: g.id, name: g.name })}
                  className="text-xs text-text-muted hover:text-danger"
                >
                  ✕
                </button>
              </div>
              <div className="mt-3">
                <Progress value={g.pct} />
              </div>
              <p className="mt-2 text-xs text-text-muted">
                {g.requiredMonthlyCents !== null && (
                  <>
                    Need <Money cents={g.requiredMonthlyCents} />/mo to hit target
                  </>
                )}
                {g.monthly_contribution_cents !== null && g.monthly_contribution_cents > 0 && (
                  <>
                    {g.requiredMonthlyCents !== null && " · "}
                    Saving <Money cents={g.monthly_contribution_cents} />/mo
                    {g.projectedCompletionDate ? ` → ${g.projectedCompletionDate}` : ""}
                  </>
                )}
                {g.requiredMonthlyCents === null && (g.monthly_contribution_cents === null || g.monthly_contribution_cents === 0) && "No target date set"}
              </p>
            </div>
          ))}
          {(goals.data?.goals ?? []).filter((g) => g.type !== "expense").length === 0 && <p className="text-sm text-text-muted">No goals yet.</p>}
        </div>
      </Card>

      {/* Add sheet (FAB) — bills / debts / goals, standardized bottom sheet */}
      {showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm md:items-center md:p-6"
          onClick={() => {
            if (createBill.isPending || createDebt.isPending || createGoal.isPending) return;
            setShowAdd(false);
            setAddKind(null);
          }}
          style={{ paddingBottom: kbdHeight > 0 ? `${kbdHeight}px` : undefined }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Add to plan"
            onClick={(e) => e.stopPropagation()}
            className="w-full overflow-y-auto rounded-t-3xl border border-border bg-surface p-5 shadow-2xl md:max-w-lg md:rounded-3xl"
            style={{
              paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))",
              maxHeight: `calc(100dvh - ${kbdHeight}px - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 2rem)`,
            }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border md:hidden" />
            <div className="mb-4 flex items-center justify-between">
              <CardTitle>{addKind ? `Add ${addKind}` : "Add to your plan"}</CardTitle>
              <button
                aria-label="Close"
                onClick={() => {
                  setShowAdd(false);
                  setAddKind(null);
                }}
                className="flex h-9 w-9 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
              >
                <X size={18} />
              </button>
            </div>

            {!addKind && (
              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={() => setAddKind("bill")}
                  className="flex items-center justify-between rounded-xl border border-border px-4 py-3 text-left text-sm transition-colors hover:border-accent/50 hover:bg-surface-muted"
                >
                  <span className="font-medium text-text">Recurring bill</span>
                  <span className="text-xs text-text-muted">Rent, utilities, subscriptions…</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAddKind("debt")}
                  className="flex items-center justify-between rounded-xl border border-border px-4 py-3 text-left text-sm transition-colors hover:border-accent/50 hover:bg-surface-muted"
                >
                  <span className="font-medium text-text">Debt</span>
                  <span className="text-xs text-text-muted">Loan, card balance…</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAddKind("goal")}
                  className="flex items-center justify-between rounded-xl border border-border px-4 py-3 text-left text-sm transition-colors hover:border-accent/50 hover:bg-surface-muted"
                >
                  <span className="font-medium text-text">Savings goal</span>
                  <span className="text-xs text-text-muted">Emergency fund, trip…</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAddKind("expense")}
                  className="flex items-center justify-between rounded-xl border border-border px-4 py-3 text-left text-sm transition-colors hover:border-accent/50 hover:bg-surface-muted"
                >
                  <span className="font-medium text-text">Upcoming expense</span>
                  <span className="text-xs text-text-muted">One-off bill — with optional set-aside</span>
                </button>
              </div>
            )}

            {addKind === "bill" && (
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  createBill.mutate();
                }}
              >
                <div>
                  <label htmlFor="plan-bill-name" className="mb-1 block text-xs font-medium text-text-muted">
                    Name
                  </label>
                  <Input id="plan-bill-name" placeholder="e.g. Rent" value={billName} onChange={(e) => setBillName(e.target.value)} required autoFocus />
                </div>
                <div>
                  <label htmlFor="plan-bill-amount" className="mb-1 block text-xs font-medium text-text-muted">
                    Amount ($)
                  </label>
                  <Input id="plan-bill-amount" placeholder="1200.00" inputMode="decimal" value={billAmount} onChange={(e) => setBillAmount(e.target.value)} required />
                </div>
                <div>
                  <label id="plan-bill-freq-label" className="mb-1 block text-xs font-medium text-text-muted">
                    Frequency
                  </label>
                  <CustomSelect
                    ariaLabel="Bill frequency"
                    value={billFrequency}
                    onChange={setBillFrequency}
                    options={FREQUENCIES.map((f) => ({ value: f, label: f }))}
                  />
                </div>
                <div>
                  <label id="plan-bill-date-label" className="mb-1 block text-xs font-medium text-text-muted">
                    Next due date
                  </label>
                  <CustomDatePicker ariaLabel="Bill next due date" value={billDueDate} onChange={setBillDueDate} min={new Date().toISOString().slice(0, 10)} />
                  <p className="mt-1 text-xs text-text-muted">Picked from the calendar — the day of month is kept for recurring bills.</p>
                </div>
                {billError && <p className="text-sm text-danger">{billError}</p>}
                <Button type="submit" disabled={createBill.isPending || !billName || !billAmount}>
                  {createBill.isPending ? "Adding…" : "Add bill"}
                </Button>
              </form>
            )}

            {addKind === "debt" && (
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  createDebt.mutate();
                }}
              >
                <div>
                  <label htmlFor="plan-debt-name" className="mb-1 block text-xs font-medium text-text-muted">
                    Name
                  </label>
                  <Input id="plan-debt-name" placeholder="e.g. Car loan" value={debtName} onChange={(e) => setDebtName(e.target.value)} required autoFocus />
                </div>
                <div>
                  <label htmlFor="plan-debt-principal" className="mb-1 block text-xs font-medium text-text-muted">
                    Principal ($)
                  </label>
                  <Input id="plan-debt-principal" placeholder="15000.00" inputMode="decimal" value={debtPrincipal} onChange={(e) => setDebtPrincipal(e.target.value)} required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="plan-debt-apr" className="mb-1 block text-xs font-medium text-text-muted">
                      APR %
                    </label>
                    <Input id="plan-debt-apr" placeholder="6.5" inputMode="decimal" value={debtApr} onChange={(e) => setDebtApr(e.target.value)} />
                  </div>
                  <div>
                    <label htmlFor="plan-debt-min" className="mb-1 block text-xs font-medium text-text-muted">
                      Min pay ($)
                    </label>
                    <Input id="plan-debt-min" placeholder="250.00" inputMode="decimal" value={debtMinPayment} onChange={(e) => setDebtMinPayment(e.target.value)} />
                  </div>
                </div>
                {debtError && <p className="text-sm text-danger">{debtError}</p>}
                <Button type="submit" disabled={createDebt.isPending || !debtName || !debtPrincipal}>
                  {createDebt.isPending ? "Adding…" : "Add debt"}
                </Button>
              </form>
            )}

            {addKind === "goal" && (
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  createGoal.mutate();
                }}
              >
                <div>
                  <label htmlFor="plan-goal-name" className="mb-1 block text-xs font-medium text-text-muted">
                    Name
                  </label>
                  <Input id="plan-goal-name" placeholder="e.g. Emergency fund" value={goalName} onChange={(e) => setGoalName(e.target.value)} required autoFocus />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="plan-goal-target" className="mb-1 block text-xs font-medium text-text-muted">
                      Target ($)
                    </label>
                    <Input id="plan-goal-target" placeholder="10000.00" inputMode="decimal" value={goalTarget} onChange={(e) => setGoalTarget(e.target.value)} required />
                  </div>
                  <div>
                    <label htmlFor="plan-goal-current" className="mb-1 block text-xs font-medium text-text-muted">
                      Saved so far ($)
                    </label>
                    <Input id="plan-goal-current" placeholder="0.00" inputMode="decimal" value={goalCurrent} onChange={(e) => setGoalCurrent(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label htmlFor="plan-goal-monthly" className="mb-1 block text-xs font-medium text-text-muted">
                    Per month ($)
                  </label>
                  <Input id="plan-goal-monthly" placeholder="200.00" inputMode="decimal" value={goalContribution} onChange={(e) => setGoalContribution(e.target.value)} />
                </div>
                <div>
                  <label id="plan-goal-date-label" className="mb-1 block text-xs font-medium text-text-muted">
                    Target date
                  </label>
                  <CustomDatePicker ariaLabel="Goal target date" value={goalDate} onChange={setGoalDate} />
                </div>
                {goalError && <p className="text-sm text-danger">{goalError}</p>}
                <Button type="submit" disabled={createGoal.isPending || !goalName || !goalTarget}>
                  {createGoal.isPending ? "Adding…" : "Add goal"}
                </Button>
                </form>
                )}

                {addKind === "expense" && (
                <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                 e.preventDefault();
                 createExpense.mutate();
                }}
                >
                <div>
                 <label htmlFor="plan-exp-name" className="mb-1 block text-xs font-medium text-text-muted">
                   Name
                 </label>
                 <Input id="plan-exp-name" placeholder="e.g. Midwife payment" value={expName} onChange={(e) => setExpName(e.target.value)} required autoFocus />
                </div>
                <div className="grid grid-cols-2 gap-3">
                 <div>
                   <label htmlFor="plan-exp-amount" className="mb-1 block text-xs font-medium text-text-muted">
                     Amount ($)
                   </label>
                   <Input id="plan-exp-amount" placeholder="3800.00" inputMode="decimal" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} required />
                 </div>
                 <div>
                   <label htmlFor="plan-exp-saved" className="mb-1 block text-xs font-medium text-text-muted">
                     Set aside so far ($)
                   </label>
                   <Input id="plan-exp-saved" placeholder="0.00" inputMode="decimal" value={expSaved} onChange={(e) => setExpSaved(e.target.value)} />
                 </div>
                </div>
                <div>
                 <label id="plan-exp-date-label" className="mb-1 block text-xs font-medium text-text-muted">
                   Due date
                 </label>
                 <CustomDatePicker ariaLabel="Expense due date" value={expDate} onChange={setExpDate} min={new Date().toISOString().slice(0, 10)} />
                </div>

                {/* Optional set-aside plan */}
                <div className="rounded-xl border border-border p-3">
                 <label className="flex items-center gap-2 text-sm text-text">
                   <input
                     type="checkbox"
                     checked={expSetAside}
                     onChange={(e) => setExpSetAside(e.target.checked)}
                     className="h-4 w-4 accent-[var(--accent)]"
                   />
                   Set money aside for this
                 </label>
                 {expSetAside && (
                   <div className="mt-3 space-y-3">
                     <div>
                       <label htmlFor="plan-exp-contrib" className="mb-1 block text-xs font-medium text-text-muted">
                         Per payment ($)
                       </label>
                       <Input id="plan-exp-contrib" placeholder="200.00" inputMode="decimal" value={expContribution} onChange={(e) => setExpContribution(e.target.value)} />
                     </div>
                     <div>
                       <p className="mb-1 text-xs font-medium text-text-muted">When</p>
                       <div className="flex flex-wrap gap-1.5">
                         {(
                           [
                             ["interval", "Regular intervals"],
                             ["days_of_month", "Specific days"],
                             ["agent", "Let the agent schedule it"],
                           ] as const
                         ).map(([mode, label]) => (
                           <button
                             key={mode}
                             type="button"
                             onClick={() => setExpMode(mode)}
                             className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                               expMode === mode ? "border-accent bg-accent/10 text-accent" : "border-border text-text-muted hover:text-text"
                             }`}
                           >
                             {label}
                           </button>
                         ))}
                       </div>
                     </div>
                     {expMode === "interval" && (
                       <div className="flex flex-wrap gap-1.5">
                         {(["weekly", "biweekly", "monthly"] as const).map((iv) => (
                           <button
                             key={iv}
                             type="button"
                             onClick={() => setExpInterval(iv)}
                             className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                               expInterval === iv ? "border-accent bg-accent/10 font-medium text-accent" : "border-border text-text-muted hover:text-text"
                             }`}
                           >
                             {iv === "biweekly" ? "Every 2 weeks" : iv === "weekly" ? "Every week" : "Every month"}
                           </button>
                         ))}
                       </div>
                     )}
                     {expMode === "days_of_month" && (
                       <div>
                         <div className="flex flex-wrap gap-1.5">
                           {[1, 5, 10, 15, 20, 25].map((d) => (
                             <button
                               key={d}
                               type="button"
                               onClick={() => toggleExpDay(d)}
                               className={`h-8 w-8 rounded-full border text-xs transition-colors ${
                                 expDays.includes(d) ? "border-accent bg-accent/10 font-medium text-accent" : "border-border text-text-muted hover:text-text"
                               }`}
                             >
                               {d}
                             </button>
                           ))}
                         </div>
                         <div className="mt-2 flex items-center gap-2">
                           <Input
                             aria-label="Other days of the month (comma separated)"
                             placeholder="Other days, e.g. 2, 27"
                             inputMode="numeric"
                             value={expDayInput}
                             onChange={(e) => {
                               setExpDayInput(e.target.value);
                               const parsed = e.target.value
                                 .split(/[,\s]+/)
                                 .map((s) => parseInt(s, 10))
                                 .filter((n) => Number.isInteger(n) && n >= 1 && n <= 31);
                               if (parsed.length > 0) setExpDays((prev) => Array.from(new Set([...prev, ...parsed])).sort((a, b) => a - b));
                             }}
                           />
                         </div>
                         <p className="mt-1 text-xs text-text-muted">
                           {expDays.length > 0 ? `Paying on the ${expDays.join(" & ")} of each month` : "Pick at least one day"}
                         </p>
                       </div>
                     )}
                     {expMode === "agent" && (
                       <p className="text-xs text-text-muted">
                         Your agent will work out a schedule that fits your cash flow and keep it updated here. It still
                         asks before any change to your money.
                       </p>
                     )}
                   </div>
                 )}
                </div>
                {expError && <p className="text-sm text-danger">{expError}</p>}
                <Button type="submit" disabled={createExpense.isPending || !expName || !expAmount || (expSetAside && expMode === "days_of_month" && expDays.length === 0)}>
                 {createExpense.isPending ? "Adding…" : "Add expense"}
                </Button>
                </form>
                )}
          </div>
        </div>
      )}

      {/* Floating action button — standard placement, bottom-right */}
      <FloatingAddButton label="Add to plan" onClick={() => setShowAdd(true)} hidden={showAdd} />

      {/* Custom delete confirmations */}
      <ConfirmDialog
        open={confirmDelete !== null}
        title={confirmDelete ? `Delete ${confirmDelete.kind}?` : "Delete?"}
        message={confirmDelete ? `"${confirmDelete.name}" will be removed from your plan.` : undefined}
        confirmLabel="Delete"
        busy={(confirmDelete?.kind === "bill" && removeBill.isPending) || (confirmDelete?.kind === "debt" && removeDebt.isPending) || (confirmDelete?.kind === "goal" && removeGoal.isPending)}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (!confirmDelete) return;
          const { kind, id } = confirmDelete;
          if (kind === "bill") removeBill.mutate(id);
          if (kind === "debt") removeDebt.mutate(id);
          if (kind === "goal") removeGoal.mutate(id);
          setConfirmDelete(null);
        }}
      />
    </div>
  );
}
