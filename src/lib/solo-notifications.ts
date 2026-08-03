"use client";

/**
 * Solo on-device notifications (P11).
 *
 * Privacy contract: NOTIFICATION CONTENT NEVER CONTAINS AMOUNTS. The phone
 * shows only status words ("on track" / "needs review" / "bill due") — the
 * numbers live inside the app, reached by tapping the notification.
 *
 * Strategy: local notifications are scheduled one-shot (the plugin can't
 * compute content at fire time). So on every app launch (and whenever prefs
 * change) we compute the CURRENT budget status and schedule the NEXT
 * occurrence (daily or weekly at the user's chosen time). Stale pending
 * notifications are cancelled first, so the schedule always reflects the
 * latest state.
 */

import type { Db } from "@/server/db/types";

export interface BudgetStatusSummary {
  onTrack: boolean;
  needsReview: boolean;
  budgetCount: number;
  billsDueSoon: number;
}

/** Compute a privacy-safe status summary from the local DB. */
export async function computeBudgetStatus(db: Db, userId: string): Promise<BudgetStatusSummary> {
  const { createBudgetsService } = await import("@/server/domain/budgets");
  const { createPlanningService } = await import("@/server/domain/planning");

  const budgets = await createBudgetsService(db).list(userId);
  let onTrack = 0;
  let needsReview = 0;
  for (const b of budgets) {
    // "needs review" = over budget or ≥85% spent (privacy-safe: no amounts)
    if (b.pct >= 0.85 || b.remainingCents < 0) needsReview++;
    else onTrack++;
  }

  let billsDueSoon = 0;
  try {
    const bills = await createPlanningService(db).listBills(userId);
    const now = new Date();
    const day = now.getDate();
    for (const bill of bills) {
      if (!bill.active) continue;
      const dueDay = bill.due_day ?? 1;
      let due = dueDay;
      if (due < day) {
        // next month
        const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        due = new Date(next.getFullYear(), next.getMonth() + 1, dueDay).getDate();
      }
      const daysUntil = due - day;
      if (daysUntil >= 0 && daysUntil <= 3) billsDueSoon++;
    }
  } catch {
    /* bills are optional — never fail the whole summary */
  }

  return {
    onTrack: onTrack > 0,
    needsReview: needsReview > 0,
    budgetCount: budgets.length,
    billsDueSoon,
  };
}

function nextFire(hourMin: string, frequency: "daily" | "weekly", now = new Date()): Date {
  const [h, m] = hourMin.split(":").map((n) => parseInt(n, 10) || 0);
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  if (frequency === "weekly") d.setDate(d.getDate() + 6);
  return d;
}

function titleFor(s: BudgetStatusSummary): string {
  if (s.billsDueSoon > 0) return "Bill due soon";
  if (s.needsReview) return "Budget needs review";
  if (s.onTrack) return "You're on track";
  return "Budget update";
}

function bodyFor(s: BudgetStatusSummary, frequency: "daily" | "weekly"): string {
  const when = frequency === "daily" ? "today" : "this week";
  if (s.budgetCount === 0) return `Open Open Finance to see your ${when} budget.`;
  if (s.needsReview) return `Some budgets need a look — open the app for details.`;
  return `Your budgets are on track ${when} — open the app for details.`;
}

export interface NotifPrefsInput {
  enabled: boolean;
  frequency: "daily" | "weekly";
  time: string;
}

/**
 * (Re)schedule the next status notification. Call on app launch + whenever
 * prefs change. Cancels pending first so stale content never fires.
 * Resolves the device user from the db itself — pass the solo CapSqliteDb.
 */
export async function syncNotificationSchedule(db: Db, prefs: NotifPrefsInput): Promise<void> {
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const pending = await LocalNotifications.getPending();
    await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });

    if (!prefs.enabled) return;

    const perms = await LocalNotifications.checkPermissions();
    if (perms.display !== "granted") {
      const req = await LocalNotifications.requestPermissions();
      if (req.display !== "granted") return;
    }

    const { createSoloBootstrapService } = await import("@/server/domain/solo-bootstrap");
    const user = await createSoloBootstrapService(db).getDeviceUser();
    if (!user) return;

    const summary = await computeBudgetStatus(db, user.id);
    const fire = nextFire(prefs.time, prefs.frequency);

    await LocalNotifications.schedule({
      notifications: [
        {
          id: 1,
          title: titleFor(summary),
          body: bodyFor(summary, prefs.frequency),
          schedule: { at: fire },
        },
      ],
    });
  } catch {
    /* notifications are best-effort — never crash the app over them */
  }
}
