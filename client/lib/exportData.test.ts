// D3: "Download my data" now has two buttons, Profile's and the Overview's export reminder. Both go through one
// function, which writes the same file Profile always wrote (deleted transactions left out) and records the
// time on this device for the reminder.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { downloadDataFile } from "./exportData";
import { DEFAULT_DATA, exportFileName, type LocalFinancials, type StoredTransaction } from "./localData";

let blobs: Blob[];
let names: string[];
beforeEach(() => {
  localStorage.clear();
  blobs = []; names = [];
  Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => { blobs.push(b); return "blob:essa"; }), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T09:00:00.000Z"));
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const live = { id: "t1", amount: 5, currency: "USD", bucket: "WANTS", description: "Coffee", date: "2026-11-19" } as StoredTransaction;
const gone = { ...live, id: "t2", description: "Deleted one", deletedAt: "2026-11-19T10:00:00.000Z" } as StoredTransaction;

describe("downloadDataFile", () => {
  it("writes Profile's file: the data, without deleted transactions, under the export file name", async () => {
    downloadDataFile({ ...DEFAULT_DATA, income: 3000, transactions: [live, gone] } as LocalFinancials, "u1");
    expect(blobs).toHaveLength(1);
    const written = JSON.parse(await blobs[0].text());
    expect(written.income).toBe(3000);
    expect(written.transactions.map((t: StoredTransaction) => t.id)).toEqual(["t1"]);
    expect(names).toEqual([exportFileName(new Date())]);
  });

  it("records the time on this device, for this account only", () => {
    downloadDataFile({ ...DEFAULT_DATA } as LocalFinancials, "u1");
    expect(localStorage.getItem("essa_last_export_u1")).toBe("2026-11-20T09:00:00.000Z");
    expect(localStorage.getItem("essa_last_export_u2")).toBeNull();
  });
});
