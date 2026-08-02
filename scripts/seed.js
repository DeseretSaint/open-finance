"use strict";
// Demo seed — creates a `demo` user with 3 months of transactions plus
// bills/debts/goals, pinned to SEED_DATE (env or --seed-date) for stable
// screenshots. Idempotent: re-running replaces the demo user's data.
//
//   node scripts/seed.js                 # uses SEED_DATE env or today
//   node scripts/seed.js --seed-date 2026-01-01
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const { runMigrations } = require("../migrations/up.js");

// ── args / env ─────────────────────────────────────────────────────────────
function loadDotEnv() {
  const p = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadDotEnv();

const argv = process.argv.slice(2);
const flagIdx = argv.indexOf("--seed-date");
const seedDate = flagIdx >= 0 ? argv[flagIdx + 1] : process.env.SEED_DATE || new Date().toISOString().slice(0, 10);
const dbPath = process.env.DATABASE_PATH || "./data/open-finance.db";

if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
const db = new Database(dbPath);
runMigrations(db);

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
if (!DATE_RE.test(seedDate)) {
  console.error(`Invalid seed date: ${seedDate} (want YYYY-MM-DD)`);
  process.exit(1);
}

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function addMonths(iso, months) {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

// ── demo user ──────────────────────────────────────────────────────────────
const DEMO_USERNAME = "demo";
const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(DEMO_USERNAME);
const demoUserId = existing ? existing.id : uid();
if (existing) {
  // reset all demo data
  const tables = ["bills", "debts", "goals", "budgets", "categories", "transactions", "accounts", "plaid_items", "plaid_credentials"];
  for (const t of tables) {
    if (t === "transactions" || t === "balance_history") {
      db.prepare(`DELETE FROM ${t} WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ?)`).run(demoUserId);
    } else if (t === "budgets") {
      db.prepare("DELETE FROM budget_categories WHERE budget_id IN (SELECT id FROM budgets WHERE user_id = ?)").run(demoUserId);
      db.prepare("DELETE FROM budgets WHERE user_id = ?").run(demoUserId);
    } else {
      db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(demoUserId);
    }
  }
  db.prepare("DELETE FROM balance_history WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ?)").run(demoUserId);
  db.prepare("UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?").run("Demo User", now(), demoUserId);
} else {
  db.prepare(
    "INSERT INTO users (id, username, display_name, password_hash, is_demo, created_at, updated_at) VALUES (?, ?, ?, NULL, 1, ?, ?)"
  ).run(demoUserId, DEMO_USERNAME, "Demo User", now(), now());
  db.prepare("INSERT INTO user_settings (user_id, updated_at) VALUES (?, ?)").run(demoUserId, now());
}
db.prepare("DELETE FROM sessions WHERE user_id = ?").run(demoUserId);

// ── system categories (mirror of src/server/domain/categories.ts ensureSystem) ──
const SYSTEM = [
  { name: "Food & Dining", paths: "Food and Drink\nFood and Drink|Restaurants" },
  { name: "Groceries", paths: "Food and Drink|Groceries" },
  { name: "Transportation", paths: "Transportation" },
  { name: "Housing", paths: "Home|Rent" },
  { name: "Utilities", paths: "Utilities|Bills and Utilities" },
  { name: "Income", paths: "Income|Paycheck" },
  { name: "Shopping", paths: "Shopping" },
  { name: "Entertainment", paths: "Entertainment" },
  { name: "Healthcare", paths: "Medical|Healthcare" },
  { name: "Travel", paths: "Travel" },
];
const COLORS = ["#10B981", "#6366F1", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4", "#84CC16", "#EC4899", "#F97316", "#14B8A6"];
const catId = {};
const insCat = db.prepare(
  "INSERT INTO categories (id, user_id, name, color, plaid_paths, is_system, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)"
);
for (let i = 0; i < SYSTEM.length; i++) {
  catId[SYSTEM[i].name] = uid();
  insCat.run(catId[SYSTEM[i].name], demoUserId, SYSTEM[i].name, COLORS[i % COLORS.length], SYSTEM[i].paths, now());
}

// ── accounts ───────────────────────────────────────────────────────────────
const insAcc = db.prepare(
  "INSERT INTO accounts (id, user_id, item_id, name, type, subtype, mask, current_balance_cents, available_balance_cents, currency, created_at) VALUES (?, ?, NULL, ?, ?, NULL, NULL, ?, ?, 'USD', ?)"
);
const checking = uid();
const savings = uid();
const credit = uid();
insAcc.run(checking, demoUserId, "Checking", "depository", 421350, 421350, now());
insAcc.run(savings, demoUserId, "Savings", "depository", 1250000, 1250000, now());
insAcc.run(credit, demoUserId, "Credit Card", "credit", -84325, -84325, now());

// ── transactions: 3 months before seed date + the seed month itself ─────────
const insTxn = db.prepare(
  `INSERT INTO transactions (id, account_id, plaid_transaction_id, amount_cents, date, authorized_date, name, merchant_name,
     category_path, personal_finance_category, pending, user_category_id, user_note, exclude_from_budgets, source, created_at)
   VALUES (?, ?, NULL, ?, ?, NULL, ?, NULL, NULL, NULL, 0, ?, NULL, 0, 'manual', ?)`
);
// income: 2 paychecks/mo × 3 months (POSITIVE = money in)
for (let m = 3; m >= 0; m--) {
  const monthStart = addMonths(seedDate, -m);
  const y = monthStart.slice(0, 4);
  const mo = monthStart.slice(5, 7);
  insTxn.run(uid(), checking, 235000, `${y}-${mo}-05`, "Acme Corp Payroll", catId["Income"], now());
  insTxn.run(uid(), checking, 235000, `${y}-${mo}-20`, "Acme Corp Payroll", catId["Income"], now());
  // expenses (NEGATIVE = money out)
  insTxn.run(uid(), checking, -145000, `${y}-${mo}-01`, "Maple Ridge Apartments", catId["Housing"], now());
  insTxn.run(uid(), checking, -9400, `${y}-${mo}-07`, "City Power & Light", catId["Utilities"], now());
  insTxn.run(uid(), checking, -5200, `${y}-${mo}-09`, "Verizon Wireless", catId["Utilities"], now());
  insTxn.run(uid(), checking, -6800, `${y}-${mo}-11`, "Whole Foods Market", catId["Groceries"], now());
  insTxn.run(uid(), checking, -4200, `${y}-${mo}-13`, "Trader Joe's", catId["Groceries"], now());
  insTxn.run(uid(), checking, -1549, `${y}-${mo}-14`, "Netflix", catId["Entertainment"], now());
  insTxn.run(uid(), checking, -8900, `${y}-${mo}-16`, "Shell Gas", catId["Transportation"], now());
  insTxn.run(uid(), checking, -3400, `${y}-${mo}-19`, "Chipotle", catId["Food & Dining"], now());
  insTxn.run(uid(), checking, -5600, `${y}-${mo}-22`, "Amazon", catId["Shopping"], now());
  insTxn.run(uid(), credit, -2100, `${y}-${mo}-24`, "Spotify", catId["Entertainment"], now());
}

// ── bills / debts / goals (pinned to seed date) ────────────────────────────
const insBill = db.prepare(
  `INSERT INTO bills (id, user_id, name, amount_cents, frequency, due_day, next_due_date, last_paid_amount_cents,
     category_id, account_id, active, notes, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)`
);
insBill.run(uid(), demoUserId, "Rent", 145000, "monthly", 1, `${seedDate.slice(0, 8)}01`, null, catId["Housing"], checking, now(), now());
insBill.run(uid(), demoUserId, "Electric", 9400, "monthly", 7, addDays(`${seedDate.slice(0, 8)}01`, 6), 10200, catId["Utilities"], checking, now(), now());
insBill.run(uid(), demoUserId, "Cell Phone", 5200, "monthly", 9, addDays(`${seedDate.slice(0, 8)}01`, 8), null, catId["Utilities"], checking, now(), now());
insBill.run(uid(), demoUserId, "Netflix", 1549, "monthly", 14, addDays(`${seedDate.slice(0, 8)}01`, 13), null, catId["Entertainment"], checking, now(), now());
insBill.run(uid(), demoUserId, "Car Insurance", 32400, "quarterly", 15, addDays(`${seedDate.slice(0, 8)}01`, 14), null, catId["Transportation"], checking, now(), now());
insBill.run(uid(), demoUserId, "HOA", 9500, "yearly", 1, addMonths(seedDate, 2), null, catId["Housing"], checking, now(), now());

const insDebt = db.prepare(
  `INSERT INTO debts (id, user_id, name, type, principal_cents, apr_bps, min_payment_cents, term_months,
     start_date, next_due_date, account_id, notes, created_at, updated_at)
   VALUES (?, ?, ?, 'credit', ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?)`
);
insDebt.run(uid(), demoUserId, "Credit Card", 84325, 1899, 2500, addMonths(seedDate, -14), seedDate, credit, now(), now());
const insDebtLoan = db.prepare(
  `INSERT INTO debts (id, user_id, name, type, principal_cents, apr_bps, min_payment_cents, term_months,
     start_date, next_due_date, account_id, notes, created_at, updated_at)
   VALUES (?, ?, ?, 'loan', ?, ?, ?, 60, ?, ?, NULL, NULL, ?, ?)`
);
insDebtLoan.run(uid(), demoUserId, "Car Loan", 1840000, 480, 35000, addMonths(seedDate, -6), seedDate, now(), now());

const insGoal = db.prepare(
  `INSERT INTO goals (id, user_id, name, type, category, target_cents, target_date, current_cents,
     monthly_contribution_cents, account_id, notes, created_at, updated_at)
   VALUES (?, ?, ?, 'savings', 'general', ?, ?, ?, ?, ?, NULL, ?, ?)`
);
insGoal.run(uid(), demoUserId, "Emergency Fund", 1500000, addMonths(seedDate, 18), 350000, 25000, savings, now(), now());
insGoal.run(uid(), demoUserId, "Summer Vacation", 300000, addMonths(seedDate, 10), 60000, 20000, savings, now(), now());

db.close();
console.log(`Seeded demo data for "${DEMO_USERNAME}" (seed date ${seedDate}) at ${dbPath}`);
