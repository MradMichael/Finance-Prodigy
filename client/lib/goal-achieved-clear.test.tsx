// Phase 2.8 (LB2), session 45: a person's clear of a goal's achievedAt is an
// edit, and it survives the sync. A merge still never drops one on its own.
//
// achievedAt is stamped once. EditGoalSheet clears it when a save leaves the
// goal below its target (and stamps the edit); a contribution only ever sets
// it (without stamping an edit). Under the fingerprint rule, per goal held on
// both sides:
//   only one side changed it since the last sync
//     the picked copy has achievedAt  -> the earliest any copy holds (as before)
//     the picked copy has none        -> a deliberate clear: it stays cleared
//   both sides changed it (a clash)   -> the earliest any copy holds (as before):
//     the merge can't tell a clear from a stamp the winner never saw (owner,
//     session 45: an achievement is never lost; a clear that clashes comes back)
//   a debt's paidOffBeforeLedger      -> unchanged: the earliest any copy holds
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("./auth", () => ({ getRecoveryTokenForSync: vi.fn(async () => undefined), getSession: () => ({ userId: "u1", email: "u1@example.com", name: "U One" }) }));
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import EditGoalSheet from "../components/EditGoalSheet";
import { ThemeProvider } from "../contexts/ThemeContext";
import { CURRENT_SCHEMA_VERSION, DEFAULT_DATA, applyGoalContribution, edited, migrateFinancials, type LocalFinancials, type StoredGoal, type StoredDebt } from "./localData";
import { mergeFinancials } from "./syncMerge";
import { fetchAndMerge, mergeAndPush } from "./syncService";
import { activateSessionKey } from "./crypto";
import { saveSeen, seenOf } from "./syncSeen";

const NOW = new Date("2026-10-08T12:00:00.000Z");
const T0 = new Date("2026-10-09T12:00:00.000Z");
const RATE = 89_500;
const goal = (o: Partial<StoredGoal> = {}): StoredGoal => ({
  id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 0, openingAmount: 1300, currency: "USD", targetDate: "2027-03-01",
  createdAt: "2026-05-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z", ...o,
});
const base = (o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, transactions: [], ...o }) as LocalFinancials;
const both = (a: LocalFinancials, b: LocalFinancials, seenFrom: LocalFinancials) =>
  [mergeFinancials(a, b, T0, seenOf(seenFrom)), mergeFinancials(b, a, T0, seenOf(seenFrom))];

/** Reached on 2 October, and both devices held it so at their last sync. */
const ACHIEVED = base({ goals: [goal({ achievedAt: "2026-10-02" })] });

