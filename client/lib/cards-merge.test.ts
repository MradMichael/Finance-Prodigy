// Plan H, part 5c (owner-approved, session 5): cards.
//
// Two devices adding the same physical card used to mint two ids, and a
// tracked balance or a transaction on one id never met the other (the card
// balance check groups by id). Now:
//   (a) one shared saveCard: the same type and last four digits as a card
//       already held IS that card;
//   (b) at merge, cards with the same type and last four collapse to the
//       earliest-created one, and every reference (StoredTransaction.cardId,
//       TrackedBalance.cardId) is remapped to it -- on BOTH sides before the
//       transactions merge, so a remap is never mistaken for an edit;
//   (c) every remapped reference carries the kept card's label.
// Cards join the merge only with all three, and, like the rest of H, only
// once this device has a record of its last sync: the first merge after
// the update is today's (this device's cards).
import { describe, it, expect } from "vitest";
import { DEFAULT_DATA, saveCard, type LocalFinancials, type StoredCard, type StoredTransaction, type TrackedBalance } from "./localData";
import { mergeFinancials } from "./syncMerge";
import { seenOf } from "./syncSeen";

const T0 = new Date("2026-10-08T12:00:00.000Z");
const card = (id: string, o: Partial<StoredCard> = {}): StoredCard => ({ id, type: "Visa", last4: "4242", label: "Visa •••• 4242", ...o });
const tx = (id: string, cardId: string, cardLabel: string): StoredTransaction => ({
  id, amount: 46.8, currency: "USD", bucket: "WANTS", category: "dining", description: id, date: "2026-10-06",
  paymentMethod: "card", cardId, cardLabel, updatedAt: "2026-10-06T12:00:00.000Z",
} as StoredTransaction);
const tb = (id: string, cardId: string): TrackedBalance =>
  ({ id, name: "Visa", paymentMethod: "card", cardId, startingBalance: 500, startingDate: "2026-10-01", currency: "USD" }) as TrackedBalance;
const base = (o: Partial<LocalFinancials> = {}) => ({ ...DEFAULT_DATA, income: 3000, ...o }) as LocalFinancials;

describe("(a) saveCard: one card per type and last four", () => {
  it("a new card is added, labelled and stamped with when", () => {
    const r = saveCard([], "Visa", "4242", T0)!;
    expect(r.cards).toEqual([r.card]);
    expect(r.card).toMatchObject({ type: "Visa", last4: "4242", label: "Visa •••• 4242", createdAt: T0.toISOString() });
  });

  it("the same type and last four returns the card already held, and adds nothing", () => {
    const held = [card("c1")];
    const r = saveCard(held, "Visa", "4242", T0)!;
    expect(r.card).toBe(held[0]);
    expect(r.cards).toBe(held);
  });

  it("another type with the same digits is another card", () => {
    expect(saveCard([card("c1")], "Mastercard", "4242", T0)!.cards).toHaveLength(2);
  });

  it("anything but four digits is refused", () => {
    for (const bad of ["424", "42424", "42a4", ""]) expect(saveCard([], "Visa", bad, T0)).toBeNull();
  });

  it("an imported card keeps the label it was given; reused, the held card's label stands", () => {
    expect(saveCard([], "Other", "1234", T0, "Chase Freedom")!.card.label).toBe("Chase Freedom");
    const held = [card("c1", { type: "Other", last4: "1234", label: "Other •••• 1234" })];
    expect(saveCard(held, "Other", "1234", T0, "Chase Freedom")!.card).toBe(held[0]);
  });
});

describe("(b, c) at merge: duplicates collapse to the earliest, every reference follows", () => {
  // The same Visa added on both devices before this update: two ids.
  const LAPTOP = card("c-laptop", { createdAt: "2026-09-01T10:00:00.000Z" });
  const PHONE = card("c-phone", { createdAt: "2026-09-03T10:00:00.000Z", label: "Visa •••• 4242 " });
  const both = base({ cards: [] });
  const laptop = base({ cards: [LAPTOP], transactions: [tx("t1", "c-laptop", LAPTOP.label)], trackedBalances: [tb("b1", "c-laptop")] });
  const phone = base({ cards: [PHONE], transactions: [tx("t2", "c-phone", PHONE.label)], trackedBalances: [tb("b2", "c-phone")] });

  it("one card remains, the earliest-created, from either side", () => {
    for (const r of [mergeFinancials(laptop, phone, T0, seenOf(both)), mergeFinancials(phone, laptop, T0, seenOf(both))]) {
      expect(r.data.cards).toEqual([LAPTOP]);
    }
  });

  it("every transaction and tracked balance points at it, with its label", () => {
    const d = mergeFinancials(phone, laptop, T0, seenOf(both)).data;
    expect(d.transactions.map((t) => [t.id, t.cardId, t.cardLabel]).sort()).toEqual([
      ["t1", "c-laptop", "Visa •••• 4242"], ["t2", "c-laptop", "Visa •••• 4242"],
    ]);
    expect(d.trackedBalances.map((b) => [b.id, b.cardId]).sort()).toEqual([["b1", "c-laptop"], ["b2", "c-laptop"]]);
  });

  it("a remap is not an edit: the same transaction remapped on one side only is no conflict, and keeps its edit time", () => {
    // The laptop already merged (t2 remapped and pushed); the phone still holds t2 on its own id.
    const merged = mergeFinancials(laptop, phone, T0, seenOf(both)).data;
    const r = mergeFinancials(phone, merged, T0, seenOf(both));
    expect(r.transactions.conflicts).toEqual([]);
    expect(r.data.transactions.find((t) => t.id === "t2")).toMatchObject({ cardId: "c-laptop", updatedAt: "2026-10-06T12:00:00.000Z" });
  });

  it("cards from before this update (no createdAt) count as earliest; between two, the lower id, the same from either side", () => {
    const a = card("c-a"), b = card("c-b"), stamped = card("c-0", { createdAt: "2026-09-01T00:00:00.000Z" });
    const l = base({ cards: [b, stamped] }), s = base({ cards: [a] });
    for (const r of [mergeFinancials(l, s, T0, seenOf(both)), mergeFinancials(s, l, T0, seenOf(both))]) expect(r.data.cards).toEqual([a]);
  });

  it("a card both devices hold appears once", () => {
    const l = base({ cards: [LAPTOP] }), s2 = base({ cards: [LAPTOP] });
    expect(mergeFinancials(l, s2, T0, seenOf(both)).data.cards).toEqual([LAPTOP]);
  });

  it("different cards are both kept (union): another number, or another type", () => {
    const l = base({ cards: [card("c1")] }), s = base({ cards: [card("c2", { last4: "1111", label: "Visa •••• 1111" }), card("c3", { type: "Amex", label: "Amex •••• 4242" })] });
    expect(mergeFinancials(l, s, T0, seenOf(both)).data.cards.map((c) => c.id).sort()).toEqual(["c1", "c2", "c3"]);
  });

  it("with no record of a last sync, cards are today's: this device's, nothing remapped", () => {
    const r = mergeFinancials(laptop, phone, T0);
    expect(r.data.cards).toEqual([LAPTOP]);
    expect(r.data.transactions.find((t) => t.id === "t2")?.cardId).toBe("c-phone");
    expect(mergeFinancials(phone, laptop, T0).data.cards).toEqual([PHONE]);
  });
});
