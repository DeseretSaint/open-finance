import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("app-shell error boundary", () => {
  it("error-boundary.tsx is a class component with getDerivedStateFromError", () => {
    const src = read("src/components/error-boundary.tsx");
    expect(src).toContain("class ErrorBoundary extends Component");
    expect(src).toContain("getDerivedStateFromError");
    expect(src).toContain("hasError");
  });

  it("renders a role=alert recovery card with a reload action", () => {
    const src = read("src/components/error-boundary.tsx");
    expect(src).toContain('role="alert"');
    expect(src).toContain("Something went wrong");
    expect(src).toContain("window.location.reload()");
  });

  it("guards reload behind hasWindow (SSR-safe)", () => {
    const src = read("src/components/error-boundary.tsx");
    expect(src).toContain("hasWindow()");
  });

  it("(app)/layout.tsx wraps children in ErrorBoundary", () => {
    const src = read("src/app/(app)/layout.tsx");
    expect(src).toContain('import { ErrorBoundary } from "@/components/error-boundary"');
    expect(src).toContain("<ErrorBoundary>{children}</ErrorBoundary>");
  });

  it("ErrorBoundary sits inside main, around children only (sidebar/header stay up)", () => {
    const src = read("src/app/(app)/layout.tsx");
    const mainIdx = src.indexOf("<main");
    const boundaryIdx = src.indexOf("<ErrorBoundary>{children}</ErrorBoundary>");
    const offlineIdx = src.indexOf("<OfflineToast />");
    expect(mainIdx).toBeGreaterThan(-1);
    expect(boundaryIdx).toBeGreaterThan(mainIdx);
    expect(boundaryIdx).toBeLessThan(offlineIdx);
  });
});
