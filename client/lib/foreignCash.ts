// Travel slice 1 (HELD; owner, session 14; FIX_PLANS.md "TRAVEL / FOREIGN
// CASH"): foreign cash without a third currency. The ledger stays in USD and
// LBP; a foreign amount is an annotation (`fx`) on an ordinary row:
//   - an exchange is two TRANSFER rows, linked by `linkedPaymentId`: the
//     source leg on the pool the money left, in the currency paid (exactly a
//     transfer's outgoing leg), and the pocket leg mirroring it, positive,
//     with `fx: { kind: "in" }` and no payment method;
//   - a pocket, one per currency code, is derived from its rows: a balance in
//     that currency and a USD cost basis. Nothing else is stored;
//   - a spend from it is an ordinary NEEDS/WANTS/SAVINGS row in USD at a cost
//     frozen when it's entered (`fx: { kind: "spend", costPerUnitUSD }`), so
//     every existing total counts it, at what the euros cost, never at a
//     rate of today's (ESSA has none, and fetches none).
// Units (2.4.138): `fx.amount` and a pocket's balance are in `fx.code`;
// `costPerUnitUSD` is USD per 1 unit of `fx.code`; a spend's `amount` and a
// pocket's basis are USD; a pocket leg's `amount` is the currency paid.
import { activeTransactions, cycleStartDayOf, makeToUSDForMonth, todayISO, uid, withRate, type Currency, type LocalFinancials, type PaymentMethod, type StoredTransaction } from "./localData";
import { cycleKeyForISO } from "./period";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** ISO 4217-shaped (three capitals), and not one of the ledger's own two. */
export function isValidForeignCode(code: string): boolean {
  return /^[A-Z]{3}$/.test(code) && code !== "USD" && code !== "LBP";
}

/** A row that moves money into or out of a pocket. Never part of a tracked pool, whatever its payment method says. */
export function isPocketRow(t: StoredTransaction): boolean {
  return t.fx?.kind === "in" || t.fx?.kind === "spend";
}

const byWhen = (a: StoredTransaction, b: StoredTransaction) =>
  a.date.localeCompare(b.date) || (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id);

function pocketRows(data: LocalFinancials, code: string, { through, excludeId }: { through?: string; excludeId?: string } = {}): StoredTransaction[] {
  return activeTransactions(data.transactions ?? [])
    .filter((t) => isPocketRow(t) && t.fx!.code === code && t.id !== excludeId && (through === undefined || t.date <= through))
    .sort(byWhen);
}

export interface PocketState {
  code: string;
  /** In `code`. */
  balance: number;
  /** USD: what the euros still held cost. */
  basisUSD: number;
  /** USD per 1 unit of `code`; none with nothing held. */
  averageCostUSD: number | null;
}

/** A pocket's balance and cost basis, from its rows (those dated through `through`, `excludeId` left out). */
export function pocketState(data: LocalFinancials, code: string, opts: { through?: string; excludeId?: string } = {}): PocketState {
  const toUSD = makeToUSDForMonth(data);
  const startDay = cycleStartDayOf(data);
  let balance = 0, basis = 0;
  for (const t of pocketRows(data, code, opts)) {
    if (t.fx!.kind === "in") { balance += t.fx!.amount; basis += toUSD(t.amount, t.currency, cycleKeyForISO(t.date, startDay)); }
    else { balance -= t.fx!.amount; basis -= t.amount; }
  }
  const balanceR = round2(balance), basisUSD = round2(basis);
  return { code, balance: balanceR, basisUSD, averageCostUSD: balanceR > 0 ? basisUSD / balanceR : null };
}

/** Every currency with pocket rows, by code. */
export function pockets(data: LocalFinancials): PocketState[] {
  const codes = [...new Set(activeTransactions(data.transactions ?? []).filter(isPocketRow).map((t) => t.fx!.code))].sort();
  return codes.map((c) => pocketState(data, c));
}

/** The USD cost of the foreign cash still held: the net worth screen's own line (not counted in net worth). */
export function foreignCashAtCostUSD(data: LocalFinancials): number {
  return round2(pockets(data).filter((p) => p.balance > 0).reduce((s, p) => s + p.basisUSD, 0));
}

