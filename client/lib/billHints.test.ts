// Session 62 (owner; FIX_PLANS session 61, item 3, and session 62's changes): "Bills you log by hand". The rule
// that tells a bill logged by hand every month from ordinary repeat spending, the item "Add as recurring" makes,
// and setting a hint aside.
// The rule: live Needs and Wants rows, dated today or earlier, not tied to anything already tracked (recurringId,
// extraForRecurringId, debtId, goalId, foreign cash), in the window (the start of the period four back, to today),
// grouped by description (trimmed, lower case, spaces collapsed) and currency. A bill: at least 3 rows; every gap
// between consecutive rows 20 to 40 days; the latest at most 62 days old; every amount within 50% of the median, in
// its own currency (owner, session 62: 50%, not 25%, so metered bills are caught); no recurring item with that
// name; not set aside. At most five, the most recent first.
import { describe, it, expect, vi } from "vitest";
import { billHints, billHintKey, addBillAsRecurring, setBillAside, undoBillAside, BILL_BAND, BILL_MAX_HINTS } from "./billHints";
import { DEFAULT_DATA, committedMonthlyUSD, type LocalFinancials, type StoredTransaction, type StoredRecurring } from "./localData";
import { computeDashboard } from "./computeDashboard";
import { usualMonth } from "./usualMonth";

let n = 0;
const tx = (o: Partial<StoredTransaction>): StoredTransaction =>
  ({ id: `t${n++}`, amount: 35, currency: "USD", bucket: "NEEDS", description: "Internet (IDM)", date: "2026-10-01", paymentMethod: "cash", createdAt: "2026-10-01T09:00:00.000Z", ...o }) as StoredTransaction;
const TODAY = "2026-11-24";
const data = (rows: StoredTransaction[], extra: Partial<LocalFinancials> = {}) =>
  ({ ...DEFAULT_DATA, income: 3000, lbpRate: 89_500, transactions: rows, recurring: [], ...extra }) as LocalFinancials;
const monthly = (dates: string[], o: Partial<StoredTransaction> = {}) => dates.map((date) => tx({ date, ...o }));
const INTERNET = ["2026-08-02", "2026-09-02", "2026-10-01", "2026-11-02"]; // gaps 31, 29, 32
const keys = (d: LocalFinancials, today = TODAY) => billHints(d, today).map((h) => h.key);
/** The dashboard reads the clock itself: its renewals as of 24 Nov 2026, midday. */
const renewalsOn = (d: LocalFinancials) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-24T12:00:00"));
  try { return computeDashboard(d).upcomingRenewals; } finally { vi.useRealTimers(); }
};

