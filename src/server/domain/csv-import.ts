import { randomUUID } from "node:crypto";
import { apiErrors } from "@/lib/api-error";
import type { Db } from "@/server/db/types";
import { createCategoriesService } from "@/server/domain/categories";
import { dedupeName } from "@/server/domain/txn-dedupe";

/**
 * Hard cap on an uploaded CSV body (25 MB). A bank statement export is at most
 * a few MB of text; the cap exists so a hostile or misconfigured upload cannot
 * exhaust server memory — the route buffers the whole JSON body into RAM via
 * req.json() before parsing. Mirrors the backup-restore size cap (run 81).
 */
export const MAX_CSV_BYTES = 25 * 1024 * 1024;

/**
 * Reject oversized CSV uploads BEFORE buffering the JSON body into RAM
 * (declared Content-Length header; the string length is re-checked after parse
 * for chunked/lying headers). Either exceeding MAX_CSV_BYTES throws 413. A
 * non-numeric Content-Length is ignored here (the length check after parsing
 * still applies).
 */
export function assertCsvSize(declaredContentLength: string | null, bodyLength: number | null): void {
  const declared = declaredContentLength === null ? NaN : Number(declaredContentLength);
  if (
    (Number.isFinite(declared) && declared > MAX_CSV_BYTES) ||
    (bodyLength !== null && bodyLength > MAX_CSV_BYTES)
  ) {
    throw apiErrors.payloadTooLarge("CSV file is too large (limit 25 MB).");
  }
}

/**
 * Bank-CSV transaction import. Handles the common bank statement export
 * formats (Capital One, America First, generic "Date, Description, Amount",
 * or a debit/credit pair). Rows are deduped against existing transactions on
 * (account_id, date, amount_cents, normalized name) so re-importing the same
 * file never doubles entries.
 *
 * Column detection is header-based, case-insensitive, and tolerant of the
 * common bank/statement export phrasings. Each header is classified by role
 * (first match wins, checked in priority order):
 *   date    — any header containing "date" ("Posted Date", "Trans Date", …)
 *   amount  — a single signed column: exact "amount"/"value"/"total"/"sum",
 *             any header containing "amount" ("Amount ($)", "Transaction
 *             Amount"), or a combined "Amount Debit/Credit" column
 *   debit   — exact "debit"/"withdrawal"/"charge"/"payment"/…, or a header
 *             starting with "debit" ("Debit Amount") — expense, positive
 *   credit  — exact "credit"/"deposit"/…, or a header starting with "credit"
 *             ("Credit Amount") — income, positive
 *   name    — exact "description"/"name"/"payee"/"memo"/"merchant"/"details"/
 *             "transaction"/"narration"/"info"/"reference", or a header
 *             ending in "name"/"description"/"memo"/"payee" ("Merchant Name",
 *             "Payee Name", "Transaction Description")
 *
 * Sign convention matches the app: expense = negative cents, income = positive.
 * A single "amount" column is treated as signed (negative = expense); debit +
 * credit pairs are converted (debit → negative, credit → positive).
 */

interface ParsedRow {
  date: string;
  name: string;
  amountCents: number;
}

