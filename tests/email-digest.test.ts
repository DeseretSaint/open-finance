import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers";
import { createSoloBootstrapService } from "@/server/domain/solo-bootstrap";
import { createNotificationsService } from "@/server/domain/notifications";
import { createEmailDigestService, smtpConfigured } from "@/server/domain/email-digest";

describe("email digest (P11 hub)", () => {
  it("smtpConfigured is false without env", () => {
    // tests run without SMTP_* env — must be false so sweep never sends
    expect(smtpConfigured()).toBe(false);
  });

  it("sweep skips cleanly when SMTP is not configured", async () => {
    const db = createTestDb();
    const { user } = await createSoloBootstrapService(db).bootstrap({ displayName: "Phone", pin: "1234" });
    await createNotificationsService(db).update(user.id, {
      emailEnabled: true,
      emailAddress: "me@example.com",
    });
    const out = await createEmailDigestService(db).sweep();
    expect(out).toEqual({ checkedUsers: 0, sent: 0, skipped: 0 });
  });

  it("sendForUser explains why it can't send without SMTP", async () => {
    const db = createTestDb();
    const { user } = await createSoloBootstrapService(db).bootstrap({ displayName: "Phone", pin: "1234" });
    await createNotificationsService(db).update(user.id, {
      emailEnabled: true,
      emailAddress: "me@example.com",
    });
    const res = await createEmailDigestService(db).sendForUser(user.id);
    expect(res.sent).toBe(false);
    expect(res.reason).toMatch(/SMTP/i);
  });
});