describe("what counts as a bill you log by hand", () => {
  it("a monthly bill (gaps 31, 29, 32) is a hint: the latest payment's name, amount and day", () => {
    const rows = monthly(INTERNET, { category: "utilities" });
    rows[3] = { ...rows[3], description: "Internet (IDM) ", amount: 38 };
    expect(billHints(data(rows), TODAY)).toEqual([{
      key: "internet (idm)|USD", name: "Internet (IDM)", amount: 38, currency: "USD", bucket: "NEEDS", category: "utilities", lastDate: "2026-11-02", count: 4,
    }]);
  });
  it("groceries five times a month are not (the gaps are days, not a month)", () => {
    const rows = ["07", "08", "09", "10", "11"].flatMap((m) => ["03", "09", "15", "20", "22"].map((d) => tx({ description: "Spinneys", amount: 40, date: `2026-${m}-${d}` })));
    expect(keys(data(rows.filter((t) => t.date <= TODAY)))).toEqual([]);
  });
  it("coffee and lunch at the same place several times a month are not", () => {
    const rows = ["08", "09", "10", "11"].flatMap((m) => ["05", "12", "19"].map((d) => tx({ description: "Charcoal", bucket: "WANTS", amount: 6, date: `2026-${m}-${d}` })));
    expect(keys(data(rows))).toEqual([]);
  });
  it("a metered generator bill, L£1.6M to L£2.9M, is a hint at 50% (it isn't at 25%)", () => {
    const amounts = [2_000_000, 2_900_000, 1_600_000, 2_200_000];
    const rows = INTERNET.map((date, i) => tx({ description: "Generator", currency: "LBP", amount: amounts[i], date }));
    expect(BILL_BAND).toBe(0.5);
    expect(keys(data(rows))).toEqual(["generator|LBP"]);
  });
  it("amounts beyond 50% of the median are not (300k, 450k, 1,000k)", () => {
    const amounts = [300_000, 450_000, 1_000_000];
    const rows = INTERNET.slice(1).map((date, i) => tx({ description: "Haircut", currency: "LBP", amount: amounts[i], date }));
    expect(keys(data(rows))).toEqual([]);
  });
  it("a missed month (gaps 31 and 61) is not", () => {
    expect(keys(data(monthly(["2026-08-02", "2026-09-02", "2026-11-02"])))).toEqual([]);
  });
  it("62 days since the latest is still a hint; 63 is not (it has stopped)", () => {
    expect(keys(data(monthly(["2026-07-23", "2026-08-23", "2026-09-23"])))).toEqual(["internet (idm)|USD"]);
    expect(keys(data(monthly(["2026-07-22", "2026-08-22", "2026-09-22"])))).toEqual([]);
  });
  it("two payments are not enough; three are", () => {
    expect(keys(data(monthly(INTERNET.slice(2))))).toEqual([]);
    expect(keys(data(monthly(INTERNET.slice(1))))).toEqual(["internet (idm)|USD"]);
  });
  it("a name that is already a recurring item is not (ignoring case and spaces)", () => {
    const rec = { id: "r1", name: "  internet (idm)", emoji: "🔁", amount: 35, currency: "USD", frequency: "monthly", bucket: "NEEDS", startDate: "2026-01-01", endDate: null, totalAmount: null, createdAt: "2026-01-01T00:00:00.000Z" } as StoredRecurring;
    expect(keys(data(monthly(INTERNET), { recurring: [rec] }))).toEqual([]);
  });
  it("a hint set aside is not", () => {
    expect(keys(data(monthly(INTERNET), { billHintsSetAside: ["internet (idm)|USD"] }))).toEqual([]);
  });
  it("rows tied to a recurring item, an extra payment, a debt, a goal or foreign cash don't count", () => {
    for (const o of [{ recurringId: "r" }, { extraForRecurringId: "r" }, { debtId: "d" }, { goalId: "g" }, { fx: { code: "EUR", amount: 30, kind: "out" } }] as Partial<StoredTransaction>[]) {
      expect(keys(data(monthly(INTERNET, o)))).toEqual([]);
    }
  });
  it("deleted rows, Savings, income, transfers and rows dated after today don't count", () => {
    const rows = monthly(INTERNET);
    expect(keys(data([...rows.slice(0, 3), { ...rows[3], deletedAt: "2026-11-03T00:00:00.000Z" }].slice(1)))).toEqual([]);
    for (const bucket of ["SAVINGS", "INCOME", "TRANSFER"] as const) expect(keys(data(monthly(INTERNET, { bucket })))).toEqual([]);
    expect(keys(data(monthly(["2026-10-01", "2026-11-01", "2026-12-01"])))).toEqual([]);
  });
  it("a lira bill steady in lira is a hint whatever the rate did", () => {
    const rows = INTERNET.map((date, i) => tx({ description: "EDL electricity", currency: "LBP", amount: 2_200_000, lbpRateAtEntry: [89_500, 95_000, 100_000, 89_500][i], date }));
    expect(keys(data(rows))).toEqual(["edl electricity|LBP"]);
  });
  it("the same description in two currencies is two groups", () => {
    const rows = [...monthly(INTERNET), ...monthly(INTERNET, { currency: "LBP", amount: 3_000_000 })];
    expect(keys(data(rows)).sort()).toEqual(["internet (idm)|LBP", "internet (idm)|USD"]);
  });
  it("the window follows the account's cycle: at a start day of 25 it opens on 25 June, at day 1 on 1 July", () => {
    const rows = monthly(["2026-06-26", "2026-07-26", "2026-08-26", "2026-09-26", "2026-10-26"]);
    expect(billHints(data(rows, { cycleStartDay: 25 }), TODAY)[0].count).toBe(5);
    expect(billHints(data(rows), TODAY)[0].count).toBe(4);
  });
  it(`at most ${BILL_MAX_HINTS}, the most recent first`, () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const rows = names.flatMap((name, i) => monthly([`2026-08-0${i + 1}`, `2026-09-0${i + 1}`, `2026-10-0${i + 1}`], { description: name }));
    expect(billHints(data(rows), TODAY).map((h) => h.name)).toEqual(["F", "E", "D", "C", "B"]);
  });
  it("a key ignores case and runs of spaces", () => {
    expect(billHintKey("  Alfa   Recharge ", "USD")).toBe("alfa recharge|USD");
  });
});

