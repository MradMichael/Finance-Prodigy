"use client";

// Travel slice 1 (every sentence here approved by the owner, session 15):
// foreign cash on the currency screen (lib/foreignCash.ts).
//   - Record an exchange: two linked rows (the source leg on its pool, the
//     pocket leg with the amount received). Past dates are allowed: the
//     owner may have changed money already.
//   - Each pocket: its balance, what it cost, and the average cost.
//   - Spend from foreign cash: one ordinary USD row at the pocket's average
//     cost on its date, frozen; shown before saving. With no price for that
//     date, the form asks what one unit cost.
import { useState } from "react";
import type { Currency, LocalFinancials, PaymentMethod, StoredCard } from "../lib/localData";
import { allCategories, cycleStartDayOf, makeToUSDForMonth, moneyMaxFor, todayISO, DEFAULT_LBP_RATE, saveCard as storeCard } from "../lib/localData";
import { cycleKeyForISO } from "../lib/period";
import { useTheme } from "../contexts/ThemeContext";
import { Label, FocusInput, MoneyInput, DateFieldDMY, CurrencyToggle, PaymentMethodPicker } from "./form/Primitives";
import { buildExchange, buildPocketSpend, fmtForeign, isValidForeignCode, pocketState, pockets, priceSpend } from "../lib/foreignCash";
import { suggestedTripId } from "../lib/trips";

const usd = (n: number, digits = 2) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
const num = (s: string) => parseFloat(s.replace(/,/g, ""));
const SPEND_BUCKETS = [
  { value: "NEEDS", label: "Needs", icon: "🏠" },
  { value: "WANTS", label: "Wants", icon: "✨" },
  { value: "SAVINGS", label: "Savings", icon: "💰" },
] as const;

