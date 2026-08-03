import { describe, expect, it } from "vitest";
import { createTestDb, seedUser } from "./helpers";
import { createCustomViewsService, validateWidgetDef } from "@/server/domain/custom-views";

describe("custom views / agent widgets (dev:ui, D10)", () => {
  it("creates, lists, updates and removes a widget", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createCustomViewsService(db);

    const view = await svc.create(user.id, "tok-1", {
      tab: "dashboard",
      name: "spending-this-month",
      widget: {
        kind: "donut",
        title: "Spending by category",
        slices: [
          { label: "Groceries", valueCents: 41205 },
          { label: "Dining", valueCents: 18840 },
        ],
      },
    });
    expect(view.id).toBeTruthy();
    expect(view.widget.kind).toBe("donut");

    const onDashboard = await svc.list(user.id, "dashboard");
    expect(onDashboard.length).toBe(1);
    expect(await svc.list(user.id, "budgets")).toEqual([]);

    const updated = await svc.update(user.id, view.id, { position: 3 });
    expect(updated.position).toBe(3);

    await svc.remove(user.id, view.id);
    expect(await svc.list(user.id)).toEqual([]);
  });

  it("validates every widget kind and rejects malformed definitions", async () => {
    expect(validateWidgetDef({ kind: "stat", title: "Balance", valueCents: 257036 }).valueCents).toBe(257036);
    expect(validateWidgetDef({ kind: "progress", title: "Food", spentCents: 30000, limitCents: 40000 }).spentCents).toBe(30000);
    expect(validateWidgetDef({ kind: "list", title: "Top", rows: [{ label: "A", valueCents: 1 }] }).rows?.length).toBe(1);
    expect(
      validateWidgetDef({ kind: "line", title: "Trend", points: [{ label: "Jan", value: 1 }, { label: "Feb", value: 2 }] }).points?.length
    ).toBe(2);

    expect(() => validateWidgetDef({ kind: "stat", title: "No value" })).toThrow(/valueCents|valueText/);
    expect(() => validateWidgetDef({ kind: "progress", title: "No limit", spentCents: 1 })).toThrow(/limitCents/);
    expect(() => validateWidgetDef({ kind: "line", title: "One", points: [{ label: "Jan", value: 1 }] })).toThrow(/2 points/);
    expect(() => validateWidgetDef({ kind: "unknown", title: "X" })).toThrow(/kind/);
    expect(() => validateWidgetDef({ kind: "stat" })).toThrow(/title/);
    // HTML/JS never survives validation — only the declared fields pass through.
    const clean = validateWidgetDef({ kind: "stat", title: "Safe", valueText: "hi", hack: "<script>alert(1)</script>" });
    expect("hack" in clean).toBe(false);
  });

  it("rejects widgets for tabs that don't accept them", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createCustomViewsService(db);
    await expect(
      svc.create(user.id, null, { tab: "settings", name: "x", widget: { kind: "stat", title: "T", valueCents: 1 } })
    ).rejects.toThrow(/dashboard|budgets|reports/);
  });

  it("enforces unique names per tab with a helpful error", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createCustomViewsService(db);
    const w = { kind: "stat", title: "T", valueCents: 1 };
    await svc.create(user.id, null, { tab: "dashboard", name: "dup", widget: w });
    await expect(svc.create(user.id, null, { tab: "dashboard", name: "dup", widget: w })).rejects.toThrow(/already exists/);
    // …but the same name on a DIFFERENT tab is fine.
    await expect(svc.create(user.id, null, { tab: "budgets", name: "dup", widget: w })).resolves.toBeTruthy();
  });
});

describe("agent guardrail prefs (D4)", () => {
  it("defaults: auto-approve off, write-confirm on, audit on", async () => {
    const { createAgentPrefsService } = await import("@/server/domain/agent-prefs");
    const db = createTestDb();
    const user = await seedUser(db);
    const prefs = await createAgentPrefsService(db).get(user.id);
    expect(prefs.autoApproveReads).toBe(false);
    expect(prefs.requireWriteConfirm).toBe(true);
    expect(prefs.auditEnabled).toBe(true);
  });

  it("persists guardrail changes and reads them back", async () => {
    const { createAgentPrefsService } = await import("@/server/domain/agent-prefs");
    const db = createTestDb();
    const user = await seedUser(db);
    const svc = createAgentPrefsService(db);
    await svc.update(user.id, { autoApproveReads: true, auditEnabled: false });
    const prefs = await svc.get(user.id);
    expect(prefs.autoApproveReads).toBe(true);
    expect(prefs.auditEnabled).toBe(false);
    expect(prefs.requireWriteConfirm).toBe(true); // untouched
  });
});
