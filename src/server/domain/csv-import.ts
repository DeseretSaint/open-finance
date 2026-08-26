import { randomUUID } from "node:crypto";
import { apiErrors } from "@/lib/api-error";
import type { Db } from "@/server/db/types";
import { createCategoriesService } from "@/server/domain/categories";
import { dedupeName } from "@/server/domain/txn-dedupe";

/**
 * Bank-CSV transaction import. Handles the common bank statement export
 * formats (Capital One, America First, generic "Date, Description, Amount",
 * or a debit/credit pair). Rows are deduped against existing transactions on
 * (account_id, date, amount_cents, normalized name) so re-importing the same
 * file never doubles entries.
 *
 * Column detection is header-based and case-insensitive:
 *   date    — "date", "posted date", "transaction date", "trans date"
 *   name    — "description", "name", "payee", "memo", "merchant", "details",
 *             "transaction", "narration"
 *   amount  — single signed column "amount", "value", "total"
 *   debit   — "debit", "withdrawal", "charge", "payment"  (expense, positive)
 *   credit  — "credit", "deposit"                          (income, positive)
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
    const idx = (pred: (h: string) => boolean): number => header.findIndex(pred);

    const dateIdx = idx((h) => /^(post)?date|transdate|transactiondate|posteddate$/.test(h) || (h.includes("date") && !h.includes("amount")));
    const nameIdx = idx((h) => /^(description|name|payee|memo|merchant|details|transaction|narration|info)$/.test(h));
    const amountIdx = idx((h) => /^(amount|value|total|sum)$/.test(h));
    const debitIdx = idx((h) => /^(debit|withdrawal|withdrawals|charge|payment|moneyout)$/.test(h));
    const creditIdx = idx((h) => /^(credit|deposit|moneyin)$/.test(h));

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
