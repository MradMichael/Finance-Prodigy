"use client";

import { spentByBucket } from "../lib/spending";
import { useState, useRef, useEffect } from "react";
import LbpMistypeDialog from "./LbpMistypeDialog";
import { useScrollFocus } from "./useScrollFocus";
import type { LocalFinancials, StoredTransaction, StoredCard } from "../lib/localData";
import type { Session } from "../lib/auth";
import type { computeDashboard } from "../lib/computeDashboard";
import { todayISO, historizedRecurringContribution, matchCategoryRule, usualBucketOf, activeTransactions, softDelete, cycleStartDayOf, syncAllowed, saveCard as storeCard, makeToUSDOn, lbpRateOf, makeToUSDLive, debtPayoff } from "../lib/localData";
import { useTheme } from "../contexts/ThemeContext";
import { Section } from "./form/Primitives";
import { money } from "./screens/shared";
import ImportStatement from "./ImportStatement";
import HistorySection from "./inputpanel/HistorySection";
import ThisMonthSection from "./inputpanel/ThisMonthSection";
import RecurringSection, { useRecurringForm } from "./inputpanel/RecurringSection";
import GoalsSection, { useGoalsForm } from "./inputpanel/GoalsSection";
import DebtsSection, { useDebtForm } from "./inputpanel/DebtsSection";
import TransferSection, { useTransferForm } from "./inputpanel/TransferSection";
import AssetsSection, { useAssetsForm } from "./inputpanel/AssetsSection";
import EntrySection, { useEntryForm } from "./inputpanel/EntrySection";
import { StatsStrip, TabBar } from "./inputpanel/Shell";
import { logAgainEntry } from "../lib/logAgain";
import {currentCycleKey, isInCycle, periodNoun } from "../lib/period";
import { calendarDayOf } from "../lib/calendarDay";
import { suggestedTripId } from "../lib/trips";

export type Bucket = "NEEDS" | "WANTS" | "SAVINGS";
// Transactions (not recurring items) can also be logged as one-off INCOME --
// see StoredTransaction's doc comment in localData.ts for why recurring stays
// 3-way.
export type TxBucket = Bucket | "INCOME" | "TRANSFER";
// PM_OPTIONS/CARD_TYPES now live in ./form/Primitives (Phase 2.6.4), shared
// with the new PaymentMethodPicker -- imported above, not redeclared here.

// ── main panel ──────────────────────────────────────────────────── //

interface Props {
  financials: LocalFinancials;
  dashData: ReturnType<typeof computeDashboard>;
  onChange: (updated: LocalFinancials) => void;
  session?: Session;
  /** Confirms a recurring item's oldest outstanding cycle -- same shared handler FinancialDashboard's Renewing-soon chip uses. `paidDate` is optional -- when set, records the real payment date instead of defaulting to the cycle's due date (2.4.30, finding A). */
  onConfirmRecurring?: (recurringId: string, paidDate?: Date) => void;
  /** TODO 124: links an entry logged by hand to a cycle instead of logging a new payment ("Already logged"); and its Undo. */
  onLinkLogged?: (recurringId: string, txId: string, dueDate: string) => Promise<boolean>;
  onUnlinkLogged?: (recurringId: string, txId: string, dueDate: string) => Promise<boolean>;
  /** Recurring item ids whose confirm write is currently in flight. */
  loggingRecurringIds?: Set<string>;
  /** Recurring item ids that just finished confirming, briefly, before their target moves on to the next cycle (2.4.30, finding 3). */
  justConfirmedIds?: Set<string>;
  /** Opens the shared edit surface (page.tsx) for the given entity -- one implementation per kind, shared with each entity's own standalone screen. */
  onEdit: (kind: "transaction" | "debt" | "recurring" | "goal", id: string) => void;
  /** Opens the shared "record a payment" surface (page.tsx) for a debt -- shared with DebtsScreen. */
  onPay: (debtId: string) => void;
}

/** This month on a phone shows this many entries until "Show all" (owner, session 34; label approved in session 35). */
const PHONE_MONTH_ROWS = 20;

