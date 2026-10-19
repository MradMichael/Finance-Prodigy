// Item 3b (owner, session 25): a restore never carries the backup choice over.
// Found in session 24's live check: restoreFromExport returned { ...file, … },
// so a backup file replaced this device's syncChoice. Profile's two restores
// (a file, and "Restore from database") now keep this device's choice exactly:
// its own when it has one, none when it has none (the prompt then asks).
import { it, expect } from "vitest";
import { restoreFromExport, withDeviceBackupChoice } from "./syncMerge";
import { DEFAULT_DATA, type LocalFinancials } from "./localData";

type Choice = NonNullable<LocalFinancials["syncChoice"]>;
const ON: Choice = { enabled: true, decidedAt: "2026-10-01T08:00:00.000Z" };
const OFF: Choice = { enabled: false, decidedAt: "2026-10-12T08:00:00.000Z" };
const device = (syncChoice?: Choice) => ({ ...DEFAULT_DATA, income: 3000, ...(syncChoice ? { syncChoice } : {}) }) as LocalFinancials;
const copy = (syncChoice?: Choice) => ({ ...DEFAULT_DATA, income: 3150.75, ...(syncChoice ? { syncChoice } : {}) }) as LocalFinancials;

it("a file with no choice, over a device that turned backup on: backup stays on", () => {
  expect(restoreFromExport(device(ON), copy()).syncChoice).toEqual(ON);
});

it("a file saved with backup on, over a device that turned it off: backup stays off", () => {
  expect(restoreFromExport(device(OFF), copy(ON)).syncChoice).toEqual(OFF);
});

it("a device with no choice and a file with one: still none, so the prompt asks", () => {
  expect("syncChoice" in restoreFromExport(device(), copy(ON))).toBe(false);
});

it("everything else still comes from the file", () => {
  expect(restoreFromExport(device(OFF), copy(ON)).income).toBe(3150.75);
});

it("the server's copy (Restore from database) the same way, and an unreadable device record counts as no choice", () => {
  expect(withDeviceBackupChoice(copy(ON), device(OFF)).syncChoice).toEqual(OFF);
  expect(withDeviceBackupChoice(copy(), device(ON)).syncChoice).toEqual(ON);
  expect("syncChoice" in withDeviceBackupChoice(copy(ON), device())).toBe(false);
  expect("syncChoice" in withDeviceBackupChoice(copy(ON), null)).toBe(false);
  expect(withDeviceBackupChoice(copy(ON), device(OFF)).income).toBe(3150.75);
});
