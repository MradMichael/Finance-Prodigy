"use client";

// InputPanel split, S8 (session 55): My Finances' Debts section, moved here line for line. The section's header
// (title and count) stays in InputPanel; a closed section doesn't build this at all.
import { useState } from "react";
import type { LocalFinancials, Currency, StoredDebt, PaymentMethod } from "../../lib/localData";
import { uid, withRate, lbpRateOf, edited, recordDeletion, moneyMaxFor, debtPayoff, derivedDebtBalance, fmtDate, todayISO, buildLoanReceiptTx, hasLoanReceipt } from "../../lib/localData";
import { looksLikeMistypedLbp } from "../../lib/entryGuards";
import { useTheme } from "../../contexts/ThemeContext";
import { fmtCur } from "../screens/shared";
import { Label, FocusInput, MoneyInput, PrimaryBtn, CurrencyToggle, DateFieldDMY } from "../form/Primitives";

/** Debts: its form's state. InputPanel calls this, so the state lives there and what is typed survives closing the section, as before the move. */
export function useDebtForm() {
  // Debt form
  const [dName,    setDName]    = useState("");
  const [dBalance, setDBalance] = useState("");
  const [dApr,     setDApr]     = useState("");
  const [dMin,     setDMin]     = useState("");
  const [dCurrency, setDCurrency] = useState<Currency>("USD");
  // Debt payment lives in the shared PayDebtSheet (page.tsx).
  // Debt editing itself now lives in the shared EditDebtSheet (page.tsx) --
  // see the "usability backlog" comment there. dOpenedDate below is the New
  // Debt form's own field, unrelated to editing an existing one.
  const [dOpenedDate,      setDOpenedDate]      = useState("");
  // Session 69 (step B): "Money received into (optional)": "" (Not recorded), "cash", or "card:<id>".
  const [dReceivedInto, setDReceivedInto] = useState("");
  return { dName, setDName, dBalance, setDBalance, dApr, setDApr, dMin, setDMin, dCurrency, setDCurrency, dOpenedDate, setDOpenedDate, dReceivedInto, setDReceivedInto };
}

