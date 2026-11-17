"use client";

// InputPanel split, S7 (session 55): My Finances' Transfer section, moved here line for line. The section's
// header stays in InputPanel; a closed section doesn't build this at all.
import { useState } from "react";
import type { LocalFinancials, Currency, PaymentMethod, StoredCard } from "../../lib/localData";
import { todayISO, lbpRateOf, buildTransferTx, moneyMaxFor } from "../../lib/localData";
import { useTheme } from "../../contexts/ThemeContext";
import { fmtCur } from "../screens/shared";
import { Label, MoneyInput, PrimaryBtn, CurrencyToggle, DateFieldDMY, PaymentMethodPicker } from "../form/Primitives";

/** Transfer: its form's state. InputPanel calls this, so the state lives there and what is typed survives closing the section, as before the move. */
export function useTransferForm() {
  // Transfer form (2.4.55 sub-phase 2) -- source pool -> destination pool.
  // Both sides reuse PaymentMethodPicker (cash/card/other), not a
  // TrackedBalance picker -- see buildTransferTx's doc comment for why: a
  // transfer's real identity is the (paymentMethod, cardId) pair
  // expectedFromRelevantTx already groups by, and most payment methods have
  // no TrackedBalance overlay at all. The Safety net deliberately has no
  // slot here -- it stays on SetupScreen's own efAmount checkbox, since an
  // EF contribution/withdrawal is a real Savings/Needs budget event, not a
  // transfer (see the note rendered in the section body below).
  const [trAmt,           setTrAmt]           = useState("");
  const [trCurrency,      setTrCurrency]      = useState<Currency>("USD");
  const [trDate,          setTrDate]          = useState(todayISO());
  const [trFromMethod,    setTrFromMethod]    = useState<PaymentMethod>("cash");
  const [trFromCardId,    setTrFromCardId]    = useState<string | null>(null);
  const [trFromOtherNote, setTrFromOtherNote] = useState("");
  const [trToMethod,      setTrToMethod]      = useState<PaymentMethod>("card");
  const [trToCardId,      setTrToCardId]      = useState<string | null>(null);
  const [trToOtherNote,   setTrToOtherNote]   = useState("");
  return { trAmt, setTrAmt, trCurrency, setTrCurrency, trDate, setTrDate, trFromMethod, setTrFromMethod, trFromCardId, setTrFromCardId, trFromOtherNote, setTrFromOtherNote, trToMethod, setTrToMethod, trToCardId, setTrToCardId, trToOtherNote, setTrToOtherNote };
}

