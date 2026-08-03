/** Scope → human copy for the capability sentence (P7b §6.5.3). */
export const SCOPE_COPY: Record<string, string> = {
  "read:summary": "a one-call dashboard briefing",
  "read:banking": "your checking & savings accounts",
  "read:investments": "your investment accounts",
  "read:budgets": "your budgets",
  "read:planning": "bills, debts, goals & projections",
  "read:reports": "reports (net worth, cashflow, spending)",
  "transactions:edit": "categorize and edit transactions",
  "budgets:write": "create and change budgets",
  "planning:write": "create bills, debts and goals",
  "categories:write": "create categories",
  "settings:write": "change settings",
  "sync:run": "trigger Plaid syncs",
  "dev:ui": "add custom dashboard widgets",
};

export interface CapabilityAccount {
  id: string;
  name: string;
  type: string | null;
}

/**
 * Live capability sentence: names the accounts the agent can read (respecting
 * the allowlist + banking/investments split), lists the other scopes, and
 * honestly flags what it cannot see.
 */
export function capabilitySentence(
  scopes: string[],
  accounts: CapabilityAccount[],
  accountIds: string[] | null
): string {
  const parts: string[] = [];
  const readBanking = scopes.includes("read:banking");
  const readInv = scopes.includes("read:investments");
  const readRest = ["read:summary", "read:budgets", "read:planning", "read:reports"].filter((s) => scopes.includes(s));

  if (readBanking || readInv) {
    let names: string[] = [];
    if (accountIds === null) {
      names = accounts
        .filter((a) => (readBanking && (!a.type || a.type !== "investment")) || (readInv && a.type === "investment"))
        .map((a) => a.name);
    } else {
      names = accounts.filter((a) => accountIds.includes(a.id)).map((a) => a.name);
    }
    if (names.length > 0) {
      parts.push(`read ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}`);
    }
  }
  for (const s of readRest) parts.push(SCOPE_COPY[s]);
  const writes = [
    "transactions:edit",
    "budgets:write",
    "planning:write",
    "categories:write",
    "settings:write",
    "sync:run",
  ].filter((s) => scopes.includes(s));
  for (const s of writes) parts.push(`can ${SCOPE_COPY[s]}`);

  if (parts.length === 0) return "This agent cannot see or change anything yet.";
  const sentence = `This agent can ${parts.join("; ")}.`;
  const missing = Object.keys(SCOPE_COPY).filter((s) => !scopes.includes(s) && s !== "dev:ui");
  if (missing.length > 0) {
    return (
      sentence +
      ` It cannot see ${missing.length > 2 ? `${missing.length} other things` : missing.map((s) => s.split(":")[1]).join(" or ")} — you can grant these anytime.`
    );
  }
  return sentence;
}
