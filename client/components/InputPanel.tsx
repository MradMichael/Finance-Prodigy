"use client";

import { spentByBucket, totalSpent } from "../lib/spending";
import { useState, useRef, useEffect, type ReactNode } from "react";
import LbpMistypeDialog from "./LbpMistypeDialog";
import { useScrollFocus } from "./useScrollFocus";
import type { LocalFinancials, StoredTransaction, StoredRecurring, StoredCard, RecurringFrequency, Currency, PaymentMethod, BudgetRuleKey } from "../lib/localData";
import type { Session } from "../lib/auth";
import type { computeDashboard } from "../lib/computeDashboard";
import { uid, todayISO, fmtDate, FREQ_LABELS, FREQ_MONTHLY, BUDGET_RULES, historizedRecurringContribution, nominalMonthlyEquivalent, isRecurringActive, nextConfirmTarget, isCycleConfirmed, cycleMonthDivergence, recurringPaidSoFar, remainingInstallments, withRate, looksRecurring, buildQuickRecurring, buildExtraPaymentTx, matchCategoryRule, usualBucketOf, roundMoney, moneyMaxFor, MONEY_MAX_USD, activeTransactions, softDelete, cardRef, cycleStartDayOf, syncAllowed, edited, recordDeletion, saveCard as storeCard, makeToUSDOn, rateOn, lbpRateOf, makeToUSDLive, debtPayoff } from "../lib/localData";
import { useTheme } from "../contexts/ThemeContext";
import { Label, FocusInput, MoneyInput, PrimaryBtn, Section, CurrencyToggle, DateFieldDMY, PM_OPTIONS, CARD_TYPES } from "./form/Primitives";
import { fmtCur, money } from "./screens/shared";
import ImportStatement from "./ImportStatement";
import EntryRow from "./inputpanel/EntryRow";
import GoalsSection, { useGoalsForm } from "./inputpanel/GoalsSection";
import DebtsSection, { useDebtForm } from "./inputpanel/DebtsSection";
import TransferSection, { useTransferForm } from "./inputpanel/TransferSection";
import AssetsSection, { useAssetsForm } from "./inputpanel/AssetsSection";
import { logAgainEntry } from "../lib/logAgain";
import {currentCycleKey, cycleKeyForISO, isInCycle, periodNoun, cycleLabel, type CycleKey } from "../lib/period";
import { calendarDayOf } from "../lib/calendarDay";
import CategoryOptions from "./form/CategoryOptions";
import { suggestedTripId } from "../lib/trips";
import RateAgeChip from "./RateAgeChip";
import { looksLikeMistypedLbp } from "../lib/entryGuards";

type Bucket = "NEEDS" | "WANTS" | "SAVINGS";
// Transactions (not recurring items) can also be logged as one-off INCOME --
// see StoredTransaction's doc comment in localData.ts for why recurring stays
// 3-way.
type TxBucket = Bucket | "INCOME" | "TRANSFER";
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
  /** Recurring item ids whose confirm write is currently in flight. */
  loggingRecurringIds?: Set<string>;
  /** Recurring item ids that just finished confirming, briefly, before their target moves on to the next cycle (2.4.30, finding 3). */
  justConfirmedIds?: Set<string>;
  /** Opens the shared edit surface (page.tsx) for the given entity -- one implementation per kind, shared with each entity's own standalone screen. */
  onEdit: (kind: "transaction" | "debt" | "recurring" | "goal", id: string) => void;
  /** Opens the shared "record a payment" surface (page.tsx) for a debt -- shared with DebtsScreen. */
  onPay: (debtId: string) => void;
}

/**
 * R1 (session 32 review): builds what it renders only when it mounts. Inside a Section, that is only while
 * the Section is open: History built a row for every past entry on every render, closed, which cost 500 ms
 * a render at 15,000 entries and 0.65 s per action on a mid-range phone at 1,500.
 */
function BuiltWhenOpen({ render }: { render: () => ReactNode }) {
  return <>{render()}</>;
}

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

/** This month on a phone shows this many entries until "Show all" (owner, session 34; label approved in session 35). */
const PHONE_MONTH_ROWS = 20;

