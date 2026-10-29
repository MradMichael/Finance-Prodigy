// Foreign cash, model 2 (owner, session 17's plan; session 18 build, held;
// FIX_PLANS.md "FOREIGN CASH, MODEL 2"), replacing slice 1's pocket at cost.
// The ledger stays in USD and LBP:
//   - an exchange is ONE expense row: what was paid, Wants, category Travel,
//     on the pool the money left, with `fx: { kind: "exchange" }` naming the
//     euros received. It counts as spending when it happens;
//   - changing euros back is ONE reimbursement-shaped row (session 19: not
//     income): a TRANSFER that gained what was received, on the pool it went
//     to, category Travel, `fx: { kind: "back" }` naming the euros given back.
//     It nets against Wants in its own month (lib/spending.ts) and lowers the
//     trip it's tagged to; income and the budget targets don't move;
//   - euros are kept on a sheet, one per currency code, derived: exchange rows
//     in, change-back rows out, and the entries that aren't ledger rows
//     (`foreignEntries`: spends out, cash received in). A spend touches no
//     budget total, no pool and not net worth: it was counted at the exchange.
// No rate is fetched or stored: an exchange's rate is its two amounts.
// Units (2.4.138): `fx.amount`, an entry's `amount`, a sheet's lines and
// balance are in the sheet's currency (`code`); a row's own `amount` is in
// its `currency` (USD or LBP).
import { activeTransactions, todayISO, uid, withRate, type Currency, type LocalFinancials, type PaymentMethod, type StoredForeignEntry, type StoredTransaction } from "./localData";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** ISO 4217-shaped (three capitals), and not one of the ledger's own two. */
export function isValidForeignCode(code: string): boolean {
  return /^[A-Z]{3}$/.test(code) && code !== "USD" && code !== "LBP";
}

type Pool = { paymentMethod: PaymentMethod; cardId?: string; cardLabel?: string };
const poolOf = (p: Pool) => ({ paymentMethod: p.paymentMethod, ...(p.paymentMethod === "card" && p.cardId ? { cardId: p.cardId, cardLabel: p.cardLabel } : {}) });

/** An exchange: one Wants row (category Travel unless another is given) for what was paid, naming the euros received. */
export function buildExchange(
  p: { date: string; paid: number; paidCurrency: Currency; from: Pool; code: string; received: number; description: string; category?: string; tripId?: string },
  lbpRate: number,
): StoredTransaction {
  const now = new Date().toISOString();
  return {
    id: uid(), amount: p.paid, currency: p.paidCurrency, bucket: "WANTS", category: p.category ?? "travel",
    description: p.description, date: p.date || todayISO(), ...poolOf(p.from),
    createdAt: now, updatedAt: now, ...withRate(p.paidCurrency, lbpRate),
    fx: { code: p.code, amount: p.received, kind: "exchange" },
    ...(p.tripId ? { tripId: p.tripId } : {}),
  };
}

/**
 * CUR-06 (owner, session 30, DECISIONS_PENDING entry 8 (a)): dollars changed into lira, recorded
 * through the exchange form with lira as the currency received. Lira is a ledger currency and the
 * money stays the person's, so it isn't an exchange row (spending, the foreign cash on a sheet): it's
 * a two-currency transfer, two TRANSFER rows linked as a transfer's legs are (linkedPaymentId, display
 * only): out of the paying pool in dollars, into the receiving pool in lira. Not spending; no sheet;
 * no trip. The rate is the two amounts.
 */
export function buildLiraExchange(
  p: { date: string; paid: number; from: Pool; received: number; to: Pool },
  lbpRate: number,
): [StoredTransaction, StoredTransaction] {
  const now = new Date().toISOString();
  const linkedPaymentId = uid();
  const date = p.date || todayISO();
  const out: StoredTransaction = {
    id: uid(), amount: -p.paid, currency: "USD", bucket: "TRANSFER", description: "Exchange to LBP", date, ...poolOf(p.from),
    createdAt: now, updatedAt: now, linkedPaymentId, ...withRate("USD", lbpRate),
  };
  const inn: StoredTransaction = {
    id: uid(), amount: p.received, currency: "LBP", bucket: "TRANSFER", description: "Exchange from USD", date, ...poolOf(p.to),
    createdAt: now, updatedAt: now, linkedPaymentId, ...withRate("LBP", lbpRate),
  };
  return [out, inn];
}

/** Euros changed back: one reimbursement-shaped row (a TRANSFER that gained what was received; category Travel), naming the euros given back. */
export function buildChangeBack(
  p: { date: string; code: string; given: number; received: number; receivedCurrency: Currency; to: Pool; description: string; tripId?: string },
  lbpRate: number,
): StoredTransaction {
  const now = new Date().toISOString();
  return {
    id: uid(), amount: p.received, currency: p.receivedCurrency, bucket: "TRANSFER", category: "travel",
    description: p.description, date: p.date || todayISO(), ...poolOf(p.to),
    createdAt: now, updatedAt: now, ...withRate(p.receivedCurrency, lbpRate),
    fx: { code: p.code, amount: p.given, kind: "back" },
    ...(p.tripId ? { tripId: p.tripId } : {}),
  };
}

