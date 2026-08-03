import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers";
import { createSoloBootstrapService } from "@/server/domain/solo-bootstrap";
import { createOnboardingService } from "@/server/domain/onboarding";

describe("onboarding (P8c)", () => {
  it("starts incomplete, completes, and can be reset", async () => {
    const db = createTestDb();
    const solo = createSoloBootstrapService(db);
    const { user } = await solo.bootstrap({ displayName: "Phone", pin: "1234" });
    const svc = createOnboardingService(db);

    expect(await svc.get(user.id)).toEqual({ completed: false, completedAt: null });

    const done = await svc.complete(user.id);
    expect(done.completed).toBe(true);
    expect((await svc.get(user.id)).completed).toBe(true);

    const reset = await svc.reset(user.id);
    expect(reset.completed).toBe(false);
    expect((await svc.get(user.id)).completed).toBe(false);
  });

  it("complete is idempotent", async () => {
    const db = createTestDb();
    const solo = createSoloBootstrapService(db);
    const { user } = await solo.bootstrap({ displayName: "Phone" });
    const svc = createOnboardingService(db);

    await svc.complete(user.id);
    await svc.complete(user.id); // no throw
    expect((await svc.get(user.id)).completed).toBe(true);
  });
});
