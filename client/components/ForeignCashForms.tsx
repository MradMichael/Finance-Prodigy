"use client";

// Foreign cash, model 2: the two forms the Currency screen's panel AND each
// trip card open (session 20, item 1: one set of form components, no copies).
// Every sentence here is one the owner has approved (sessions 15 and 19).
//   - ExchangeForm: ONE Wants/Travel row for what was paid, naming the euros
//     received. Its trip defaults to the one whose dates hold the date, else
//     the next trip (decision 10); a trip card presets its own trip instead.
//   - SpendForm: a sheet entry; not counted in the budget. Its trip defaults
//     to the one holding the date; a trip card presets its own.
// A preset trip is only where the choice starts: the Trip field still changes.
// `idPrefix` keeps two forms' element ids apart (the Currency screen keeps
// "fx-ex" and "fx-sp"; a trip card passes its own).
import { useState } from "react";
import type { Currency, LocalFinancials, PaymentMethod, StoredCard } from "../lib/localData";
import { allCategories, cycleStartDayOf, makeToUSDForMonth, moneyMaxFor, todayISO, DEFAULT_LBP_RATE, saveCard as storeCard } from "../lib/localData";
import { cycleKeyForISO } from "../lib/period";
import { useTheme } from "../contexts/ThemeContext";
import { Label, FocusInput, MoneyInput, DateFieldDMY, CurrencyToggle, PaymentMethodPicker } from "./form/Primitives";
import { buildExchange, buildForeignEntry, fmtForeign, isValidForeignCode, sheet, sheetCodes } from "../lib/foreignCash";
import { suggestedTripId } from "../lib/trips";

const usd = (n: number, digits = 2) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
const num = (s: string) => parseFloat(s.replace(/,/g, ""));

interface FormProps {
  financials: LocalFinancials;
  onChange: (updated: LocalFinancials) => void;
  /** Called after a save, so the opener can close the form. */
  onDone: () => void;
  /** A trip card's own trip: the Trip field starts there (still changeable). */
  presetTripId?: string;
  idPrefix?: string;
}

