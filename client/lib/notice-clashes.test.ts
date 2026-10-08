// Plan H, part 5d (owner-approved, session 5): the merge notice under the
// fingerprint rule.
//
// The two "may differ … this device's copy was kept" sentences are gone:
// under the rule nothing is silently kept, so each two-sided change is named.
// Approved:
//   'Both devices changed the goal "<name>" — kept the later change.'
//   "Both devices changed your <setting> — kept <value> (the other device had <value>)."
// Each setting keeps the name the owner approved for the retired sentence
// ("income", "LBP rate", "budget split", "payday", "emergency fund target").
// DRAFTS, for the owner (held branch): each setting's value format,
// the other kinds' sentences, and the sentence for a pick that is not the
// later edit (equal times, or no times).
import { describe, it, expect } from "vitest";
import { buildMergeNoticeText, clashSentence } from "./syncService";
import { DEFAULT_DATA, type LocalFinancials, type StoredGoal, type StoredTransaction } from "./localData";
import { mergeFinancials, type MergeClash } from "./syncMerge";
import { seenOf } from "./syncSeen";

const text = (clashes: MergeClash[], added = 0) => buildMergeNoticeText(added, [], clashes, []).text;

describe("approved sentences", () => {
  it("a goal both devices changed, the later edit kept", () => {
    expect(text([{ kind: "goal", name: "Laptop", later: true }]))
      .toBe('Both devices changed the goal "Laptop" — kept the later change.');
  });

  it("a setting both devices changed: what was kept and what the other device had", () => {
    expect(text([{ kind: "setting", setting: "income", kept: 3400, other: 3200 }]))
      .toBe("Both devices changed your income — kept $3,400 (the other device had $3,200).");
  });
});

describe("drafts: each setting's value, under its approved name", () => {
  const one = (c: MergeClash) => clashSentence(c);
  it("income keeps its cents when it has them", () => {
    expect(one({ kind: "setting", setting: "income", kept: 3150.75, other: 3000 })).toBe("Both devices changed your income — kept $3,150.75 (the other device had $3,000).");
  });
  it("the LBP rate, as the Currency screen writes it", () => {
    expect(one({ kind: "setting", setting: "lbpRate", kept: 89_500, other: 90_000 })).toBe("Both devices changed your LBP rate — kept L£ 89,500 / $1 (the other device had L£ 90,000 / $1).");
  });
  it("the budget split, a model or a custom split", () => {
    expect(one({ kind: "setting", setting: "budget", kept: { rule: "50-30-20" }, other: { rule: "custom", needs: 60, wants: 25 } }))
      .toBe("Both devices changed your budget split — kept 50 / 30 / 20 (the other device had 60 / 25 / 15).");
  });
  it("payday", () => {
    expect(one({ kind: "setting", setting: "payday", kept: 25, other: 1 })).toBe("Both devices changed your payday — kept the 25th (the other device had the 1st).");
    expect(one({ kind: "setting", setting: "payday", kept: 12, other: 22 })).toBe("Both devices changed your payday — kept the 12th (the other device had the 22nd).");
  });
  it("the emergency fund target", () => {
    expect(one({ kind: "setting", setting: "efTarget", kept: 8, other: 1 })).toBe("Both devices changed your emergency fund target — kept 8 months (the other device had 1 month).");
  });
});

describe("drafts: the other kinds, and a pick that isn't the later edit", () => {
  it("each kind names itself", () => {
    const k = (kind: "debt" | "recurring" | "asset" | "wishlist" | "category" | "rule", name: string) => clashSentence({ kind, name, later: true });
    expect(k("debt", "Card")).toBe('Both devices changed the debt "Card" — kept the later change.');
    expect(k("recurring", "Rent")).toBe('Both devices changed the recurring payment "Rent" — kept the later change.');
    expect(k("asset", "Car")).toBe('Both devices changed the asset "Car" — kept the later change.');
    expect(k("wishlist", "Quartz lamp")).toBe('Both devices changed the wishlist item "Quartz lamp" — kept the later change.');
    expect(k("category", "Pets")).toBe('Both devices changed the category "Pets" — kept the later change.');
    expect(k("rule", "uber")).toBe('Both devices changed the category rule "uber" — kept the later change.');
  });

  it("equal edit times, or none: it claims no 'later'", () => {
    expect(clashSentence({ kind: "goal", name: "Laptop", later: false })).toBe('Your devices had different versions of the goal "Laptop" — ESSA kept one of them.');
  });
});

