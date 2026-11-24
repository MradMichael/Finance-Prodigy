"use client";

// InputPanel split, S12 (session 55): My Finances' Log an entry section, moved here line for line, with the
// functions that save an entry. The section's header stays in InputPanel, and so do the things other sections
// share: the toast, the lira dialog, saving a card, and "Log again" (which fills this form from a row).
import { useState } from "react";
import type { LocalFinancials, Currency, PaymentMethod, StoredCard, StoredTransaction, BudgetRuleKey, cycleStartDayOf } from "../../lib/localData";
import { uid, todayISO, BUDGET_RULES, withRate, looksRecurring, buildQuickRecurring, quickRecurringStart, matchCategoryRule, roundMoney, moneyMaxFor, MONEY_MAX_USD, cardRef, edited, saveCard as storeCard, rateOn, lbpRateOf } from "../../lib/localData";
import type { Session } from "../../lib/auth";
import type { computeDashboard } from "../../lib/computeDashboard";
import type { periodNoun } from "../../lib/period";
import type { Bucket, TxBucket } from "../InputPanel";
import { useTheme } from "../../contexts/ThemeContext";
import { Label, FocusInput, MoneyInput, PrimaryBtn, CurrencyToggle, DateFieldDMY, PM_OPTIONS, CARD_TYPES } from "../form/Primitives";
import { fmtCur } from "../screens/shared";
import CategoryOptions from "../form/CategoryOptions";
import RateAgeChip from "../RateAgeChip";
import { looksLikeMistypedLbp, entryDescription } from "../../lib/entryGuards";

/**
 * U5 (owner, session 33, DECISIONS_PENDING 14 (a)): the last currency and payment method (and card) an entry
 * was logged with on this device. A preference kept in this browser only: never in the account's data,
 * never synced. Anything unreadable, or a card that's gone, falls back to the form's defaults.
 */
function rememberedEntry(userId: string | undefined, cards: StoredCard[]): { currency: Currency; paymentMethod: PaymentMethod; cardId: string | null } | null {
  if (!userId) return null;
  try {
    const v = JSON.parse(localStorage.getItem(`essa_entry_last_${userId}`) ?? "null");
    if (!v || (v.currency !== "USD" && v.currency !== "LBP") || !["cash", "card", "other"].includes(v.paymentMethod)) return null;
    const cardOk = v.paymentMethod === "card" && typeof v.cardId === "string" && cards.some((c) => c.id === v.cardId);
    return { currency: v.currency, paymentMethod: v.paymentMethod === "card" && !cardOk ? "cash" : v.paymentMethod, cardId: cardOk ? v.cardId : null };
  } catch { return null; }
}

function rememberEntry(userId: string | undefined, e: { currency: Currency; paymentMethod: PaymentMethod; cardId?: string }): void {
  if (!userId) return;
  try {
    localStorage.setItem(`essa_entry_last_${userId}`, JSON.stringify(e.paymentMethod === "card" && e.cardId ? e : { currency: e.currency, paymentMethod: e.paymentMethod }));
  } catch { /* a preference: nothing to do if this browser refuses it */ }
}

