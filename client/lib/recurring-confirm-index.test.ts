// R4 (session 51 review; owner, session 55: build the parts of "adding an entry" that change no stored data and no
// wording). Every change recomputes the dashboard, and in it each recurring bill's due-date walk asked, for every
// cycle since the bill started, whether a transaction confirms that cycle, scanning the whole list each time:
// entries × bills × cycles. The confirmed cycles are now read from an index built once per transaction list.
// The answer must be exactly what the scan gave, for every bill and every cycle: the scan is kept here as the
// reference. Lists are never changed in place (every write makes a new array), so an index lives as long as its
// list and a new list is indexed afresh.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isCycleConfirmed, dueCycles, migrateFinancials, type StoredRecurring, type StoredTransaction } from "./localData";
import { storedDay, asCalendarDay } from "./calendarDay";

/** The scan isCycleConfirmed did before (the reference). */
function scan(r: StoredRecurring, dueDate: Date, transactions: StoredTransaction[]): boolean {
  const dueISO = dueDate.toISOString().slice(0, 10);
  return transactions.some((t) => t.deletedAt == null && t.recurringId === r.id && t.cycleDate !== null && (t.cycleDate ?? t.date) === dueISO);
}

const rec = (o: Partial<StoredRecurring> = {}): StoredRecurring => ({ id: "r1", name: "Rent", emoji: "🏠", amount: 500, currency: "USD", frequency: "monthly", bucket: "NEEDS", startDate: "2026-01-05", endDate: null, totalAmount: null, createdAt: "2026-01-01T00:00:00.000Z", ...o }) as StoredRecurring;
const tx = (o: Partial<StoredTransaction>): StoredTransaction => ({ id: Math.random().toString(36).slice(2), amount: 500, currency: "USD", bucket: "NEEDS", description: "Rent", date: "2026-02-05", createdAt: "2026-02-05T09:00:00.000Z", ...o }) as StoredTransaction;
const due = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("isCycleConfirmed reads an index, with the scan's answers", () => {
  it("a confirm row by its cycle date; the paid date when there is no cycle date; never a detached row", () => {
    const list = [
      tx({ recurringId: "r1", date: "2026-03-07", cycleDate: "2026-03-05" }), // paid two days late, settles 5 March
      tx({ recurringId: "r1", date: "2026-02-05" }), // before cycleDate existed: its date is the due date
      tx({ recurringId: "r1", date: "2026-04-05", cycleDate: null }), // deliberately detached
    ];
    const r = rec();
    expect(isCycleConfirmed(r, due("2026-03-05"), list)).toBe(true);
    expect(isCycleConfirmed(r, due("2026-03-07"), list)).toBe(false);
    expect(isCycleConfirmed(r, due("2026-02-05"), list)).toBe(true);
    expect(isCycleConfirmed(r, due("2026-04-05"), list)).toBe(false);
  });

  it("a deleted row doesn't confirm; another bill's row doesn't confirm this one", () => {
    const list = [tx({ recurringId: "r1", date: "2026-02-05", deletedAt: "2026-02-06T00:00:00.000Z" }), tx({ recurringId: "r2", date: "2026-03-05" })];
    expect(isCycleConfirmed(rec(), due("2026-02-05"), list)).toBe(false);
    expect(isCycleConfirmed(rec(), due("2026-03-05"), list)).toBe(false);
    expect(isCycleConfirmed(rec({ id: "r2" }), due("2026-03-05"), list)).toBe(true);
  });

  it("a new list (every write makes one) is indexed afresh: a row added or deleted is seen at once", () => {
    const first = [tx({ recurringId: "r1", date: "2026-02-05" })];
    expect(isCycleConfirmed(rec(), due("2026-03-05"), first)).toBe(false);
    const added = [...first, tx({ id: "m", recurringId: "r1", date: "2026-03-05" })];
    expect(isCycleConfirmed(rec(), due("2026-03-05"), added)).toBe(true);
    const deleted = added.map((t) => (t.id === "m" ? { ...t, deletedAt: "2026-03-06T00:00:00.000Z" } : t));
    expect(isCycleConfirmed(rec(), due("2026-03-05"), deleted)).toBe(false);
    expect(isCycleConfirmed(rec(), due("2026-03-05"), first)).toBe(false); // the old list still answers for itself
  });

  it("on both seeded accounts, every bill and every cycle from its start to a year ahead: the same answer as the scan", () => {
    const dir = process.env.SEEDS_DIR;
    const files = ["seed-1500.json", "seed-15000.json"].map((f) => dir ? path.join(dir, f) : "").filter((p) => p && fs.existsSync(p));
    // The seeds live outside the repository; without them, a built account of the same shape stands in.
    const accounts = files.length ? files.map((p) => migrateFinancials(JSON.parse(fs.readFileSync(p, "utf8")))) : [built()];
    let checked = 0, confirmed = 0;
    for (const d of accounts) {
      for (const r of d.recurring ?? []) {
        for (const c of dueCycles({ ...r, totalAmount: null }, storedDay(r.confirmCutoverDate ?? r.startDate), asCalendarDay("2027-11-30"))) {
          const want = scan(r, c, d.transactions);
          expect(isCycleConfirmed(r, c, d.transactions), `${r.name} ${c.toISOString()}`).toBe(want);
          checked++; if (want) confirmed++;
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
    expect(confirmed).toBeGreaterThan(5); // the premise: real confirmations were among them
  });
});

describe("the list is read once, not once per cycle", () => {
  it("checking 200 cycles of 3 bills against a 1,000-row list reads each row once", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => tx({ id: `t${i}`, recurringId: i % 10 === 0 ? "r1" : undefined, date: `2026-${String(1 + (i % 12)).padStart(2, "0")}-05` }));
    let reads = 0;
    const counted = new Proxy(rows, { get(target, key, recv) { if (typeof key === "string" && /^\d+$/.test(key)) reads++; return Reflect.get(target, key, recv); } });
    for (const id of ["r1", "r2", "r3"]) for (let k = 0; k < 200; k++) isCycleConfirmed(rec({ id }), due(`2026-${String(1 + (k % 12)).padStart(2, "0")}-05`), counted);
    expect(reads).toBeLessThanOrEqual(rows.length);
  });
});

/** A small account with weekly and monthly bills, confirmations on time, late, detached and deleted. */
function built() {
  const bills = [rec({ id: "w", name: "Gym", frequency: "weekly", startDate: "2026-01-03" }), rec({ id: "m", name: "Rent" })];
  const transactions: StoredTransaction[] = [];
  for (const r of bills) {
    let i = 0;
    for (const c of dueCycles(r, storedDay(r.startDate), asCalendarDay("2026-10-31"))) {
      const iso = c.toISOString().slice(0, 10);
      i++;
      if (i % 5 === 0) continue; // missed
      transactions.push(tx({ recurringId: r.id, date: iso, ...(i % 3 === 0 ? { cycleDate: iso, date: "2026-11-01" } : {}), ...(i % 7 === 0 ? { cycleDate: null } : {}), ...(i % 11 === 0 ? { deletedAt: "2026-11-01T00:00:00.000Z" } : {}) }));
    }
  }
  return { recurring: bills, transactions };
}
