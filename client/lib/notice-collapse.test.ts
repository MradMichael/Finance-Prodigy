// The merge notice at three or more conflicts (owner, session 4, variant (b)):
//   Your devices had different versions of N <transactions|items>, including
//   "<a>" and "<b>" — ESSA kept one of each.
// One line for every conflict the notice describes -- newer edits, ties and
// no-edit-time conflicts together -- with the review link. "items" when the
// conflicts span kinds. One and two conflicts keep their own sentences, and
// the 2026-09-01 "N edit conflicts resolved (kept the most recent edit each
// time)" is retired.
import { describe, it, expect } from "vitest";
import type { StoredTransaction } from "./localData";
import { buildMergeNoticeText, collapsedConflictLine, type MergeConflictDetail } from "./syncService";

const tx = (o: Partial<StoredTransaction>): StoredTransaction =>
  ({ id: "t", amount: 50, currency: "USD", bucket: "WANTS", description: "x", date: "2026-10-03", ...o }) as StoredTransaction;
const newer = (name: string): MergeConflictDetail => ({
  winner: tx({ id: name, description: name, amount: 47, updatedAt: "2026-10-06T19:00:00.000Z" }),
  loser: tx({ id: name, description: name, amount: 40, updatedAt: "2026-10-06T18:00:00.000Z" }),
});
const tie = (name: string): MergeConflictDetail => ({
  winner: tx({ id: name, description: name, amount: 75, updatedAt: "2026-10-03T13:20:00.000Z" }),
  loser: tx({ id: name, description: name, amount: 50, updatedAt: "2026-10-03T13:20:00.000Z" }),
});
const undated = (name: string): MergeConflictDetail => ({ winner: tx({ id: name, description: name, amount: 75 }), loser: tx({ id: name, description: name, amount: 50 }) });

describe("three or more conflicts", () => {
  it("one line, naming the count and the first two, with the review link", () => {
    expect(buildMergeNoticeText(0, [newer("Bistro Margaux"), newer("Kahwet Leila"), newer("Spinneys")])).toEqual({
      text: 'Your devices had different versions of 3 transactions, including "Bistro Margaux" and "Kahwet Leila" — ESSA kept one of each.',
      showReviewLink: true,
    });
  });

  it("counts newer edits, ties and no-edit-time conflicts together, replacing their sentences", () => {
    const r = buildMergeNoticeText(0, [tie("Kebab"), undated("Lunch at Tawlet"), newer("Spinneys"), undated("Pharmacy")]);
    expect(r).toEqual({
      text: 'Your devices had different versions of 4 transactions, including "Kebab" and "Lunch at Tawlet" — ESSA kept one of each.',
      showReviewLink: true,
    });
  });

  it("follows what arrived, as its own sentence", () => {
    expect(buildMergeNoticeText(2, [newer("A"), newer("B"), newer("C")]).text).toBe(
      'Merged with your other device — 2 new transactions added. Your devices had different versions of 3 transactions, including "A" and "B" — ESSA kept one of each.',
    );
  });

  it("names two different items, not the same one twice", () => {
    const same = [newer("Rent"), { ...newer("Rent"), winner: tx({ id: "r2", description: "Rent", updatedAt: "2026-10-06T19:00:00.000Z" }) }, newer("Gas")];
    expect(buildMergeNoticeText(0, same).text).toBe('Your devices had different versions of 3 transactions, including "Rent" and "Gas" — ESSA kept one of each.');
  });

  it("the retired sentence never appears", () => {
    for (const n of [3, 4, 7]) {
      const text = buildMergeNoticeText(0, Array.from({ length: n }, (_, i) => newer(`T${i}`))).text;
      expect(text).not.toMatch(/edit conflicts resolved|kept the most recent edit/);
    }
  });

  it("a deleted or purged record isn't counted (DI-12): two live conflicts keep their sentences", () => {
    const gone = { winner: tx({ id: "g", description: "", deletedAt: "2026-10-01T00:00:00.000Z", purgedAt: "2026-10-02T00:00:00.000Z" }), loser: tx({ id: "g", description: "", deletedAt: "2026-10-01T00:00:00.000Z" }) };
    expect(buildMergeNoticeText(0, [newer("A"), gone, newer("B")]).text).toBe(
      'Merged with your other device — kept the newer edit to "A" ($47, was $40) and kept the newer edit to "B" ($47, was $40).',
    );
  });
});

describe("one and two conflicts keep their sentences", () => {
  it("one", () => {
    expect(buildMergeNoticeText(0, [newer("A")])).toEqual({ text: 'Merged with your other device — kept the newer edit to "A" ($47, was $40).', showReviewLink: false });
  });

  it("two, of different kinds", () => {
    expect(buildMergeNoticeText(0, [newer("A"), tie("Kebab")])).toEqual({
      text: 'Merged with your other device — kept the newer edit to "A" ($47, was $40). Both devices changed "Kebab" at the same moment — kept $75 (the other copy said $50).',
      showReviewLink: false,
    });
  });
});

describe("the line itself", () => {
  it('says "items" when the conflicts span kinds', () => {
    expect(collapsedConflictLine([{ kind: "transaction", name: "Rent" }, { kind: "goal", name: "Laptop" }, { kind: "transaction", name: "Gas" }]))
      .toBe('Your devices had different versions of 3 items, including "Rent" and "Laptop" — ESSA kept one of each.');
  });

  it('says "transactions" when every conflict is one', () => {
    expect(collapsedConflictLine([{ kind: "transaction", name: "a" }, { kind: "transaction", name: "b" }, { kind: "transaction", name: "c" }]))
      .toBe('Your devices had different versions of 3 transactions, including "a" and "b" — ESSA kept one of each.');
  });
});