export default function TransferSection({ financials, update, lbpRate, cards, saveCard, showToast, form }: {
  financials: LocalFinancials;
  update: (patch: Partial<LocalFinancials>) => void;
  lbpRate: number;
  cards: StoredCard[];
  saveCard: (type: StoredCard["type"], last4: string) => StoredCard | null;
  showToast: (msg: string) => void;
  form: ReturnType<typeof useTransferForm>;
}) {
  const T = useTheme();
  const { trAmt, setTrAmt, trCurrency, setTrCurrency, trDate, setTrDate, trFromMethod, setTrFromMethod, trFromCardId, setTrFromCardId, trFromOtherNote, setTrFromOtherNote, trToMethod, setTrToMethod, trToCardId, setTrToCardId, trToOtherNote, setTrToOtherNote } = form;

  // Human-readable pool name for a transfer leg's own "Transfer to/from X"
  // description -- not the same lookup as CardPicker's own label rendering,
  // since "other" has no persisted record to read a label from.
  function transferPoolLabel(method: PaymentMethod, cardId: string | null, otherNote: string): string {
    if (method === "cash") return "Cash";
    if (method === "card") return cards.find((c) => c.id === cardId)?.label ?? "Card";
    return otherNote.trim() || "Other";
  }

  // True once source and destination resolve to the same (paymentMethod,
  // cardId) pair -- buildTransferTx deliberately leaves this check to the
  // caller (a same-pool "transfer" is a no-op, its job isn't to guess at
  // UI validation). Cash===Cash and Other===Other always collide (neither
  // has a second identity to tell two selections apart); Card===Card only
  // collides once both sides have actually picked the same saved card.
  function transferSamePool(): boolean {
    if (trFromMethod !== trToMethod) return false;
    if (trFromMethod === "card") return !!trFromCardId && trFromCardId === trToCardId;
    return true;
  }

  function addTransfer() {
    const amt = parseFloat(trAmt.replace(/,/g, ""));
    if (!amt || amt <= 0) return;
    if (trFromMethod === "card" && !trFromCardId) return;
    if (trToMethod === "card" && !trToCardId) return;
    if (transferSamePool()) return;
    const source = {
      paymentMethod: trFromMethod,
      label: transferPoolLabel(trFromMethod, trFromCardId, trFromOtherNote),
      ...(trFromMethod === "card" && trFromCardId
        ? { cardId: trFromCardId, cardLabel: cards.find((c) => c.id === trFromCardId)?.label }
        : {}),
    };
    const dest = {
      paymentMethod: trToMethod,
      label: transferPoolLabel(trToMethod, trToCardId, trToOtherNote),
      ...(trToMethod === "card" && trToCardId
        ? { cardId: trToCardId, cardLabel: cards.find((c) => c.id === trToCardId)?.label }
        : {}),
    };
    const [outgoing, incoming] = buildTransferTx(amt, trCurrency, source, dest, lbpRateOf(financials), {
      date: trDate || todayISO(),
    });
    update({ transactions: [incoming, outgoing, ...financials.transactions] });
    showToast(`Transferred ${fmtCur(amt, trCurrency)} from ${source.label} to ${dest.label}`);
    setTrAmt(""); setTrFromCardId(null); setTrToCardId(null); setTrFromOtherNote(""); setTrToOtherNote(""); setTrDate(todayISO());
  }

  return (
    <>
      <p className="text-xs" style={{ color: T.mute }}>
        Move money between two of your own payment methods — an ATM withdrawal, moving cash onto a card,
        consolidating between accounts. Doesn&apos;t count as spending or income, so it won&apos;t skew your
        budget — only Balance Check sees it move.
      </p>
      <p className="text-[10px] px-1" style={{ color: T.mute }}>
        Moving money to or from your Safety net? Use the Safety net checkbox on a regular entry instead — a
        Safety net contribution or withdrawal is a real budget event, not a transfer between pools.
      </p>
      <div
        className="rounded-xl p-4 space-y-3"
        style={{ background: T.ink, border: `1px solid ${T.line}` }}
      >
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-1.5" style={{ color: T.jade }}>From</p>
          <PaymentMethodPicker
            value={trFromMethod}
            onChange={setTrFromMethod}
            cardId={trFromCardId}
            onCardIdChange={setTrFromCardId}
            otherNote={trFromOtherNote}
            onOtherNoteChange={setTrFromOtherNote}
            cards={cards}
            onSaveCard={saveCard}
          />
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-1.5" style={{ color: T.brass }}>To</p>
          <PaymentMethodPicker
            value={trToMethod}
            onChange={setTrToMethod}
            cardId={trToCardId}
            onCardIdChange={setTrToCardId}
            otherNote={trToOtherNote}
            onOtherNoteChange={setTrToOtherNote}
            cards={cards}
            onSaveCard={saveCard}
          />
        </div>
        {transferSamePool() && (
          <p className="text-[10px] px-1" style={{ color: T.coral }}>
            From and To are the same pool — pick two different payment methods, or two different cards, to transfer between.
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="new-transfer-amount">Amount</Label>
            <MoneyInput id="new-transfer-amount" value={trAmt} onChange={setTrAmt} placeholder="0" max={moneyMaxFor(trCurrency, lbpRate)} />
          </div>
          <div>
            <Label>Currency</Label>
            <CurrencyToggle value={trCurrency} onChange={setTrCurrency} />
          </div>
        </div>
        <div>
          <Label htmlFor="new-transfer-date">Date</Label>
          <DateFieldDMY id="new-transfer-date" value={trDate} onChange={setTrDate} />
        </div>
        <PrimaryBtn
          onClick={addTransfer}
          color={T.jade}
          disabled={!trAmt || (trFromMethod === "card" && !trFromCardId) || (trToMethod === "card" && !trToCardId) || transferSamePool()}
        >
          ⇄ Transfer
        </PrimaryBtn>
      </div>
    </>
  );
}
