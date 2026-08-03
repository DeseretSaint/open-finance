import nodemailer from "nodemailer";
import { getDb, type Db } from "@/server/db/adapter";
import { createNotificationsService } from "@/server/domain/notifications";
import { createBudgetsService } from "@/server/domain/budgets";
import { createPlanningService } from "@/server/domain/planning";
import { currentVersion } from "@/server/domain/updates";

/**
 * Email digests (P11) — hub-side sender. Users who enable email digests get a
 * daily or weekly "where does my budget stand" summary from their own hub via
 * SMTP (self-hosted: SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM env).
 *
 * Content policy: the digest shows budget NAMES + status (on track / needs
 * review) and how many budgets are in each bucket. It deliberately does NOT
 * include account numbers or transaction-level detail — the phone is where
 * the details live.
 *
 * Last-sent timestamps live in app_state (`digest.sent.<userId>` + frequency)
 * so the scheduler can decide when a user is due.
 */

const SMTP = {
  host: process.env.SMTP_HOST ?? "",
  port: parseInt(process.env.SMTP_PORT ?? "587", 10),
  user: process.env.SMTP_USER ?? "",
  pass: process.env.SMTP_PASS ?? "",
  from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "Open Finance <noreply@localhost>",
};

export function smtpConfigured(): boolean {
  return !!(SMTP.host && (SMTP.pass || SMTP.user));
}

export interface DigestOutcome {
  checkedUsers: number;
  sent: number;
  skipped: number;
}

export function createEmailDigestService(db: Db = getDb()) {
  const notif = createNotificationsService(db);
  const budgets = createBudgetsService(db);
  const planning = createPlanningService(db);

  async function lastSent(userId: string, frequency: string): Promise<string | null> {
    const row = await db.get<{ value: string }>(
      "SELECT value FROM app_state WHERE key = ?",
      `digest.sent.${userId}.${frequency}`
    );
    return row?.value ?? null;
  }

  async function markSent(userId: string, frequency: string): Promise<void> {
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      `digest.sent.${userId}.${frequency}`,
      now,
      now
    );
  }

  function due(last: string | null, frequency: string, now = Date.now()): boolean {
    if (!last) return true; // never sent → send
    const windowMs = frequency === "daily" ? 20 * 60 * 60 * 1000 : 6 * 24 * 60 * 60 * 1000;
    // daily: 20h window (tolerate jitter), weekly: 6d window
    return now - new Date(last).getTime() >= windowMs;
  }

  async function compose(userId: string): Promise<string> {
    const list = await budgets.list(userId);
    const lines: string[] = [];
    let review = 0;

    for (const b of list) {
      const needs = b.pct >= 0.85 || b.remainingCents < 0;
      if (needs) review++;
      lines.push(
        `• ${b.name}: ${needs ? "needs review" : "on track"} (${Math.round(b.pct * 100)}% used)`
      );
    }

    let billsLine = "";
    try {
      const bills = await planning.listBills(userId);
      const upcoming = bills.filter((b) => b.active);
      if (upcoming.length > 0) billsLine = `\n\nBills on file: ${upcoming.length} active.`;
    } catch {
      /* optional */
    }

    const headline =
      list.length === 0
        ? "No budgets set up yet — add one in the app when you're ready."
        : review > 0
          ? `${review} budget${review === 1 ? "" : "s"} need${review === 1 ? "s" : ""} a look — open the app for details.`
          : `All ${list.length} budget${list.length === 1 ? "" : "s"} are on track.`;

    return [
      `Open Finance budget summary`,
      ``,
      headline,
      ``,
      ...lines,
      billsLine,
      ``,
      `— sent by your own Open Finance hub (v${currentVersion()}). Details stay in the app.`,
    ].join("\n");
  }

  return {
    /** Send ONE user's digest now (used by the scheduler and for a manual test hook). */
    async sendForUser(userId: string): Promise<{ sent: boolean; reason?: string }> {
      const prefs = await notif.get(userId);
      if (!prefs.emailEnabled || !prefs.emailAddress) {
        return { sent: false, reason: "email not enabled or no address" };
      }
      if (!smtpConfigured()) {
        return { sent: false, reason: "SMTP not configured (set SMTP_HOST/SMTP_USER/SMTP_PASS)" };
      }
      const body = await compose(userId);
      const transporter = nodemailer.createTransport({
        host: SMTP.host,
        port: SMTP.port,
        secure: SMTP.port === 465,
        auth: SMTP.user ? { user: SMTP.user, pass: SMTP.pass } : undefined,
      });
      await transporter.sendMail({
        from: SMTP.from,
        to: prefs.emailAddress,
        subject: prefs.emailFrequency === "daily" ? "Open Finance — daily budget status" : "Open Finance — weekly budget status",
        text: body,
      });
      await markSent(userId, prefs.emailFrequency);
      return { sent: true };
    },

    /** Scheduler sweep: find users due for a digest and send. */
    async sweep(now = Date.now()): Promise<DigestOutcome> {
      if (!smtpConfigured()) return { checkedUsers: 0, sent: 0, skipped: 0 };
      const rows = await db.all<{ id: string }>("SELECT id FROM users WHERE is_demo = 0");
      let sent = 0;
      let skipped = 0;
      for (const row of rows) {
        const prefs = await notif.get(row.id);
        if (!prefs.emailEnabled || !prefs.emailAddress) {
          skipped++;
          continue;
        }
        const last = await lastSent(row.id, prefs.emailFrequency);
        if (!due(last, prefs.emailFrequency, now)) {
          skipped++;
          continue;
        }
        try {
          const res = await this.sendForUser(row.id);
          if (res.sent) sent++;
          else skipped++;
        } catch {
          skipped++;
        }
      }
      return { checkedUsers: rows.length, sent, skipped };
    },
  };
}

export type EmailDigestService = ReturnType<typeof createEmailDigestService>;

/**
 * Scheduler: sweeps every 30 minutes for users whose digest is due. The
 * due-window logic (20h/6d) means jitter across sweeps is fine; a missed
 * sweep just delays by one cycle. Never crashes the process.
 */
export function startEmailDigestScheduler(db: Db = getDb()): NodeJS.Timeout | null {
  if (process.env.DISABLE_EMAIL_DIGEST === "1") return null;
  return setInterval(async () => {
    try {
      await createEmailDigestService(db).sweep();
    } catch (e) {
      console.error("Email digest sweep failed:", e);
    }
  }, 30 * 60 * 1000);
}
