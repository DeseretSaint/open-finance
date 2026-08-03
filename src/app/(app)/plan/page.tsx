"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { api } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomDatePicker } from "@/components/ui/custom-date-picker";
import { CustomSelect } from "@/components/ui/custom-select";
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
  target_cents: number;
  target_date: string | null;
  current_cents: number;
  monthly_contribution_cents: number | null;
  pct: number;
  requiredMonthlyCents: number | null;
  projectedCompletionDate: string | null;
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

export default function PlanPage() {
  const qc = useQueryClient();

  const digest = useQuery({
    queryKey: ["planning", "digest"],
    queryFn: () => api.get<{ days: number; upcomingBills: Bill[]; overdueBills: Bill[]; totalUpcomingCents: number }>("/api/planning/digest?days=30"),
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

  // ── Bill form ──
  const [billName, setBillName] = useState("");
  const [billAmount, setBillAmount] = useState("");
  const [billFrequency, setBillFrequency] = useState("monthly");
  const [billDueDay, setBillDueDay] = useState("");
  const [billError, setBillError] = useState<string | null>(null);
  const createBill = useMutation({
    mutationFn: () =>
      api.post("/api/planning/bills", {
        name: billName,
        amountCents: Math.round(parseFloat(billAmount) * 100),
        frequency: billFrequency,
        dueDay: billDueDay ? parseInt(billDueDay, 10) : null,
      }),
    onSuccess: () => {
      setBillName("");
      setBillAmount("");
      setBillDueDay("");
      setBillError(null);
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
      invalidate();
    },
    onError: (e) => setDebtError(e instanceof Error ? e.message : "Failed to create debt."),
  });
  const removeDebt = useMutation({ mutationFn: (id: string) => api.del(`/api/planning/debts/${id}`), onSuccess: invalidate });

  // ── Goal form ──
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
      invalidate();
    },
    onError: (e) => setGoalError(e instanceof Error ? e.message : "Failed to create goal."),
  });
  const removeGoal = useMutation({ mutationFn: (id: string) => api.del(`/api/planning/goals/${id}`), onSuccess: invalidate });

  const chartData = (projection.data?.points ?? []).map((p) => ({ month: p.month, Balance: p.balanceCents / 100 }));

  return (
    <div className="space-y-6">
      {/* Upcoming bills digest */}
      <Card>
        <CardTitle>Upcoming bills</CardTitle>
        {digest.data && digest.data.upcomingBills.length === 0 && digest.data.overdueBills.length === 0 && (
          <p className="mt-2 text-sm text-text-muted">Nothing due in the next {digest.data?.days ?? 30} days.</p>
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
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Next {digest.data.days} days</p>
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
                  <button onClick={() => removeBill.mutate(b.id)} className="text-xs text-text-muted hover:text-danger">
                    ✕
                  </button>
                </div>
              </div>
            ))}
            {(bills.data?.bills ?? []).length === 0 && <p className="text-sm text-text-muted">No bills yet.</p>}
          </div>

          <form
            className="mt-4 space-y-3 border-t border-border pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              createBill.mutate();
            }}
          >
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-40 flex-1">
                <label className="mb-1 block text-xs text-text-muted">Name</label>
                <Input placeholder="e.g. Rent" value={billName} onChange={(e) => setBillName(e.target.value)} required />
              </div>
              <div className="min-w-28">
                <label className="mb-1 block text-xs text-text-muted">Amount ($)</label>
                <Input placeholder="1200.00" inputMode="decimal" value={billAmount} onChange={(e) => setBillAmount(e.target.value)} required />
              </div>
              <div className="min-w-28">
                <label className="mb-1 block text-xs text-text-muted">Frequency</label>
                <CustomSelect
                  ariaLabel="Bill frequency"
                  value={billFrequency}
                  onChange={setBillFrequency}
                  options={FREQUENCIES.map((f) => ({ value: f, label: f }))}
                />
              </div>
              <div className="min-w-20">
                <label className="mb-1 block text-xs text-text-muted">Due day</label>
                <Input placeholder="1" inputMode="numeric" value={billDueDay} onChange={(e) => setBillDueDay(e.target.value)} />
              </div>
              <Button type="submit" disabled={createBill.isPending || !billName || !billAmount}>
                {createBill.isPending ? "Adding…" : "Add bill"}
              </Button>
            </div>
            {billError && <p className="text-sm text-danger">{billError}</p>}
          </form>
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
                    <button onClick={() => removeDebt.mutate(d.id)} className="text-xs text-text-muted hover:text-danger">
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

          <form
            className="mt-4 space-y-3 border-t border-border pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              createDebt.mutate();
            }}
          >
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-36 flex-1">
                <label className="mb-1 block text-xs text-text-muted">Name</label>
                <Input placeholder="e.g. Car loan" value={debtName} onChange={(e) => setDebtName(e.target.value)} required />
              </div>
              <div className="min-w-28">
                <label className="mb-1 block text-xs text-text-muted">Principal ($)</label>
                <Input placeholder="15000.00" inputMode="decimal" value={debtPrincipal} onChange={(e) => setDebtPrincipal(e.target.value)} required />
              </div>
              <div className="min-w-24">
                <label className="mb-1 block text-xs text-text-muted">APR %</label>
                <Input placeholder="6.5" inputMode="decimal" value={debtApr} onChange={(e) => setDebtApr(e.target.value)} />
              </div>
              <div className="min-w-24">
                <label className="mb-1 block text-xs text-text-muted">Min pay ($)</label>
                <Input placeholder="250.00" inputMode="decimal" value={debtMinPayment} onChange={(e) => setDebtMinPayment(e.target.value)} />
              </div>
              <Button type="submit" disabled={createDebt.isPending || !debtName || !debtPrincipal}>
                {createDebt.isPending ? "Adding…" : "Add debt"}
              </Button>
            </div>
            {debtError && <p className="text-sm text-danger">{debtError}</p>}
          </form>
        </Card>
      </div>

      {/* Goals */}
      <Card>
        <CardTitle>Goals</CardTitle>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(goals.data?.goals ?? []).map((g) => (
            <div key={g.id} className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-text">{g.name}</p>
                  <p className="text-xs text-text-muted">
                    <Money cents={g.current_cents} /> of <Money cents={g.target_cents} />
                    {g.target_date ? ` · by ${g.target_date}` : ""}
                  </p>
                </div>
                <button onClick={() => removeGoal.mutate(g.id)} className="text-xs text-text-muted hover:text-danger">
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
          {(goals.data?.goals ?? []).length === 0 && <p className="text-sm text-text-muted">No goals yet.</p>}
        </div>

        <form
          className="mt-4 space-y-3 border-t border-border pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            createGoal.mutate();
          }}
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-36 flex-1">
              <label className="mb-1 block text-xs text-text-muted">Name</label>
              <Input placeholder="e.g. Emergency fund" value={goalName} onChange={(e) => setGoalName(e.target.value)} required />
            </div>
            <div className="min-w-28">
              <label className="mb-1 block text-xs text-text-muted">Target ($)</label>
              <Input placeholder="10000.00" inputMode="decimal" value={goalTarget} onChange={(e) => setGoalTarget(e.target.value)} required />
            </div>
            <div className="min-w-28">
              <label className="mb-1 block text-xs text-text-muted">Saved so far ($)</label>
              <Input placeholder="0.00" inputMode="decimal" value={goalCurrent} onChange={(e) => setGoalCurrent(e.target.value)} />
            </div>
            <div className="min-w-28">
              <label className="mb-1 block text-xs text-text-muted">Per month ($)</label>
              <Input placeholder="200.00" inputMode="decimal" value={goalContribution} onChange={(e) => setGoalContribution(e.target.value)} />
            </div>
            <div className="min-w-32">
              <label className="mb-1 block text-xs text-text-muted">Target date</label>
              <CustomDatePicker ariaLabel="Goal target date" value={goalDate} onChange={setGoalDate} />
            </div>
            <Button type="submit" disabled={createGoal.isPending || !goalName || !goalTarget}>
              {createGoal.isPending ? "Adding…" : "Add goal"}
            </Button>
          </div>
          {goalError && <p className="text-sm text-danger">{goalError}</p>}
        </form>
      </Card>
    </div>
  );
}
