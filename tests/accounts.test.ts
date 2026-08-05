import { describe, expect, it } from "vitest";
import { createAccountsService } from "@/server/domain/accounts";
import { createTestDb, seedManualAccount, seedUser } from "./helpers";

describe("account reorder (v0.3.11)", () => {
  it("persists sort_order and lists in that order", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const a = await seedManualAccount(db, user.id, "Checking", "depository");
    const b = await seedManualAccount(db, user.id, "Savings", "depository");
    const c = await seedManualAccount(db, user.id, "Credit", "credit");

    const svc = createAccountsService(db);
    await svc.reorder(user.id, [c, a, b]);

    const rows = await svc.list(user.id);
    expect(rows.map((r) => r.name)).toEqual(["Credit", "Checking", "Savings"]);
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1, 2]);
  });

  it("ignores ids that are not the user's and dedupes", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const other = await seedUser(db, "other-user");
    const a = await seedManualAccount(db, user.id, "Checking", "depository");
    const b = await seedManualAccount(db, user.id, "Savings", "depository");
    const otherAcct = await seedManualAccount(db, other.id, "Not Mine", "depository");

    const svc = createAccountsService(db);
    await svc.reorder(user.id, [b, a, otherAcct, a]);
    const rows = await svc.list(user.id);
    expect(rows.map((r) => r.name)).toEqual(["Savings", "Checking"]);
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1]);
  });
});

describe("account description (v0.3.11)", () => {
  it("sets, trims, and clears a note", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const id = await seedManualAccount(db, user.id, "Checking", "depository");
    const svc = createAccountsService(db);

    const withNote = await svc.setDescription(user.id, id, "  Main checking for bills  ");
    expect(withNote.description).toBe("Main checking for bills");

    const cleared = await svc.setDescription(user.id, id, null);
    expect(cleared.description).toBeNull();
  });
});

describe("account soft delete + restore (v0.3.11)", () => {
  it("removed accounts disappear from list but can be restored", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const id = await seedManualAccount(db, user.id, "Checking", "depository");

    const svc = createAccountsService(db);
    expect((await svc.list(user.id)).length).toBe(1);

    await svc.remove(user.id, id);
    expect(await svc.list(user.id)).toEqual([]);
    const deleted = await svc.listDeleted(user.id);
    expect(deleted.length).toBe(1);
    expect(deleted[0].name).toBe("Checking");

    const restored = await svc.restore(user.id, id);
    expect(restored.name).toBe("Checking");
    expect((await svc.list(user.id)).length).toBe(1);
    expect(await svc.listDeleted(user.id)).toEqual([]);
  });

  it("cannot remove an already-removed account twice", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const id = await seedManualAccount(db, user.id, "Checking", "depository");
    const svc = createAccountsService(db);
    await svc.remove(user.id, id);
    await expect(svc.remove(user.id, id)).rejects.toThrow();
  });

  it("Plaid accounts are soft-deleted (hidden) so sync does not recreate them", async () => {
    const db = createTestDb();
    const user = await seedUser(db);
    const id = await seedManualAccount(db, user.id, "Plaid Checking", "depository");
    // Simulate a Plaid-owned account row.
    await db.run("UPDATE accounts SET item_id = 'item-1', plaid_account_id = 'acct-1' WHERE id = ?", id);

    const svc = createAccountsService(db);
    await svc.remove(user.id, id);
    const row = await db.get<{ hidden: number; deleted_at: string | null }>(
      "SELECT hidden, deleted_at FROM accounts WHERE id = ?",
      id
    );
    expect(row?.hidden).toBe(1);
    expect(row?.deleted_at).not.toBeNull();

    await svc.restore(user.id, id);
    const restored = await db.get<{ hidden: number; deleted_at: string | null }>(
      "SELECT hidden, deleted_at FROM accounts WHERE id = ?",
      id
    );
    expect(restored?.hidden).toBe(0);
    expect(restored?.deleted_at).toBeNull();
  });
});