/** The Trip field every foreign-cash form shares. */
export function TripSelect({ id, value, onPick, financials }: { id: string; value: string; onPick: (v: string) => void; financials: LocalFinancials }) {
  const T = useTheme();
  const trips = financials.trips ?? [];
  if (trips.length === 0) return null;
  return (
    <div>
      <Label htmlFor={id}>Trip</Label>
      <select id={id} value={value} onChange={(e) => onPick(e.target.value)} className="w-full rounded-lg px-2 py-1.5 text-sm"
        style={{ background: T.ink, border: `1px solid ${T.line}`, color: T.text }}>
        <option value="">No trip</option>
        {trips.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
    </div>
  );
}

/** Record an exchange: ONE Wants/Travel row for what was paid, naming the euros received. */
export function ExchangeForm({ financials, onChange, onDone, presetTripId, idPrefix = "fx-ex" }: FormProps) {
  const T = useTheme();
  const lbpRate = financials.lbpRate ?? DEFAULT_LBP_RATE;
  const trips = financials.trips ?? [];
  const cards = financials.cards ?? [];
  const toUSD = makeToUSDForMonth(financials);
  const startDay = cycleStartDayOf(financials);

  const [exDate, setExDate] = useState(todayISO());
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [cardId, setCardId] = useState<string | null>(null);
  const [payNote, setPayNote] = useState("");
  const [paid, setPaid] = useState("");
  const [paidCurrency, setPaidCurrency] = useState<Currency>("USD");
  const [code, setCode] = useState("EUR");
  const [received, setReceived] = useState("");
  const [tripPick, setTripPick] = useState<string | null>(presetTripId ?? null);
  const exTrip = tripPick ?? suggestedTripId(trips, exDate || todayISO(), { orNext: true }) ?? "";
  const [error, setError] = useState("");
  const codeUpper = code.trim().toUpperCase();
  const paidUSD = num(paid) > 0 ? toUSD(num(paid), paidCurrency, cycleKeyForISO(exDate || todayISO(), startDay)) : NaN;
  const ratePreview = paidUSD > 0 && num(received) > 0 && isValidForeignCode(codeUpper)
    ? `You got ${fmtForeign(num(received) / paidUSD, codeUpper)} per $1 (${usd(paidUSD / num(received), 4)} per ${fmtForeign(1, codeUpper).replace(/\.00$/, "")})${paidCurrency === "LBP" ? ", at this period's L£ rate" : ""}.`
    : "";

  function saveCard(type: StoredCard["type"], last4: string): StoredCard | null {
    const saved = storeCard(cards, type, last4);
    if (!saved) return null;
    if (saved.cards !== cards) onChange({ ...financials, cards: saved.cards });
    return saved.card;
  }

  function save() {
    if (!isValidForeignCode(codeUpper)) { setError("Use a three-letter currency code other than USD or LBP, like EUR."); return; }
    if (!(num(paid) > 0) || !(num(received) > 0)) { setError("Enter both amounts."); return; }
    const card = payMethod === "card" && cardId ? cards.find((c) => c.id === cardId) : undefined;
    const row = buildExchange({
      date: exDate || todayISO(), paid: num(paid), paidCurrency,
      from: { paymentMethod: payMethod, ...(card ? { cardId: card.id, cardLabel: card.label } : {}) },
      code: codeUpper, received: num(received), description: `Exchange to ${codeUpper}`, ...(exTrip ? { tripId: exTrip } : {}),
    }, lbpRate);
    onChange({ ...financials, transactions: [...financials.transactions, row] });
    onDone();
  }

  return (
    <form aria-label="Record an exchange" className="space-y-2.5" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div>
        <Label htmlFor={`${idPrefix}-date`}>Date</Label>
        <DateFieldDMY id={`${idPrefix}-date`} value={exDate} onChange={setExDate} />
      </div>
      <PaymentMethodPicker value={payMethod} onChange={setPayMethod} cardId={cardId} onCardIdChange={setCardId}
        otherNote={payNote} onOtherNoteChange={setPayNote} cards={cards} onSaveCard={saveCard} />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor={`${idPrefix}-paid`}>Amount paid</Label>
          <MoneyInput id={`${idPrefix}-paid`} value={paid} onChange={setPaid} placeholder="0" max={moneyMaxFor(paidCurrency, lbpRate)} />
        </div>
        <div className="flex items-end"><CurrencyToggle value={paidCurrency} onChange={setPaidCurrency} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor={`${idPrefix}-code`}>Currency received</Label>
          <FocusInput id={`${idPrefix}-code`} value={code} onChange={(e) => setCode(e.target.value)} maxLength={3} autoComplete="off" />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-received`}>Amount received</Label>
          <MoneyInput id={`${idPrefix}-received`} value={received} onChange={setReceived} placeholder="0" max={moneyMaxFor("USD", lbpRate)} />
        </div>
      </div>
      <TripSelect id={`${idPrefix}-trip`} value={exTrip} onPick={setTripPick} financials={financials} />
      {ratePreview && <p className="text-[11px]" style={{ color: T.text }}>{ratePreview}</p>}
      {paidUSD > 0 && <p className="text-[11px]" style={{ color: T.text }}>{`Counts as Travel spending of ${usd(paidUSD)}.`}</p>}
      <div role="status">{error && <p className="text-[11px]" style={{ color: T.coral }}>{error}</p>}</div>
      <button type="submit" className="w-full py-2 rounded-xl text-sm font-semibold" style={{ background: T.jade, color: T.ink }}>Save exchange</button>
    </form>
  );
}

/** Spend from foreign cash: a sheet entry, not counted in the budget. Renders nothing with no sheet yet. */
export function SpendForm({ financials, onChange, onDone, presetTripId, idPrefix = "fx-sp" }: FormProps) {
  const T = useTheme();
  const lbpRate = financials.lbpRate ?? DEFAULT_LBP_RATE;
  const trips = financials.trips ?? [];
  const codes = sheetCodes(financials);
  const field = { background: T.ink, border: `1px solid ${T.line}`, color: T.text };

  const [spCode, setSpCode] = useState("");
  const spendCode = spCode || codes[0] || "";
  const [spDate, setSpDate] = useState(todayISO());
  const [spAmount, setSpAmount] = useState("");
  const [spCategory, setSpCategory] = useState("");
  const [spDesc, setSpDesc] = useState("");
  const [tripPick, setTripPick] = useState<string | null>(presetTripId ?? null);
  const spTrip = tripPick ?? suggestedTripId(trips, spDate || todayISO()) ?? "";
  const [error, setError] = useState("");
  const after = spendCode && num(spAmount) > 0 ? sheet(financials, spendCode, { through: spDate || todayISO() }).balance - num(spAmount) : 0;

  function save() {
    if (!(num(spAmount) > 0) || !spDesc.trim()) { setError("Enter the amount and a description."); return; }
    const entry = buildForeignEntry({
      kind: "spend", code: spendCode, amount: num(spAmount), date: spDate || todayISO(), description: spDesc.trim(),
      ...(spCategory ? { category: spCategory } : {}), ...(spTrip ? { tripId: spTrip } : {}),
    });
    onChange({ ...financials, foreignEntries: [...(financials.foreignEntries ?? []), entry] });
    onDone();
  }

  if (!spendCode) return null;
  return (
    <form aria-label="Spend from foreign cash" className="space-y-2.5" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor={`${idPrefix}-code`}>Currency</Label>
          <select id={`${idPrefix}-code`} value={spendCode} onChange={(e) => setSpCode(e.target.value)} className="w-full rounded-lg px-2 py-1.5 text-sm" style={field}>
            {codes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-date`}>Date</Label>
          <DateFieldDMY id={`${idPrefix}-date`} value={spDate} onChange={setSpDate} />
        </div>
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-amount`}>Amount</Label>
        <MoneyInput id={`${idPrefix}-amount`} value={spAmount} onChange={setSpAmount} placeholder="0" max={moneyMaxFor("USD", lbpRate)} />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-desc`}>Description</Label>
        <FocusInput id={`${idPrefix}-desc`} value={spDesc} onChange={(e) => setSpDesc(e.target.value)} />
      </div>
      <select value={spCategory} onChange={(e) => setSpCategory(e.target.value)} aria-label="Category"
        className="w-full rounded-lg px-2 py-1.5 text-[11px]" style={field}>
        <option value="">No category</option>
        {allCategories(financials.customCategories).map((c) => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
      </select>
      <TripSelect id={`${idPrefix}-trip`} value={spTrip} onPick={setTripPick} financials={financials} />
      <p className="text-[11px]" style={{ color: T.mute }}>Not counted in your budget: the exchange already was.</p>
      {after < 0 && <p className="text-[11px]" style={{ color: T.brass }}>{`That's ${fmtForeign(-after, spendCode)} more than this cash held on that date.`}</p>}
      <div role="status">{error && <p className="text-[11px]" style={{ color: T.coral }}>{error}</p>}</div>
      <button type="submit" className="w-full py-2 rounded-xl text-sm font-semibold" style={{ background: T.jade, color: T.ink }}>Save spend</button>
    </form>
  );
}
