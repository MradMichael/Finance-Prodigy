// TODO 127 (owner, session 65, item 2): the hand-logged entry rule builds each row's name key once per call and checks
// the amount and the date before the name. Its answer must not change, for any bill. The reference below is the rule
// exactly as session 63 wrote it (lib/alreadyLogged.ts at c5e43e1), kept here so the faster form is checked against it:
// the same row, or none, for every bill, over rows generated around every edge the rule has.
import { describe, it, expect } from "vitest";
import { HALF_CYCLE_DAYS, loggedEntries, loggedEntryFor } from "./alreadyLogged";
import { BILL_BAND, billHintKey } from "./billHints";
import { DEFAULT_DATA, type Bucket, type Currency, type LocalFinancials, type RecurringFrequency, type StoredRecurring, type StoredTransaction } from "./localData";

// ---- The reference: session 63's rule, verbatim but for its constants, which are copied too ----
const REF_HALF: Record<RecurringFrequency, number> = { weekly: 3, biweekly: 7, monthly: 15, every2months: 30, quarterly: 45, biannually: 91, yearly: 182 };
const REF_BAND = 0.5;
const refDay = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;
const refTied = (t: StoredTransaction) => t.recurringId == null && t.cycleDate === undefined && t.extraForRecurringId == null
  && t.debtId == null && t.goalId == null && t.fx == null && t.linkedPaymentId == null;
function refEarlier(a: StoredTransaction, b: StoredTransaction): boolean {
  if (a.date !== b.date) return a.date < b.date;
  const ac = a.createdAt ?? "", bc = b.createdAt ?? "";
  if (ac !== bc) return ac < bc;
  return a.id < b.id;
}
function reference(r: StoredRecurring, dueISO: string, transactions: readonly StoredTransaction[]): StoredTransaction | null {
  if (!(r.amount > 0)) return null;
  const key = billHintKey(r.name, r.currency);
  const due = refDay(dueISO);
  const half = REF_HALF[r.frequency];
  let best: StoredTransaction | null = null, bestGap = Infinity;
  for (const t of transactions) {
    if (t.deletedAt != null || t.purgedAt != null || !refTied(t)) continue;
    if (t.bucket !== "NEEDS" && t.bucket !== "WANTS" && t.bucket !== "SAVINGS") continue;
    if (billHintKey(t.description, t.currency) !== key) continue;
    if (!(t.amount > 0) || Math.abs(t.amount - r.amount) > REF_BAND * r.amount) continue;
    const gap = Math.abs(refDay(t.date) - due);
    if (!(gap <= half)) continue;
    if (best === null || gap < bestGap || (gap === bestGap && refEarlier(t, best))) { best = t; bestGap = gap; }
  }
  return best;
}

// ---- Generated rows around every edge ----
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const addDays = (iso: string, d: number) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + d)).toISOString().slice(0, 10);

const bill = (id: string, name: string, amount: number, currency: Currency, frequency: RecurringFrequency): StoredRecurring =>
  ({ id, name, emoji: "•", amount, currency, frequency, bucket: "NEEDS", startDate: "2026-01-01", endDate: null, totalAmount: null, createdAt: "2026-01-01T00:00:00.000Z" }) as StoredRecurring;
// Every frequency; one name in both currencies; names that differ only in case and spacing from a row's words.
const BILLS: { r: StoredRecurring; due: string }[] = [
  { r: bill("b-netflix", "Netflix", 15, "USD", "monthly"), due: "2026-11-24" },
  { r: bill("b-netflix-lbp", "Netflix", 1_342_500, "LBP", "monthly"), due: "2026-11-24" },
  { r: bill("b-gym", "Gym", 40, "USD", "weekly"), due: "2026-11-27" },
  { r: bill("b-idm", "Internet (IDM)", 35, "USD", "biweekly"), due: "2026-11-30" },
  { r: bill("b-edl", "EDL electricity", 3_000_000, "LBP", "every2months"), due: "2026-12-05" },
  { r: bill("b-water", "Water", 60, "USD", "quarterly"), due: "2026-12-15" },
  { r: bill("b-car", "Car insurance", 450, "USD", "biannually"), due: "2027-01-10" },
  { r: bill("b-domain", "Domain   name", 20, "USD", "yearly"), due: "2027-03-01" },
];
const BUCKETS: Bucket[] = ["NEEDS", "WANTS", "SAVINGS", "INCOME", "TRANSFER"] as Bucket[];
const TIES: Partial<StoredTransaction>[] = [
  {}, {}, {}, {}, {}, {}, { recurringId: "x" }, { cycleDate: null }, { cycleDate: "2026-11-24" }, { extraForRecurringId: "x" },
  { debtId: "d" }, { goalId: "g" }, { fx: { pairId: "p" } } as Partial<StoredTransaction>, { linkedPaymentId: "l" },
];