/** Log an entry: its form's state. InputPanel calls this, so the state lives there and what is typed survives closing the section, as before the move. */
export function useEntryForm(session: Session | undefined, financials: LocalFinancials) {
  // Transaction form
  const [remembered] = useState(() => rememberedEntry(session?.userId, financials.cards ?? []));
  const [txAmt,    setTxAmt]    = useState("");
  const [txBucket, setTxBucket] = useState<TxBucket>("NEEDS");
  // T9 (owner, session 33, DECISIONS_PENDING 21 (a)): set once a type tile is clicked for this entry.
  const [bucketTouched, setBucketTouched] = useState(false);
  const [txCategory, setTxCategory] = useState<string>("");
  const [txDesc,   setTxDesc]   = useState("");
  const [txDate,   setTxDate]   = useState(todayISO());
  // Session 22, item 1b (approved and merged in session 23, 2f5d30c): the Trip follows the date (a spend inside a trip's dates defaults to it) until
  // the person picks one, "No trip" included. Income and transfers default to no trip.
  const [txTripPick, setTxTripPick] = useState<string | null>(null);
  const [txCurrency,  setTxCurrency]  = useState<Currency>(remembered?.currency ?? "USD");
  // Batch C (dual-currency single transaction, 2026-08-31): one real
  // payment split across both currencies ($10 USD + L£200,000 as one
  // bill). Deliberately excludes EF/debt-linking and the card-add flow's
  // typo guard -- kept to the case actually asked for, not a redesign of
  // the whole entry form. See localData.ts's linkedPaymentId doc comment
  // for what this does and does not do downstream.
  const [txSplitMode, setTxSplitMode] = useState(false);
  const [txSplitUSD,  setTxSplitUSD]  = useState("");
  const [txSplitLBP,  setTxSplitLBP]  = useState("");
  const [txPayMethod, setTxPayMethod] = useState<PaymentMethod>(remembered?.paymentMethod ?? "cash");
  const [txPayNote,   setTxPayNote]   = useState("");
  const [txAddToEF,   setTxAddToEF]   = useState(false);
  const [txFromEF,    setTxFromEF]    = useState(false);
  // Phase 2.6.3c: how much of this transaction is EF-related -- blank means
  // "the full transaction amount" (today's implicit behavior, zero extra
  // typing for the common case), a typed value overrides it down to a
  // partial amount. Entered in the transaction's own currency, like txAmt
  // itself -- converted to USD at commit, the same way efAmtUSD is.
  const [txEfAmt,     setTxEfAmt]     = useState("");
  const [txCardId,    setTxCardId]    = useState<string | null>(remembered?.cardId ?? null);
  const [showAddCard, setShowAddCard] = useState(false);
  const [newCardType, setNewCardType] = useState<StoredCard["type"]>("Visa");
  const [newCardLast4, setNewCardLast4] = useState("");
  return { remembered, txAmt, setTxAmt, txBucket, setTxBucket, bucketTouched, setBucketTouched, txCategory, setTxCategory, txDesc, setTxDesc, txDate, setTxDate, txTripPick, setTxTripPick, txCurrency, setTxCurrency, txSplitMode, setTxSplitMode, txSplitUSD, setTxSplitUSD, txSplitLBP, setTxSplitLBP, txPayMethod, setTxPayMethod, txPayNote, setTxPayNote, txAddToEF, setTxAddToEF, txFromEF, setTxFromEF, txEfAmt, setTxEfAmt, txCardId, setTxCardId, showAddCard, setShowAddCard, newCardType, setNewCardType, newCardLast4, setNewCardLast4 };
}