export default function ForeignCashPanel({ financials, onChange }: { financials: LocalFinancials; onChange: (updated: LocalFinancials) => void }) {
  const T = useTheme();
  const lbpRate = financials.lbpRate ?? DEFAULT_LBP_RATE;
  const held = pockets(financials);
  const [open, setOpen] = useState<"exchange" | "spend" | null>(null);

  // ── exchange ──
  const [exDate, setExDate] = useState(todayISO());
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [cardId, setCardId] = useState<string | null>(null);
  const [payNote, setPayNote] = useState("");
  const [paid, setPaid] = useState("");
  const [paidCurrency, setPaidCurrency] = useState<Currency>("USD");
  const [code, setCode] = useState("EUR");
  const [received, setReceived] = useState("");
  // Travel slice 2 (held): the trip, defaulting to the one whose dates hold the form's date until one is chosen.
  const trips = financials.trips ?? [];
  const [exTripPick, setExTripPick] = useState<string | null>(null);
  const exTrip = exTripPick ?? suggestedTripId(trips, exDate || todayISO()) ?? "";
  const [exError, setExError] = useState("");
  const cards = financials.cards ?? [];
  const toUSD = makeToUSDForMonth(financials);
  const startDay = cycleStartDayOf(financials);
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

  function saveExchange() {
    if (!isValidForeignCode(codeUpper)) { setExError("Use a three-letter currency code other than USD or LBP, like EUR."); return; }
    if (!(num(paid) > 0) || !(num(received) > 0)) { setExError("Enter both amounts."); return; }
    const card = payMethod === "card" && cardId ? cards.find((c) => c.id === cardId) : undefined;
    const rows = buildExchange({
      date: exDate || todayISO(), paid: num(paid), paidCurrency,
      from: { paymentMethod: payMethod, ...(card ? { cardId: card.id, cardLabel: card.label } : {}) },
      code: codeUpper, received: num(received), description: `Exchange to ${codeUpper}`,
    }, lbpRate).map((t) => (exTrip ? { ...t, tripId: exTrip } : t));
    onChange({ ...financials, transactions: [...financials.transactions, ...rows] });
    setPaid(""); setReceived(""); setExError(""); setExTripPick(null); setOpen(null);
  }

  // ── spend ──
  const [spCode, setSpCode] = useState<string>("");
  const pocketCode = spCode || held[0]?.code || "";
  const [spDate, setSpDate] = useState(todayISO());
  const [spAmount, setSpAmount] = useState("");
  const [spBucket, setSpBucket] = useState<"NEEDS" | "WANTS" | "SAVINGS">("WANTS");
  const [spCategory, setSpCategory] = useState("");
  const [spDesc, setSpDesc] = useState("");
  const [spRate, setSpRate] = useState("");
  const [spTripPick, setSpTripPick] = useState<string | null>(null);
  const spTrip = spTripPick ?? suggestedTripId(trips, spDate || todayISO()) ?? "";
  const [spError, setSpError] = useState("");
  const price = pocketCode ? priceSpend(financials, pocketCode, spDate || todayISO()) : null;
  const typedRate = num(spRate);
  const cost = price?.costPerUnitUSD ?? (typedRate > 0 ? typedRate : null);
  const unit = pocketCode ? fmtForeign(1, pocketCode).replace(/\.00$/, "") : "";
  const after = pocketCode && num(spAmount) > 0 ? pocketState(financials, pocketCode, { through: spDate || todayISO() }).balance - num(spAmount) : 0;

  function saveSpend() {
    if (!pocketCode) return;
    if (!(num(spAmount) > 0) || !spDesc.trim()) { setSpError("Enter the amount and a description."); return; }
    if (cost === null) { setSpError(`Enter what ${unit} cost you.`); return; }
    const row = buildPocketSpend({
      date: spDate || todayISO(), code: pocketCode, amount: num(spAmount), bucket: spBucket,
      ...(spCategory ? { category: spCategory } : {}), description: spDesc.trim(), costPerUnitUSD: cost,
    });
    if (spTrip) row.tripId = spTrip;
    onChange({ ...financials, transactions: [...financials.transactions, row] });
    setSpAmount(""); setSpDesc(""); setSpRate(""); setSpError(""); setSpTripPick(null); setOpen(null);
  }

  const btn = (active: boolean) => ({ background: active ? T.jade + "22" : T.ink, border: `1px solid ${active ? T.jade : T.line}`, color: active ? T.jade : T.mute });

  return (
    <div className="rounded-2xl p-5 space-y-4" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
      <div>
        <p className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>Foreign cash</p>
        <p className="text-[11px] mt-1" style={{ color: T.mute }}>
          Cash in another currency, at what it cost you. Spending it counts in your budget at that cost.
        </p>
      </div>

      {held.length > 0 && (
        <ul className="space-y-1.5">
          {held.map((p) => (
            <li key={p.code} className="rounded-xl px-3 py-2" style={{ background: T.ink, border: `1px solid ${T.line}` }}>
              <p className="text-sm tabular-nums" style={{ color: T.text }}>{`${p.code} cash: ${fmtForeign(p.balance, p.code)}`}</p>
              <p className="text-[11px] tabular-nums" style={{ color: T.mute }}>
                {`Cost ${usd(p.basisUSD)}${p.averageCostUSD !== null ? ` · ${usd(p.averageCostUSD, 4)} per ${fmtForeign(1, p.code).replace(/\.00$/, "")}` : ""}`}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setOpen(open === "exchange" ? null : "exchange")} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={btn(open === "exchange")}>
          Record an exchange
        </button>
        {held.length > 0 && (
          <button type="button" onClick={() => setOpen(open === "spend" ? null : "spend")} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={btn(open === "spend")}>
            Spend from foreign cash
          </button>
        )}
      </div>

      {open === "exchange" && (
        <form aria-label="Record an exchange" className="space-y-2.5" onSubmit={(e) => { e.preventDefault(); saveExchange(); }}>
          <div>
            <Label htmlFor="fx-ex-date">Date</Label>
            <DateFieldDMY id="fx-ex-date" value={exDate} onChange={setExDate} />
          </div>
          <PaymentMethodPicker value={payMethod} onChange={setPayMethod} cardId={cardId} onCardIdChange={setCardId}
            otherNote={payNote} onOtherNoteChange={setPayNote} cards={cards} onSaveCard={saveCard} />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="fx-ex-paid">Amount paid</Label>
              <MoneyInput id="fx-ex-paid" value={paid} onChange={setPaid} placeholder="0" max={moneyMaxFor(paidCurrency, lbpRate)} />
            </div>
            <div className="flex items-end"><CurrencyToggle value={paidCurrency} onChange={setPaidCurrency} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="fx-ex-code">Currency received</Label>
              <FocusInput id="fx-ex-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={3} autoComplete="off" />
            </div>
            <div>
              <Label htmlFor="fx-ex-received">Amount received</Label>
              <MoneyInput id="fx-ex-received" value={received} onChange={setReceived} placeholder="0" max={moneyMaxFor("USD", lbpRate)} />
            </div>
          </div>
          {trips.length > 0 && (
            <div>
              <Label htmlFor="fx-ex-trip">Trip</Label>
              <select id="fx-ex-trip" value={exTrip} onChange={(e) => setExTripPick(e.target.value)} className="w-full rounded-lg px-2 py-1.5 text-sm" style={{ background: T.ink, border: `1px solid ${T.line}`, color: T.text }}>
                <option value="">No trip</option>
                {trips.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </div>
          )}
          {ratePreview && <p className="text-[11px]" style={{ color: T.text }}>{ratePreview}</p>}
          <div role="status">{exError && <p className="text-[11px]" style={{ color: T.coral }}>{exError}</p>}</div>
          <button type="submit" className="w-full py-2 rounded-xl text-sm font-semibold" style={{ background: T.jade, color: T.ink }}>Save exchange</button>
        </form>
      )}

      {open === "spend" && pocketCode && (
        <form aria-label="Spend from foreign cash" className="space-y-2.5" onSubmit={(e) => { e.preventDefault(); saveSpend(); }}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="fx-sp-code">Currency</Label>
              <select id="fx-sp-code" value={pocketCode} onChange={(e) => setSpCode(e.target.value)}
                className="w-full rounded-lg px-2 py-1.5 text-sm" style={{ background: T.ink, border: `1px solid ${T.line}`, color: T.text }}>
                {held.map((p) => <option key={p.code} value={p.code}>{p.code}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="fx-sp-date">Date</Label>
              <DateFieldDMY id="fx-sp-date" value={spDate} onChange={setSpDate} />
            </div>
          </div>
          <div>
            <Label htmlFor="fx-sp-amount">Amount</Label>
            <MoneyInput id="fx-sp-amount" value={spAmount} onChange={setSpAmount} placeholder="0" max={moneyMaxFor("USD", lbpRate)} />
          </div>
          <div>
            <Label htmlFor="fx-sp-desc">Description</Label>
            <FocusInput id="fx-sp-desc" value={spDesc} onChange={(e) => setSpDesc(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {SPEND_BUCKETS.map((b) => (
              <button key={b.value} type="button" onClick={() => setSpBucket(b.value)} aria-pressed={spBucket === b.value}
                className="py-1.5 rounded-lg text-[11px] font-medium" style={btn(spBucket === b.value)}>{b.icon} {b.label}</button>
            ))}
          </div>
          {trips.length > 0 && (
            <div>
              <Label htmlFor="fx-sp-trip">Trip</Label>
              <select id="fx-sp-trip" value={spTrip} onChange={(e) => setSpTripPick(e.target.value)} className="w-full rounded-lg px-2 py-1.5 text-sm" style={{ background: T.ink, border: `1px solid ${T.line}`, color: T.text }}>
                <option value="">No trip</option>
                {trips.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </div>
          )}
          <select value={spCategory} onChange={(e) => setSpCategory(e.target.value)} aria-label="Category"
            className="w-full rounded-lg px-2 py-1.5 text-[11px]" style={{ background: T.ink, border: `1px solid ${T.line}`, color: T.text }}>
            <option value="">No category</option>
            {allCategories(financials.customCategories).map((c) => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
          </select>
          {price === null && (
            <div>
              <Label htmlFor="fx-sp-rate">{`What did ${unit} cost you, in $?`}</Label>
              <FocusInput id="fx-sp-rate" value={spRate} onChange={(e) => setSpRate(e.target.value)} inputMode="decimal" autoComplete="off" />
            </div>
          )}
          {cost !== null && num(spAmount) > 0 && (
            <p className="text-[11px]" style={{ color: T.text }}>{`Counts as ${usd(Math.round(num(spAmount) * cost * 100) / 100)} (${usd(cost, 4)} per ${unit}).`}</p>
          )}
          {after < 0 && (
            <p className="text-[11px]" style={{ color: T.brass }}>{`That's ${fmtForeign(-after, pocketCode)} more than this cash held on that date.`}</p>
          )}
          <div role="status">{spError && <p className="text-[11px]" style={{ color: T.coral }}>{spError}</p>}</div>
          <button type="submit" className="w-full py-2 rounded-xl text-sm font-semibold" style={{ background: T.jade, color: T.ink }}>Save spend</button>
        </form>
      )}
    </div>
  );
}