function generate(seed: number): StoredTransaction[] {
  const rand = rng(seed);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(rand() * a.length)];
  const rows: StoredTransaction[] = [];
  let n = 0;
  for (const { r, due } of BILLS) {
    const half = REF_HALF[r.frequency];
    const names = [r.name, r.name.toUpperCase(), `  ${r.name.toLowerCase()}  `, r.name.replace(/ /g, "  "), `${r.name} extra`, pick(BILLS).r.name, ""];
    const amounts = [r.amount, r.amount * 0.5, r.amount * 1.5, r.amount * 0.5 - 0.01, r.amount * 1.5 + 0.01, r.amount * (0.6 + rand() * 0.8), 0, -r.amount];
    const offsets = [0, half, -half, half + 1, -(half + 1), Math.round((rand() - 0.5) * 2 * half), 1, -1];
    for (let i = 0; i < 60; i++) {
      const date = addDays(due, pick(offsets));
      rows.push({
        id: `t${String(n++).padStart(4, "0")}`,
        description: pick(names),
        currency: rand() < 0.8 ? r.currency : (r.currency === "USD" ? "LBP" : "USD"),
        amount: pick(amounts),
        bucket: rand() < 0.85 ? pick(BUCKETS.slice(0, 3)) : pick(BUCKETS),
        date,
        paymentMethod: "card",
        createdAt: rand() < 0.3 ? undefined : `${date}T0${Math.floor(rand() * 9)}:00:00.000Z`,
        ...(rand() < 0.1 ? { deletedAt: "2026-11-01T00:00:00.000Z" } : {}),
        ...(rand() < 0.05 ? { purgedAt: "2026-11-01T00:00:00.000Z" } : {}),
        ...pick(TIES),
      } as StoredTransaction);
    }
  }
  // Ties at the same distance: the same date (createdAt decides), and the same date and createdAt (the id decides).
  rows.push({ id: "tie-b", description: "Netflix", currency: "USD", amount: 15, bucket: "WANTS", date: "2026-11-20", paymentMethod: "card", createdAt: "2026-11-20T09:00:00.000Z" } as StoredTransaction);
  rows.push({ id: "tie-a", description: "netflix", currency: "USD", amount: 16, bucket: "WANTS", date: "2026-11-20", paymentMethod: "card", createdAt: "2026-11-20T09:00:00.000Z" } as StoredTransaction);
  rows.push({ id: "tie-c", description: "NETFLIX", currency: "USD", amount: 14, bucket: "WANTS", date: "2026-11-28", paymentMethod: "card", createdAt: "2026-11-20T08:00:00.000Z" } as StoredTransaction);
  // One description in both currencies, both inside the band and window of the dollar bill, the lira row first: a key
  // remembered by the description alone would give the dollar row the lira row's key. The dollar row is the dollar
  // bill's answer whatever was generated: on its due day, no createdAt, and an id before every generated one.
  rows.unshift({ id: "a-same-words-usd", description: "Netflix", currency: "USD", amount: 15, bucket: "WANTS", date: "2026-11-24", paymentMethod: "card" } as StoredTransaction);
  rows.unshift({ id: "a-same-words-lbp", description: "Netflix", currency: "LBP", amount: 15, bucket: "WANTS", date: "2026-11-24", paymentMethod: "card" } as StoredTransaction);
  return rows;
}

const SEEDS = [1, 2, 3, 65, 127, 2026];

it("the premise: the reference's constants are the rule's", () => {
  expect(HALF_CYCLE_DAYS).toEqual(REF_HALF);
  expect(BILL_BAND).toBe(REF_BAND);
});

describe.each(SEEDS)("seed %i", (seed) => {
  const transactions = generate(seed);
  const data = { ...DEFAULT_DATA, income: 3000, recurring: BILLS.map((b) => b.r), transactions } as LocalFinancials;
  const renewals = BILLS.map((b) => ({ id: b.r.id, dueDate: b.due }));

  it("loggedEntryFor gives the reference's row, or none, for every bill", () => {
    for (const { r, due } of BILLS) expect(loggedEntryFor(r, due, transactions)?.id ?? null, r.id).toBe(reference(r, due, transactions)?.id ?? null);
  });

  it("loggedEntries gives the reference's row, or none, for every bill, in one call", () => {
    const want: Record<string, string> = {};
    for (const { r, due } of BILLS) { const t = reference(r, due, transactions); if (t) want[r.id] = t.id; }
    const got = Object.fromEntries(Object.entries(loggedEntries(data, renewals)).map(([k, v]) => [k, v.txId]));
    expect(got).toEqual(want);
  });

  it("the premise: most bills are found, and the dollar Netflix by its own row", () => {
    expect(Object.keys(loggedEntries(data, renewals)).length).toBeGreaterThan(BILLS.length / 2);
    expect(reference(BILLS[0].r, BILLS[0].due, transactions)?.id).toBe("a-same-words-usd");
  });
});
