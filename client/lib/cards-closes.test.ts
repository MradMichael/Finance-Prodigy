// Plan H 5c, owner's added check (session 6): collapsing duplicate cards
// remaps their tracked balances, and with them the close records that name
// those balances (PeriodCloseAccount.trackedBalanceId). A close is keyed by
// its own content (periodCloseKey: cycle and closing instant), its standing
// by its span (cycle and range), and its deletion, revival and reopen records
// by that key. None of those includes a card or balance id, so remapping a
// close's accounts must change none of them. Checked here with the same card
// tracked on both devices, a close on each, and one reopened before the
// collapse:
//   1. which close stands for each cycle is the same with and without it;
//   2. deletion and revival records keyed on the old close keys still match;
//   3. a reopen recorded before it still applies.
import { describe, it, expect } from "vitest";
import { DEFAULT_DATA, periodCloseKey, type LocalFinancials, type PeriodClose, type StoredCard, type TrackedBalance } from "./localData";
import { mergeFinancials } from "./syncMerge";
import { seenOf } from "./syncSeen";

const T0 = new Date("2026-10-08T12:00:00.000Z");
const card = (id: string, createdAt: string): StoredCard => ({ id, type: "Visa", last4: "4242", label: "Visa •••• 4242", createdAt });
const LAPTOP = card("c-laptop", "2026-07-01T10:00:00.000Z");
const PHONE = card("c-phone", "2026-07-03T10:00:00.000Z");
const ANCHOR = "2026-06-01T00:00:00.000Z";
const tracked = (id: string, cardId: string): TrackedBalance => ({
  id, name: "Visa", paymentMethod: "card", cardId, startingBalance: 500, startingDate: "2026-06-01", startingAt: ANCHOR, currency: "USD",
}) as TrackedBalance;
const close = (cycleKey: string, closedAt: string, tbId: string, extra: Partial<PeriodClose> = {}): PeriodClose => {
  const [y, m] = cycleKey.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1)).toISOString(), end = new Date(Date.UTC(y, m, 1)).toISOString();
  return {
    cycleKey, rangeStart: start, rangeEnd: end, startDayAtClose: 1, closedAt,
    accounts: [{ trackedBalanceId: tbId, actual: 380, expectedAtClose: 380, discrepancy: 0, currency: "USD", lbpRateAtClose: 89_500,
      priorState: { startingBalance: 500, startingDate: "2026-06-01", startingAt: ANCHOR } }],
    ...extra,
  } as unknown as PeriodClose;
};

// August: each device closed it; A first, so A's close stands.
const A_AUG = close("2026-08", "2026-09-01T08:00:00.000Z", "tb-laptop");
const B_AUG = close("2026-08", "2026-09-02T08:00:00.000Z", "tb-phone");
// September: closed on B, synced to A, then reopened on B before the collapse.
const SEP = close("2026-09", "2026-10-01T08:00:00.000Z", "tb-phone");
const SEP_REOPENED = { ...SEP, reopenedAt: "2026-10-02T09:00:00.000Z" } as PeriodClose;
// June: deleted on A; B still holds it.
const JUN = close("2026-06", "2026-07-01T08:00:00.000Z", "tb-phone");
// July: deleted on B (generation 1), then restored on A from a file (generation 2).
const JUL = close("2026-07", "2026-08-01T08:00:00.000Z", "tb-phone");

// A never had the phone's card (cards stayed each device's own before plan H)
// but did receive its tracked balance and closes (those already merged).
const A = { ...DEFAULT_DATA, income: 3000, cards: [LAPTOP], trackedBalances: [tracked("tb-laptop", "c-laptop"), tracked("tb-phone", "c-phone")],
  periodCloses: [A_AUG, SEP, JUL],
  deletedKeys: { periodCloses: [{ key: periodCloseKey(JUN), deletedAt: "2026-10-03T09:00:00.000Z" }, { key: periodCloseKey(JUL), deletedAt: "2026-10-03T10:00:00.000Z", gen: 1 }] },
  revivedKeys: { periodCloses: { [periodCloseKey(JUL)]: 2 } },
} as unknown as LocalFinancials;
const B = { ...DEFAULT_DATA, income: 3000, cards: [PHONE], trackedBalances: [tracked("tb-phone", "c-phone")],
  periodCloses: [B_AUG, SEP_REOPENED, JUN],
} as unknown as LocalFinancials;
const BOTH = { ...DEFAULT_DATA, income: 3000 } as LocalFinancials;

const inForce = (d: LocalFinancials) =>
  Object.fromEntries((d.periodCloses ?? []).filter((c) => !c.reopenedAt && !c.supersededAt).map((c) => [c.cycleKey, periodCloseKey(c)]));
const keyed = (d: LocalFinancials, c: PeriodClose) => (d.periodCloses ?? []).find((x) => periodCloseKey(x) === periodCloseKey(c));
const merges = () => [
  { collapsed: mergeFinancials(A, B, T0, seenOf(BOTH)).data, plain: mergeFinancials(A, B, T0).data },
  { collapsed: mergeFinancials(B, A, T0, seenOf(BOTH)).data, plain: mergeFinancials(B, A, T0).data },
];

describe("closes keep their keys, standing, deletions, revivals and reopens through a card collapse", () => {
  it("premise: the collapse happens, and the closes now name the kept balance", () => {
    for (const { collapsed } of merges()) {
      expect(collapsed.cards.map((c) => c.id)).toEqual(["c-laptop"]);
      expect(collapsed.trackedBalances.map((b) => b.id)).toEqual(["tb-laptop"]);
      expect([...new Set((collapsed.periodCloses ?? []).flatMap((c) => c.accounts.map((a) => a.trackedBalanceId)))]).toEqual(["tb-laptop"]);
    }
  });

  it("1. which close stands for each cycle is unchanged by the collapse", () => {
    for (const { collapsed, plain } of merges()) {
      expect(inForce(collapsed)).toEqual(inForce(plain));
      expect(inForce(collapsed)).toEqual({ "2026-08": periodCloseKey(A_AUG), "2026-07": periodCloseKey(JUL) });
      expect(keyed(collapsed, B_AUG)?.supersededAt).toBeTruthy();
    }
  });

  it("2. deletion and revival records keyed on the old close keys still match", () => {
    for (const { collapsed } of merges()) {
      expect(keyed(collapsed, JUN)).toBeUndefined(); // deleted stays deleted
      expect(keyed(collapsed, JUL)).toBeTruthy(); // revived stays live
      expect(keyed(collapsed, JUL)?.reopenedAt).toBeUndefined();
      expect(collapsed.deletedKeys?.periodCloses?.map((t) => t.key).sort()).toEqual([periodCloseKey(JUL), periodCloseKey(JUN)].sort());
      expect(collapsed.revivedKeys?.periodCloses).toEqual({ [periodCloseKey(JUL)]: 2 });
    }
  });

  it("3. a reopen recorded before the collapse still applies: the reopened close stays out of force", () => {
    for (const { collapsed, plain } of merges()) {
      expect(keyed(collapsed, SEP)?.reopenedAt).toBe("2026-10-02T09:00:00.000Z");
      expect(keyed(plain, SEP)?.reopenedAt).toBe("2026-10-02T09:00:00.000Z");
      expect(inForce(collapsed)["2026-09"]).toBeUndefined();
    }
  });
});
