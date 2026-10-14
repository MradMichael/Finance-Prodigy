// Foreign cash, model 2: the schema step 7 → 8 converts slice 1's rows
// (owner, session 18: "Convert anyway" — whatever slice 1 rows a copy holds).
//   - An exchange pair (a pocket leg `fx.kind: "in"` and the source leg it's
//     linked to) becomes ONE exchange row, in the source leg's place: the same
//     id, Wants, |paid|, category Travel unless it had one, the euros on `fx`,
//     no link, the trip from either leg. The pocket leg goes.
//   - A pocket spend (`fx.kind: "spend"`) becomes a sheet entry with the same
//     id; its USD row goes (the exchange now counts instead).
//   - Half a pair (a pocket leg alone) becomes an exchange row with no pool.
//   - A deleted pair converts and stays deleted; a deleted pocket spend goes;
//     purged rows (no `fx` left) and every other row are untouched.
//   - No pool's balance moves, and no close record changes. Deterministic (no
//     clock, no new ids) and run once: a v8 copy is left as it is.
import { describe, it, expect } from "vitest";
import { CURRENT_SCHEMA_VERSION, DEFAULT_DATA, migrateFinancials, type LocalFinancials, type StoredTransaction } from "./localData";
import { periodTotals, trackedBalanceExpected } from "./computeDashboard";

const T = (d: string, h = "09") => `${d}T${h}:00:00.000Z`;
const TB = { id: "cash", name: "Cash", paymentMethod: "cash" as const, startingBalance: 1000, startingDate: "2026-09-01", currency: "USD" as const };
const CLOSE = { cycleKey: "2026-09", rangeStart: "2026-09-01", rangeEnd: "2026-09-30", startDayAtClose: 1, closedAt: T("2026-10-01"), accounts: [] };

// Slice 1's shapes, written out (its builders are gone).
const S1 = { id: "s1", amount: -500, currency: "USD", bucket: "TRANSFER", description: "Exchange to EUR", date: "2026-10-03", paymentMethod: "cash", linkedPaymentId: "L1", createdAt: T("2026-10-03"), updatedAt: T("2026-10-03") };
const P1 = { id: "p1", amount: 500, currency: "USD", bucket: "TRANSFER", description: "Exchange to EUR", date: "2026-10-03", linkedPaymentId: "L1", createdAt: T("2026-10-03"), updatedAt: T("2026-10-03"), fx: { code: "EUR", amount: 460, kind: "in" }, tripId: "trip-lis" };
const SP1 = { id: "sp1", amount: 43.48, currency: "USD", bucket: "WANTS", category: "dining", description: "Dinner in Lisbon", date: "2026-10-05", createdAt: T("2026-10-05", "20"), updatedAt: T("2026-10-05", "20"), fx: { code: "EUR", amount: 40, kind: "spend", costPerUnitUSD: 500 / 460 }, tripId: "trip-lis" };
const TR1 = { id: "tr1", amount: -200, currency: "USD", bucket: "TRANSFER", description: "Transfer to Cash", date: "2026-10-04", paymentMethod: "card", linkedPaymentId: "L2", createdAt: T("2026-10-04"), updatedAt: T("2026-10-04") };
const TR2 = { id: "tr2", amount: 200, currency: "USD", bucket: "TRANSFER", description: "Transfer from Card", date: "2026-10-04", paymentMethod: "cash", linkedPaymentId: "L2", createdAt: T("2026-10-04"), updatedAt: T("2026-10-04") };
const P9 = { id: "p9", amount: 100, currency: "USD", bucket: "TRANSFER", description: "Exchange to GBP", date: "2026-09-20", linkedPaymentId: "L9", createdAt: T("2026-09-20"), updatedAt: T("2026-09-20"), fx: { code: "GBP", amount: 85, kind: "in" } };
const S2 = { id: "s2", amount: -100, currency: "USD", bucket: "TRANSFER", description: "Exchange to EUR", date: "2026-10-06", paymentMethod: "cash", linkedPaymentId: "L3", createdAt: T("2026-10-06"), updatedAt: T("2026-10-08"), deletedAt: T("2026-10-08") };
const P2 = { id: "p2", amount: 100, currency: "USD", bucket: "TRANSFER", description: "Exchange to EUR", date: "2026-10-06", linkedPaymentId: "L3", createdAt: T("2026-10-06"), updatedAt: T("2026-10-08"), deletedAt: T("2026-10-08"), fx: { code: "EUR", amount: 90, kind: "in" } };
const SP2 = { id: "sp2", amount: 10.87, currency: "USD", bucket: "WANTS", description: "Coffee", date: "2026-10-07", createdAt: T("2026-10-07"), updatedAt: T("2026-10-08"), deletedAt: T("2026-10-08"), fx: { code: "EUR", amount: 10, kind: "spend", costPerUnitUSD: 1.087 } };
const PURGED = { id: "pg", amount: 0, currency: "USD", bucket: "WANTS", description: "", date: "2026-10-02", createdAt: T("2026-10-02"), updatedAt: T("2026-10-09"), deletedAt: T("2026-10-03"), purgedAt: T("2026-10-09") };
const PLAIN = { id: "plain", amount: 30, currency: "USD", bucket: "NEEDS", description: "Airport taxi", date: "2026-10-03", paymentMethod: "cash", createdAt: T("2026-10-03"), updatedAt: T("2026-10-03") };