export default function InputPanel({ financials, dashData, onChange, session, onConfirmRecurring, loggingRecurringIds, justConfirmedIds, onEdit, onPay }: Props) {
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

  // Transaction form
  const [remembered] = useState(() => rememberedEntry(session?.userId, financials.cards ?? []));
  const [txAmt,    setTxAmt]    = useState("");
  const [txBucket, setTxBucket] = useState<TxBucket>("NEEDS");
  // T9 (owner, session 33, DECISIONS_PENDING 21 (a)): set once a type tile is clicked for this entry.
  const [bucketTouched, setBucketTouched] = useState(false);
  // Owner, session 34 (label approved in session 35): below md, This month shows its first PHONE_MONTH_ROWS entries.
  const [showAllMonth, setShowAllMonth] = useState(false);
  const [txCategory, setTxCategory] = useState<string>("");
  const [txDesc,   setTxDesc]   = useState("");
  // T9: until a type is picked for this entry, it follows the category's usual type -- the one chosen, or
  // the one a rule finds in the description.
  const effectiveCategory = txCategory || matchCategoryRule(txDesc.trim(), financials.categoryRules) || "";
  useEffect(() => {
    if (bucketTouched) return;
    const usual = usualBucketOf(effectiveCategory, financials.customCategories);
    if (usual) setTxBucket(usual);
  }, [effectiveCategory, bucketTouched, financials.customCategories]);
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
  const [lbpConfirm, setLbpConfirm] = useState<{ amount: number; proceed: () => void } | null>(null);
  const monthListScrollRef = useScrollFocus(); // A11Y-05

  const goalsForm = useGoalsForm(); // Goals: its form's state stays here (S-moves, session 55), so it survives closing the section

  const debtForm = useDebtForm(); // Debts: its form's state stays here (S-moves, session 55), so it survives closing the section

  const assetsForm = useAssetsForm(); // Other Assets: its form's state stays here (S-moves, session 55), so it survives closing the section


  const transferForm = useTransferForm(); // Transfer: its form's state stays here (S-moves, session 55), so it survives closing the section

  // Recurring form
  const [rName,        setRName]        = useState("");
  const [rEmoji,       setREmoji]       = useState("🔁");
  const [rAmount,      setRAmount]      = useState("");
  const [rCurrency,    setRCurrency]    = useState<Currency>("USD");
  const [rFreq,        setRFreq]        = useState<RecurringFrequency>("monthly");
  const [rBucket,      setRBucket]      = useState<"NEEDS" | "WANTS" | "SAVINGS">("NEEDS");
  const [rCategory,    setRCategory]    = useState<string>("");
  const [rStart,       setRStart]       = useState(todayISO());
  const [rEndType,     setREndType]     = useState<"infinite" | "date" | "amount">("infinite");
  const [rEnd,         setREnd]         = useState("");
  const [rTotalAmount, setRTotalAmount] = useState("");
  // Recurring extra payment state
  const [extraRecId,  setExtraRecId]  = useState<string | null>(null);
  const [extraRecAmt, setExtraRecAmt] = useState("");

  // Recurring confirm state (2.4.30, finding A) -- confirmDate defaults to
  // the target cycle's own due date when the form opens, editable to
  // record the date actually paid.
  const [confirmingRecId, setConfirmingRecId] = useState<string | null>(null);
  const [confirmDate,     setConfirmDate]     = useState("");


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
    const description = txDesc.trim() || txBucket.charAt(0) + txBucket.slice(1).toLowerCase();
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
    const description = txDesc.trim() || txBucket.charAt(0) + txBucket.slice(1).toLowerCase();
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

  function addRecurring() {
    if (!rName.trim() || !rAmount || !rStart) return;
    const rec: StoredRecurring = {
      id: uid(), name: rName.trim(), emoji: rEmoji || "🔁",
      amount: parseFloat(rAmount.replace(/,/g, "")), currency: rCurrency, frequency: rFreq,
      bucket: rBucket, ...(rCategory ? { category: rCategory } : {}), startDate: rStart,
      endDate:     rEndType === "date"   ? (rEnd.trim() || null) : null,
      totalAmount: rEndType === "amount" ? (parseFloat(rTotalAmount.replace(/,/g, "")) || null) : null,
      createdAt: new Date().toISOString(),
    };
    update({ recurring: [...(financials.recurring ?? []), edited(rec)] });
    setRName(""); setRAmount(""); setREmoji("🔁"); setRCategory(""); setRStart(todayISO()); setREnd(""); setRTotalAmount(""); setREndType("infinite");
  }

  /** Quick-add a Recurring item from a transaction that looksRecurring flagged — starts today, monthly, editable further in the Recurring screen. Past transactions are left untouched; this only affects future months. */
  function convertToRecurring(name: string, amount: string, currency: Currency, bucket: Bucket, category: string) {
    const rec = buildQuickRecurring(name, amount, currency, bucket, category);
    if (!rec) return;
    update({ recurring: [...(financials.recurring ?? []), edited(rec)] });
  }

  function logExtraPayment(rec: StoredRecurring) {
    const amt = parseFloat(extraRecAmt.replace(/,/g, ""));
    if (!amt || amt <= 0) return;
    const tx = buildExtraPaymentTx(rec, amt, lbpRateOf(financials));
    update({ transactions: [tx, ...financials.transactions] });
    setExtraRecId(null); setExtraRecAmt("");
  }

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
        <div
          className="grid grid-cols-3 gap-px mx-0"
          style={{ background: T.line, borderBottom: `1px solid ${T.line}` }}
        >
          {[
            { label: "Needs", value: fmt(needsOut), color: T.sky   },
            { label: "Wants", value: fmt(wantsOut), color: T.brass },
            { label: "Saved", value: fmt(savOut),   color: T.jade  },
          ].map((s) => (
            <div key={s.label} className="flex flex-col items-center py-3" style={{ background: T.panelSoft }}>
              <span className="text-xs font-semibold tabular-nums" style={{ color: s.color }}>{s.value}</span>
              <span className="text-[9px] uppercase tracking-widest mt-0.5" style={{ color: T.mute }}>{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Tab bar ─────────────────────────────────────────── */}
      <div className="flex flex-shrink-0" style={{ borderBottom: `1px solid ${T.line}` }}>
        {([
          { id: "daily" as const, label: "Daily",  icon: "⚡", badge: monthTx.length },
          { id: "setup" as const, label: "Manage", icon: "⚙", badge: 0 },
        ]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            aria-pressed={activeTab === tab.id}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-semibold transition-all"
            style={{
              color: activeTab === tab.id ? T.jade : T.mute,
              borderBottom: activeTab === tab.id ? `2px solid ${T.jade}` : "2px solid transparent",
              background: "transparent",
              marginBottom: -1,
            }}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
            {tab.badge > 0 && (
              <span className="text-[9px] font-bold px-1 py-0.5 rounded-full" style={{ background: T.jade + "28", color: T.jade }}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Scrollable body ─────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6">

        {/* ── DAILY TAB ────────────────────────────────────── */}
        {activeTab === "daily" && <>

        {/* Log an entry */}
        <Section title="Log an entry" icon="📝" defaultOpen openSignal={entryOpenSignal}>
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
                  placeholder="Who paid or how? e.g. Dad filled gas tank"
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
          {monthTx.length === 0 && recurRowsThisMonth.length === 0 ? (
            <div
              className="rounded-xl px-4 py-6 text-center"
              style={{ background: T.panelSoft, border: `1px dashed ${T.line}` }}
            >
              <p className="text-2xl mb-1">📭</p>
              <p className="text-xs" style={{ color: T.mute }}>No entries yet this {noun}</p>
            </div>
          ) : (
            <>
              <div ref={monthListScrollRef} className="space-y-2 md:max-h-72 md:overflow-y-auto pr-0.5" /* U6 (session 33): grows on a phone, a box from md up */>
                {monthTx.map((tx, i) => {
                  // Safe again now that TRANSFER is a real TX_BUCKETS member
                  // (2.4.55 sub-phase 3) -- the ?? TRANSFER_META fallback
                  // this replaced (2.4.56) is no longer reachable.
                  const b = TX_BUCKETS.find((b) => b.value === tx.bucket)!;
                  const divergence = cycleMonthDivergence(tx, financials.recurring ?? [], startDay);
                  return (
                    <div key={tx.id} data-month-entry data-entry-row className={!showAllMonth && i >= PHONE_MONTH_ROWS ? "max-md:hidden" : undefined}>
                        <EntryRow variant="month" tx={tx} b={b} divergence={divergence} financials={financials} cards={cards} logAgain={logAgain} onEdit={onEdit} softDeleteTransaction={softDeleteTransaction} />
                    </div>
                  );
                })}
                {recurRowsThisMonth.map(({ r, usd }) => {
                  const b = TX_BUCKETS.find((bb) => bb.value === r.bucket)!;
                  return (
                    <div
                      key={`recur-${r.id}`}
                      className="flex items-center justify-between rounded-xl px-3 py-2.5"
                      style={{ background: T.panelSoft, borderLeft: `3px solid ${b.color}`, opacity: 0.85 }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm flex-shrink-0">↻</span>
                        <div className="min-w-0">
                          <span className="text-xs truncate block" style={{ color: T.text }}>{r.emoji ? `${r.emoji} ` : ""}{r.name}</span>
                          <span className="text-[9px]" style={{ color: T.mute }}>Recurring · {FREQ_LABELS[r.frequency]}</span>
                        </div>
                      </div>
                      <span className="text-xs font-semibold tabular-nums flex-shrink-0" style={{ color: b.color }}>
                        {fmtCur(usd, "USD")}
                      </span>
                    </div>
                  );
                })}
              </div>
              {!showAllMonth && monthTx.length > PHONE_MONTH_ROWS && (
                <button
                  onClick={() => setShowAllMonth(true)}
                  className="md:hidden w-full text-xs font-semibold px-3 py-2 rounded-xl hover:opacity-90"
                  style={{ background: T.panelSoft, color: T.text, border: `1px solid ${T.line}` }}
                >
                  Show all
                </button>
              )}
              <div
                className="flex justify-between text-xs px-3 py-2 rounded-xl"
                style={{ background: T.ink, color: T.mute }}
              >
                <span>
                  {monthTx.length} {monthTx.length === 1 ? "entry" : "entries"}
                  {recurRowsThisMonth.length > 0 && ` + ${recurRowsThisMonth.length} recurring`}
                </span>
                <span className="font-semibold tabular-nums" style={{ color: T.text }}>{fmt(totalOut)} logged</span>
              </div>
            </>
          )}
        </Section>

        {/* History — past months */}
        {(() => {
          const pastTx = activeTx.filter((t) => !isInCycle(t.date, prefix, startDay));
          if (pastTx.length === 0) return null;
          return (
            <Section title="History" icon="📚" badge={pastTx.length} defaultOpen={false}>
              <BuiltWhenOpen render={() => {
          const byMonth: Record<CycleKey, StoredTransaction[]> = {} as Record<CycleKey, StoredTransaction[]>;
          pastTx.forEach((t) => {
            const ym = cycleKeyForISO(t.date, startDay);
            if (!byMonth[ym]) byMonth[ym] = [];
            byMonth[ym].push(t);
          });
          // Keys here are built by cycleKeyForISO above, so they are cycle
          // keys and get the range form (2.4.120).
          const label = (ym: CycleKey) => cycleLabel(ym, startDay);
          return (
              <div className="space-y-4">
                {/* Object.keys erases the brand -- it returns string[] whatever
                    the Record says, deliberately, because an object may carry keys
                    beyond its declared type. Re-asserted here, the same way
                    TransactionsScreen:556 does (2.4.96, fourth row). */}
                {(Object.keys(byMonth) as CycleKey[]).sort().reverse().map((ym) => {
                  const txs = byMonth[ym];
                  // Excludes INCOME, matching the current month's total just
                  // above (totalOut) and every other "spend" figure in the
                  // app -- this used to include it, inflating past months'
                  // totals for anyone who ever logged a gift/reimbursement.
                  // TRANSFER (2.4.55) excluded too -- not spend, and its
                  // amount can be negative (an incoming leg).
                  // Session 19: the shared spending rule (lib/spending.ts): a change-back nets against Wants; income, transfers and other reimbursements stay out.
                  const total = totalSpent(txs, (t) => toUSDOn(t.amount, t.currency, t.date));
                  return (
                    <div key={ym}>
                      <div className="flex justify-between items-center mb-2">
                        <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.mute }}>{label(ym)}</p>
                        <p className="text-[10px] tabular-nums font-semibold" style={{ color: T.text }}>{fmt(total)}</p>
                      </div>
                      <div className="space-y-1.5">
                        {txs.sort((a, b) => b.date.localeCompare(a.date)).map((tx) => {
                          const b = TX_BUCKETS.find((b) => b.value === tx.bucket)!;
                          const divergence = cycleMonthDivergence(tx, financials.recurring ?? [], startDay);
                          return (
                            <div key={tx.id} data-entry-row>
                                <EntryRow variant="history" tx={tx} b={b} divergence={divergence} financials={financials} cards={cards} logAgain={logAgain} onEdit={onEdit} softDeleteTransaction={softDeleteTransaction} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
          );
              }} />
            </Section>
          );
        })()}

        </>}

        {/* ── SETUP TAB (continued) — Goals, Recurring, Debts ─ */}
        {activeTab === "setup" && <>

        {/* Goals */}
        <Section title="Goals" icon="🎯" badge={financials.goals.length} defaultOpen={false}>
          <GoalsSection financials={financials} update={update} lbpRate={lbpRate} cards={cards} saveCard={saveCard} showToast={showToast} onEdit={onEdit} form={goalsForm} />
        </Section>

        {/* Recurring Payments */}
        <Section title="Recurring Payments" icon="🔁" badge={(financials.recurring ?? []).length} defaultOpen={false}>
          {(() => {
            const recs = financials.recurring ?? [];
            const now  = new Date();
            // Nominal (payment-status-independent) figures -- this section is
            // "what am I committed to," which shouldn't dip to $0 for a bill
            // that's simply already been paid this cycle. Actual spend/budget
            // totals elsewhere keep using monthlyEquivalent, which correctly
            // suppresses a paid cycle to avoid double-counting real spend.
            // CUR-01: each item's figure is in its OWN currency, so convert
            // before adding -- the same toUSD RecurringScreen applies.
            const totalMonthly = recs.reduce((s, r) => s + toUSD(nominalMonthlyEquivalent(r, financials.transactions, financials, now), r.currency), 0);
            return (
              <>
                {recs.length > 0 && (
                  <div className="space-y-2 mb-1">
                    {recs.map((r) => {
                      const mo     = nominalMonthlyEquivalent(r, financials.transactions, financials, now);
                      const b      = BUCKETS.find((b) => b.value === r.bucket)!;
                      const cur    = r.currency ?? "USD";
                      const sym    = cur === "LBP" ? "L£" : "$";
                      const target = nextConfirmTarget(r, financials.transactions, financials, today);
                      // 2.4.112: "ended" is now asked of BOTH bounds, because
                      // isRecurringActive no longer guesses exhaustion from
                      // elapsed time. A capped item is over when the money is
                      // spent -- remainingInstallments returns null then --
                      // and otherwise only when its endDate passes.
                      //
                      // This also closes a bug the old form had in the other
                      // direction: an item paid off EARLY kept reading as live
                      // until the calendar caught up.
                      const ended  = !isRecurringActive(r, now)
                        || (r.totalAmount != null && remainingInstallments(r, financials.transactions, financials, today) === null);
                      const overdue = (target?.overdueCount ?? 0) > 0;
                      // Covers both "confirmed on time" and "confirmed early" (paid ahead of its due date) -- either way still shown as paid.
                      const paidThisCycle = target ? isCycleConfirmed(r, target.dueDate, financials.transactions) : false;
                      const paid   = r.totalAmount ? recurringPaidSoFar(r, financials.transactions, financials) : null;
                      const pct    = paid != null && r.totalAmount ? Math.min(100, (paid / r.totalAmount) * 100) : null;
                      const remaining = !ended ? remainingInstallments(r, financials.transactions, financials, today) : null;
                      const isAddingExtra = extraRecId === r.id;
                      const isConfirming  = confirmingRecId === r.id;
                      const justConfirmed = justConfirmedIds?.has(r.id);
                      return (
                        <div key={r.id}>
                          <div
                            className="rounded-xl px-3 py-2.5"
                            style={{
                              background: T.panelSoft,
                              borderLeft: `3px solid ${ended ? T.mute : b.color}`,
                              opacity: ended ? 0.5 : 1,
                            }}
                          >
                            <div className="flex items-start justify-between gap-2 group">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm" style={{ color: T.text }}>
                                  {r.emoji} {r.name}
                                  {ended && <span className="ml-1.5 text-[9px] uppercase tracking-wider" style={{ color: T.mute }}>ended</span>}
                                  {!ended && overdue && <span className="ml-1.5 text-[9px] uppercase tracking-wider" style={{ color: T.coral }}>overdue{target!.overdueCount > 1 ? ` ×${target!.overdueCount}` : ""}</span>}
                                  {!ended && !overdue && paidThisCycle && <span className="ml-1.5 text-[9px] uppercase tracking-wider" style={{ color: T.jade }}>✓ paid</span>}
                                  <span className="ml-1.5 text-[9px] uppercase tracking-wider px-1 rounded" style={{ background: cur === "LBP" ? T.brass + "22" : T.jade + "15", color: cur === "LBP" ? T.brass : T.jade }}>{cur}</span>
                                </p>
                                <p className="text-[10px] mt-0.5 tabular-nums" style={{ color: T.mute }}>
                                  {sym}{r.amount.toLocaleString("en-US")} · {FREQ_LABELS[r.frequency]}
                                  <span style={{ color: b.color }}> · {b.label}</span>
                                </p>
                                {r.createdAt && (
                                  <p className="text-[9px] mt-0.5" style={{ color: T.mute }}>Added {fmtDate(r.createdAt)}</p>
                                )}
                                {r.totalAmount ? (
                                  <div className="mt-1.5">
                                    <div className="flex justify-between text-[9px] mb-0.5" style={{ color: T.mute }}>
                                      <span>{sym}{(paid ?? 0).toLocaleString("en-US")} paid</span>
                                      <span>{sym}{r.totalAmount.toLocaleString("en-US")} total</span>
                                    </div>
                                    <div className="h-1 rounded-full overflow-hidden" style={{ background: T.line }}>
                                      <div className="h-full rounded-full transition-all" style={{ width: `${pct ?? 0}%`, background: ended ? T.mute : b.color }} />
                                    </div>
                                    {remaining && (
                                      <p className="text-[9px] mt-1" style={{ color: T.mute }}>
                                        {remaining.count} payment{remaining.count === 1 ? "" : "s"} left · ends {fmtDate(remaining.endsOn.toISOString().slice(0, 10))}
                                      </p>
                                    )}
                                  </div>
                                ) : (
                                  <p className="text-[10px] mt-0.5" style={{ color: T.mute }}>
                                    {fmtDate(r.startDate)} → {r.endDate ? fmtDate(r.endDate) : <span style={{ color: T.jade }}>∞ ongoing</span>}
                                    {remaining && ` · ${remaining.count} left`}
                                  </p>
                                )}
                              </div>
                              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                <span className="text-xs font-semibold tabular-nums" style={{ color: b.color }}>
                                  {sym}{Math.round(mo).toLocaleString("en-US")}<span className="font-normal" style={{ color: T.mute }}>/mo</span>
                                </span>
                                <div className="flex gap-1.5 opacity-70 transition-opacity">
                                  <button
                                    onClick={() => onEdit("recurring", r.id)}
                                    aria-label="Edit recurring payment"
                                    className="text-[10px] px-1.5 py-0.5 rounded transition-all hover:opacity-80"
                                    style={{ color: T.brass, border: `1px solid ${T.brass}40` }}
                                  >✎</button>
                                  {!ended && target && onConfirmRecurring && (
                                    <button
                                      onClick={() => { setConfirmingRecId(isConfirming ? null : r.id); setConfirmDate(target.dueDate.toISOString().slice(0, 10)); }}
                                      disabled={loggingRecurringIds?.has(r.id)}
                                      aria-label={`Confirm this ${r.name} payment`}
                                      className="text-[10px] px-1.5 py-0.5 rounded transition-all hover:opacity-80 disabled:opacity-40 disabled:hover:opacity-40"
                                      style={{ color: justConfirmed ? T.jade : overdue ? T.coral : T.jade, border: `1px solid ${(justConfirmed ? T.jade : overdue ? T.coral : T.jade)}40` }}
                                    >
                                      {loggingRecurringIds?.has(r.id) ? "Confirming…" : justConfirmed ? "Confirmed ✓" : "Confirm"}
                                    </button>
                                  )}
                                  {!ended && (
                                    <button
                                      onClick={() => { setExtraRecId(isAddingExtra ? null : r.id); setExtraRecAmt(""); }}
                                      aria-label="Log an extra payment"
                                      className="text-[10px] px-1.5 py-0.5 rounded transition-all hover:opacity-80"
                                      style={{ color: T.jade, border: `1px solid ${T.jade}40` }}
                                    >
                                      +extra
                                    </button>
                                  )}
                                  <button
                                    onClick={() => {
                                      if (!confirm("Delete this recurring payment?")) return;
                                      // 2.4.35: every transaction confirmed against this item would
                                      // otherwise keep a permanently dangling recurringId/cycleDate --
                                      // detach both, same as the edit-transaction form's own Detach
                                      // button does deliberately (cycleDate: null, recurringId has no
                                      // sentinel need per its own comment, so undefined). The
                                      // transaction itself is real spend/income and stays.
                                      update({
                                        recurring: recs.filter((x) => x.id !== r.id),
                                        deletedKeys: recordDeletion(financials, "recurring", r.id),
                                        // 2.4.126: extraForRecurringId is cleared here too. It is a
                                        // link to this same item and would dangle exactly the way
                                        // 2.4.35 describes -- but it gets no cycleDate sentinel,
                                        // because an extra payment never settled a cycle to detach
                                        // from. Undefined is the whole of its cleared state.
                                        transactions: financials.transactions.map((t) =>
                                          t.recurringId !== r.id && t.extraForRecurringId !== r.id ? t : {
                                            ...t,
                                            ...(t.recurringId === r.id ? { recurringId: undefined, cycleDate: null } : {}),
                                            ...(t.extraForRecurringId === r.id ? { extraForRecurringId: undefined } : {}),
                                            updatedAt: new Date().toISOString(),
                                          }
                                        ),
                                      });
                                    }}
                                    aria-label="Delete recurring payment"
                                    className="text-xs"
                                    style={{ color: T.coral }}
                                  >✕</button>
                                </div>
                              </div>
                            </div>
                            {/* Extra payment inline form */}
                            {isAddingExtra && (
                              <div className="mt-2 pt-2 space-y-2" style={{ borderTop: `1px solid ${T.line}` }}>
                                <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.jade }}>
                                  Log extra payment this {noun}
                                </p>
                                <div className="flex gap-2">
                                  <div className="flex-1">
                                    <MoneyInput
                                      value={extraRecAmt}
                                      onChange={setExtraRecAmt}
                                      placeholder="Extra amount"
                                      max={moneyMaxFor(r.currency, lbpRate)}
                                    />
                                  </div>
                                  <button
                                    onClick={() => logExtraPayment(r)}
                                    className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all hover:opacity-90"
                                    style={{ background: T.jade, color: T.ink }}
                                  >
                                    Log
                                  </button>
                                  <button
                                    onClick={() => setExtraRecId(null)}
                                    aria-label="Cancel extra payment"
                                    className="px-2 py-1.5 rounded-xl text-xs transition-all hover:opacity-70"
                                    style={{ color: T.mute }}
                                  >✕</button>
                                </div>
                                <p className="text-[10px]" style={{ color: T.mute }}>
                                  Logged as a transaction in {b.label} · {cur} this {noun}.
                                </p>
                              </div>
                            )}
                            {/* Confirm inline form (2.4.30, finding A) -- date actually paid, defaults to the cycle's own due date */}
                            {isConfirming && target && (
                              <div className="mt-2 pt-2 space-y-2" style={{ borderTop: `1px solid ${T.line}` }}>
                                <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.jade }}>
                                  Confirm payment
                                </p>
                                <div className="flex gap-2 items-end">
                                  <div className="flex-1">
                                    <Label htmlFor={`confirm-date-${r.id}`}>Date actually paid</Label>
                                    <DateFieldDMY id={`confirm-date-${r.id}`} value={confirmDate} onChange={setConfirmDate} />
                                  </div>
                                  <button
                                    onClick={() => {
                                      onConfirmRecurring?.(r.id, confirmDate ? new Date(confirmDate) : undefined);
                                      setConfirmingRecId(null);
                                    }}
                                    className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all hover:opacity-90"
                                    style={{ background: T.jade, color: T.ink }}
                                  >
                                    Confirm
                                  </button>
                                  <button
                                    onClick={() => setConfirmingRecId(null)}
                                    aria-label="Cancel confirm"
                                    className="px-2 py-1.5 rounded-xl text-xs transition-all hover:opacity-70"
                                    style={{ color: T.mute }}
                                  >✕</button>
                                </div>
                                {(() => {
                                  // 2.4.36: a confirmed transaction's date can land a month away
                                  // from the cycle it settles with nothing surfacing the mismatch
                                  // until the edit form is opened -- warn live, here, at the one
                                  // point where it's still easy to fix. Warns, doesn't block: a
                                  // genuinely late/early payment across a month boundary stays
                                  // fully legitimate.
                                  const dueYm = cycleKeyForISO(target.dueDate.toISOString(), startDay);
                                  const diverges = !!confirmDate && cycleKeyForISO(confirmDate, startDay) !== dueYm;
                                  // dueYm is a cycle key (cycleKeyForISO, line above).
                                  const dueMonthLabel = cycleLabel(dueYm, startDay);
                                  return (
                                    <p className="text-[10px]" style={{ color: diverges ? T.brass : T.mute }}>
                                      {diverges
                                        ? `⚠ This settles the ${dueMonthLabel} cycle, but you're dating it a different month.`
                                        : `Due ${fmtDate(target.dueDate.toISOString().slice(0, 10))} · defaults to the due date if left as-is.`}
                                    </p>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    <div
                      className="flex justify-between items-center text-xs px-3 py-2 rounded-xl"
                      style={{ background: T.ink, color: T.mute }}
                    >
                      <span>{recs.length} recurring</span>
                      <span className="font-semibold tabular-nums" style={{ color: T.text }}>
                        ${Math.round(totalMonthly).toLocaleString("en-US")}<span style={{ color: T.mute }}>/mo total</span>
                      </span>
                    </div>
                  </div>
                )}

                {recs.length === 0 && (
                  <div
                    className="rounded-xl px-4 py-6 text-center mb-2"
                    style={{ background: T.panelSoft, border: `1px dashed ${T.line}` }}
                  >
                    <p className="text-2xl mb-1">🔁</p>
                    <p className="text-xs" style={{ color: T.mute }}>Rent, subscriptions, loan payments…</p>
                  </div>
                )}

                {/* Add form */}
                <div className="rounded-xl p-4 space-y-3" style={{ background: T.ink, border: `1px solid ${T.line}` }}>
                  <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.jade }}>New recurring payment</p>

                  <div className="flex gap-2">
                    <div style={{ width: 68 }}>
                      <Label htmlFor="new-rec-emoji">Icon</Label>
                      <FocusInput id="new-rec-emoji" value={rEmoji} onChange={(e) => setREmoji(e.target.value)} placeholder="🔁" />
                    </div>
                    <div className="flex-1">
                      <Label htmlFor="new-rec-name">Name</Label>
                      <FocusInput id="new-rec-name" value={rName} onChange={(e) => setRName(e.target.value)} placeholder="Rent, Netflix, gym…" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label htmlFor="new-rec-amount">Amount</Label>
                      <MoneyInput id="new-rec-amount" value={rAmount} onChange={setRAmount} placeholder="0" max={moneyMaxFor(rCurrency, lbpRate)} />
                    </div>
                    <div>
                      <Label htmlFor="new-rec-freq">Frequency</Label>
                      <select
                        id="new-rec-freq"
                        value={rFreq}
                        onChange={(e) => setRFreq(e.target.value as RecurringFrequency)}
                        className="w-full rounded-xl px-3 py-2.5 text-sm"
                        style={{ background: T.panelSoft, border: `1px solid ${T.line}`, color: T.text, outline: "none", colorScheme: "dark" }}
                      >
                        {(Object.keys(FREQ_LABELS) as RecurringFrequency[]).map((f) => (
                          <option key={f} value={f}>{FREQ_LABELS[f]}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <Label>Currency</Label>
                    <CurrencyToggle value={rCurrency} onChange={setRCurrency} />
                  </div>

                  <div>
                    <Label>Type</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {BUCKETS.map((b) => (
                        <button
                          key={b.value}
                          onClick={() => setRBucket(b.value)}
                          className="flex flex-col items-center gap-1 py-2 rounded-xl text-xs font-medium transition-all duration-150"
                          style={{
                            background: rBucket === b.value ? b.color + "22" : T.panelSoft,
                            border: `1px solid ${rBucket === b.value ? b.color : T.line}`,
                            color: rBucket === b.value ? b.color : T.mute,
                          }}
                        >
                          <span>{b.icon}</span>
                          <span>{b.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="new-rec-category">Category</Label>
                    <select
                      id="new-rec-category"
                      value={rCategory}
                      onChange={(e) => setRCategory(e.target.value)}
                      className="w-full rounded-xl px-3 py-2.5 text-sm"
                      style={{ background: T.panelSoft, border: `1px solid ${T.line}`, color: T.text, outline: "none", colorScheme: "dark" }}
                    >
                      <option value="">No category</option>
                      <CategoryOptions customCategories={financials.customCategories} />
                    </select>
                  </div>

                  <div>
                    <Label htmlFor="new-rec-start">Start date</Label>
                    <DateFieldDMY id="new-rec-start" value={rStart} onChange={setRStart} />
                  </div>

                  <div>
                    <Label>Ends</Label>
                    <div className="grid grid-cols-3 gap-1.5 mb-2">
                      {(["infinite", "date", "amount"] as const).map((t) => (
                        <button
                          key={t}
                          onClick={() => setREndType(t)}
                          className="py-2 rounded-xl text-xs font-medium transition-all"
                          style={{
                            background: rEndType === t ? T.jade + "22" : T.panelSoft,
                            border: `1px solid ${rEndType === t ? T.jade : T.line}`,
                            color: rEndType === t ? T.jade : T.mute,
                          }}
                        >
                          {t === "infinite" ? "∞ Never" : t === "date" ? "📅 By date" : "💰 By amount"}
                        </button>
                      ))}
                    </div>
                    {rEndType === "date" && (
                      <DateFieldDMY value={rEnd} onChange={setREnd} />
                    )}
                    {rEndType === "amount" && (
                      <div>
                        <MoneyInput
                          value={rTotalAmount}
                          onChange={setRTotalAmount}
                          placeholder="Total amount e.g. 10,000"
                          max={moneyMaxFor(rCurrency, lbpRate)}
                        />
                        {rAmount && rTotalAmount && (
                          <p className="text-[10px] mt-1 px-1 tabular-nums" style={{ color: T.mute }}>
                            ≈ <span style={{ color: T.jade }}>
                              {Math.ceil(parseFloat(rTotalAmount.replace(/,/g, "")) / parseFloat(rAmount.replace(/,/g, "")))} payments
                              · {(Math.ceil(parseFloat(rTotalAmount.replace(/,/g, "")) / parseFloat(rAmount.replace(/,/g, ""))) / FREQ_MONTHLY[rFreq]).toFixed(1)} months
                            </span>
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {rAmount && (
                    <p className="text-[10px] tabular-nums px-1" style={{ color: T.mute }}>
                      ≈ <span style={{ color: T.jade }}>{rCurrency === "LBP" ? "L£" : "$"}{(parseFloat(rAmount.replace(/,/g, "") || "0") * FREQ_MONTHLY[rFreq]).toFixed(2)}/month</span>
                    </p>
                  )}

                  <PrimaryBtn onClick={addRecurring} color={T.jade} disabled={!rName.trim() || !rAmount || !rStart}>+ Add recurring</PrimaryBtn>
                </div>
              </>
            );
          })()}
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