/**
 * What one unit of `code` cost, for a spend dated `date` (`excludeId`, the
 * spend itself when re-pricing, left out): the pocket's moving average on
 * that date. With nothing held then, the latest exchange's rate on or before
 * it. With no exchange by then either, none: the form asks.
 */
export function priceSpend(data: LocalFinancials, code: string, date: string, excludeId?: string):
  { costPerUnitUSD: number; source: "average" | "lastExchange" } | null {
  const s = pocketState(data, code, { through: date, excludeId });
  if (s.averageCostUSD !== null) return { costPerUnitUSD: s.averageCostUSD, source: "average" };
  const lastIn = pocketRows(data, code, { through: date, excludeId }).filter((t) => t.fx!.kind === "in").at(-1);
  if (!lastIn) return null;
  const toUSD = makeToUSDForMonth(data);
  return { costPerUnitUSD: toUSD(lastIn.amount, lastIn.currency, cycleKeyForISO(lastIn.date, cycleStartDayOf(data))) / lastIn.fx!.amount, source: "lastExchange" };
}

/** An exchange's two rows: the source leg, then the pocket leg. */
export function buildExchange(
  p: {
    date: string; paid: number; paidCurrency: Currency;
    from: { paymentMethod: PaymentMethod; cardId?: string; cardLabel?: string };
    code: string; received: number; description: string;
  },
  lbpRate: number,
): [StoredTransaction, StoredTransaction] {
  const now = new Date().toISOString();
  const shared = {
    currency: p.paidCurrency, date: p.date || todayISO(), bucket: "TRANSFER" as const, description: p.description,
    createdAt: now, updatedAt: now, linkedPaymentId: uid(), ...withRate(p.paidCurrency, lbpRate),
  };
  const source: StoredTransaction = {
    id: uid(), amount: -p.paid, paymentMethod: p.from.paymentMethod,
    ...(p.from.paymentMethod === "card" && p.from.cardId ? { cardId: p.from.cardId, cardLabel: p.from.cardLabel } : {}),
    ...shared,
  };
  const pocket: StoredTransaction = { id: uid(), amount: p.paid, ...shared, fx: { code: p.code, amount: p.received, kind: "in" } };
  return [source, pocket];
}

/** A spend from a pocket: an ordinary USD row at the cost frozen now. */
export function buildPocketSpend(p: {
  date: string; code: string; amount: number; bucket: "NEEDS" | "WANTS" | "SAVINGS";
  category?: string; description: string; costPerUnitUSD: number;
}): StoredTransaction {
  const now = new Date().toISOString();
  return {
    id: uid(), amount: round2(p.amount * p.costPerUnitUSD), currency: "USD", bucket: p.bucket,
    ...(p.category ? { category: p.category } : {}),
    description: p.description, date: p.date || todayISO(), createdAt: now, updatedAt: now,
    fx: { code: p.code, amount: p.amount, kind: "spend", costPerUnitUSD: p.costPerUnitUSD },
  };
}

/** The other row of an exchange, or null (a spend, an ordinary transfer, any other row). */
export function exchangePartnerId(transactions: StoredTransaction[], t: StoredTransaction): string | null {
  if (!t.linkedPaymentId) return null;
  const other = transactions.find((o) => o.id !== t.id && o.linkedPaymentId === t.linkedPaymentId);
  if (!other) return null;
  return t.fx?.kind === "in" || other.fx?.kind === "in" ? other.id : null;
}

/** The rows a delete, a restore or a removal acts on: an exchange's two together, any other row alone. */
export function pairedIds(transactions: StoredTransaction[], id: string): string[] {
  const t = transactions.find((x) => x.id === id);
  const partner = t ? exchangePartnerId(transactions, t) : null;
  return partner ? [id, partner] : [id];
}

/** What a row is to foreign cash: part of an exchange, a spend from a pocket, or neither. */
export function foreignCashRole(t: StoredTransaction, transactions: StoredTransaction[]): "exchange" | "spend" | null {
  if (t.fx?.kind === "spend") return "spend";
  if (t.fx?.kind === "in" || exchangePartnerId(transactions, t)) return "exchange";
  return null;
}

/** An amount in a pocket's own currency, e.g. "€40.00". */
export function fmtForeign(amount: number, code: string): string {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(amount); }
  catch { return `${amount.toFixed(2)} ${code}`; }
}
