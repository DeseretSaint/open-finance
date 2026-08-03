import { describe, expect, it, vi } from "vitest";
import { createNativePlaidClient } from "@/server/plaid/native";
import type { PlaidCreds } from "@/server/plaid/adapter";

const creds: PlaidCreds = { clientId: "cid", secret: "sec", environment: "sandbox" };

function installProxy(impl: Partial<Record<string, (...a: unknown[]) => Promise<unknown>>>) {
  (globalThis as unknown as { PlaidProxy?: unknown }).PlaidProxy = impl;
}

describe("native plaid client (P8b solo)", () => {
  it("throws when the PlaidProxy plugin is absent (web build)", () => {
    (globalThis as unknown as { PlaidProxy?: unknown }).PlaidProxy = undefined;
    expect(() => createNativePlaidClient()).toThrow(/plugin unavailable/i);
  });

  it("testCredentials maps valid/invalid", async () => {
    installProxy({
      testCredentials: vi.fn().mockResolvedValue({ valid: true }),
    });
    expect(await createNativePlaidClient().testCredentials(creds)).toEqual({ ok: true });

    installProxy({
      testCredentials: vi.fn().mockResolvedValue({ valid: false, error: "INVALID_CREDENTIALS" }),
    });
    expect(await createNativePlaidClient().testCredentials(creds)).toEqual({
      ok: false,
      message: "INVALID_CREDENTIALS",
    });
  });

  it("createLinkToken passes client_user_id through", async () => {
    const fn = vi.fn().mockResolvedValue({ linkToken: "link-sandbox-token" });
    installProxy({ createLinkToken: fn });
    const token = await createNativePlaidClient().createLinkToken(creds, "user-42");
    expect(token).toBe("link-sandbox-token");
    expect(fn).toHaveBeenCalledWith({
      clientId: "cid",
      secret: "sec",
      environment: "sandbox",
      config: { client_user_id: "user-42" },
    });
  });

  it("exchangePublicToken returns accessToken + itemId", async () => {
    installProxy({
      exchangePublicToken: vi.fn().mockResolvedValue({ accessToken: "access-1", itemId: "item-1" }),
    });
    const r = await createNativePlaidClient().exchangePublicToken(creds, "public-1");
    expect(r).toEqual({ accessToken: "access-1", itemId: "item-1" });
  });

  it("getAccounts returns accounts array", async () => {
    installProxy({
      getAccounts: vi.fn().mockResolvedValue({ accounts: [{ id: "a1" }, { id: "a2" }] }),
    });
    const r = await createNativePlaidClient().getAccounts(creds, "access-1");
    expect(r).toHaveLength(2);
  });

  it("syncTransactions maps added/modified/removed/cursor", async () => {
    installProxy({
      syncTransactions: vi.fn().mockResolvedValue({
        added: [{ id: "t1" }],
        modified: [],
        removed: [{ transactionId: "t0" }],
        nextCursor: "cursor-2",
      }),
    });
    const r = await createNativePlaidClient().syncTransactions(creds, "access-1", "cursor-1");
    expect(r.added).toHaveLength(1);
    expect(r.removed).toEqual([{ transactionId: "t0" }]);
    expect(r.nextCursor).toBe("cursor-2");
    expect(r.hasMore).toBe(false);
  });

  it("removeItem resolves", async () => {
    const fn = vi.fn().mockResolvedValue({ removed: true });
    installProxy({ removeItem: fn });
    await createNativePlaidClient().removeItem(creds, "access-1");
    expect(fn).toHaveBeenCalled();
  });
});
