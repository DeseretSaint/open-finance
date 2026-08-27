import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { syncShouldAdopt } from "../src/server/db/browser-sqlite";

const SRC = readFileSync(
  resolve(__dirname, "../src/server/db/browser-sqlite.ts"),
  "utf8"
);

describe("syncShouldAdopt (cross-tab IndexedDB clobber guard)", () => {
  it("adopts a newer message from a different tab with no pending write", () => {
    expect(
      syncShouldAdopt({ tabId: "other", seq: 5 }, "me", 3, false)
    ).toBe(true);
  });

  it("ignores its own echoes", () => {
    expect(
      syncShouldAdopt({ tabId: "me", seq: 9 }, "me", 3, false)
    ).toBe(false);
  });

  it("ignores stale/equal seq (no echo loops)", () => {
    expect(
      syncShouldAdopt({ tabId: "other", seq: 3 }, "me", 3, false)
    ).toBe(false);
    expect(
      syncShouldAdopt({ tabId: "other", seq: 2 }, "me", 3, false)
    ).toBe(false);
  });

  it("does NOT adopt while this tab has a pending local write", () => {
    // Our in-memory copy is ahead of IDB; adopting would discard our pending write.
    expect(
      syncShouldAdopt({ tabId: "other", seq: 99 }, "me", 3, true)
    ).toBe(false);
  });

  it("ignores null / malformed messages", () => {
    expect(syncShouldAdopt(null, "me", 3, false)).toBe(false);
    // seq missing -> treated as not newer
    expect(syncShouldAdopt({ tabId: "other" } as never, "me", 3, false)).toBe(
      false
    );
  });
});

describe("browser-sqlite cross-tab sync wiring (source guard)", () => {
  it("opens a BroadcastChannel on the dedicated sync channel", () => {
    expect(SRC).toMatch(/BroadcastChannel\(\s*SYNC_CHANNEL\s*\)/);
    expect(SRC).toMatch(/const SYNC_CHANNEL = "open-finance-solo-db"/);
  });

  it("announces each flush over the channel with a growing seq + tab id", () => {
    expect(SRC).toMatch(/getChannel\(\)\?\.postMessage\(\{ tabId: TAB_ID, seq: syncSeq \}\)/);
    expect(SRC).toMatch(/syncSeq \+= 1/);
  });

  it("adopts remote saves only through the guard (no clobber while pending)", () => {
    expect(SRC).toMatch(/onRemoteUpdate/);
    expect(SRC).toMatch(/syncShouldAdopt\(msg, TAB_ID, syncSeq, this\.saveTimer !== null\)/);
    // Reloads from IDB on accept, discarding the stale in-memory copy.
    expect(SRC).toMatch(/this\.db = new this\.SQL\.Database\(bytes\)/);
  });
});
