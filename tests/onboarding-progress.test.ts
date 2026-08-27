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

  it("defines a prevStep helper for back navigation", () => {
    expect(src).toContain("function prevStep(s: Step): Step {");
  });

  it("renders a Back button on every numbered step (5 total, none on welcome/done)", () => {
    const backCount = (src.match(/← Back/g) || []).length;
    expect(backCount).toBe(5);
    // Each footer wires Back to prevStep.
    expect((src.match(/onClick=\{\(\) => setStep\(prevStep\(step\)\)\}/g) || []).length).toBe(5);
  });

  it("bank step advances via one conditional button (no duplicate Continue + Done linking)", () => {
    // Bug fixed: the bank footer previously rendered a sibling secondary "Continue"
    // button AND a conditional primary "Done linking"/"Skip" button at once. Now a
    // single ternary renders one advance button.
    expect(src).not.toContain('{keysSaved ? "Continue" : "Continue"}');
    expect(src).not.toContain('variant="secondary" onClick={() => setStep("agent")}');
    expect(src).toMatch(
      /\{keysSaved \? \(\s*<Button onClick=\{\(\) => setStep\("agent"\)\}[\s\S]*?\) : \(\s*<Button onClick=\{\(\) => setStep\("agent"\)\}/
    );
  });
});
