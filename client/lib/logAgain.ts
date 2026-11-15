import { cardRef, type Currency, type PaymentMethod, type StoredCard, type StoredTransaction } from "./localData";

/** What "Log again" puts in the entry form. The amount is text, as the form's amount box holds it. */
export interface LogAgainEntry {
  amount: string;
  currency: Currency;
  bucket: "NEEDS" | "WANTS" | "SAVINGS" | "INCOME";
  category: string;
  description: string;
  paymentMethod: PaymentMethod;
  paymentNote: string;
  cardId: string | null;
}

/**
 * Session 52, item 18 (held): what the entry form is filled with from a past row, or null when the row doesn't
 * offer "Log again". Only an ordinary entry does: a transfer, a goal contribution, a debt payment, a confirmed
 * recurring bill, a foreign-cash row and a split's part are each made by their own form, and copying one into
 * the entry form would drop its link. The date isn't here: it is always today. A card that's no longer saved
 * falls back to Cash, as the remembered entry does. The amount is in the row's own currency.
 */
export function logAgainEntry(t: StoredTransaction, cards: StoredCard[]): LogAgainEntry | null {
  if (t.bucket !== "NEEDS" && t.bucket !== "WANTS" && t.bucket !== "SAVINGS" && t.bucket !== "INCOME") return null;
  if (t.goalId || t.debtId || t.recurringId || t.linkedPaymentId || t.fx) return null;
  if (!(t.amount > 0)) return null;
  const method: PaymentMethod = t.paymentMethod ?? "cash";
  const card = cardRef(cards, method, t.cardId);
  const paymentMethod: PaymentMethod = method === "card" && !card.cardId ? "cash" : method;
  return {
    amount: String(Math.round(t.amount * 100) / 100), // bare, as the amount box holds it: it adds the separators itself
    currency: t.currency === "LBP" ? "LBP" : "USD",
    bucket: t.bucket,
    category: t.category ?? "",
    description: t.description,
    paymentMethod,
    paymentNote: paymentMethod === "other" ? t.paymentNote ?? "" : "",
    cardId: card.cardId ?? null,
  };
}