describe("Add as recurring", () => {
  it("makes one monthly item from the latest payment, starting one month after it; the rows are untouched", () => {
    const d = data(monthly(INTERNET, { category: "utilities", amount: 35 }));
    const [hint] = billHints(d, TODAY);
    const { data: next, item } = addBillAsRecurring(d, hint, TODAY);
    expect(item).toMatchObject({ name: "Internet (IDM)", amount: 35, currency: "USD", bucket: "NEEDS", category: "utilities", frequency: "monthly", emoji: "🔁", startDate: "2026-12-02", endDate: null, totalAmount: null });
    expect(typeof item.updatedAt).toBe("string");
    expect(next.recurring).toEqual([item]);
    expect(next.transactions).toEqual(d.transactions);
    expect(billHints(next, TODAY)).toEqual([]);
  });
  it("the latest payment on 5 Nov: starts 5 Dec, nothing asked now", () => {
    const d = data(monthly(["2026-08-05", "2026-09-05", "2026-10-05", "2026-11-05"]));
    const { data: next } = addBillAsRecurring(d, billHints(d, TODAY)[0], TODAY);
    expect(next.recurring[0].startDate).toBe("2026-12-05");
    expect(renewalsOn(next)).toEqual([]);
  });
  it("no payment yet this month (the latest 5 Oct): starts 5 Nov, asked at once, as it isn't logged", () => {
    const d = data(monthly(["2026-07-05", "2026-08-05", "2026-09-05", "2026-10-05"]));
    const { data: next } = addBillAsRecurring(d, billHints(d, TODAY)[0], TODAY);
    expect(next.recurring[0].startDate).toBe("2026-11-05");
    expect(renewalsOn(next)).toMatchObject([{ name: "Internet (IDM)", overdueCount: 1 }]);
  });
  it("past figures don't change; the commitments include it from its start", () => {
    const d = data(monthly(INTERNET, { category: "utilities", amount: 35 }));
    const { data: next } = addBillAsRecurring(d, billHints(d, TODAY)[0], TODAY);
    expect(usualMonth(next, new Date("2026-11-24T12:00:00"))).toEqual(usualMonth(d, new Date("2026-11-24T12:00:00")));
    expect(committedMonthlyUSD(next, new Date("2026-11-24T12:00:00"))).toBe(committedMonthlyUSD(d, new Date("2026-11-24T12:00:00")));
    expect(committedMonthlyUSD(next, new Date("2026-12-02T12:00:00")) - committedMonthlyUSD(d, new Date("2026-12-02T12:00:00"))).toBeCloseTo(35, 6);
  });
});

describe("Not a bill", () => {
  it("sets the hint aside; Undo brings it back", () => {
    const d = data(monthly(INTERNET));
    const key = billHints(d, TODAY)[0].key;
    const aside = setBillAside(d, key);
    expect(aside.billHintsSetAside).toEqual([key]);
    expect(billHints(aside, TODAY)).toEqual([]);
    expect(setBillAside(aside, key).billHintsSetAside).toEqual([key]); // once
    const back = undoBillAside(aside, key);
    expect(back.billHintsSetAside).toEqual([]);
    expect(keys(back)).toEqual([key]);
  });
});