export default function EntrySection({ financials, dashData, session, update, lbpRate, cards, saveCard, showToast, setLbpConfirm, TX_BUCKETS, activeTx, noun, startDay, savOut, txTrip, looksLikeSalary, form }: {
  financials: LocalFinancials;
  dashData: ReturnType<typeof computeDashboard>;
  session: Session | undefined;
  update: (patch: Partial<LocalFinancials>) => void;
  lbpRate: number;
  cards: StoredCard[];
  saveCard: (type: StoredCard["type"], last4: string) => StoredCard | null;
  showToast: (msg: string) => void;
  setLbpConfirm: (v: { amount: number; proceed: () => void } | null) => void;
  TX_BUCKETS: { value: TxBucket; label: string; icon: string; color: string }[];
  activeTx: StoredTransaction[];
  noun: ReturnType<typeof periodNoun>;
  startDay: ReturnType<typeof cycleStartDayOf>;
  savOut: number;
  txTrip: string;
  looksLikeSalary: boolean;
  form: ReturnType<typeof useEntryForm>;
}) {
  const T = useTheme();
  const { txAmt, setTxAmt, txBucket, setTxBucket, setBucketTouched, txCategory, setTxCategory, txDesc, setTxDesc, txDate, setTxDate, setTxTripPick, txCurrency, setTxCurrency, txSplitMode, setTxSplitMode, txSplitUSD, setTxSplitUSD, txSplitLBP, setTxSplitLBP, txPayMethod, setTxPayMethod, txPayNote, setTxPayNote, txAddToEF, setTxAddToEF, txFromEF, setTxFromEF, txEfAmt, setTxEfAmt, txCardId, setTxCardId, showAddCard, setShowAddCard, newCardType, setNewCardType, newCardLast4, setNewCardLast4 } = form;

  function addTransaction() {
    const amt = parseFloat(txAmt);
    if (!amt || amt <= 0) return;
    if (looksLikeMistypedLbp(amt, txCurrency)) {
      setLbpConfirm({ amount: amt, proceed: commitTransaction });
      return;
    }
    commitTransaction();
  }

  // Shared by commitTransaction and commitSplitTransaction -- resolves the
  // card being paid with (saves a new one if the add-card panel is open),
  // so this small but easy-to-get-wrong bit of logic isn't duplicated.
  // A card typed into the open panel comes back as `cards`, for the caller to
  // write in the SAME update as the entry: saving it in an update of its own
  // lost it, because the entry's update was built from the older state and
  // replaced it (the lost-card bug, owner's item 6, session 6).
  function resolveCard(): { cardId?: string; cardLabel?: string; cards?: StoredCard[] } {
    if (txPayMethod !== "card") return {};
    if (showAddCard) {
      const saved = storeCard(cards, newCardType, newCardLast4);
      if (saved) {
        setNewCardLast4(""); setShowAddCard(false);
        return { cardId: saved.card.id, cardLabel: saved.card.label, ...(saved.cards !== cards ? { cards: saved.cards } : {}) };
      }
      return {};
    }
    return cardRef(cards, txPayMethod, txCardId);
  }

  function commitTransaction() {
    const amt = parseFloat(txAmt);
    if (!amt || amt <= 0) return;
    const { cardId, cardLabel, cards: withNewCard } = resolveCard();
    const description = entryDescription(txDesc, txBucket);
    // "If null only": a category rule only ever fills in a category the
    // user hasn't already picked -- never overrides an explicit choice.
    const autoCategory = txCategory || matchCategoryRule(description, financials.categoryRules);
    // Phase 2.6.3c: EF is now a real, signed field on the transaction itself
    // instead of a side-effect mutation of emergencyFundBalance -- blank
    // txEfAmt means "the full transaction amount" (today's implicit
    // behavior); a typed value makes a partial amount representable (e.g.
    // "$300 of this $325 came from EF," 2.4.27's exact case). Entered in the
    // transaction's own currency like txAmt itself, converted the same way.
    const efAmtRaw = txEfAmt.trim() ? parseFloat(txEfAmt.replace(/,/g, "")) : amt;
    // Plan J: a backdated entry's draw at its own day's rate, as every figure prices it.
    const efAmtUSD = txCurrency === "LBP" ? efAmtRaw / rateOn(financials, txDate) : efAmtRaw;
    const now = new Date().toISOString();
    const tx: StoredTransaction = {
      id: uid(), amount: amt, currency: txCurrency, bucket: txBucket,
      description,
      date: txDate,
      paymentMethod: txPayMethod,
      createdAt: now, updatedAt: now,
      ...withRate(txCurrency, lbpRateOf(financials)),
      ...(autoCategory ? { category: autoCategory } : {}),
      ...(txPayMethod === "other" && txPayNote.trim() ? { paymentNote: txPayNote.trim() } : {}),
      ...(cardId ? { cardId, cardLabel } : {}),
      ...(txTrip ? { tripId: txTrip } : {}),
      ...(txBucket === "SAVINGS" && txAddToEF ? { efAmount: roundMoney(efAmtUSD) } : {}),
      ...(txBucket !== "SAVINGS" && txBucket !== "INCOME" && txBucket !== "TRANSFER" && txFromEF ? { efAmount: roundMoney(-efAmtUSD) } : {}),
    };
    update({ transactions: [tx, ...financials.transactions], ...(withNewCard ? { cards: withNewCard } : {}) });
    setTxAmt(""); setTxDesc(""); setTxPayNote(""); setTxAddToEF(false); setTxFromEF(false); setTxEfAmt(""); setTxCategory(""); setTxTripPick(null);
    setBucketTouched(false);
    rememberEntry(session?.userId, { currency: txCurrency, paymentMethod: txPayMethod, cardId });
    showToast(`Logged ${description}, ${fmtCur(amt, txCurrency)}.`); // U4 (session 33): the reminder's approved text
  }

  // Batch C: one real payment, two currency legs, sharing everything except
  // amount/currency (description/date/bucket/category/payment method are
  // entered once). Each leg is built the same way commitTransaction builds
  // its one -- no EF/debt-linking here, that's the normal single-currency
  // form's job. linkedPaymentId is the only thing tying the two together,
  // and it's stamped identically on both -- see its own doc comment in
  // localData.ts for why nothing downstream may read it as anything other
  // than a display hint.
  // Session 42 (owner): the lira leg gets the same "did you mean USD?" check
  // as a single lira entry (addTransaction). It skipped it before, by oversight.
  function addSplitTransaction() {
    const amtUSDLeg = parseFloat(txSplitUSD.replace(/,/g, ""));
    const amtLBPLeg = parseFloat(txSplitLBP.replace(/,/g, ""));
    if (!(amtUSDLeg > 0) || !(amtLBPLeg > 0)) return;
    if (looksLikeMistypedLbp(amtLBPLeg, "LBP")) {
      setLbpConfirm({ amount: amtLBPLeg, proceed: commitSplitTransaction });
      return;
    }
    commitSplitTransaction();
  }

  function commitSplitTransaction() {
    const amtUSDLeg = parseFloat(txSplitUSD.replace(/,/g, ""));
    const amtLBPLeg = parseFloat(txSplitLBP.replace(/,/g, ""));
    if (!(amtUSDLeg > 0) || !(amtLBPLeg > 0)) return;
    const { cardId, cardLabel, cards: withNewCard } = resolveCard();
    const description = entryDescription(txDesc, txBucket);
    const autoCategory = txCategory || matchCategoryRule(description, financials.categoryRules);
    const now = new Date().toISOString();
    const linkedPaymentId = uid();
    const shared = {
      description, date: txDate, bucket: txBucket, paymentMethod: txPayMethod,
      createdAt: now, updatedAt: now, linkedPaymentId,
      ...(autoCategory ? { category: autoCategory } : {}),
      ...(txPayMethod === "other" && txPayNote.trim() ? { paymentNote: txPayNote.trim() } : {}),
      ...(cardId ? { cardId, cardLabel } : {}),
      ...(txTrip ? { tripId: txTrip } : {}),
    };
    const legUSD: StoredTransaction = { id: uid(), amount: amtUSDLeg, currency: "USD", ...shared };
    const legLBP: StoredTransaction = {
      id: uid(), amount: amtLBPLeg, currency: "LBP", ...shared,
      ...withRate("LBP", lbpRateOf(financials)),
    };
    update({ transactions: [legUSD, legLBP, ...financials.transactions], ...(withNewCard ? { cards: withNewCard } : {}) });
    setTxSplitUSD(""); setTxSplitLBP(""); setTxSplitMode(false); setTxDesc(""); setTxPayNote(""); setTxCategory(""); setTxTripPick(null);
    setBucketTouched(false);
    rememberEntry(session?.userId, { currency: txCurrency, paymentMethod: txPayMethod, cardId });
    showToast(`Logged ${description}, ${fmtCur(amtUSDLeg, "USD")} + ${fmtCur(amtLBPLeg, "LBP")}.`); // U4 (session 33)
  }

  /** Quick-add a Recurring item from a transaction that looksRecurring flagged — monthly, editable further in the Recurring screen. Past transactions are left untouched; this only affects future months. Session 62 (TODO 117): it starts one month after the latest payment of that bill, this entry's date included (the entry is logged right after), so this period is never asked for again. */
  function convertToRecurring(name: string, amount: string, currency: Currency, bucket: Bucket, category: string) {
    const rec = buildQuickRecurring(name, amount, currency, bucket, category, quickRecurringStart(name, financials.transactions, txDate));
    if (!rec) return;
    update({ recurring: [...(financials.recurring ?? []), edited(rec)] });
  }

  return (
    <>
      {!txSplitMode ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <Label htmlFor="tx-amount">Amount</Label>
            <MoneyInput
              id="tx-amount"
              value={txAmt}
              onChange={setTxAmt}
              placeholder="0"
              max={moneyMaxFor(txCurrency, lbpRate)}
            />
          </div>
          <div>
            <Label htmlFor="tx-date">Date</Label>
            <DateFieldDMY id="tx-date" value={txDate} onChange={setTxDate} />
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <Label htmlFor="tx-split-usd">Amount (USD)</Label>
              <MoneyInput id="tx-split-usd" value={txSplitUSD} onChange={setTxSplitUSD} placeholder="0" max={MONEY_MAX_USD} />
            </div>
            <div>
              <Label htmlFor="tx-split-lbp">Amount (LBP)</Label>
              <MoneyInput id="tx-split-lbp" value={txSplitLBP} onChange={setTxSplitLBP} placeholder="0" max={moneyMaxFor("LBP", lbpRate)} />
            </div>
          </div>
          <div>
            <Label htmlFor="tx-date">Date</Label>
            <DateFieldDMY id="tx-date" value={txDate} onChange={setTxDate} />
          </div>
        </>
      )}

      {/* One real payment split across both currencies -- e.g. a bill
          paid as $10 + L£200,000. Writes two ordinary transactions
          sharing everything below except amount/currency, tagged only
          for display grouping (localData.ts's linkedPaymentId). */}
      <button
        type="button"
        onClick={() => setTxSplitMode((v) => !v)}
        className="text-[11px] font-medium hover:opacity-80 transition-opacity"
        style={{ color: txSplitMode ? T.jade : T.mute }}
      >
        {txSplitMode ? "✓ Split across USD and LBP" : "Split across USD and LBP?"}
      </button>

      <div>
        <Label>Type</Label>
        <div className="grid grid-cols-2 gap-2">
          {TX_BUCKETS.map((b) => (
            <button
              key={b.value}
              onClick={() => { setTxBucket(b.value); setBucketTouched(true); }}
              aria-pressed={txBucket === b.value}
              className="flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-medium transition-all duration-150"
              style={{
                background: txBucket === b.value ? b.color + "22" : T.panelSoft,
                border: `1px solid ${txBucket === b.value ? b.color : T.line}`,
                color: txBucket === b.value ? b.color : T.mute,
              }}
            >
              <span>{b.icon}</span>
              <span>{b.label}</span>
            </button>
          ))}
        </div>
        {/* T1 (owner, session 33, DECISIONS_PENDING 13; wording approved): Setup's income is the salary. */}
        {txBucket === "INCOME" && (
          <p className="text-[10px] mt-1.5 px-1" style={{ color: T.mute }}>
            Your monthly salary is already counted from Setup. Log only extra income here, like a bonus, a gift or freelance work.
          </p>
        )}
        {txBucket === "INCOME" && looksLikeSalary && (
          <p role="status" className="text-[11px] mt-1.5 px-1 font-medium" style={{ color: T.brass }}>
            This looks like your salary, which Setup already counts. Saving it as Income counts it twice.
          </p>
        )}
        {txBucket === "TRANSFER" && (
          <p className="text-[10px] mt-1.5 px-1" style={{ color: T.mute }}>
            For money arriving that isn&apos;t real income — a reimbursement, a repayment. Not counted as
            spending or income, excluded from every budget total. Moving money between your own Cash/Card/Other
            pools has its own form in Manage → Transfer.
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="tx-category">Category</Label>
        <select
          id="tx-category"
          value={txCategory}
          onChange={(e) => setTxCategory(e.target.value)}
          className="w-full rounded-xl px-3 py-2.5 text-sm"
          style={{ background: T.panelSoft, border: `1px solid ${T.line}`, color: T.text, outline: "none", colorScheme: "dark" }}
        >
          <option value="">No category</option>
          <CategoryOptions customCategories={financials.customCategories} />
        </select>
      </div>

      {(financials.trips ?? []).length > 0 && (
      <div>
        <Label htmlFor="tx-trip">Trip</Label>
        <select id="tx-trip" value={txTrip} onChange={(e) => setTxTripPick(e.target.value)}
          className="w-full rounded-xl px-3 py-2.5 text-sm" style={{ background: T.panelSoft, border: `1px solid ${T.line}`, color: T.text, outline: "none", colorScheme: "dark" }}>
          <option value="">No trip</option>
          {[...(financials.trips ?? [])].sort((a, b) => b.startDate.localeCompare(a.startDate)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      )}

      {/* Savings context: target hint + EF toggle -- not shown in split
          mode, since commitSplitTransaction deliberately doesn't set
          efAmount on either leg (EF/debt-linking is out of scope for
          this entry path, see its own comment). */}
      {!txSplitMode && txBucket === "SAVINGS" && financials.income > 0 && (() => {
        const ruleKey: BudgetRuleKey = financials.budgetRule ?? "50-30-20";
        const savPct  = ruleKey === "custom"
          ? Math.max(0, 100 - (financials.budgetCustomNeeds ?? 50) - (financials.budgetCustomWants ?? 30))
          : BUDGET_RULES[ruleKey].savings;
        // Reads computeDashboard.ts's own effectiveBudgetTargets/
        // emergencyFund instead of recomputing from financials.income
        // directly -- the raw stored income ignores rollover AND any
        // one-off INCOME transaction logged this month, both of which
        // computeDashboard.ts folds in, so recomputing locally used to
        // disagree with Overview/Budget/Projections for the same account.
        const targetAmt = Math.round(dashData.effectiveBudgetTargets.savings);
        const efTarget  = dashData.emergencyFund.targetAmount;
        const efBalance = dashData.emergencyFund.balance;
        const efRemaining = dashData.emergencyFund.remaining;
        const efFull = efTarget > 0 && efRemaining <= 0;
        return (
          <div className="space-y-2">
            {/* Target hint */}
            <div className="rounded-xl px-3 py-2.5 flex items-center justify-between" style={{ background: T.jade + "14", border: `1px solid ${T.jade}30` }}>
              <span className="text-[11px]" style={{ color: T.mute }}>
                Monthly savings target ({savPct}% of ${financials.income.toLocaleString("en-US")})
              </span>
              <span className="text-sm font-semibold tabular-nums" style={{ color: T.jade }}>
                ${targetAmt.toLocaleString("en-US")}
              </span>
            </div>
            {/* So far this month */}
            <div className="rounded-xl px-3 py-2 flex items-center justify-between" style={{ background: T.panelSoft }}>
              <span className="text-[11px]" style={{ color: T.mute }}>Saved so far this {noun}</span>
              <span className="text-xs font-medium tabular-nums" style={{ color: savOut >= targetAmt ? T.jade : T.brass }}>
                ${Math.round(savOut).toLocaleString("en-US")} / ${targetAmt.toLocaleString("en-US")}
              </span>
            </div>
            {/* EF toggle */}
            {!efFull ? (
              <>
                <button
                  onClick={() => setTxAddToEF((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all"
                  style={{
                    background: txAddToEF ? T.jade + "18" : T.panelSoft,
                    border: `1px solid ${txAddToEF ? T.jade : T.line}`,
                  }}
                >
                  <div>
                    <p className="text-xs font-medium" style={{ color: txAddToEF ? T.jade : T.text }}>
                      Also add to Safety net
                    </p>
                    <p className="text-[10px]" style={{ color: T.mute }}>
                      EF: ${efBalance.toLocaleString("en-US")} of ${efTarget.toLocaleString("en-US")} · ${efRemaining.toLocaleString("en-US")} remaining
                    </p>
                  </div>
                  <span className="text-base ml-2">{txAddToEF ? "✓" : "○"}</span>
                </button>
                {/* Blank = full transaction amount -- only needed to type
                    something here for a PARTIAL EF contribution. */}
                {txAddToEF && (
                  <MoneyInput value={txEfAmt} onChange={setTxEfAmt} placeholder={`Full amount (${txAmt || "0"})`} max={moneyMaxFor(txCurrency, lbpRate)} />
                )}
              </>
            ) : (
              <div className="rounded-xl px-3 py-2" style={{ background: T.jade + "14", border: `1px solid ${T.jade}30` }}>
                <p className="text-xs font-medium" style={{ color: T.jade }}>✓ Safety net is fully funded</p>
              </div>
            )}
          </div>
        );
      })()}

      {/* Needs/Wants: option to pay this from the Emergency Fund instead
          of new spending -- not shown in split mode, same reasoning as
          the Savings/EF block above. Excludes Transfer too (2.4.55
          sub-phase 3): a reimbursement receipt isn't an expense EF
          could have paid. */}
      {!txSplitMode && txBucket !== "SAVINGS" && txBucket !== "INCOME" && txBucket !== "TRANSFER" && dashData.emergencyFund.balance > 0 && (
        <>
          <button
            onClick={() => setTxFromEF((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all"
            style={{
              background: txFromEF ? T.coral + "18" : T.panelSoft,
              border: `1px solid ${txFromEF ? T.coral : T.line}`,
            }}
          >
            <div>
              <p className="text-xs font-medium" style={{ color: txFromEF ? T.coral : T.text }}>
                Pay this from Safety net
              </p>
              <p className="text-[10px]" style={{ color: T.mute }}>
                EF balance: ${dashData.emergencyFund.balance.toLocaleString("en-US")} · reduces it by this amount
              </p>
            </div>
            <span className="text-base ml-2">{txFromEF ? "✓" : "○"}</span>
          </button>
          {/* Blank = full transaction amount -- type a smaller number to
              represent only PART of this payment coming from EF (2.4.27's
              exact case: $300 of a $325 payment). */}
          {txFromEF && (
            <MoneyInput value={txEfAmt} onChange={setTxEfAmt} placeholder={`Full amount (${txAmt || "0"})`} max={moneyMaxFor(txCurrency, lbpRate)} />
          )}
        </>
      )}

      <div>
        <Label htmlFor="tx-desc">Description</Label>
        <FocusInput
          id="tx-desc"
          value={txDesc}
          onChange={(e) => setTxDesc(e.target.value)}
          placeholder={txBucket === "INCOME" ? "Bonus, freelance gig, gift…" : txBucket === "TRANSFER" ? "Dad paid me back for gas…" : "Rent, groceries, gym…"}
          onKeyDown={(e) => e.key === "Enter" && (txSplitMode ? addSplitTransaction() : addTransaction())}
        />
        {!txSplitMode && txBucket !== "INCOME" && txBucket !== "TRANSFER" && looksRecurring(txDesc, txDate, activeTx, financials.recurring ?? [], startDay) && (
          <div className="mt-2 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2" style={{ background: T.brass + "14", border: `1px solid ${T.brass}30` }}>
            <p className="text-[11px]" style={{ color: T.brass }}>You&apos;ve logged this before in another month. Looks recurring.</p>
            <button
              type="button"
              onClick={() => convertToRecurring(txDesc, txAmt, txCurrency, txBucket, txCategory)}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-lg flex-shrink-0 hover:opacity-80 transition-opacity"
              style={{ background: T.brass + "22", color: T.brass }}
            >
              Add to Recurring
            </button>
          </div>
        )}
      </div>

      {!txSplitMode && (
        <div>
          <Label>Currency</Label>
          <CurrencyToggle value={txCurrency} onChange={setTxCurrency} />
          {txCurrency === "LBP" && <RateAgeChip updatedAt={financials.lbpRateUpdatedAt} rate={lbpRate} />}
        </div>
      )}

      {/* Payment method */}
      <div>
        <Label>Payment method</Label>
        <div className="grid grid-cols-3 gap-2 mb-2">
          {PM_OPTIONS.map((p) => (
            <button
              key={p.value}
              onClick={() => { setTxPayMethod(p.value); setTxCardId(null); setShowAddCard(false); }}
              aria-pressed={txPayMethod === p.value}
              className="flex flex-col items-center gap-1 py-2 rounded-xl text-xs font-medium transition-all"
              style={{
                background: txPayMethod === p.value ? T.jade + "22" : T.panelSoft,
                border: `1px solid ${txPayMethod === p.value ? T.jade : T.line}`,
                color: txPayMethod === p.value ? T.jade : T.mute,
              }}
            >
              <span>{p.icon}</span>
              <span>{p.label}</span>
            </button>
          ))}
        </div>

        {/* Other: who paid / context */}
        {txPayMethod === "other" && (
          <div className="space-y-1.5">
            <FocusInput
              value={txPayNote}
              onChange={(e) => setTxPayNote(e.target.value)}
              placeholder="Who paid or how?"
            />
            <p className="text-[10px] px-1" style={{ color: T.mute }}>
              Still counted in your budget. You consumed the expense.
            </p>
          </div>
        )}

        {/* Card selector */}
        {txPayMethod === "card" && (
          <div className="space-y-2">
            {cards.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {cards.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { setTxCardId(c.id); setShowAddCard(false); }}
                    aria-pressed={txCardId === c.id}
                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all"
                    style={{
                      background: txCardId === c.id ? T.jade + "22" : T.panelSoft,
                      border: `1px solid ${txCardId === c.id ? T.jade : T.line}`,
                      color: txCardId === c.id ? T.jade : T.mute,
                    }}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}
            {!showAddCard ? (
              <button
                onClick={() => { setShowAddCard(true); setTxCardId(null); }}
                className="text-[11px] px-2.5 py-1.5 rounded-lg transition-all hover:opacity-80"
                style={{ background: T.panelSoft, color: T.brass, border: `1px solid ${T.line}` }}
              >
                + New card
              </button>
            ) : (
              <div className="rounded-xl p-3 space-y-2" style={{ background: T.ink, border: `1px solid ${T.line}` }}>
                <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.brass }}>Add card</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Type</Label>
                    <select
                      value={newCardType}
                      onChange={(e) => setNewCardType(e.target.value as StoredCard["type"])}
                      className="w-full rounded-xl px-3 py-2 text-xs"
                      style={{ background: T.panelSoft, border: `1px solid ${T.line}`, color: T.text, outline: "none", colorScheme: "dark" }}
                    >
                      {CARD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="new-card-last4">Last 4 digits</Label>
                    <FocusInput
                      id="new-card-last4"
                      type="text"
                      inputMode="numeric"
                      maxLength={4}
                      value={newCardLast4}
                      onChange={(e) => setNewCardLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      placeholder="1234"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const saved = saveCard(newCardType, newCardLast4);
                      if (saved) { setTxCardId(saved.id); setNewCardLast4(""); setShowAddCard(false); }
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:opacity-90"
                    style={{ background: T.jade, color: T.ink }}
                  >
                    Save & use
                  </button>
                  <button
                    onClick={() => setShowAddCard(false)}
                    className="px-3 py-1.5 rounded-lg text-xs transition-all hover:opacity-70"
                    style={{ color: T.mute }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <PrimaryBtn
        onClick={txSplitMode ? addSplitTransaction : addTransaction}
        color={T.jade}
        disabled={txSplitMode ? !(parseFloat(txSplitUSD) > 0 && parseFloat(txSplitLBP) > 0) : !(parseFloat(txAmt) > 0)}
      >
        + Add entry
      </PrimaryBtn>
    </>
  );
}
