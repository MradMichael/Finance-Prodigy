// TODO 127 (owner, session 65, item 2): the hand-logged entry rule normalises each row's name once per render, not once
// per bill, and checks the amount and the date before the name. Session 64 measured about 100 ms per change on the
// throttled phone profile at 13,500 entries with 8 bills due (AUDIT 2.4.176): the name key (billHintKey) was built for
// every row before the cheap checks, once per bill, about 108,000 times. Here the key's builder is counted, through a
// pass-through mock, over one call for 8 bills (loggedEntries is called once per render). Its answers are checked
// against session 63's rule in alreadyLogged.same-results.test.ts.
import { it, expect, vi, beforeEach } from "vitest";

vi.mock("./billHints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./billHints")>();
  return { ...actual, billHintKey: vi.fn(actual.billHintKey) };
});

import { billHintKey } from "./billHints";
import { loggedEntries } from "./alreadyLogged";
import { DEFAULT_DATA, type LocalFinancials, type StoredRecurring, type StoredTransaction } from "./localData";

const DUE = "2026-11-24";
const BILLS = Array.from({ length: 8 }, (_, k) => ({ id: `b${k}`, name: `Bill ${k}`, emoji: "•", amount: 100, currency: "USD", frequency: "monthly",
  bucket: "NEEDS", startDate: "2026-01-01", endDate: null, totalAmount: null, createdAt: "2026-01-01T00:00:00.000Z" }) as StoredRecurring);
const row = (id: string, description: string, o: Partial<StoredTransaction> = {}) =>
  ({ id, description, amount: 100, currency: "USD", bucket: "NEEDS", date: "2026-11-20", paymentMethod: "card", createdAt: "2026-11-20T09:00:00.000Z", ...o }) as StoredTransaction;

// Inside every bill's band and window, with words no bill has: each is checked by name against all 8 bills.
const NEAR = Array.from({ length: 50 }, (_, i) => row(`near${i}`, `Near row ${i}`));
// Each bill's own row, in other case and spacing.
const OWN = BILLS.map((b, k) => row(`own${k}`, `  bill ${k}  `, { date: "2026-11-23" }));
// Outside every band (ten times the amount) or every window (five months early).
const FAR = Array.from({ length: 30 }, (_, i) => row(`far${i}`, `Far row ${i}`, { amount: 1000 }));
const EARLY = Array.from({ length: 30 }, (_, i) => row(`early${i}`, `Early row ${i}`, { date: "2026-06-20" }));
const DATA = { ...DEFAULT_DATA, income: 3000, recurring: BILLS, transactions: [...NEAR, ...FAR, ...OWN, ...EARLY] } as LocalFinancials;
const RENEWALS = BILLS.map((b) => ({ id: b.id, dueDate: DUE }));

const callsFor = (description: string) => vi.mocked(billHintKey).mock.calls.filter(([d]) => d === description).length;

beforeEach(() => { vi.mocked(billHintKey).mockClear(); });

it("each row's name key is built at most once in one call, however many bills are due", () => {
  loggedEntries(DATA, RENEWALS);
  const most = Math.max(...[...NEAR, ...OWN].map((t) => callsFor(t.description)));
  expect(most).toBe(1);
});

it("a row outside every bill's amount band or date window never has its name key built", () => {
  loggedEntries(DATA, RENEWALS);
  const built = [...FAR, ...EARLY].filter((t) => callsFor(t.description) > 0).map((t) => t.id);
  expect(built).toEqual([]);
});

it("the premise: each bill still finds its own row, and only it", () => {
  const got = loggedEntries(DATA, RENEWALS);
  expect(Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v.txId]))).toEqual(Object.fromEntries(BILLS.map((b, k) => [b.id, `own${k}`])));
});