/** Device A's copy after the real edit sheet saves a target above what's saved. */
function clearedOnA(): LocalFinancials {
  const onChange = vi.fn<(d: LocalFinancials) => void>();
  render(<ThemeProvider><EditGoalSheet goal={ACHIEVED.goals[0]} financials={ACHIEVED} onChange={onChange} onClose={vi.fn()} /></ThemeProvider>);
  fireEvent.change(document.getElementById("edit-goal-target")!, { target: { value: "1500" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  return onChange.mock.calls.at(-1)![0];
}

beforeEach(() => { vi.useFakeTimers({ now: NOW, toFake: ["Date"] }); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("a person's clear survives the sync", () => {
  it("premise: the edit sheet clears achievedAt when the goal falls below its target, and stamps the edit", () => {
    const g = clearedOnA().goals[0];
    expect(g.targetAmount).toBe(1500);
    expect(g.achievedAt).toBeUndefined();
    expect(g.updatedAt).toBe(NOW.toISOString());
  });

  it("an edit that takes a goal below its target on A stays cleared on B", () => {
    const a = clearedOnA();
    // B is unchanged since the last sync; the server holds A's push.
    const onB = mergeFinancials(ACHIEVED, a, T0, seenOf(ACHIEVED)).data.goals[0];
    expect(onB.targetAmount).toBe(1500);
    expect(onB.achievedAt).toBeUndefined();
  });

  it("and on A's own merge with the unchanged server copy", () => {
    const onA = mergeFinancials(clearedOnA(), ACHIEVED, T0, seenOf(ACHIEVED)).data.goals[0];
    expect(onA.achievedAt).toBeUndefined();
  });

  it("is no clash", () => {
    expect(mergeFinancials(ACHIEVED, clearedOnA(), T0, seenOf(ACHIEVED)).clashes).toEqual([]);
  });
});

describe("a merge never silently drops a standing achievedAt", () => {
  /** Not yet reached at the last sync: 1,100 saved of 1,200. */
  const OPEN = base({ goals: [goal({ openingAmount: 1100 })] });
  const contributedOnA = () => {
    const r = applyGoalContribution(OPEN.goals, "g1", 150, RATE, { date: "2026-10-08" }, OPEN.transactions)!;
    return { ...OPEN, goals: r.goals, transactions: [r.transaction, ...OPEN.transactions] } as LocalFinancials;
  };

  it("premise: a contribution that reaches the target stamps achievedAt without stamping an edit", () => {
    const g = contributedOnA().goals[0];
    expect(g.achievedAt).toBe("2026-10-08");
    expect(g.updatedAt).toBe(OPEN.goals[0].updatedAt);
  });

  it("a contribution's stamp on A against a later rename on B: the rename wins the clash, the stamp stays, from either side", () => {
    const renamedOnB = base({ goals: [edited({ ...OPEN.goals[0], name: "MacBook" }, "2026-10-08T15:00:00.000Z")] });
    for (const r of both(contributedOnA(), renamedOnB, OPEN)) {
      expect(r.clashes).toEqual([{ kind: "goal", name: "MacBook", later: true }]);
      expect(r.data.goals[0]).toMatchObject({ name: "MacBook", achievedAt: "2026-10-08" });
    }
  });

  it("a stamp on one side, the other unchanged, stays, from either side", () => {
    for (const r of both(contributedOnA(), OPEN, OPEN)) expect(r.data.goals[0].achievedAt).toBe("2026-10-08");
  });

  it("both stamped: the earlier stays, from either side", () => {
    const a = base({ goals: [goal({ openingAmount: 1100, achievedAt: "2026-10-05", name: "Laptop Pro", updatedAt: "2026-10-05T09:00:00.000Z" })] });
    const b = base({ goals: [goal({ openingAmount: 1100, achievedAt: "2026-10-03", updatedAt: "2026-10-03T09:00:00.000Z" })] });
    for (const r of both(a, b, OPEN)) expect(r.data.goals[0].achievedAt).toBe("2026-10-03");
  });
});

describe("older code can't clear it", () => {
  // achievedAt has been in StoredGoal since the first commit (cc468e0,
  // 2026-06-13), and the server keeps the backup as an opaque record, so no
  // version of this app writes a goal without the achievedAt it held: a copy
  // with none was cleared by a person, or never reached its target.
  it("every migration step, from a copy with no version at all, keeps a goal's achievedAt", () => {
    const v0 = { income: 3000, goals: [{ id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 1300, targetDate: "2027-03-01", achievedAt: "2026-07-01" }] };
    const out = migrateFinancials(v0);
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(out.goals[0].achievedAt).toBe("2026-07-01");
  });

  describe("through the sync", () => {
    const on = { syncChoice: { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" } };
    const local = () => ({ ...ACHIEVED, ...on }) as LocalFinancials;
    let serverData: LocalFinancials;
    const pushed: LocalFinancials[] = [];
    beforeEach(async () => {
      localStorage.clear(); sessionStorage.clear();
      sessionStorage.setItem("essa_st_v1", "tok");
      activateSessionKey(new Uint8Array(32).fill(7));
      pushed.length = 0;
      await saveSeen("u1", local());
      localStorage.setItem("essa_last_sync_u1", "2026-10-07T09:00:00.000Z");
      vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
        if (url === "/api/sync/pull") return new Response(JSON.stringify({ ok: true, data: serverData, syncedAt: "2026-10-08T09:00:00.000Z", hasRecoveryCode: true }), { status: 200 });
        pushed.push((JSON.parse(String(init.body)) as { data: LocalFinancials }).data);
        return new Response(JSON.stringify({ ok: true, syncedAt: "2026-10-08T10:00:00.000Z" }), { status: 200 });
      }));
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    it("a copy from older code (v6, migrated before the merge) keeps the achievedAt it carries", async () => {
      // The other device, on older code, renamed the goal; its copy still holds the stamp.
      const { openingAmount: _o, ...older } = edited({ ...ACHIEVED.goals[0], name: "MacBook", currentAmount: 1300 }, "2026-10-08T08:00:00.000Z");
      serverData = { ...ACHIEVED, ...on, schemaVersion: 6, goals: [older] } as LocalFinancials;
      const r = await fetchAndMerge("u1@example.com", local);
      if (!r.ok || r.skipped) throw new Error("expected a merge");
      expect(r.mergedData.goals[0]).toMatchObject({ name: "MacBook", achievedAt: "2026-10-02" });
    });

    it("older code pauses on a newer backup: refused, not merged into, nothing pushed", async () => {
      serverData = { ...ACHIEVED, ...on, schemaVersion: CURRENT_SCHEMA_VERSION + 1, goals: [goal()] } as LocalFinancials;
      expect(await fetchAndMerge("u1@example.com", local)).toEqual({ ok: false, newerVersion: true });
      expect(await mergeAndPush("u1@example.com", local())).toEqual({ ok: false, newerVersion: true });
      expect(pushed).toEqual([]);
    });
  });
});

describe("debts unchanged: paidOffBeforeLedger is never cleared by a merge", () => {
  // Written only by a migration (localData.ts, movePaidOffFlag); no screen
  // clears it, so the earliest any copy holds stays, even when the copy the
  // rule picks has none.
  const debt = (o: Partial<StoredDebt> = {}) =>
    ({ id: "d1", name: "Card", openingBalance: 0, balance: 0, apr: 18, minPayment: 50, currency: "USD", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z", ...o }) as StoredDebt;
  const PAID = base({ debts: [debt({ paidOffBeforeLedger: "2026-09-03T09:00:00.000Z" })] });

  it("one side's edit, picked without a clash, keeps the other copy's stamp", () => {
    const { paidOffBeforeLedger: _p, ...without } = PAID.debts[0];
    const renamed = base({ debts: [edited({ ...without, name: "Visa card" }, "2026-10-08T09:00:00.000Z")] });
    for (const r of both(renamed, PAID, PAID)) {
      expect(r.clashes).toEqual([]);
      expect(r.data.debts[0]).toMatchObject({ name: "Visa card", paidOffBeforeLedger: "2026-09-03T09:00:00.000Z" });
    }
  });
});