describe("the notice as a whole", () => {
  it("never says 'may differ' or 'this device's copy was kept' any more", () => {
    const all: MergeClash[] = [{ kind: "goal", name: "Laptop", later: true }, { kind: "setting", setting: "income", kept: 3400, other: 3200 }];
    expect(text(all)).not.toMatch(/may differ|this device's copy was kept/);
  });

  it("after what arrived, one sentence per change", () => {
    expect(text([{ kind: "goal", name: "Laptop", later: true }, { kind: "setting", setting: "payday", kept: 25, other: 1 }], 1)).toBe(
      'Merged with your other device — 1 new transaction added. Both devices changed the goal "Laptop" — kept the later change. Both devices changed your payday — kept the 25th (the other device had the 1st).',
    );
  });

  it("three or more changes in all, across kinds, collapse to one line", () => {
    const r = buildMergeNoticeText(0, [], [
      { kind: "goal", name: "Laptop", later: true }, { kind: "debt", name: "Card", later: true }, { kind: "setting", setting: "income", kept: 3400, other: 3200 },
    ], []);
    expect(r.text).toBe('Your devices had different versions of 3 items, including "Laptop" and "Card" — ESSA kept one of each.');
  });

  it("the review link (the Transactions screen's conflict view) shows only when a transaction is among them", () => {
    const goals: MergeClash[] = [{ kind: "goal", name: "Laptop", later: true }, { kind: "goal", name: "Car", later: true }];
    expect(buildMergeNoticeText(0, [], [...goals, { kind: "debt", name: "Card", later: true }], []).showReviewLink).toBe(false);
    const tx = (id: string): StoredTransaction => ({ id, amount: 46.8, currency: "USD", bucket: "WANTS", description: "Bistro Margaux", date: "2026-10-06", updatedAt: "2026-10-06T12:00:00.000Z" }) as StoredTransaction;
    const older = { ...tx("t1"), amount: 40, updatedAt: "2026-10-05T12:00:00.000Z" };
    expect(buildMergeNoticeText(0, [{ winner: tx("t1"), loser: older }], goals, []).showReviewLink).toBe(true);
  });

  it("nothing two-sided, nothing arrived: silence", () => {
    expect(buildMergeNoticeText(0, [], [], [])).toEqual({ text: "", showReviewLink: false });
  });
});

describe("from the merge to the sentence", () => {
  it("a category is named by its label", () => {
    const cat = (label: string, updatedAt: string) => ({ value: "pets", label, icon: "🐾", updatedAt });
    const B2 = { ...DEFAULT_DATA, income: 3000, customCategories: [cat("Pets", "2026-10-01T00:00:00.000Z")] } as unknown as LocalFinancials;
    const r = mergeFinancials({ ...B2, customCategories: [cat("Pet care", "2026-10-05T00:00:00.000Z")] } as LocalFinancials, { ...B2, customCategories: [cat("Animals", "2026-10-06T00:00:00.000Z")] } as LocalFinancials, new Date(), seenOf(B2));
    expect(r.clashes).toEqual([{ kind: "category", name: "Animals", later: true }]);
  });

  const goal = (o: Partial<StoredGoal>): StoredGoal => ({ id: "g1", name: "Laptop", emoji: "💻", targetAmount: 1200, currentAmount: 0, openingAmount: 100, currency: "USD", targetDate: "2027-03-01", createdAt: "2026-05-01T09:00:00.000Z", ...o });
  const base = (o: Partial<LocalFinancials>) => ({ ...DEFAULT_DATA, income: 3000, transactions: [] as StoredTransaction[], ...o }) as LocalFinancials;
  const B = base({ goals: [goal({})] });

  it("a two-sided goal edit with times: the later kept, and said so", () => {
    const r = mergeFinancials(base({ goals: [goal({ name: "Laptop Pro", updatedAt: "2026-10-05T00:00:00.000Z" })] }), base({ goals: [goal({ name: "MacBook", updatedAt: "2026-10-06T00:00:00.000Z" })] }), new Date(), seenOf(B));
    expect(r.clashes).toEqual([{ kind: "goal", name: "MacBook", later: true }]);
  });

  it("a two-sided goal edit with no times (an older client): not 'later'", () => {
    const r = mergeFinancials(base({ goals: [goal({ name: "Laptop Pro" })] }), base({ goals: [goal({ name: "MacBook" })] }), new Date(), seenOf(B));
    expect(r.clashes).toEqual([{ kind: "goal", name: expect.any(String), later: false }]);
  });
});
