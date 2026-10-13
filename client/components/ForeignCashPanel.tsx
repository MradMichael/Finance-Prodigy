"use client";

// Foreign cash, model 2 (session 18, held). Slice 1's approved sentences are
// kept where they still apply; every new one here was approved by the owner
// in session 19. The currency screen's foreign cash, as a sheet per currency
// (lib/foreignCash.ts):
//   - Record an exchange, Spend from foreign cash: the shared form components
//     (./ForeignCashForms; session 20: each trip card opens the same ones).
//   - Each sheet: its balance, and its lines with a running balance. A sheet
//     entry (a spend, cash received) can be deleted: re-entered to undo
//     (decision 7); exchange and change-back lines are ledger rows, deleted
//     from the transaction list.
//   - Change back: ONE reimbursement-shaped row (a TRANSFER that gained) on
//     the pool the money went to; it nets against Wants (session 19).
//   - A sheet entry is edited like any row (session 19): its ✎ ("Edit
//     entry") opens its form, filled in; "Save changes" saves it (approved
//     labels reused). The balance is derived, so it recalculates.
//   - Cash received (decision 4): a sheet entry in, with no USD effect.
import { useState } from "react";
import type { Currency, LocalFinancials, PaymentMethod, StoredCard } from "../lib/localData";
import { allCategories, fmtDate, moneyMaxFor, recordDeletion, todayISO, DEFAULT_LBP_RATE, saveCard as storeCard } from "../lib/localData";
import { useTheme } from "../contexts/ThemeContext";
import { Label, FocusInput, MoneyInput, DateFieldDMY, CurrencyToggle, PaymentMethodPicker } from "./form/Primitives";
import { buildChangeBack, buildForeignEntry, editForeignEntry, fmtForeign, isValidForeignCode, sheet, sheetCodes } from "../lib/foreignCash";
import { suggestedTripId } from "../lib/trips";
import { ExchangeForm, SpendForm, TripSelect } from "./ForeignCashForms";

const num = (s: string) => parseFloat(s.replace(/,/g, ""));
const signed = (n: number, code: string) => `${n < 0 ? "−" : "+"}${fmtForeign(Math.abs(n), code)}`;