function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  // YYYY-MM-DD or YYYY/MM/DD
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // MM/DD/YYYY or MM-DD-YYYY (US bank exports), also M/D/YYYY
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) {
    const [, mo, d, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // MM/DD/YY
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2})$/);
  if (m) {
    const [, mo, d, yy] = m;
    const y = Number(yy) < 70 ? 2000 + Number(yy) : 1900 + Number(yy);
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

function parseAmount(raw: string): number | null {
  const s = raw.trim().replace(/[$,]/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function normHeader(h: string): string {
  return h.toLowerCase().replace(/["'\s]+/g, "");
}

type HeaderRole = "date" | "name" | "amount" | "debit" | "credit";

const NAME_EXACT = new Set([
  "description", "name", "payee", "memo", "merchant", "details",
  "transaction", "narration", "info", "reference",
]);
const AMOUNT_EXACT = new Set(["amount", "value", "total", "sum"]);
const DEBIT_EXACT = new Set(["debit", "withdrawal", "withdrawals", "charge", "payment", "moneyout"]);
const CREDIT_EXACT = new Set(["credit", "deposit", "moneyin"]);

/** Exact/well-known header spellings (checked first). */
function classifyExact(h: string): HeaderRole | null {
  if (h.includes("date") && !h.includes("amount")) return "date";
  if (AMOUNT_EXACT.has(h)) return "amount";
  if (DEBIT_EXACT.has(h)) return "debit";
  if (CREDIT_EXACT.has(h)) return "credit";
  if (NAME_EXACT.has(h)) return "name";
  return null;
}

/**
 * Tolerant matching for bank-export phrasings ("Merchant Name", "Amount ($)",
 * "Debit Amount", "Amount Debit/Credit", …). Each header gets at most one
 * role; priority: combined debit+credit → single signed amount, then
 * debit/credit, then amount, then name — so "Debit Amount" is a debit
 * column, never the signed amount column.
 */
function classifyFuzzy(h: string): HeaderRole | null {
  if (h.includes("debit") && h.includes("credit")) return "amount";
  if (h.includes("debit")) return "debit";
  if (h.includes("credit")) return "credit";
  if (h.includes("amount")) return "amount";
  if (h.endsWith("name") || h.endsWith("description") || h.endsWith("memo") || h.endsWith("payee")) return "name";
  return null;
}

/** Split a CSV line into fields, honoring quoted fields ("" escapes a quote). */
function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

function detectDelimiter(firstLine: string): string {
  for (const d of [",", "\t", ";"]) {
    if (firstLine.includes(d)) return d;
  }
  return ",";
}

export function createCsvImportService(db: Db) {
  /**
   * Parse CSV text into rows. Returns { rows, detected: {columns…} } so the
   * caller can preview/import. Throws a badRequest with a readable message on
   * unrecognized layouts.
   */
  function parseCsv(contents: string): { rows: ParsedRow[]; columns: string[]; matched: number; skippedHeaders: number } {
    const text = contents.replace(/^\uFEFF/, "").trim();
    if (!text) throw apiErrors.badRequest("The file is empty.");
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) throw apiErrors.badRequest("The file needs a header row plus at least one transaction row.");

    const delimiter = detectDelimiter(lines[0]);
    const header = splitCsvLine(lines[0], delimiter).map(normHeader);
    const columns = header;
    // Classify each header into a role. Exact/well-known spellings win over
    // tolerant matches (e.g. "Name" beats "Merchant Name" when both exist).
    const exact = header.map(classifyExact);
    const fuzzy = header.map(classifyFuzzy);
    const idx = (role: HeaderRole): number => {
      const e = exact.indexOf(role);
      return e !== -1 ? e : fuzzy.indexOf(role);
    };

    const dateIdx = idx("date");
    const nameIdx = idx("name");
    const amountIdx = idx("amount");
    const debitIdx = idx("debit");
    const creditIdx = idx("credit");

    if (dateIdx === -1 || nameIdx === -1) {
      throw apiErrors.badRequest(
        `Could not find date and description columns. Found: ${columns.join(", ") || "(none)"}. Expected columns like Date, Description, Amount (or Debit/Credit).`
      );
    }
    if (amountIdx === -1 && debitIdx === -1 && creditIdx === -1) {
      throw apiErrors.badRequest(
        `Could not find an amount column. Found: ${columns.join(", ") || "(none)"}. Look for an Amount, Debit, or Credit column.`
      );
    }

    const rows: ParsedRow[] = [];
    let skippedHeaders = 0;
    for (let i = 1; i < lines.length; i++) {
      const fields = splitCsvLine(lines[i], delimiter);
      const get = (ix: number) => (ix >= 0 && ix < fields.length ? fields[ix] : "");

      const date = parseDate(get(dateIdx));
      const name = get(nameIdx).slice(0, 200);
      if (!date || !name) continue;

      let amountCents: number | null = null;
      if (amountIdx !== -1) {
        // Single signed amount column: negative = expense (matches app).
        amountCents = parseAmount(get(amountIdx));
      } else {
        // Debit/credit pair: debit (expense) → negative, credit (income) → positive.
        const debit = debitIdx !== -1 ? parseAmount(get(debitIdx)) : null;
        const credit = creditIdx !== -1 ? parseAmount(get(creditIdx)) : null;
        if (debit && debit !== 0) amountCents = -debit;
        else if (credit && credit !== 0) amountCents = credit;
      }

      if (amountCents === null || amountCents === 0) {
        skippedHeaders++;
        continue;
      }
      rows.push({ date, name, amountCents });
    }

    if (rows.length === 0) {
      throw apiErrors.badRequest(
        "No transaction rows could be parsed. Check that the file uses one of the common bank CSV layouts (Date, Description, Amount)."
      );
    }

    return { rows, columns, matched: rows.length, skippedHeaders };
  }

  /**
   * Import parsed rows into an account. Dedupes against existing transactions
   * on (account_id, date, amount_cents, normalized name). Runs the same
   * category matching as ingest (path/PFC match + merchant-name fallback).
   */
  async function importRows(
    userId: string,
    accountId: string,
    rows: ParsedRow[]
  ): Promise<{ imported: number; skipped: number; firstImported: string[] }> {
    const account = await db.get<{ id: string }>(
      "SELECT id FROM accounts WHERE id = ? AND user_id = ?",
      accountId,
      userId
    );
    if (!account) throw apiErrors.notFound("Account");

    const cats = createCategoriesService(db);
    await cats.ensureSystem(userId);

    // Existing dedupe keys for this account: date|amountCents|normalized name.
    const existing = await db.all<{ date: string; amount_cents: number; name: string }>(
      "SELECT date, amount_cents, name FROM transactions WHERE account_id = ?",
      accountId
    );
    const seen = new Set<string>();
    for (const e of existing) {
      seen.add(`${e.date}|${e.amount_cents}|${dedupeName(e.name)}`);
    }

    let imported = 0;
    let skipped = 0;
    const firstImported: string[] = [];
    await db.transaction(async () => {
      for (const row of rows) {
        const key = `${row.date}|${row.amountCents}|${dedupeName(row.name)}`;
        if (seen.has(key)) {
          skipped++;
          continue;
        }
        seen.add(key);
        // CSVs have no Plaid category data — use the merchant-name keyword
        // fallback so obvious merchants get categorized on import.
        const cat = await cats.matchByName(userId, row.name);
        await db.run(
          "INSERT INTO transactions (id, account_id, plaid_transaction_id, amount_cents, date, authorized_date, name, merchant_name, category_path, personal_finance_category, pending, user_category_id, user_note, exclude_from_budgets, source, created_at) VALUES (?, ?, NULL, ?, ?, NULL, ?, NULL, NULL, NULL, 0, ?, NULL, 0, 'csv', ?)",
          randomUUID(),
          accountId,
          row.amountCents,
          row.date,
          row.name,
          cat?.id ?? null,
          new Date().toISOString()
        );
        imported++;
        if (firstImported.length < 5) firstImported.push(`${row.date} · ${row.name}`);
      }
    });
    return { imported, skipped, firstImported };
  }

  /** One-call convenience for the API route. */
  async function importCsv(userId: string, accountId: string, contents: string) {
    const { rows } = parseCsv(contents);
    const result = await importRows(userId, accountId, rows);
    return { ...result, totalParsed: rows.length };
  }

  return { parseCsv, importRows, importCsv };
}

export type CsvImportService = ReturnType<typeof createCsvImportService>;
