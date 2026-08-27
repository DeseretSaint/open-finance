import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const src = readFileSync(join(root, "src/app/(app)/settings/page.tsx"), "utf8");

// Settings IA regroup (run 122): groups must be logically scoped and the
// Setup tour must live with Backup & updates, not inside Data & sync.
describe("settings information architecture", () => {
  it("renames the device/data group and scopes its description", () => {
    expect(src).toContain(
      '<SettingsGroup title="Data & sync" description="Pay schedule, device pairing, and phone-data import.">'
    );
    // the old vague "Connections" group is gone
    expect(src).not.toContain('<SettingsGroup title="Connections"');
  });

  it("keeps the backup group title casing consistent and mentions the tour", () => {
    expect(src).toContain(
      '<SettingsGroup title="Backup & updates" description="Backups, the setup tour, and app updates.">'
    );
    expect(src).not.toContain('<SettingsGroup title="Backup & Updates"');
  });

  it("moves SetupTourCard out of Data & sync into Backup & updates", () => {
    const dataSyncStart = src.indexOf('title="Data & sync"');
    const dataSyncEnd = src.indexOf("</SettingsGroup>", dataSyncStart);
    const backupStart = src.indexOf('title="Backup & updates"');
    const backupEnd = src.indexOf("</SettingsGroup>", backupStart);
    expect(dataSyncStart).toBeGreaterThan(-1);
    expect(backupStart).toBeGreaterThan(-1);

    const dataSyncBlock = src.slice(dataSyncStart, dataSyncEnd);
    const backupBlock = src.slice(backupStart, backupEnd);
    expect(dataSyncBlock).not.toContain("SetupTourCard");
    expect(backupBlock).toContain("{!solo && <SetupTourCard setErr={setErr} />}");
    // BackupPanel renders before the tour, tour before UpdatesCard
    expect(backupBlock.indexOf("<BackupPanel")).toBeLessThan(backupBlock.indexOf("SetupTourCard"));
    expect(backupBlock.indexOf("SetupTourCard")).toBeLessThan(backupBlock.indexOf("<UpdatesCard"));
  });
});
