/**
 * D3 (owner, 2026-11-05; ROADMAP Phase 7): with backup off, this device holds the only copy of the data. After
 * EXPORT_REMINDER_DAYS without a download of it, the Overview reminds. Two times, kept in this browser per
 * account (never in the account's data, never synced; removed with the account): the last download, and a clock
 * that starts the first time the Overview sees backup off, so a new account isn't reminded on its first day.
 * "Not now" restarts the clock. Reminded from the later of the two.
 */
export const EXPORT_REMINDER_DAYS = 14;
const DAY_MS = 86_400_000;

export const lastExportKey = (userId: string) => `essa_last_export_${userId}`;
export const exportClockKey = (userId: string) => `essa_export_clock_${userId}`;

function read(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    return v && !Number.isNaN(Date.parse(v)) ? v : null;
  } catch { return null; }
}
function write(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* a reminder: nothing to do if this browser refuses it */ }
}

/** Whether the reminder is due: backup off, and 14 days since the later of the last download and the clock. */
export function exportReminderDue(o: { backupOff: boolean; lastExportAt: string | null; clockAt: string | null; now: Date }): boolean {
  if (!o.backupOff) return false;
  const since = [o.lastExportAt, o.clockAt].filter((t): t is string => t !== null).map((t) => Date.parse(t));
  if (since.length === 0) return false;
  return o.now.getTime() - Math.max(...since) >= EXPORT_REMINDER_DAYS * DAY_MS;
}

/** This device's answer for the account, starting the clock the first time backup is seen off. */
export function exportReminderState(userId: string, backupOff: boolean, now: Date = new Date()): boolean {
  if (!backupOff) return false;
  let clockAt = read(exportClockKey(userId));
  if (!clockAt) { clockAt = now.toISOString(); write(exportClockKey(userId), clockAt); }
  return exportReminderDue({ backupOff, lastExportAt: read(lastExportKey(userId)), clockAt, now });
}

export function recordExport(userId: string, now: Date = new Date()): void {
  write(lastExportKey(userId), now.toISOString());
}

/** "Not now": the clock starts again. */
export function snoozeExportReminder(userId: string, now: Date = new Date()): void {
  write(exportClockKey(userId), now.toISOString());
}
