// D3 (owner, 2026-11-05; ROADMAP Phase 7): with backup off, this device holds the only copy of the data. After
// 14 days without a download of it, the Overview reminds. The time is kept on this device, per account: the last
// download, and the clock that starts the first time the Overview sees backup off (so a new account isn't
// reminded on its first day). "Not now" restarts the clock.
import { describe, it, expect, beforeEach } from "vitest";
import { exportReminderDue, exportReminderState, recordExport, snoozeExportReminder, EXPORT_REMINDER_DAYS } from "./exportReminder";

const DAY = 86_400_000;
const T0 = new Date("2026-11-01T09:00:00.000Z");
const at = (days: number) => new Date(T0.getTime() + days * DAY);

beforeEach(() => localStorage.clear());

describe("exportReminderDue", () => {
  it("is due 14 days after the later of the last download and the clock, not at 13", () => {
    expect(EXPORT_REMINDER_DAYS).toBe(14);
    const base = { backupOff: true, lastExportAt: null, clockAt: T0.toISOString() };
    expect(exportReminderDue({ ...base, now: at(13.99) })).toBe(false);
    expect(exportReminderDue({ ...base, now: at(14) })).toBe(true);
    expect(exportReminderDue({ ...base, lastExportAt: at(5).toISOString(), now: at(14) })).toBe(false);
    expect(exportReminderDue({ ...base, lastExportAt: at(5).toISOString(), now: at(19) })).toBe(true);
  });

  it("is never due with backup on or undecided, or with no time to count from", () => {
    expect(exportReminderDue({ backupOff: false, lastExportAt: null, clockAt: T0.toISOString(), now: at(100) })).toBe(false);
    expect(exportReminderDue({ backupOff: true, lastExportAt: null, clockAt: null, now: at(100) })).toBe(false);
  });
});

describe("this device's record, per account", () => {
  it("the first look starts the clock; 14 days later it's due", () => {
    expect(exportReminderState("u1", true, T0)).toBe(false);
    expect(exportReminderState("u1", true, at(13))).toBe(false);
    expect(exportReminderState("u1", true, at(14))).toBe(true);
  });

  it("a download resets it", () => {
    exportReminderState("u1", true, T0);
    recordExport("u1", at(10));
    expect(exportReminderState("u1", true, at(20))).toBe(false);
    expect(exportReminderState("u1", true, at(24))).toBe(true);
  });

  it("'Not now' restarts the clock", () => {
    exportReminderState("u1", true, T0);
    expect(exportReminderState("u1", true, at(15))).toBe(true);
    snoozeExportReminder("u1", at(15));
    expect(exportReminderState("u1", true, at(28))).toBe(false);
    expect(exportReminderState("u1", true, at(29))).toBe(true);
  });

  it("with backup on, nothing is started or shown", () => {
    expect(exportReminderState("u1", false, T0)).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it("each account on the device has its own clock", () => {
    exportReminderState("u1", true, T0);
    exportReminderState("u2", true, at(10));
    expect(exportReminderState("u1", true, at(14))).toBe(true);
    expect(exportReminderState("u2", true, at(14))).toBe(false);
  });

  it("an unreadable stored time is treated as none", () => {
    localStorage.setItem("essa_export_clock_u1", "not a date");
    expect(exportReminderState("u1", true, at(30))).toBe(false); // the clock restarts now
    expect(exportReminderState("u1", true, at(44))).toBe(true);
  });
});
