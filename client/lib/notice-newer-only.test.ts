// The merge notice says "kept the newer edit" only when one copy is newer
// (owner, 2026-10-07, session 2 item E).
//
// Before: a tie had the owner's tie sentence, but two copies with NO edit
// time on either side (records last written before 2.6.3(c) began stamping
// every write) still read "kept the newer edit" -- untrue, nothing says
// which is newer -- and counted toward "kept the most recent edit each time".
//
// One copy is newer when both carry an edit time and the kept one's is later,
// or when only the kept one carries one: every write has stamped a time
// since 2.6.3(c), so the unstamped copy's last edit came first (the merge
// already sorts a missing time as older than any).
//
// A conflict with no edit time on either copy gets its own sentence, in the
// owner's wording (2026-10-07, session 3): it says the devices had different
// versions, not that both changed it, and claims no moment.
import { describe, it, expect, vi, afterEach } from "vitest";
import { DEFAULT_DATA, type LocalFinancials, type StoredTransaction } from "./localData";
import { buildMergeNoticeText, fetchAndMerge } from "./syncService";

const tx = (o: Partial<StoredTransaction>): StoredTransaction =>
  ({ id: "t-tawlet", amount: 50, currency: "USD", bucket: "WANTS", category: "dining", description: "Lunch at Tawlet", date: "2026-10-03", ...o }) as StoredTransaction;
const NO_TIME = { winner: tx({ amount: 75 }), loser: tx({ amount: 50 }) };
const NO_TIME_SENTENCE = 'Your devices had different versions of "Lunch at Tawlet" — kept $75 (the other copy said $50).';
const newer = (description: string, kept: number, was: number) => ({
  winner: tx({ id: `t-${description}`, description, amount: kept, updatedAt: "2026-10-06T19:00:00.000Z" }),
  loser: tx({ id: `t-${description}`, description, amount: was, updatedAt: "2026-10-06T18:00:00.000Z" }),
});

describe("no edit time on either copy", () => {
  it("doesn't call either copy newer", () => {
    expect(buildMergeNoticeText(0, [NO_TIME])).toEqual({ text: NO_TIME_SENTENCE, showReviewLink: false });
  });

  it("follows what arrived, as its own sentence", () => {
    expect(buildMergeNoticeText(2, [NO_TIME]).text).toBe(`Merged with your other device — 2 new transactions added. ${NO_TIME_SENTENCE}`);
  });

  it("doesn't count toward the most-recent-edit tally", () => {
    const three = [newer("Bistro Margaux", 46.8, 40), newer("Kahwet Leila", 12, 9), newer("Spinneys", 88, 80)];
    expect(buildMergeNoticeText(0, [...three, NO_TIME])).toEqual({
      text: `Merged with your other device — 3 edit conflicts resolved (kept the most recent edit each time). ${NO_TIME_SENTENCE}`,
      showReviewLink: true,
    });
    // Two newer edits and one without times: named inline, not collapsed to a count of three.
    expect(buildMergeNoticeText(0, [three[0], three[1], NO_TIME]).text).toBe(
      'Merged with your other device — kept the newer edit to "Bistro Margaux" ($47, was $40) and kept the newer edit to "Kahwet Leila" ($12, was $9). ' + NO_TIME_SENTENCE,
    );
  });

  it("sits beside a tie, each with its own sentence, in the order they came", () => {
    const AT = "2026-10-03T13:20:00.000Z";
    const tie = { winner: tx({ id: "t-kebab", description: "Kebab", amount: 14, updatedAt: AT }), loser: tx({ id: "t-kebab", description: "Kebab", amount: 11, updatedAt: AT }) };
    expect(buildMergeNoticeText(0, [tie, NO_TIME]).text).toBe(
      `Both devices changed "Kebab" at the same moment — kept $14 (the other copy said $11). ${NO_TIME_SENTENCE}`,
    );
  });

  describe("end to end, from a fetch", () => {
    afterEach(() => { vi.unstubAllGlobals(); });
    it("the merge's own winner and loser reach the sentence, the same from either device", async () => {
      sessionStorage.setItem("essa_st_v1", "tok");
      const on = { syncChoice: { enabled: true, decidedAt: "2026-09-28T12:00:00.000Z" } };
      const phone = { ...DEFAULT_DATA, ...on, transactions: [tx({ amount: 50 })] } as LocalFinancials;
      const laptop = { ...DEFAULT_DATA, ...on, transactions: [tx({ amount: 75 })] } as LocalFinancials;
      const texts: string[] = [];
      for (const [local, server] of [[phone, laptop], [laptop, phone]]) {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, data: server, syncedAt: "2026-10-07T09:00:00.000Z", hasRecoveryCode: true }), { status: 200 })));
        const r = await fetchAndMerge("u1@example.com", () => local);
        if (!r.ok || r.skipped) throw new Error("expected a merge");
        texts.push(buildMergeNoticeText(r.addedFromServer, r.conflictDetails).text);
      }
      expect(texts).toEqual([NO_TIME_SENTENCE, NO_TIME_SENTENCE]);
    });
  });
});

describe("one copy is newer", () => {
  it("both stamped, the kept one later: the newer edit", () => {
    expect(buildMergeNoticeText(0, [newer("Bistro Margaux", 46.8, 40)]).text).toBe(
      'Merged with your other device — kept the newer edit to "Bistro Margaux" ($47, was $40).',
    );
  });

  it("only the kept one stamped: the newer edit (the unstamped copy predates stamping)", () => {
    const d = { winner: tx({ amount: 75, updatedAt: "2026-10-03T13:20:00.000Z" }), loser: tx({ amount: 50 }) };
    expect(buildMergeNoticeText(0, [d]).text).toBe('Merged with your other device — kept the newer edit to "Lunch at Tawlet" ($75, was $50).');
  });
});
