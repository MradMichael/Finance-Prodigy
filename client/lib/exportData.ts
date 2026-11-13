import { activeTransactions, exportFileName, type LocalFinancials } from "./localData";
import { recordExport } from "./exportReminder";

/**
 * "Download my data": the account's data as a JSON file, as Profile has always written it. A soft-deleted
 * transaction still has its full payload -- it's filtered from every calculation, not stripped. Left unfiltered
 * here, every transaction ever deleted (with description, amount, everything) would leave the device the moment
 * this file does. D3: one function for Profile's button and the Overview's export reminder, and it records the
 * time on this device for the reminder.
 */
export function downloadDataFile(data: LocalFinancials, userId: string): void {
  const exportData = { ...data, transactions: activeTransactions(data.transactions) };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = exportFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  recordExport(userId);
}