/** A sheet entry that isn't a ledger row: cash spent, or cash received from someone. */
export function buildForeignEntry(
  p: { kind: "spend" | "in"; code: string; amount: number; date: string; description: string; category?: string; tripId?: string },
  now: Date = new Date(),
): StoredForeignEntry {
  const at = now.toISOString();
  return {
    id: uid(), kind: p.kind, code: p.code, amount: round2(p.amount), date: p.date || todayISO(), description: p.description,
    ...(p.category ? { category: p.category } : {}), ...(p.tripId ? { tripId: p.tripId } : {}),
    createdAt: at, updatedAt: at,
  };
}

/**
 * A sheet entry edited (session 19): its description, category, trip, amount
 * and date, checked as a row is (a positive amount and a description). Its
 * id, kind, code and creation time stay; its edit time moves, so the sync
 * merge sees an ordinary change. The balance is derived, so it recalculates.
 * An entry that's gone (deleted on another device) isn't brought back.
 */
export function editForeignEntry(
  data: LocalFinancials, id: string,
  p: { amount: number; description: string; date: string; category?: string; tripId?: string },
  now: Date = new Date(),
): { ok: true; data: LocalFinancials } | { ok: false; reason: "entry" } {
  const old = (data.foreignEntries ?? []).find((e) => e.id === id);
  if (!old) return { ok: true, data };
  const description = p.description.trim();
  if (!(p.amount > 0) || !description || !p.date) return { ok: false, reason: "entry" };
  const { category: _c, tripId: _t, ...kept } = old;
  const entry: StoredForeignEntry = {
    ...kept, amount: round2(p.amount), description, date: p.date,
    ...(p.category ? { category: p.category } : {}), ...(p.tripId ? { tripId: p.tripId } : {}),
    updatedAt: now.toISOString(),
  };
  return { ok: true, data: { ...data, foreignEntries: (data.foreignEntries ?? []).map((e) => (e.id === id ? entry : e)) } };
}

/** One line of a sheet. `delta` and `balance` are in the sheet's currency. */
export interface SheetLine {
  id: string;
  source: "exchange" | "back" | "spend" | "in";
  date: string;
  description: string;
  delta: number;
  balance: number;
  category?: string;
  tripId?: string;
  createdAt?: string;
}

/** A currency's sheet: its lines by date (then entry time, then id), with a running balance; `through` a date, `excludeId` left out. */
export function sheet(data: LocalFinancials, code: string, opts: { through?: string; excludeId?: string } = {}): { code: string; balance: number; lines: SheetLine[] } {
  const keep = (id: string, date: string) => id !== opts.excludeId && (opts.through === undefined || date <= opts.through);
  const fromRows = activeTransactions(data.transactions ?? [])
    .filter((t) => (t.fx?.kind === "exchange" || t.fx?.kind === "back") && t.fx.code === code && keep(t.id, t.date))
    .map((t) => ({
      id: t.id, source: t.fx!.kind, date: t.date, description: t.description,
      delta: t.fx!.kind === "exchange" ? t.fx!.amount : -t.fx!.amount,
      ...(t.category ? { category: t.category } : {}), ...(t.tripId ? { tripId: t.tripId } : {}), createdAt: t.createdAt,
    }));
  const fromEntries = (data.foreignEntries ?? [])
    .filter((e) => e.code === code && keep(e.id, e.date))
    .map((e) => ({
      id: e.id, source: e.kind, date: e.date, description: e.description,
      delta: e.kind === "in" ? e.amount : -e.amount,
      ...(e.category ? { category: e.category } : {}), ...(e.tripId ? { tripId: e.tripId } : {}), createdAt: e.createdAt,
    }));
  const ordered = [...fromRows, ...fromEntries].sort((a, b) =>
    a.date.localeCompare(b.date) || (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id));
  let balance = 0;
  const lines = ordered.map((l) => { balance = round2(balance + l.delta); return { ...l, balance } as SheetLine; });
  return { code, balance, lines };
}

/** Every currency with a sheet line, in order. */
export function sheetCodes(data: LocalFinancials): string[] {
  const codes = new Set<string>();
  for (const t of activeTransactions(data.transactions ?? [])) if (t.fx?.kind === "exchange" || t.fx?.kind === "back") codes.add(t.fx.code);
  for (const e of data.foreignEntries ?? []) codes.add(e.code);
  return [...codes].sort();
}

/** What a row is to foreign cash: an exchange, a change-back, or neither. */
export function foreignCashRole(t: StoredTransaction): "exchange" | "back" | null {
  return t.fx?.kind === "exchange" || t.fx?.kind === "back" ? t.fx.kind : null;
}

/** An amount in a sheet's own currency, e.g. "€40.00". */
export function fmtForeign(amount: number, code: string): string {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(amount); }
  catch { return `${amount.toFixed(2)} ${code}`; }
}