export default function DebtsSection({ financials, update, lbpRate, onEdit, onPay, form, setLbpConfirm }: {
  financials: LocalFinancials;
  update: (patch: Partial<LocalFinancials>) => void;
  lbpRate: number;
  onEdit: (kind: "debt", id: string) => void;
  onPay: (debtId: string) => void;
  form: ReturnType<typeof useDebtForm>;
  /** Session 69 (step B): the panel's lira check, asked when the money received goes into a pool. */
  setLbpConfirm: (v: { amount: number; proceed: () => void } | null) => void;
}) {
  const T = useTheme();
  const { dName, setDName, dBalance, setDBalance, dApr, setDApr, dMin, setDMin, dCurrency, setDCurrency, dOpenedDate, setDOpenedDate, dReceivedInto, setDReceivedInto } = form;

  // Session 68's plan, step B (owner approved, session 69): where the money borrowed arrived, if the person says.
  // Cash or a saved card; anything else (Not recorded, a card since removed) records no money received.
  const cards = financials.cards ?? [];
  const receivedCard = dReceivedInto.startsWith("card:") ? cards.find((c) => c.id === dReceivedInto.slice(5)) : undefined;
  const pool: { paymentMethod: PaymentMethod; cardId?: string; cardLabel?: string; label: string } | null =
    dReceivedInto === "cash" ? { paymentMethod: "cash", label: "Cash" }
    : receivedCard ? { paymentMethod: "card", cardId: receivedCard.id, cardLabel: receivedCard.label, label: receivedCard.label }
    : null;
  const typedBalance = parseFloat(dBalance.replace(/,/g, "")) || 0;
  // The opened date if one is typed and it isn't in the future; otherwise today.
  const receiptDate = dOpenedDate && dOpenedDate <= todayISO() ? dOpenedDate : todayISO();

  function addDebt() {
    if (!dName.trim() || !dBalance) return;
    const balance = parseFloat(dBalance.replace(/,/g, ""));
    // With a pool picked, a mistyped lira balance would also land in Cash or the card: the lira check asks first.
    if (pool && looksLikeMistypedLbp(balance, dCurrency)) { setLbpConfirm({ amount: balance, proceed: () => commitDebt(balance) }); return; }
    commitDebt(balance);
  }

  function commitDebt(balance: number) {
    const debt: StoredDebt = {
      id: uid(), name: dName.trim(),
      balance,
      apr: Math.max(0, parseFloat(dApr) || 0),
      minPayment: parseFloat(dMin.replace(/,/g, "")) || 0,
      // Same reasoning as addGoal's currency field -- see its comment.
      currency: dCurrency,
      ...withRate(dCurrency, lbpRateOf(financials)),
      createdAt: new Date().toISOString(),
      ...(dOpenedDate ? { openedDate: dOpenedDate } : {}),
      // Phase 2.6.1 -- a brand-new debt has no history yet, so its own
      // starting balance IS its opening balance, trivially.
      openingBalance: balance,
    };
    // The debt and the money received in ONE update: one save, one sync push.
    const receipt = pool && balance > 0 ? buildLoanReceiptTx(debt, pool, lbpRateOf(financials), receiptDate) : null;
    update({ debts: [...financials.debts, edited(debt)], ...(receipt ? { transactions: [receipt, ...financials.transactions] } : {}) });
    setDName(""); setDBalance(""); setDApr(""); setDMin(""); setDOpenedDate(""); setDCurrency("USD"); setDReceivedInto("");
  }

  return (
    <>
      {financials.debts.map((d) => {
        // Phase 2.6.3a: derived once per row from openingBalance + the
        // linked transaction ledger, not read from the stored `balance`
        // field.
        const balance = derivedDebtBalance(d, financials.transactions, financials);
        const payoff = debtPayoff(d, financials.transactions, financials); // DI-01 (session 30): from the balance, not a stored flag
        return (
          <div key={d.id}>
            <div
              className="rounded-xl px-3 py-2.5 group"
              style={{
                background: T.panelSoft,
                borderLeft: `3px solid ${payoff.paidOff ? T.jade : T.coral}`,
                opacity: payoff.paidOff ? 0.65 : 1,
              }}
            >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm flex items-center gap-1.5 min-w-0" style={{ color: T.text }}>
                      <span className="truncate">{d.name}</span>
                      {payoff.paidOff && (
                        <span className="flex-shrink-0 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: T.jade + "22", color: T.jade }}>Paid off</span>
                      )}
                    </p>
                    <p className="text-[10px] tabular-nums mt-0.5" style={{ color: T.mute }}>
                      {fmtCur(balance, d.currency)} · {d.apr}% APR · min {fmtCur(d.minPayment, d.currency)}/mo
                    </p>
                    {(d.openedDate || d.createdAt || payoff.on) && (
                      <p className="text-[9px] mt-1" style={{ color: T.mute }}>
                        {d.openedDate && <span>Opened {fmtDate(d.openedDate)}</span>}
                        {d.openedDate && d.createdAt && <span> · </span>}
                        {d.createdAt && <span>Added {fmtDate(d.createdAt)}</span>}
                        {payoff.on && <span style={{ color: T.jade }}> · Paid {fmtDate(payoff.on)}</span>}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 opacity-70 transition-opacity flex-shrink-0 ml-2">
                    <button
                      onClick={() => onEdit("debt", d.id)}
                      aria-label="Edit debt"
                      className="text-[10px] px-1.5 py-0.5 rounded transition-all hover:opacity-80"
                      style={{ color: T.brass, border: `1px solid ${T.brass}40` }}
                    >✎</button>
                    {!payoff.paidOff && (
                      <button
                        onClick={() => onPay(d.id)}
                        aria-label="Record a payment"
                        className="text-[10px] px-1.5 py-0.5 rounded transition-all hover:opacity-80"
                        style={{ color: T.jade, border: `1px solid ${T.jade}40` }}
                      >pay</button>
                    )}
                    <button
                      onClick={() => { if (confirm(hasLoanReceipt(d.id, financials.transactions) ? "Delete this debt? The money you received for it stays in your entries." : "Delete this debt?")) update({ debts: financials.debts.filter((x) => x.id !== d.id), deletedKeys: recordDeletion(financials, "debts", d.id) }); }}
                      aria-label="Delete debt"
                      className="text-xs"
                      style={{ color: T.coral }}
                    >✕</button>
                  </div>
                </div>
              </div>
          </div>
        );
      })}

      <div
        className="rounded-xl p-4 space-y-3"
        style={{ background: T.ink, border: `1px solid ${T.line}` }}
      >
        <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.coral }}>
          New debt
        </p>
        <div>
          <Label htmlFor="new-debt-name">Name</Label>
          <FocusInput id="new-debt-name" value={dName} onChange={(e) => setDName(e.target.value)} placeholder="Credit card, car loan…" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label htmlFor="new-debt-balance">Balance ({dCurrency === "LBP" ? "L£" : "$"})</Label>
            <MoneyInput id="new-debt-balance" value={dBalance} onChange={setDBalance} placeholder="0" max={moneyMaxFor(dCurrency, lbpRate)} />
          </div>
          <div>
            <Label htmlFor="new-debt-apr">APR (%)</Label>
            <FocusInput id="new-debt-apr" type="number" inputMode="decimal" min="0" step="0.1" value={dApr} onChange={(e) => setDApr(e.target.value)} placeholder="20" />
          </div>
          <div>
            <Label htmlFor="new-debt-min">Min/mo</Label>
            <MoneyInput id="new-debt-min" value={dMin} onChange={setDMin} placeholder="25" max={moneyMaxFor(dCurrency, lbpRate)} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <Label htmlFor="new-debt-opened">Opened date (optional: when this debt started)</Label>
            <DateFieldDMY id="new-debt-opened" value={dOpenedDate} onChange={setDOpenedDate} />
          </div>
          <div>
            <Label>Currency</Label>
            <CurrencyToggle value={dCurrency} onChange={setDCurrency} />
          </div>
        </div>
        <div>
          <Label htmlFor="new-debt-received">Money received into (optional)</Label>
          <select
            id="new-debt-received"
            value={dReceivedInto}
            onChange={(e) => setDReceivedInto(e.target.value)}
            aria-describedby={pool && typedBalance > 0 ? "new-debt-received-line" : undefined}
            className="w-full rounded-xl px-3 py-2.5 text-sm"
            style={{ background: T.panelSoft, border: `1px solid ${T.line}`, color: T.text, outline: "none", colorScheme: "dark" }}
          >
            <option value="">Not recorded</option>
            <option value="cash">Cash</option>
            {cards.map((c) => <option key={c.id} value={`card:${c.id}`}>{c.label}</option>)}
          </select>
          {pool && typedBalance > 0 && (
            <p id="new-debt-received-line" className="text-[11px] mt-1.5 px-1" style={{ color: T.mute }}>
              {`Adds ${fmtCur(typedBalance, dCurrency)} to ${pool.label} on ${fmtDate(receiptDate)}. Not counted as income.`}
            </p>
          )}
        </div>
        <PrimaryBtn onClick={addDebt} color={T.coral} disabled={!dName.trim() || !dBalance}>+ Add debt</PrimaryBtn>
      </div>
    </>
  );
}
