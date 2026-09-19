// 2.4.122: a goal contribution is linked to its goal by an English sentence.
//
// `t.description.startsWith("Goal:")` (GoalsScreen.tsx) is the ONLY semantic
// keyword match on stored text in the app. Every other linked entity carries
// a foreign key -- StoredTransaction has recurringId, debtId, cycleDate,
// efAmount, debtAdjustment, linkedPaymentId -- and buildDebtPaymentTx writes
// BOTH `debtId` and its prose. buildGoalContributionTx writes only the prose.
//
// The description is user-editable with no guard (EditTransactionSheet's
// `desc` state, written straight back by commit()), so an ordinary edit
// silently drops a real contribution out of the total. THAT is the defect,
// and it is independent of localisation -- localisation only makes it worse,
// by making the stored key whatever language the UI was in at write time.
//
// THE FIRST TEST HERE IS THE PERTURBATION, deliberately: rename a real
// contribution through the real sheet and assert the total does not move.
// It is RED against main. A unit test on buildGoalContributionTx alone would
// have passed the moment the field was added, while the screen still read
// the prose -- the end-to-end edit is what pins the reader to the key.
//
// WHICH INPUTS THESE FIXTURES CANNOT REACH (2.4.116), stated up front:
//
//   * startDay -- the matcher also gates on isInCycle, so the perturbation
//     is run at BOTH 1 and 27. A contribution dated today is in the current
//     cycle by construction at either, which is the point: the payday must
//     not be what decides whether the link holds.
//   * goal identity -- nothing consumes goalId PER GOAL yet (the only
//     consumer is an all-goals total), so these tests can prove the link
//     exists and survives, not that anything reads it per goal.
//   * pre-change rows -- no fixture here can produce a row written by the
//     OLD builder except by hand, because the builder now always stamps.
//     The legacy-tier tests construct those rows literally, on purpose.
import { describe, it, expect, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import GoalsScreen from "./GoalsScreen";
import EditTransactionSheet from "../EditTransactionSheet";
import { computeDashboard } from "../../lib/computeDashboard";
import {
  DEFAULT_DATA, buildGoalContributionTx, todayISO,
  type LocalFinancials, type StoredGoal, type StoredTransaction,
} from "../../lib/localData";

afterEach(() => { cleanup(); });

const GOAL: StoredGoal = {
  id: "g1", name: "New laptop", emoji: "L", targetAmount: 1500, currentAmount: 600,
  currency: "USD", targetDate: "2027-01-31", createdAt: "2026-06-01T00:00:00.000Z",
};

function base(over: Partial<LocalFinancials> = {}): LocalFinancials {
  return { ...DEFAULT_DATA, income: 3000, goals: [GOAL], ...over } as LocalFinancials;
}

// Both return "" when the screen renders no line at all (it gates the whole
// block on `total > 0`), so a disappeared total fails as a readable value
// mismatch rather than as "toMatch received an object".
/** The screen's own line: "$200 paid toward goals this month|cycle". */
const totalLine = () => screen.queryByText(/paid toward goals this/)?.textContent ?? "";
/** "1 payment logged" / "2 payments logged". */
const countLine = () => screen.queryByText(/payments? logged/)?.textContent ?? "";

/**
 * Both components over ONE piece of state, so an edit committed in the sheet
 * is the same data the screen re-derives from -- which is the whole question.
 * Mocking one side would assert the wiring I wrote rather than the app's.
 */
function Harness({ initial }: { initial: LocalFinancials }) {
  const [fin, setFin] = useState(initial);
  return (
    <>
      <GoalsScreen dashData={computeDashboard(fin)} financials={fin} onChange={setFin} onEdit={() => {}} />
      <EditTransactionSheet transaction={fin.transactions[0]} financials={fin} onChange={setFin} onClose={() => {}} />
    </>
  );
}

// ───────────────────── 1. the perturbation ─────────────────────

describe("1. THE PERTURBATION — renaming a contribution must not unmake it", () => {
  for (const startDay of [1, 27]) {
    it(`survives an ordinary description edit at startDay ${startDay}`, () => {
      const tx = buildGoalContributionTx(GOAL, 200, 89_500, { paymentMethod: "cash", date: todayISO() });
      const fin = base({ transactions: [tx], ...(startDay === 1 ? {} : { cycleStartDay: 27 }) });
      const seen: LocalFinancials[] = [];
      render(<HarnessSpy initial={fin} onWrite={(f) => seen.push(f)} />);

      // Premise (2.4.97): the contribution IS counted before the edit. Without
      // this, "unchanged" would hold just as well for a total that was never
      // anything but $0, and the test would assert nothing.
      expect(totalLine()).toMatch(/\$200/);
      expect(countLine()).toMatch(/^1 payment logged$/);

      fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Laptop" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      // Premise: the edit really landed. Without this, an edit that silently
      // no-op'd would read as the fix working.
      const written = seen[seen.length - 1];
      expect(written.transactions[0].description).toBe("Laptop");
      expect(written.transactions[0].description.startsWith("Goal:")).toBe(false);

      // The assertion: the link is the key, not the sentence.
      expect(totalLine()).toMatch(/\$200/);
      expect(countLine()).toMatch(/^1 payment logged$/);
    });
  }

  it("the edit carries goalId through untouched", () => {
    // commit() spreads `...t` and then names the fields it overwrites;
    // goalId is not among them, which is the only reason the test above
    // passes. Pinned separately so a future refactor to an explicit field
    // list fails HERE, with a readable reason, rather than showing up as a
    // total that quietly drops.
    const tx = buildGoalContributionTx(GOAL, 200, 89_500, { date: todayISO() });
    const seen: LocalFinancials[] = [];
    render(<HarnessSpy initial={base({ transactions: [tx] })} onWrite={(f) => seen.push(f)} />);
    expect(tx.goalId).toBe("g1");
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(seen[seen.length - 1].transactions[0].goalId).toBe("g1");
  });
});

/** Harness plus a spy on every write, so stored state can be asserted too. */
function HarnessSpy({ initial, onWrite }: { initial: LocalFinancials; onWrite: (f: LocalFinancials) => void }) {
  const [fin, setFin] = useState(initial);
  const set = (f: LocalFinancials) => { onWrite(f); setFin(f); };
  return (
    <>
      <GoalsScreen dashData={computeDashboard(fin)} financials={fin} onChange={set} onEdit={() => {}} />
      <EditTransactionSheet transaction={fin.transactions[0]} financials={fin} onChange={set} onClose={() => {}} />
    </>
  );
}

// ───────────────────── 2. the builder stamps the key ─────────────────────

describe("2. buildGoalContributionTx — the writer", () => {
  it("stamps goalId alongside the prose, the way buildDebtPaymentTx already stamps debtId", () => {
    const tx = buildGoalContributionTx(GOAL, 50, 89_500);
    expect(tx.goalId).toBe("g1");
    // The prose stays: it is what pre-change rows are matched on, and it is
    // still the transaction's own human-readable label in the ledger.
    expect(tx.description).toBe("Goal: New laptop");
  });

  it("carries the key regardless of payment method or date", () => {
    expect(buildGoalContributionTx(GOAL, 50, 89_500, { paymentMethod: "card", cardId: "c1", cardLabel: "Visa" }).goalId).toBe("g1");
    expect(buildGoalContributionTx(GOAL, 50, 89_500, { date: "2026-08-20" }).goalId).toBe("g1");
  });
});

// ───────────────────── 3. the legacy tier ─────────────────────

const legacy = (over: Partial<StoredTransaction> = {}): StoredTransaction => ({
  id: "old1", amount: 200, currency: "USD", bucket: "SAVINGS",
  description: "Goal: New laptop", date: todayISO(), paymentMethod: "other", ...over,
});

describe("3. the legacy tier — rows written before the key existed", () => {
  it("a prose-only row still counts", () => {
    // Every contribution on every existing account is this row. The prefix
    // cannot be dropped from the reader without silently zeroing their
    // history, which is what makes "Goal:" stored-data format from here on.
    render(<Harness initial={base({ transactions: [legacy()] })} />);
    expect(totalLine()).toMatch(/\$200/);
  });

  it("a prose-only row whose goal was renamed still counts — the match is the prefix, not the name", () => {
    render(<Harness initial={base({ transactions: [legacy({ description: "Goal: Old name nobody has" })] })} />);
    expect(totalLine()).toMatch(/\$200/);
  });

  it("BUT a user-typed Savings row starting \"Goal:\" is counted too — the cost of keeping the tier", () => {
    // Recorded as a test, not only as prose, so the residual is a fact the
    // suite states rather than a caveat in a doc. This is false-positive
    // behaviour and it is accepted deliberately: the alternative is dropping
    // real history. It disappears only for rows written from here on, which
    // carry the key and no longer depend on the sentence.
    render(<Harness initial={base({ transactions: [legacy({ id: "typed", description: "Goal: buy a boat someday" })] })} />);
    expect(totalLine()).toMatch(/\$200/);
  });
});

// ───────────────────── 4. controls ─────────────────────

describe("4. controls — the filter is not just \"every Savings row\"", () => {
  it("an unrelated Savings transaction is not counted", () => {
    render(<Harness initial={base({ transactions: [legacy({ id: "ef", description: "Emergency fund top-up" })] })} />);
    // Premise: with nothing matched the line is absent entirely (the screen
    // gates it on `> 0`), so this is a real exclusion, not a $0 match.
    expect(totalLine()).toBe("");
  });

  it("a keyed row in a DIFFERENT cycle is not counted — the key does not override cycle membership", () => {
    const tx = buildGoalContributionTx(GOAL, 200, 89_500, { date: "2026-01-15" });
    render(<Harness initial={base({ transactions: [tx] })} />);
    expect(totalLine()).toBe("");
  });

  it("a keyed row and a prose-only row in the same cycle are counted once each, not twice", () => {
    // The two tiers are an OR on one row, not two passes over the list --
    // a row carrying both must not be double-counted.
    const keyed = buildGoalContributionTx(GOAL, 200, 89_500, { date: todayISO() });
    render(<Harness initial={base({ transactions: [keyed, legacy({ id: "old2", amount: 50 })] })} />);
    expect(totalLine()).toMatch(/\$250/);
    expect(countLine()).toMatch(/^2 payments logged$/);
  });
});