export default function ForeignCashPanel({ financials, onChange }: { financials: LocalFinancials; onChange: (updated: LocalFinancials) => void }) {
  const T = useTheme();
  const lbpRate = financials.lbpRate ?? DEFAULT_LBP_RATE;
  const codes = sheetCodes(financials);
  const trips = financials.trips ?? [];
  const cards = financials.cards ?? [];
  const [open, setOpen] = useState<"exchange" | "spend" | "back" | "in" | null>(null);
  const field = { background: T.ink, border: `1px solid ${T.line}`, color: T.text };

  function saveCard(type: StoredCard["type"], last4: string): StoredCard | null {
    const saved = storeCard(cards, type, last4);
    if (!saved) return null;
    if (saved.cards !== cards) onChange({ ...financials, cards: saved.cards });
    return saved.card;
  }
  const poolFrom = (method: PaymentMethod, cardId: string | null) => {
    const card = method === "card" && cardId ? cards.find((c) => c.id === cardId) : undefined;
    return { paymentMethod: method, ...(card ? { cardId: card.id, cardLabel: card.label } : {}) };
  };
  const codeSelect = (id: string, value: string, onPick: (v: string) => void) => (
    <div>
      <Label htmlFor={id}>Currency</Label>
      <select id={id} value={value} onChange={(e) => onPick(e.target.value)} className="w-full rounded-lg px-2 py-1.5 text-sm" style={field}>
        {codes.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </div>
  );
  const shortBy = (code: string, date: string, amount: number) => {
    const after = code && amount > 0 ? sheet(financials, code, { through: date || todayISO() }).balance - amount : 0;
    return after < 0 ? <p className="text-[11px]" style={{ color: T.brass }}>{`That's ${fmtForeign(-after, code)} more than this cash held on that date.`}</p> : null;
  };

  // ── change back ──
  const [cbCode, setCbCode] = useState("");
  const backCode = cbCode || codes[0] || "";
  const [cbDate, setCbDate] = useState(todayISO());
  const [given, setGiven] = useState("");
  const [cbReceived, setCbReceived] = useState("");
  const [cbCurrency, setCbCurrency] = useState<Currency>("USD");
  const [cbMethod, setCbMethod] = useState<PaymentMethod>("cash");
  const [cbCardId, setCbCardId] = useState<string | null>(null);
  const [cbNote, setCbNote] = useState("");
  const [cbTripPick, setCbTripPick] = useState<string | null>(null);
  const cbTrip = cbTripPick ?? suggestedTripId(trips, cbDate || todayISO()) ?? "";
  const [cbError, setCbError] = useState("");

  function saveChangeBack() {
    if (!backCode) return;
    if (!(num(given) > 0) || !(num(cbReceived) > 0)) { setCbError("Enter both amounts."); return; }
    const row = buildChangeBack({
      date: cbDate || todayISO(), code: backCode, given: num(given), received: num(cbReceived), receivedCurrency: cbCurrency,
      to: poolFrom(cbMethod, cbCardId), description: `Changed back from ${backCode}`, ...(cbTrip ? { tripId: cbTrip } : {}),
    }, lbpRate);
    onChange({ ...financials, transactions: [...financials.transactions, row] });
    setGiven(""); setCbReceived(""); setCbError(""); setCbTripPick(null); setOpen(null);
  }

  // ── cash received ──
  const [inCode, setInCode] = useState<string | null>(null); // null: follow the first sheet (else EUR) until typed in
  const inCodeShown = inCode ?? (codes[0] || "EUR");
  const inCodeUpper = inCodeShown.trim().toUpperCase();
  const [inDate, setInDate] = useState(todayISO());
  const [inAmount, setInAmount] = useState("");
  const [inDesc, setInDesc] = useState("");
  const [inError, setInError] = useState("");

  function saveReceived() {
    if (!isValidForeignCode(inCodeUpper)) { setInError("Use a three-letter currency code other than USD or LBP, like EUR."); return; }
    if (!(num(inAmount) > 0) || !inDesc.trim()) { setInError("Enter the amount and a description."); return; }
    const entry = buildForeignEntry({ kind: "in", code: inCodeUpper, amount: num(inAmount), date: inDate || todayISO(), description: inDesc.trim() });
    onChange({ ...financials, foreignEntries: [...(financials.foreignEntries ?? []), entry] });
    setInAmount(""); setInDesc(""); setInError(""); setOpen(null);
  }

  // ── editing a sheet entry ──
  const [editing, setEditing] = useState<string | null>(null);
  const [edAmount, setEdAmount] = useState("");
  const [edDesc, setEdDesc] = useState("");
  const [edDate, setEdDate] = useState("");
  const [edCategory, setEdCategory] = useState("");
  const [edTrip, setEdTrip] = useState("");
  const [edError, setEdError] = useState("");

  function toggleEdit(id: string) {
    if (editing === id) { setEditing(null); return; }
    const e = (financials.foreignEntries ?? []).find((x) => x.id === id);
    if (!e) return;
    setEditing(id); setEdAmount(String(e.amount)); setEdDesc(e.description); setEdDate(e.date);
    setEdCategory(e.category ?? ""); setEdTrip(e.tripId ?? ""); setEdError("");
  }

  function saveEdit(id: string) {
    const r = editForeignEntry(financials, id, {
      amount: num(edAmount), description: edDesc, date: edDate,
      ...(edCategory ? { category: edCategory } : {}), ...(edTrip ? { tripId: edTrip } : {}),
    });
    if (!r.ok) { setEdError("Enter the amount and a description."); return; }
    onChange(r.data);
    setEditing(null);
  }

  function removeEntry(id: string) {
    if (!confirm("Delete this entry? To undo, enter it again.")) return;
    onChange({ ...financials, foreignEntries: (financials.foreignEntries ?? []).filter((e) => e.id !== id), deletedKeys: recordDeletion(financials, "foreignEntries", id, new Date()) });
  }

  const btn = (active: boolean) => ({ background: active ? T.jade + "22" : T.ink, border: `1px solid ${active ? T.jade : T.line}`, color: active ? T.jade : T.mute });
  const toggle = (which: NonNullable<typeof open>) => setOpen(open === which ? null : which);

  return (
    <div className="rounded-2xl p-5 space-y-4" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
      <div>
        <p className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>Foreign cash</p>
        <p className="text-[11px] mt-1" style={{ color: T.mute }}>
          Cash in another currency. Buying it counts as Travel spending when you exchange; spending it doesn&apos;t count again.
        </p>
      </div>

      {codes.map((c) => {
        const s = sheet(financials, c);
        return (
          <section key={c} aria-label={`${c} cash`} className="rounded-xl px-3 py-2 space-y-1.5" style={{ background: T.ink, border: `1px solid ${T.line}` }}>
            <p className="text-sm tabular-nums" style={{ color: T.text }}>{`${c} cash · balance ${fmtForeign(s.balance, c)}`}</p>
            <ul className="space-y-1">
              {s.lines.map((l) => (
                <li key={l.id} className="text-[11px] tabular-nums flex items-center justify-between gap-2" style={{ color: T.mute }}>
                  <span>{`${fmtDate(l.date)} · ${l.description}`}</span>
                  <span className="flex items-center gap-2">
                    <span style={{ color: l.delta < 0 ? T.text : T.jade }}>{signed(l.delta, c)}</span>
                    <span>{fmtForeign(l.balance, c)}</span>
                    {(l.source === "spend" || l.source === "in") && (
                      <>
                        <button type="button" onClick={() => toggleEdit(l.id)} aria-label="Edit entry" aria-expanded={editing === l.id}
                          className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: T.brass, border: `1px solid ${T.brass}40` }}>✎</button>
                        <button type="button" onClick={() => removeEntry(l.id)} className="underline" style={{ color: T.coral }}>Delete</button>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {editing && s.lines.some((l) => l.id === editing) && (
              <form aria-label="Edit entry" className="space-y-2.5 pt-2" style={{ borderTop: `1px solid ${T.line}` }} onSubmit={(e) => { e.preventDefault(); saveEdit(editing); }}>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="fx-ed-amount">Amount</Label>
                    <MoneyInput id="fx-ed-amount" value={edAmount} onChange={setEdAmount} placeholder="0" max={moneyMaxFor("USD", lbpRate)} />
                  </div>
                  <div>
                    <Label htmlFor="fx-ed-date">Date</Label>
                    <DateFieldDMY id="fx-ed-date" value={edDate} onChange={setEdDate} />
                  </div>
                </div>
                <div>
                  <Label htmlFor="fx-ed-desc">Description</Label>
                  <FocusInput id="fx-ed-desc" value={edDesc} onChange={(e) => setEdDesc(e.target.value)} />
                </div>
                <select value={edCategory} onChange={(e) => setEdCategory(e.target.value)} aria-label="Category"
                  className="w-full rounded-lg px-2 py-1.5 text-[11px]" style={field}>
                  <option value="">No category</option>
                  {allCategories(financials.customCategories).map((cat) => <option key={cat.value} value={cat.value}>{cat.icon} {cat.label}</option>)}
                </select>
                <TripSelect id="fx-ed-trip" value={edTrip} onPick={setEdTrip} financials={financials} />
                <div role="status">{edError && <p className="text-[11px]" style={{ color: T.coral }}>{edError}</p>}</div>
                <button type="submit" className="w-full py-2 rounded-xl text-sm font-semibold" style={{ background: T.jade, color: T.ink }}>Save changes</button>
              </form>
            )}
          </section>
        );
      })}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => toggle("exchange")} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={btn(open === "exchange")}>Record an exchange</button>
        {codes.length > 0 && (
          <>
            <button type="button" onClick={() => toggle("spend")} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={btn(open === "spend")}>Spend from foreign cash</button>
            <button type="button" onClick={() => toggle("back")} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={btn(open === "back")}>Change back</button>
          </>
        )}
        <button type="button" onClick={() => toggle("in")} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={btn(open === "in")}>Cash received</button>
      </div>

      {open === "exchange" && <ExchangeForm financials={financials} onChange={onChange} onDone={() => setOpen(null)} />}

      {open === "spend" && <SpendForm financials={financials} onChange={onChange} onDone={() => setOpen(null)} />}

      {open === "back" && backCode && (
        <form aria-label="Change back" className="space-y-2.5" onSubmit={(e) => { e.preventDefault(); saveChangeBack(); }}>
          <div className="grid grid-cols-2 gap-2">
            {codeSelect("fx-cb-code", backCode, setCbCode)}
            <div>
              <Label htmlFor="fx-cb-date">Date</Label>
              <DateFieldDMY id="fx-cb-date" value={cbDate} onChange={setCbDate} />
            </div>
          </div>
          <div>
            <Label htmlFor="fx-cb-given">Amount changed back</Label>
            <MoneyInput id="fx-cb-given" value={given} onChange={setGiven} placeholder="0" max={moneyMaxFor("USD", lbpRate)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="fx-cb-received">Amount received</Label>
              <MoneyInput id="fx-cb-received" value={cbReceived} onChange={setCbReceived} placeholder="0" max={moneyMaxFor(cbCurrency, lbpRate)} />
            </div>
            <div className="flex items-end"><CurrencyToggle value={cbCurrency} onChange={setCbCurrency} /></div>
          </div>
          <PaymentMethodPicker value={cbMethod} onChange={setCbMethod} cardId={cbCardId} onCardIdChange={setCbCardId}
            otherNote={cbNote} onOtherNoteChange={setCbNote} cards={cards} onSaveCard={saveCard} />
          <TripSelect id="fx-cb-trip" value={cbTrip} onPick={setCbTripPick} financials={financials} />
          {shortBy(backCode, cbDate, num(given))}
          <div role="status">{cbError && <p className="text-[11px]" style={{ color: T.coral }}>{cbError}</p>}</div>
          <button type="submit" className="w-full py-2 rounded-xl text-sm font-semibold" style={{ background: T.jade, color: T.ink }}>Save change-back</button>
        </form>
      )}

      {open === "in" && (
        <form aria-label="Cash received" className="space-y-2.5" onSubmit={(e) => { e.preventDefault(); saveReceived(); }}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="fx-in-code">Currency</Label>
              <FocusInput id="fx-in-code" value={inCodeShown} onChange={(e) => setInCode(e.target.value)} maxLength={3} autoComplete="off" />
            </div>
            <div>
              <Label htmlFor="fx-in-date">Date</Label>
              <DateFieldDMY id="fx-in-date" value={inDate} onChange={setInDate} />
            </div>
          </div>
          <div>
            <Label htmlFor="fx-in-amount">Amount</Label>
            <MoneyInput id="fx-in-amount" value={inAmount} onChange={setInAmount} placeholder="0" max={moneyMaxFor("USD", lbpRate)} />
          </div>
          <div>
            <Label htmlFor="fx-in-desc">Description</Label>
            <FocusInput id="fx-in-desc" value={inDesc} onChange={(e) => setInDesc(e.target.value)} />
          </div>
          <div role="status">{inError && <p className="text-[11px]" style={{ color: T.coral }}>{inError}</p>}</div>
          <button type="submit" className="w-full py-2 rounded-xl text-sm font-semibold" style={{ background: T.jade, color: T.ink }}>Save cash received</button>
        </form>
      )}
    </div>
  );
}
