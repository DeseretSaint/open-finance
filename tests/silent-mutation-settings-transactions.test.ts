import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Run-146 (SLOT-B): four frontend mutations still had NO onError and failed
 * silently — a failed request (network/CSRF/validation) left the UI out of sync
 * with the server and gave the user zero feedback:
 *   - settings/page.tsx `revoke`  (session revoke — row silently stays)
 *   - settings/page.tsx `logoutAll` (logout-all — dialog stays open, no feedback)
 *   - settings/page.tsx `setPref`  (agent-prefs toggles — optimistic UI desync)
 *   - transactions/page.tsx `toggleExclude` (exclude-from-budgets checkbox flips
 *     but the server never saved)
 * These guards fail the build if any of them loses its error surfacing.
 */
const SETTINGS = path.resolve(__dirname, "../src/app/(app)/settings/page.tsx");
const TXNS = path.resolve(__dirname, "../src/app/(app)/transactions/page.tsx");

function mutationBody(src: string, name: string): string {
  const start = src.indexOf(`const ${name} = useMutation(`);
  if (start < 0) throw new Error(`mutation not found: ${name}`);
  let i = src.indexOf("{", start) + 1;
  let depth = 1;
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
  }
  return src.slice(start, i);
}

describe("settings silent mutations surface errors", () => {
  const src = readFileSync(SETTINGS, "utf8");

  it("revoke has onError -> setErr", () => {
    const body = mutationBody(src, "revoke");
    expect(body).toContain("onError");
    expect(body).toContain("setErr(");
  });

  it("logoutAll has onError -> setErr (stays on page on failure)", () => {
    const body = mutationBody(src, "logoutAll");
    expect(body).toContain("onError");
    expect(body).toContain("setErr(");
  });

  it("setPref has onError -> setErr", () => {
    const body = mutationBody(src, "setPref");
    expect(body).toContain("onError");
    expect(body).toContain("setErr(");
  });
});

describe("transactions toggleExclude surfaces errors", () => {
  const src = readFileSync(TXNS, "utf8");
  const body = mutationBody(src, "toggleExclude");

  it("toggleExclude has onError -> setError", () => {
    expect(body).toContain("onError");
    expect(body).toContain("setError(");
  });
});