const v7 = (transactions: object[]) => ({ ...DEFAULT_DATA, schemaVersion: 7, lbpRate: 89_500, lbpRateHistory: [], trackedBalances: [TB], periodCloses: [CLOSE], transactions }) as unknown as LocalFinancials;
const RAW = () => v7([S1, P1, SP1, TR1, TR2, P9, S2, P2, SP2, PURGED, PLAIN]);

it("this code's version is 8", () => {
  expect(CURRENT_SCHEMA_VERSION).toBe(9); // plan J (session 22) took v9; v8 is still this step
});

describe("converting a v7 copy that holds slice 1 rows", () => {
  const out = () => migrateFinancials(RAW());

  it("each row, exactly", () => {
    const { linkedPaymentId: _l1, ...s1 } = S1;
    const { linkedPaymentId: _l9, fx: _f9, ...p9 } = P9;
    const { linkedPaymentId: _l3, ...s2 } = S2;
    expect(out().transactions).toEqual([
      { ...s1, amount: 500, bucket: "WANTS", category: "travel", fx: { code: "EUR", amount: 460, kind: "exchange" }, tripId: "trip-lis" },
      TR1, TR2,
      { ...p9, bucket: "WANTS", category: "travel", fx: { code: "GBP", amount: 85, kind: "exchange" } },
      { ...s2, amount: 100, bucket: "WANTS", category: "travel", fx: { code: "EUR", amount: 90, kind: "exchange" } },
      PURGED, PLAIN,
    ]);
    expect(out().foreignEntries).toEqual([
      { id: "sp1", kind: "spend", code: "EUR", amount: 40, date: "2026-10-05", description: "Dinner in Lisbon", category: "dining", tripId: "trip-lis", createdAt: T("2026-10-05", "20"), updatedAt: T("2026-10-05", "20") },
    ]);
    expect(out().schemaVersion).toBe(9); // through v8, then plan J's v9
  });

  it("an exchange that already had a category keeps it", () => {
    const m = migrateFinancials(v7([{ ...S1, category: "transport" }, P1]));
    expect(m.transactions[0].category).toBe("transport");
  });

  it("no pool's balance moves", () => {
    const before = { ...RAW(), schemaVersion: 8 } as LocalFinancials; // the v7 rows as this code reads them
    expect(trackedBalanceExpected(TB, out())).toBe(trackedBalanceExpected(TB, before));
  });

  it("no close record changes; the budget now counts the exchange instead of the spends", () => {
    expect(out().periodCloses).toEqual([CLOSE]);
    const before = { ...RAW(), schemaVersion: 8 } as LocalFinancials;
    const oct = (d: LocalFinancials) => periodTotals(d, "2026-10" as never, new Date("2026-10-31")).wants;
    expect(oct(out()) - oct(before)).toBeCloseTo(500 - 43.48, 2);
  });

  it("deterministic and run once: the same copy converts the same, and a v8 copy is left as it is", () => {
    expect(migrateFinancials(RAW())).toEqual(out());
    const once = out();
    expect(migrateFinancials(once)).toEqual(once);
  });
});

it("a v7 copy with no slice 1 rows: only its version changes, and no sheet list is added", () => {
  const m = migrateFinancials(v7([TR1, TR2, PLAIN]));
  expect(m.transactions).toEqual([TR1, TR2, PLAIN]);
  expect(m).not.toHaveProperty("foreignEntries");
  expect(m.schemaVersion).toBe(9); // through v8, then plan J's v9
});

it("rows already in the new shape are untouched", () => {
  const exchangeRow = { ...PLAIN, id: "e1", bucket: "WANTS", category: "travel", amount: 500, fx: { code: "EUR", amount: 460, kind: "exchange" } } as StoredTransaction;
  expect(migrateFinancials(v7([exchangeRow])).transactions).toEqual([exchangeRow]);
});
