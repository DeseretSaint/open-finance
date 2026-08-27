import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Agent manual editor UX (validation + preview): the AI-guidance editor should
 * (1) bound each field to MANUAL_MAX_LEN with a live counter + hard limit
 * message, (2) offer a Preview of exactly what the agent reads on its next poll,
 * (3) only enable Save when the draft actually changed (dirty) and is within limit.
 * The page is a client component (can't render in node without a DOM), so these
 * are source-level guards (matches agent-permission-ux / reports-trend-chart pattern).
 */
const src = readFileSync(path.resolve(__dirname, "../src/app/(app)/agents/page.tsx"), "utf8");

describe("agent manual editor UX (validation + preview)", () => {
  it("imports the shared manual length cap (MANUAL_MAX_LEN)", () => {
    expect(src).toMatch(/import \{ MANUAL_MAX_LEN \} from "@\/server\/domain\/agent-manual-meta";/);
  });

  it("shows a live per-field character counter bounded by the cap", () => {
    // counter template `${d.draft.length}/{MANUAL_MAX_LEN}`
    expect(src).toContain("d.draft.length}/{MANUAL_MAX_LEN}");
    // over-limit turns the counter red
    expect(src).toContain('"text-danger" : "text-text-muted"');
  });

  it("blocks save past the limit with a visible message", () => {
    expect(src).toContain("A field exceeds the {MANUAL_MAX_LEN}-character limit.");
    expect(src).toContain("overLimit");
    // Save disabled while over limit (and while not dirty)
    expect(src).toContain("!dirty || overLimit");
  });

  it("offers a preview of exactly what the agent reads next poll", () => {
    expect(src).toContain("Preview");
    expect(src).toContain("Hide preview");
    expect(src).toContain("What your agent reads on its next poll:");
    // preview is the serialized non-empty domains
    expect(src).toContain("JSON.stringify(preview, null, 2)");
  });

  it("only enables Save when the draft has changed (dirty) and is in limit", () => {
    expect(src).toContain("const dirty = domains.some((d) => d.draft !== saved[d.key]);");
    expect(src).toContain('dirty ? "Save guidance" : "Saved"');
  });
});