export default function InputPanel({ financials, dashData, onChange, session, onConfirmRecurring, loggingRecurringIds, justConfirmedIds, onEdit, onPay, onLinkLogged, onUnlinkLogged }: Props) {
  const T = useTheme();
  const startDay = cycleStartDayOf(financials);
  const BUCKETS: { value: Bucket; label: string; icon: string; color: string }[] = [
    { value: "NEEDS",   label: "Needs",   icon: "🏠", color: T.sky   },
    { value: "WANTS",   label: "Wants",   icon: "✨", color: T.brass },
    { value: "SAVINGS", label: "Savings", icon: "💰", color: T.jade  },
  ];
  // Transaction-only picker (adds Income, Transfer) -- recurring pickers
  // keep using BUCKETS above unchanged, since recurring income already has
  // its own home in the Setup income field and a recurring item can never
  // sensibly be a transfer.
  //
  // Transfer here (2.4.55, sub-phase 3) is deliberately the SINGLE-leg
  // reimbursement-repayment case only -- "Dad paid me back for gas,"
  // amount always positive (this pool gained money), reusing the exact
  // same amount/date/description/payment-method fields every other type
  // already has. A same-moment POOL-TO-POOL transfer (Cash to a card, an
  // ATM withdrawal) still has its own dedicated two-leg form in the Manage
  // tab (buildTransferTx) -- a single quick-entry leg here would be an
  // unpaired half of one of those, which is exactly the case this entry
  // point does NOT build. No gained/lost toggle: unlike
  // EditTransactionSheet's retag (which can start from either a spend or
  // an income transaction), a brand-new entry here only ever represents
  // money arriving.
  const TX_BUCKETS: { value: TxBucket; label: string; icon: string; color: string }[] = [
    ...BUCKETS,
    { value: "INCOME", label: "Income", icon: "📥", color: T.jade },
    { value: "TRANSFER", label: "Transfer", icon: "🔁", color: T.mute },
  ];
  const update = (patch: Partial<LocalFinancials>) => onChange({ ...financials, ...patch });

  const entryForm = useEntryForm(session, financials); // Log an entry: its form's state stays here (S-moves, session 55), so it survives closing the section
  const { bucketTouched, setBucketTouched, setShowAddCard, setTxAddToEF, setTxAmt, setTxBucket, setTxCardId, setTxCategory, setTxCurrency, setTxDate, setTxDesc, setTxEfAmt, setTxFromEF, setTxPayMethod, setTxPayNote, setTxSplitLBP, setTxSplitMode, setTxSplitUSD, setTxTripPick, txAmt, txBucket, txCategory, txCurrency, txDate, txDesc, txTripPick } = entryForm;
  // Owner, session 34 (label approved in session 35): below md, This month shows its first PHONE_MONTH_ROWS entries.
  const [showAllMonth, setShowAllMonth] = useState(false);
  // T9: until a type is picked for this entry, it follows the category's usual type -- the one chosen, or
  // the one a rule finds in the description.
  const effectiveCategory = txCategory || matchCategoryRule(txDesc.trim(), financials.categoryRules) || "";
  useEffect(() => {
    if (bucketTouched) return;
    const usual = usualBucketOf(effectiveCategory, financials.customCategories);
    if (usual) setTxBucket(usual);
  }, [effectiveCategory, bucketTouched, financials.customCategories, setTxBucket]); // setTxBucket: a state setter (S12 moved it into useEntryForm), the same every render
  const [showImport, setShowImport] = useState(false);
  // Phase 2.6.3b: brief confirmation after a soft-delete, telling the user
  // recovery exists at the exact moment it becomes relevant -- see
  // TransactionsScreen's "Recently deleted" view, the persistent, always-
  // visible entry point for later. No expiry is stated: retention is
  // undecided, and promising one that doesn't exist would either be a lie
  // or make someone think a real window is closing.
  // 2.4.47: renamed from deletedMsg/deletedMsgTimer -- was delete-only,
  // now the one shared success toast (debt payment, goal contribution,
  // still delete too) instead of a 4th near-identical message+timer pair.
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const actionMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showToast(msg: string) {
    setActionMsg(msg);
    if (actionMsgTimer.current) clearTimeout(actionMsgTimer.current);
    actionMsgTimer.current = setTimeout(() => setActionMsg(null), 4000);
  }
  // Replaces native confirm() for the "LBP amount looks like a typo'd USD
  // entry" guard below -- OK/Cancel semantics don't map cleanly onto "save
  // it anyway" vs "let me fix the currency", so this stores enough to
  // resume whichever save flow (add or edit) triggered it.
  // Item 3 (session 57): `forGoal` gives the dialog a goal payment's words (Add to this goal).
  const [lbpConfirm, setLbpConfirm] = useState<{ amount: number; proceed: () => void; forGoal?: boolean } | null>(null);
  const monthListScrollRef = useScrollFocus(); // A11Y-05

  const goalsForm = useGoalsForm(); // Goals: its form's state stays here (S-moves, session 55), so it survives closing the section

  const debtForm = useDebtForm(); // Debts: its form's state stays here (S-moves, session 55), so it survives closing the section

  const assetsForm = useAssetsForm(); // Other Assets: its form's state stays here (S-moves, session 55), so it survives closing the section


  const transferForm = useTransferForm(); // Transfer: its form's state stays here (S-moves, session 55), so it survives closing the section

  const recurringForm = useRecurringForm(); // Recurring Payments: its form's state stays here (S-moves, session 55), so it survives closing the section



  // ── edit state ──────────────────────────────────────────────── //

  // Goal editing lives in the shared EditGoalSheet (page.tsx).
  // Recurring editing lives in the shared EditRecurringSheet (page.tsx).
  // Transaction editing lives in the shared EditTransactionSheet (page.tsx).

  // ── helpers ────────────────────────────────────────────────────── //

  const cards = financials.cards ?? [];

  // Phase 2.6.4: parameterized (was reading module-level newCardType/
  // newCardLast4 directly) so the new shared PaymentMethodPicker can call
  // this without its own copy of the persistence logic -- this function's
  // only job now is "persist a card, hand it back," not managing any
  // particular form's own typing/panel-open state. Callers do their own
  // cleanup (clearing their own newCardLast4/showAddCard-equivalent) on
  // success, same as they already had to.
  function saveCard(type: StoredCard["type"], last4: string): StoredCard | null {
    // Plan H 5c: the shared saveCard; the same card typed twice is reused.
    const saved = storeCard(cards, type, last4);
    if (!saved) return null;
    if (saved.cards !== cards) update({ cards: saved.cards });
    return saved.card;
  }

  const txTrip = txTripPick ?? (txBucket === "INCOME" || txBucket === "TRANSFER" ? "" : suggestedTripId(financials.trips ?? [], txDate) ?? "");

  // ── edit helpers ───────────────────────────────────────────── //

  // Phase 2.6.3b: soft-delete -- stamps deletedAt instead of removing the
  // row, so it's recoverable from TransactionsScreen's "Recently deleted"
  // view rather than gone the moment "Delete transaction" is confirmed.
  function softDeleteTransaction(txId: string) {
    const now = new Date().toISOString();
    update({
      transactions: financials.transactions.map((t) => t.id !== txId ? t : softDelete(financials, t, now)),
    });
    showToast("Deleted — recoverable in Transactions");
  }

  // ── tab state ─────────────────────────────────────────────────── //
  const [activeTab, setActiveTab] = useState<"daily" | "setup">("daily");

  // Session 52, item 18 (merged in session 53; the button is named "Log again: {description}"): "Log again" on a past row fills the entry form from it, dated today, and saves
  // nothing; "+ Add entry" does that, with the form's own checks. logAgainEntry says which rows offer it and what
  // is copied. The form opens if it was closed and is brought into view.
  const [entryOpenSignal, setEntryOpenSignal] = useState(0);
  function logAgain(t: StoredTransaction) {
    const e = logAgainEntry(t, cards);
    if (!e) return;
    setTxSplitMode(false); setTxSplitUSD(""); setTxSplitLBP("");
    setTxAmt(e.amount); setTxCurrency(e.currency);
    setTxBucket(e.bucket); setBucketTouched(true); // the row's own type, not the category's usual one
    setTxCategory(e.category); setTxDesc(e.description);
    setTxPayMethod(e.paymentMethod); setTxPayNote(e.paymentNote); setTxCardId(e.cardId); setShowAddCard(false);
    setTxDate(todayISO()); setTxTripPick(null);
    setTxAddToEF(false); setTxFromEF(false); setTxEfAmt("");
    setEntryOpenSignal((n) => n + 1);
    // After the form has opened and filled: bring it into view. No field is focused on a touch screen, so the
    // keyboard doesn't cover the form that was just filled.
    setTimeout(() => {
      const amount = document.getElementById("tx-amount");
      amount?.scrollIntoView({ block: "center" });
      if (typeof window.matchMedia === "function" && !window.matchMedia("(pointer: coarse)").matches) amount?.focus({ preventScroll: true });
    }, 0);
  }

  // ── reset-all-data confirmation ──────────────────────────────────── //

  // ── derived ───────────────────────────────────────────────────── //

  const prefix   = currentCycleKey(new Date(), startDay);
  const noun = periodNoun(startDay);
  // Phase 2.6.3b: a soft-deleted transaction must not keep counting toward
  // this month's totals or appear in "This month"'s list -- deleting is
  // meant to behave exactly like the old hard-delete from here on.
  const activeTx = activeTransactions(financials.transactions);
  const monthTx  = activeTx.filter((t) => isInCycle(t.date, prefix, startDay));
  const now      = new Date();
  // The recurring engine takes calendar days: today, on this device.
  const today    = calendarDayOf(now);
  const lbpRate  = lbpRateOf(financials);
  // T1 (session 33): an Income entry within 10% of Setup's monthly income, in dollars at today's rate.
  const txAmtUSD = txCurrency === "LBP" ? (parseFloat(txAmt) || 0) / lbpRate : (parseFloat(txAmt) || 0);
  const looksLikeSalary = financials.income > 0 && txAmtUSD > 0 && Math.abs(txAmtUSD - financials.income) <= financials.income * 0.1;
  const toUSD    = makeToUSDLive(financials);
  // Plan J (merged in session 23, bafa688): each row at the rate in effect on its own day, as the dashboard prices it; this screen used today's rate for every row, past ones too.
  const toUSDOn  = makeToUSDOn(financials);
  const recs     = financials.recurring ?? [];
  // Recurring bills already fed the Needs/Wants/Savings totals just below
  // (and the Transactions screen's own list), but never appeared as rows in
  // "This month" here -- the one screen people actually check day to day.
  // Someone scanning for "did my rent go through" would never find it, even
  // though it was already counted in every total on this page.
  const recurRowsThisMonth = recs
    .map((r) => ({ r, usd: toUSD(historizedRecurringContribution(r, prefix, now, startDay), r.currency) }))
    .filter(({ usd }) => usd > 0);
  // Session 19: the shared spending rule (lib/spending.ts): a change-back nets against Wants; income, transfers and other reimbursements stay out.
  const monthSpent = spentByBucket(monthTx, (t) => toUSDOn(t.amount, t.currency, t.date));
  const needsOut = monthSpent.needs
                 + recs.filter((r) => r.bucket === "NEEDS").reduce((s, r)   => s + toUSD(historizedRecurringContribution(r, prefix, now, startDay), r.currency), 0);
  const wantsOut = monthSpent.wants
                 + recs.filter((r) => r.bucket === "WANTS").reduce((s, r)   => s + toUSD(historizedRecurringContribution(r, prefix, now, startDay), r.currency), 0);
  const savOut   = monthSpent.savings
                 + recs.filter((r) => r.bucket === "SAVINGS").reduce((s, r) => s + toUSD(historizedRecurringContribution(r, prefix, now, startDay), r.currency), 0);
  const totalOut = needsOut + wantsOut + savOut;
  const fmt      = (n: number) => money(n); // CODE-01: "-$105", not "$-105"

  return (
    <>
    <aside
      className="flex flex-col h-full overflow-y-auto"
      style={{ background: T.panel }}
    >
      {/* U10 (session 33): the brand block that repeated the top bar's and the sidebar's is gone. */}
      {/* ── Quick stats strip ───────────────────────────────── */}
      {financials.income > 0 && (
        <StatsStrip needs={fmt(needsOut)} wants={fmt(wantsOut)} saved={fmt(savOut)} />
      )}

      {/* ── Tab bar ─────────────────────────────────────────── */}
      <TabBar activeTab={activeTab} setActiveTab={setActiveTab} dailyCount={monthTx.length} />

      {/* ── Scrollable body ─────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6">

        {/* ── DAILY TAB ────────────────────────────────────── */}
        {activeTab === "daily" && <>

        {/* Log an entry */}
        <Section title="Log an entry" icon="📝" defaultOpen openSignal={entryOpenSignal}>
          <EntrySection financials={financials} dashData={dashData} session={session} update={update} lbpRate={lbpRate} cards={cards} saveCard={saveCard} showToast={showToast} setLbpConfirm={setLbpConfirm} TX_BUCKETS={TX_BUCKETS} activeTx={activeTx} noun={noun} startDay={startDay} savOut={savOut} txTrip={txTrip} looksLikeSalary={looksLikeSalary} form={entryForm} />
        </Section>

        <button
          onClick={() => setShowImport(true)}
          className="w-full text-center text-xs py-2 transition-all hover:opacity-70"
          style={{ color: T.mute }}
        >
          📄 Import a bank statement (PDF)
        </button>

        {/* This month */}
        <Section
          title="This month" icon="📋"
          badge={monthTx.length + recurRowsThisMonth.length}
          defaultOpen={monthTx.length + recurRowsThisMonth.length > 0}
        >
          <ThisMonthSection financials={financials} cards={cards} monthTx={monthTx} recurRowsThisMonth={recurRowsThisMonth} noun={noun} startDay={startDay} TX_BUCKETS={TX_BUCKETS} PHONE_MONTH_ROWS={PHONE_MONTH_ROWS} showAllMonth={showAllMonth} setShowAllMonth={setShowAllMonth} monthListScrollRef={monthListScrollRef} totalOut={totalOut} fmt={fmt} logAgain={logAgain} onEdit={onEdit} softDeleteTransaction={softDeleteTransaction} />
        </Section>

        {/* History — past months */}
        {(() => {
          const pastTx = activeTx.filter((t) => !isInCycle(t.date, prefix, startDay));
          if (pastTx.length === 0) return null;
          return (
            <Section title="History" icon="📚" badge={pastTx.length} defaultOpen={false}>
              <HistorySection financials={financials} cards={cards} pastTx={pastTx} startDay={startDay} TX_BUCKETS={TX_BUCKETS} toUSDOn={toUSDOn} fmt={fmt} logAgain={logAgain} onEdit={onEdit} softDeleteTransaction={softDeleteTransaction} />
            </Section>
          );
        })()}

        </>}

        {/* ── SETUP TAB (continued) — Goals, Recurring, Debts ─ */}
        {activeTab === "setup" && <>

        {/* Goals */}
        <Section title="Goals" icon="🎯" badge={financials.goals.length} defaultOpen={false}>
          <GoalsSection financials={financials} update={update} lbpRate={lbpRate} cards={cards} saveCard={saveCard} showToast={showToast} onEdit={onEdit} form={goalsForm} setLbpConfirm={setLbpConfirm} />
        </Section>

        {/* Recurring Payments */}
        <Section title="Recurring Payments" icon="🔁" badge={(financials.recurring ?? []).length} defaultOpen={false}>
          <RecurringSection financials={financials} update={update} lbpRate={lbpRate} onEdit={onEdit} BUCKETS={BUCKETS} noun={noun} startDay={startDay} today={today} toUSD={toUSD} onConfirmRecurring={onConfirmRecurring} loggingRecurringIds={loggingRecurringIds} justConfirmedIds={justConfirmedIds} form={recurringForm} onLinkLogged={onLinkLogged} onUnlinkLogged={onUnlinkLogged} />
        </Section>

        {/* Debts */}
        <Section title="Debts" icon="💳" badge={financials.debts.filter((d) => !debtPayoff(d, financials.transactions, financials).paidOff).length} defaultOpen={false}>
          <DebtsSection financials={financials} update={update} lbpRate={lbpRate} onEdit={onEdit} onPay={onPay} form={debtForm} />
        </Section>

        <Section title="Other Assets" icon="🏦" badge={(financials.assets ?? []).length} defaultOpen={false}>
          <AssetsSection financials={financials} update={update} lbpRate={lbpRate} form={assetsForm} />
        </Section>

        <Section title="Transfer" icon="🔁" defaultOpen={false}>
          <TransferSection financials={financials} update={update} lbpRate={lbpRate} cards={cards} saveCard={saveCard} showToast={showToast} form={transferForm} />
        </Section>

        {/* Balance Check moved to its own page (BalanceCheckScreen,
            2026-09-13) -- list, check-in, add and remove together, so a
            single surface owns the feature rather than splitting creation
            from reconciliation. Reached from the sidebar, and from the
            balance-check alert on Overview. */}

        </>}

        <div className="h-6" />
      </div>
      {/* end scrollable body */}

      {/* ── Footer ──────────────────────────────────────────── */}
      <div
        className="px-6 py-3 flex-shrink-0"
        style={{ borderTop: `1px solid ${T.line}` }}
      >
        {/* "Reset all data" lived here until it moved to Profile's Danger zone,
            next to Delete account: a destructive control in this footer was one
            misclick-and-type from wiping the account, and its confirm never said
            it overwrote the server copy too. */}
        <p className="text-[10px]" style={{ color: T.mute }}>
          {syncAllowed(financials) ? "Saved in your browser · backed up to ESSA's server" : "Saved in your browser"}
        </p>
      </div>
    </aside>
    {showImport && (
      <ImportStatement financials={financials} onImport={update} onClose={() => setShowImport(false)} />
    )}
    {lbpConfirm && (
      <LbpMistypeDialog
        amount={lbpConfirm.amount}
        forGoal={lbpConfirm.forGoal}
        onFix={() => setLbpConfirm(null)}
        onSave={() => { const proceed = lbpConfirm.proceed; setLbpConfirm(null); proceed(); }}
        closeOnEscape
      />
    )}

    {actionMsg && (
      <div
        className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-xs font-medium shadow-lg"
        style={{ background: T.panel, border: `1px solid ${T.jade}50`, color: T.text }}
      >
        <span style={{ color: T.jade }}>✓</span> {actionMsg}
      </div>
    )}
    </>
  );
}
