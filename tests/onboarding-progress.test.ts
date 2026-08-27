import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const src = readFileSync(join(root, "src/components/onboarding-wizard.tsx"), "utf8");

// Onboarding progress indicator (run 125, SLOT-B): the 6-step wizard had no
// sense of position — users couldn't tell how far along setup they were.
// A calm dot row + "Step N of 5" label must exist for the numbered steps.
describe("onboarding wizard progress indicator", () => {
  it("defines the numbered step order between welcome and done", () => {
    expect(src).toContain(
      'const WIZARD_STEPS: Step[] = ["paydays", "security", "plaid", "bank", "agent"];'
    );
  });

  it("renders a StepProgress component with an accessible step counter", () => {
    expect(src).toContain("function StepProgress(");
    expect(src).toMatch(/aria-label=\{`Step \$\{idx \+ 1\} of \$\{WIZARD_STEPS\.length\}`\}/);
    expect(src).toContain('aria-current={i === idx ? "step" : undefined}');
  });

  it("mounts StepProgress in the wizard shell", () => {
    expect(src).toContain("<StepProgress step={step} />");
  });

  it("hides the indicator on welcome and done (idx === -1 guard)", () => {
    expect(src).toContain("if (idx === -1) return null;");
  });
});
