"use client";

import { useState, useRef } from "react";
import type {
  LocalFinancials, StoredTransaction, StoredGoal, StoredDebt,
  StoredRecurring, StoredCard, RecurringFrequency, Currency, PaymentMethod, BudgetRuleKey, TrackedBalance,
} from "../lib/localData";
import type { Session } from "../lib/auth";
import type { computeDashboard } from "../lib/computeDashboard";
import { uid, todayISO, fmtDate, FREQ_LABELS, FREQ_MONTHLY, BUDGET_RULES, historizedRecurringContribution, nominalMonthlyEquivalent, isRecurringActive, nextConfirmTarget, isCycleConfirmed, cycleMonthDivergence, recurringPaidSoFar, toUSD as toUSDShared, withRate, applyGoalContribution, looksRecurring, buildQuickRecurring, allCategories, categoryLabel, categoryIcon, matchCategoryRule, roundMoney, derivedDebtBalance, activeTransactions, DEFAULT_DATA, DEFAULT_LBP_RATE } from "../lib/localData";
import { useTheme } from "../contexts/ThemeContext";
import { Signet } from "./EssaBrand";
import { Label, FocusInput, MoneyInput, PrimaryBtn, Section, CurrencyToggle, DateFieldDMY, PM_OPTIONS, CARD_TYPES, PaymentMethodPicker, CardPicker } from "./form/Primitives";
import { fmtCur } from "./screens/shared";
import ImportStatement from "./ImportStatement";

type Bucket = "NEEDS" | "WANTS" | "SAVINGS";
// Transactions (not recurring items) can also be logged as one-off INCOME --
// see StoredTransaction's doc comment in localData.ts for why recurring stays
// 3-way.
type TxBucket = Bucket | "INCOME";
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
  /** Confirms one specific pre-cutover cycle (2.4.31 backfill) -- dated to that cycle's own historical due date, not today. */
  onBackfillRecurring?: (recurringId: string, dueDate: Date) => void;
  /** `${recurringId}:${dueISO}` keys whose backfill write is currently in flight. */
  backfillingIds?: Set<string>;
  /** Opens the shared edit surface (page.tsx) for the given entity -- one implementation per kind, shared with each entity's own standalone screen. */
  onEdit: (kind: "transaction" | "debt" | "recurring" | "goal", id: string) => void;
  /** Opens the shared "record a payment" surface (page.tsx) for a debt -- shared with DebtsScreen. */
  onPay: (debtId: string) => void;
}

export default function InputPanel({ financials, dashData, onChange, session, onConfirmRecurring, loggingRecurringIds, justConfirmedIds, onBackfillRecurring, backfillingIds, onEdit, onPay }: Props) {
  const T = useTheme();
  const BUCKETS: { value: Bucket; label: string; icon: string; color: string }[] = [
    { value: "NEEDS",   label: "Needs",   icon: "🏠", color: T.sky   },
    { value: "WANTS",   label: "Wants",   icon: "✨", color: T.brass },
    { value: "SAVINGS", label: "Savings", icon: "💰", color: T.jade  },
  ];
  // Transaction-only picker (adds Income) -- recurring pickers keep using
  // BUCKETS above unchanged, since recurring income already has its own home
  // in the Setup income field.
  const TX_BUCKETS: { value: TxBucket; label: string; icon: string; color: string }[] = [
    ...BUCKETS,
    { value: "INCOME", label: "Income", icon: "📥", color: T.jade },
  ];
  const update = (patch: Partial<LocalFinancials>) => onChange({ ...financials, ...patch });

  // Transaction form
  const [txAmt,    setTxAmt]    = useState("");
  const [txBucket, setTxBucket] = useState<TxBucket>("NEEDS");
  const [txCategory, setTxCategory] = useState<string>("");
  const [txDesc,   setTxDesc]   = useState("");
  const [txDate,   setTxDate]   = useState(todayISO());
  const [txCurrency,  setTxCurrency]  = useState<Currency>("USD");
  // Batch C (dual-currency single transaction, 2026-08-31): one real
  // payment split across both currencies ($10 USD + L£200,000 as one
  // bill). Deliberately excludes EF/debt-linking and the card-add flow's
  // typo guard -- kept to the case actually asked for, not a redesign of
  // the whole entry form. See localData.ts's linkedPaymentId doc comment
  // for what this does and does not do downstream.
  const [txSplitMode, setTxSplitMode] = useState(false);
  const [txSplitUSD,  setTxSplitUSD]  = useState("");
  const [txSplitLBP,  setTxSplitLBP]  = useState("");
  const [txPayMethod, setTxPayMethod] = useState<PaymentMethod>("cash");
  const [txPayNote,   setTxPayNote]   = useState("");
  const [txAddToEF,   setTxAddToEF]   = useState(false);
  const [txFromEF,    setTxFromEF]    = useState(false);
  // Phase 2.6.3c: how much of this transaction is EF-related -- blank means
  // "the full transaction amount" (today's implicit behavior, zero extra
  // typing for the common case), a typed value overrides it down to a
  // partial amount. Entered in the transaction's own currency, like txAmt
  // itself -- converted to USD at commit, same as amtUSD.
  const [txEfAmt,     setTxEfAmt]     = useState("");
  const [txCardId,    setTxCardId]    = useState<string | null>(null);
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

  // Goal form
  const [gName,    setGName]    = useState("");
  const [gEmoji,   setGEmoji]   = useState("🎯");
  const [gTarget,  setGTarget]  = useState("");
  const [gCurrent, setGCurrent] = useState("");
  const [gDate,    setGDate]    = useState("");
  const [gCurrency, setGCurrency] = useState<Currency>("USD");

  // Debt form
  const [dName,    setDName]    = useState("");
  const [dBalance, setDBalance] = useState("");
  const [dApr,     setDApr]     = useState("");
  const [dMin,     setDMin]     = useState("");
  const [dCurrency, setDCurrency] = useState<Currency>("USD");
  // Debt payment lives in the shared PayDebtSheet (page.tsx).

  // Asset form
  const [aName,     setAName]     = useState("");
  const [aValue,    setAValue]    = useState("");
  const [aCurrency, setACurrency] = useState<Currency>("USD");

  // Tracked balance (reconciliation) form
  const [tbName,        setTbName]        = useState("");
  const [tbMethod,      setTbMethod]      = useState<PaymentMethod>("cash");
  const [tbCardId,      setTbCardId]      = useState("");
  const [tbStartBal,    setTbStartBal]    = useState("");
  const [tbStartDate,   setTbStartDate]   = useState(todayISO());
  const [tbCurrency,    setTbCurrency]    = useState<Currency>("USD");
  const [actualInputs,  setActualInputs]  = useState<Record<string, string>>({});

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

  // Goal contribution state
  const [contributeGoalId,  setContributeGoalId]  = useState<string | null>(null);
  const [contributeGoalAmt, setContributeGoalAmt] = useState("");
  // Phase 2.6.4: closes half of 2.4.41 -- buildGoalContributionTx used to
  // hardcode paymentMethod "other" unconditionally.
  const [contributeMethod, setContributeMethod] = useState<PaymentMethod>("cash");
  const [contributeCardId, setContributeCardId] = useState<string | null>(null);
  const [contributeOtherNote, setContributeOtherNote] = useState("");
  // 2.4.47: date defaults to today but is editable, same gap as the
  // debt-payment form.
  const [contributeDate, setContributeDate] = useState(todayISO());

  // ── edit state ──────────────────────────────────────────────── //
  // Debt editing itself now lives in the shared EditDebtSheet (page.tsx) --
  // see the "usability backlog" comment there. dOpenedDate below is the New
  // Debt form's own field, unrelated to editing an existing one.
  const [dOpenedDate,      setDOpenedDate]      = useState("");

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
    if (last4.length !== 4 || !/^\d{4}$/.test(last4)) return null;
    const card: StoredCard = { id: uid(), type, last4, label: `${type} •••• ${last4}` };
    update({ cards: [...cards, card] });
    return card;
  }

  function addTransaction() {
    const amt = parseFloat(txAmt);
    if (!amt || amt <= 0) return;
    if (txCurrency === "LBP" && amt < 500) {
      setLbpConfirm({ amount: amt, proceed: commitTransaction });
      return;
    }
    commitTransaction();
  }

  // Shared by commitTransaction and commitSplitTransaction -- resolves the
  // card being paid with (saves a new one if the add-card panel is open),
  // so this small but easy-to-get-wrong bit of logic isn't duplicated.
  function resolveCard(): { cardId?: string; cardLabel?: string } {
    if (txPayMethod !== "card") return {};
    if (showAddCard) {
      const saved = saveCard(newCardType, newCardLast4);
      if (saved) { setNewCardLast4(""); setShowAddCard(false); return { cardId: saved.id, cardLabel: saved.label }; }
      return {};
    }
    if (txCardId) {
      const card = cards.find((c) => c.id === txCardId);
      if (card) return { cardId: card.id, cardLabel: card.label };
    }
    return {};
  }

  function commitTransaction() {
    const amt = parseFloat(txAmt);
    if (!amt || amt <= 0) return;
    const { cardId, cardLabel } = resolveCard();
    const amtUSD = txCurrency === "LBP" ? amt / (financials.lbpRate ?? DEFAULT_LBP_RATE) : amt;
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
    const efAmtUSD = txCurrency === "LBP" ? efAmtRaw / (financials.lbpRate ?? DEFAULT_LBP_RATE) : efAmtRaw;
    const now = new Date().toISOString();
    const tx: StoredTransaction = {
      id: uid(), amount: amt, currency: txCurrency, bucket: txBucket,
      description,
      date: txDate,
      paymentMethod: txPayMethod,
      createdAt: now, updatedAt: now,
      ...withRate(txCurrency, financials.lbpRate ?? DEFAULT_LBP_RATE),
      ...(autoCategory ? { category: autoCategory } : {}),
      ...(txPayMethod === "other" && txPayNote.trim() ? { paymentNote: txPayNote.trim() } : {}),
      ...(cardId ? { cardId, cardLabel } : {}),
      ...(txBucket === "SAVINGS" && txAddToEF ? { efAmount: roundMoney(efAmtUSD) } : {}),
      ...(txBucket !== "SAVINGS" && txBucket !== "INCOME" && txFromEF ? { efAmount: roundMoney(-efAmtUSD) } : {}),
    };
    update({ transactions: [tx, ...financials.transactions] });
    setTxAmt(""); setTxDesc(""); setTxPayNote(""); setTxAddToEF(false); setTxFromEF(false); setTxEfAmt(""); setTxCategory("");
  }

  // Batch C: one real payment, two currency legs, sharing everything except
  // amount/currency (description/date/bucket/category/payment method are
  // entered once). Each leg is built the same way commitTransaction builds
  // its one -- no EF/debt-linking here, that's the normal single-currency
  // form's job. linkedPaymentId is the only thing tying the two together,
  // and it's stamped identically on both -- see its own doc comment in
  // localData.ts for why nothing downstream may read it as anything other
  // than a display hint.
  function commitSplitTransaction() {
    const amtUSDLeg = parseFloat(txSplitUSD.replace(/,/g, ""));
    const amtLBPLeg = parseFloat(txSplitLBP.replace(/,/g, ""));
    if (!(amtUSDLeg > 0) || !(amtLBPLeg > 0)) return;
    const { cardId, cardLabel } = resolveCard();
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
    };
    const legUSD: StoredTransaction = { id: uid(), amount: amtUSDLeg, currency: "USD", ...shared };
    const legLBP: StoredTransaction = {
      id: uid(), amount: amtLBPLeg, currency: "LBP", ...shared,
      ...withRate("LBP", financials.lbpRate ?? DEFAULT_LBP_RATE),
    };
    update({ transactions: [legUSD, legLBP, ...financials.transactions] });
    setTxSplitUSD(""); setTxSplitLBP(""); setTxSplitMode(false); setTxDesc(""); setTxPayNote(""); setTxCategory("");
  }

  function addGoal() {
    if (!gName.trim() || !gTarget || !gDate) return;
    const goal: StoredGoal = {
      id: uid(), name: gName.trim(), emoji: gEmoji || "🎯",
      targetAmount: parseFloat(gTarget.replace(/,/g, "")),
      currentAmount: parseFloat(gCurrent.replace(/,/g, "")) || 0,
      // Currency is locked at creation and never editable afterward --
      // contributions are recorded against a goal in this currency, and
      // changing it later would silently reinterpret them. See
      // buildGoalContributionTx in localData.ts.
      currency: gCurrency,
      ...withRate(gCurrency, financials.lbpRate ?? DEFAULT_LBP_RATE),
      targetDate: gDate,
      createdAt: new Date().toISOString(),
    };
    update({ goals: [...financials.goals, goal] });
    setGName(""); setGTarget(""); setGCurrent(""); setGDate(""); setGEmoji("🎯"); setGCurrency("USD");
  }

  function addDebt() {
    if (!dName.trim() || !dBalance) return;
    const balance = parseFloat(dBalance.replace(/,/g, ""));
    const debt: StoredDebt = {
      id: uid(), name: dName.trim(),
      balance,
      apr: Math.max(0, parseFloat(dApr) || 0),
      minPayment: parseFloat(dMin.replace(/,/g, "")) || 0,
      // Same reasoning as addGoal's currency field -- see its comment.
      currency: dCurrency,
      ...withRate(dCurrency, financials.lbpRate ?? DEFAULT_LBP_RATE),
      createdAt: new Date().toISOString(),
      ...(dOpenedDate ? { openedDate: dOpenedDate } : {}),
      // Phase 2.6.1 -- a brand-new debt has no history yet, so its own
      // starting balance IS its opening balance, trivially.
      openingBalance: balance,
    };
    update({ debts: [...financials.debts, debt] });
    setDName(""); setDBalance(""); setDApr(""); setDMin(""); setDOpenedDate(""); setDCurrency("USD");
  }

  function addAsset() {
    if (!aName.trim() || !aValue) return;
    const asset = {
      id: uid(), name: aName.trim(),
      value: parseFloat(aValue.replace(/,/g, "")),
      currency: aCurrency,
      ...withRate(aCurrency, financials.lbpRate ?? DEFAULT_LBP_RATE),
      createdAt: new Date().toISOString(),
    };
    update({ assets: [...(financials.assets ?? []), asset] });
    setAName(""); setAValue(""); setACurrency("USD");
  }

  function deleteAsset(id: string) {
    if (!confirm("Remove this asset?")) return;
    update({ assets: (financials.assets ?? []).filter((a) => a.id !== id) });
  }

  function addTrackedBalance() {
    if (!tbName.trim() || !tbStartBal) return;
    if (tbMethod === "card" && !tbCardId) return;
    const tb: TrackedBalance = {
      id: uid(), name: tbName.trim(), paymentMethod: tbMethod,
      ...(tbMethod === "card" ? { cardId: tbCardId } : {}),
      startingBalance: parseFloat(tbStartBal.replace(/,/g, "")),
      startingDate: tbStartDate, currency: tbCurrency,
      ...withRate(tbCurrency, financials.lbpRate ?? DEFAULT_LBP_RATE),
    };
    update({ trackedBalances: [...(financials.trackedBalances ?? []), tb] });
    setTbName(""); setTbMethod("cash"); setTbCardId(""); setTbStartBal(""); setTbStartDate(todayISO()); setTbCurrency("USD");
  }

  function updateActualBalance(id: string) {
    const raw = actualInputs[id];
    const amt = parseFloat((raw ?? "").replace(/,/g, ""));
    if (isNaN(amt)) return;
    // 2.4.42: this replaces the previous check in place, with no history
    // kept -- a mistyped figure silently destroys the last real snapshot.
    // Only worth confirming when there's actually a prior check to lose;
    // the very first "what you actually have now" entry for a tracked
    // balance has nothing behind it yet.
    const tb = (financials.trackedBalances ?? []).find((t) => t.id === id);
    if (tb?.actualBalance != null && !confirm(`Replace your last check (${fmtCur(tb.actualBalance, tb.currency)} on ${fmtDate(tb.actualBalanceDate ?? "")}) with this new figure? The old one won't be recoverable.`)) {
      return;
    }
    // Snapshot the live expected total (from dashData, already computed as
    // of right now) at the exact moment of confirming -- see
    // computeDashboard.ts's balanceChecks for why this can't be
    // reconstructed later from transaction dates.
    const expectedNow = dashData.balanceChecks.find((b) => b.id === id)?.expected;
    update({
      trackedBalances: (financials.trackedBalances ?? []).map((tb) =>
        tb.id !== id ? tb : { ...tb, actualBalance: amt, actualBalanceDate: new Date().toISOString(), expectedAtCheckUSD: expectedNow }),
    });
    setActualInputs((prev) => ({ ...prev, [id]: "" }));
  }

  function deleteTrackedBalance(id: string) {
    if (!confirm("Remove this tracked balance?")) return;
    update({ trackedBalances: (financials.trackedBalances ?? []).filter((tb) => tb.id !== id) });
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
    update({ recurring: [...(financials.recurring ?? []), rec] });
    setRName(""); setRAmount(""); setREmoji("🔁"); setRCategory(""); setRStart(todayISO()); setREnd(""); setRTotalAmount(""); setREndType("infinite");
  }

  /** Quick-add a Recurring item from a transaction that looksRecurring flagged — starts today, monthly, editable further in the Recurring screen. Past transactions are left untouched; this only affects future months. */
  function convertToRecurring(name: string, amount: string, currency: Currency, bucket: Bucket, category: string) {
    const rec = buildQuickRecurring(name, amount, currency, bucket, category);
    if (!rec) return;
    update({ recurring: [...(financials.recurring ?? []), rec] });
  }

  function contributeToGoal(goalId: string) {
    const amt = parseFloat(contributeGoalAmt.replace(/,/g, ""));
    if (!amt || amt <= 0) return;
    const goal = financials.goals.find((g) => g.id === goalId);
    if (!goal) return; // needed for the toast message below; applyGoalContribution does its own lookup for the actual update
    let cardId: string | undefined;
    let cardLabel: string | undefined;
    if (contributeMethod === "card" && contributeCardId) {
      const card = cards.find((c) => c.id === contributeCardId);
      if (card) { cardId = card.id; cardLabel = card.label; }
    }
    // AUD-05: shared with GoalsScreen.tsx's pay() -- one implementation of
    // "what happens when you contribute to a goal," not two independently
    // maintained copies (2334ea9 already proved that split lets a real bug
    // land on only one side).
    const result = applyGoalContribution(financials.goals, goalId, amt, financials.lbpRate ?? DEFAULT_LBP_RATE, {
      paymentMethod: contributeMethod, cardId, cardLabel,
      paymentNote: contributeMethod === "other" && contributeOtherNote.trim() ? contributeOtherNote.trim() : undefined,
      date: contributeDate || todayISO(),
    });
    if (!result) return;
    update({ goals: result.goals, transactions: [result.transaction, ...financials.transactions] });
    setContributeGoalId(null); setContributeGoalAmt("");
    setContributeMethod("cash"); setContributeCardId(null); setContributeOtherNote("");
    setContributeDate(todayISO());
    showToast(`Contribution added to ${goal.name}`);
  }

  function logExtraPayment(rec: StoredRecurring) {
    const amt = parseFloat(extraRecAmt.replace(/,/g, ""));
    if (!amt || amt <= 0) return;
    const now = new Date().toISOString();
    const tx: StoredTransaction = {
      id: uid(), amount: amt, currency: rec.currency,
      bucket: rec.bucket,
      ...(rec.category ? { category: rec.category } : {}),
      ...withRate(rec.currency, financials.lbpRate ?? DEFAULT_LBP_RATE),
      description: `Extra: ${rec.name}`,
      date: todayISO(),
      paymentMethod: "cash",
      createdAt: now, updatedAt: now,
    };
    update({ transactions: [tx, ...financials.transactions] });
    setExtraRecId(null); setExtraRecAmt("");
  }

  // ── edit helpers ───────────────────────────────────────────── //

  // Pausing stops the goal counting toward the health score's goal-pace
  // average and Projections' funding plan (see computeDashboard.ts's
  // goalScores / ProjectionsScreen's openGoals) while keeping it, and its
  // saved amount, around for history -- resuming (clearing pausedAt) is
  // fully reversible, matching how editing a debt's balance clears paidOffAt.
  function toggleGoalPause(goalId: string) {
    update({
      goals: financials.goals.map((g) => g.id !== goalId ? g : {
        ...g, pausedAt: g.pausedAt ? undefined : new Date().toISOString(),
      }),
    });
  }

  // Phase 2.6.3b: soft-delete -- stamps deletedAt instead of removing the
  // row, so it's recoverable from TransactionsScreen's "Recently deleted"
  // view rather than gone the moment "Delete transaction" is confirmed.
  function softDeleteTransaction(txId: string) {
    const now = new Date().toISOString();
    update({
      transactions: financials.transactions.map((t) => t.id !== txId ? t : { ...t, deletedAt: now, updatedAt: now }),
    });
    showToast("Deleted — recoverable in Transactions");
  }

  // ── tab state ─────────────────────────────────────────────────── //
  const [activeTab, setActiveTab] = useState<"daily" | "setup">("daily");

  // ── reset-all-data confirmation ──────────────────────────────────── //
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");

  // ── derived ───────────────────────────────────────────────────── //

  const prefix   = todayISO().slice(0, 7);
  // Phase 2.6.3b: a soft-deleted transaction must not keep counting toward
  // this month's totals or appear in "This month"'s list -- deleting is
  // meant to behave exactly like the old hard-delete from here on.
  const activeTx = activeTransactions(financials.transactions);
  const monthTx  = activeTx.filter((t) => t.date.startsWith(prefix));
  const now      = new Date();
  // nextConfirmTarget requires a UTC-midnight-anchored asOf, same contract as isCycleOverdue/dueCycles.
  const todayMidnight = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const lbpRate  = financials.lbpRate ?? DEFAULT_LBP_RATE;
  const toUSD    = (amt: number, cur?: Currency) => toUSDShared(amt, cur, lbpRate);
  const recs     = financials.recurring ?? [];
  // Recurring bills already fed the Needs/Wants/Savings totals just below
  // (and the Transactions screen's own list), but never appeared as rows in
  // "This month" here -- the one screen people actually check day to day.
  // Someone scanning for "did my rent go through" would never find it, even
  // though it was already counted in every total on this page.
  const recurRowsThisMonth = recs
    .map((r) => ({ r, usd: toUSD(historizedRecurringContribution(r, prefix, now), r.currency) }))
    .filter(({ usd }) => usd > 0);
  const needsOut = monthTx.filter((t) => t.bucket === "NEEDS").reduce((s, t)   => s + toUSD(t.amount, t.currency), 0)
                 + recs.filter((r) => r.bucket === "NEEDS").reduce((s, r)   => s + toUSD(historizedRecurringContribution(r, prefix, now), r.currency), 0);
  const wantsOut = monthTx.filter((t) => t.bucket === "WANTS").reduce((s, t)   => s + toUSD(t.amount, t.currency), 0)
                 + recs.filter((r) => r.bucket === "WANTS").reduce((s, r)   => s + toUSD(historizedRecurringContribution(r, prefix, now), r.currency), 0);
  const savOut   = monthTx.filter((t) => t.bucket === "SAVINGS").reduce((s, t) => s + toUSD(t.amount, t.currency), 0)
                 + recs.filter((r) => r.bucket === "SAVINGS").reduce((s, r) => s + toUSD(historizedRecurringContribution(r, prefix, now), r.currency), 0);
  const totalOut = needsOut + wantsOut + savOut;
  const fmt      = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  return (
    <>
    <aside
      className="flex flex-col h-full overflow-y-auto"
      style={{ background: T.panel }}
    >
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="px-6 pt-6 pb-5" style={{ borderBottom: `1px solid ${T.line}` }}>
        <div className="flex items-center gap-2.5 mb-1">
          <Signet size={28} />
          <span className="text-lg font-medium" style={{ color: T.text, fontFamily: "Spectral, Georgia, serif" }}>
            ESSA
          </span>
        </div>
        <p className="text-xs mt-0.5" style={{ color: T.mute }}>
          Earn · Spend · Save · Achieve
        </p>
        {session && (
          <p className="text-[11px] mt-2 font-medium" style={{ color: T.jade }}>
            {session.name}&apos;s finances
          </p>
        )}
      </div>

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
        <Section title="Log an entry" icon="📝" defaultOpen>
          {!txSplitMode ? (
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <Label htmlFor="tx-amount">Amount</Label>
                <MoneyInput
                  id="tx-amount"
                  value={txAmt}
                  onChange={setTxAmt}
                  placeholder="0"
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
                  <MoneyInput id="tx-split-usd" value={txSplitUSD} onChange={setTxSplitUSD} placeholder="0" />
                </div>
                <div>
                  <Label htmlFor="tx-split-lbp">Amount (LBP)</Label>
                  <MoneyInput id="tx-split-lbp" value={txSplitLBP} onChange={setTxSplitLBP} placeholder="0" />
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
                  onClick={() => setTxBucket(b.value)}
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
              {allCategories(financials.customCategories).map((c) => (
                <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
              ))}
            </select>
          </div>

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
                    Monthly savings target ({savPct}% of ${financials.income.toLocaleString()})
                  </span>
                  <span className="text-sm font-semibold tabular-nums" style={{ color: T.jade }}>
                    ${targetAmt.toLocaleString()}
                  </span>
                </div>
                {/* So far this month */}
                <div className="rounded-xl px-3 py-2 flex items-center justify-between" style={{ background: T.panelSoft }}>
                  <span className="text-[11px]" style={{ color: T.mute }}>Saved so far this month</span>
                  <span className="text-xs font-medium tabular-nums" style={{ color: savOut >= targetAmt ? T.jade : T.brass }}>
                    ${Math.round(savOut).toLocaleString()} / ${targetAmt.toLocaleString()}
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
                          EF: ${efBalance.toLocaleString()} of ${efTarget.toLocaleString()} · ${efRemaining.toLocaleString()} remaining
                        </p>
                      </div>
                      <span className="text-base ml-2">{txAddToEF ? "✓" : "○"}</span>
                    </button>
                    {/* Blank = full transaction amount -- only needed to type
                        something here for a PARTIAL EF contribution. */}
                    {txAddToEF && (
                      <MoneyInput value={txEfAmt} onChange={setTxEfAmt} placeholder={`Full amount (${txAmt || "0"})`} />
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
              the Savings/EF block above. */}
          {!txSplitMode && txBucket !== "SAVINGS" && txBucket !== "INCOME" && dashData.emergencyFund.balance > 0 && (
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
                    EF balance: ${dashData.emergencyFund.balance.toLocaleString()} · reduces it by this amount
                  </p>
                </div>
                <span className="text-base ml-2">{txFromEF ? "✓" : "○"}</span>
              </button>
              {/* Blank = full transaction amount -- type a smaller number to
                  represent only PART of this payment coming from EF (2.4.27's
                  exact case: $300 of a $325 payment). */}
              {txFromEF && (
                <MoneyInput value={txEfAmt} onChange={setTxEfAmt} placeholder={`Full amount (${txAmt || "0"})`} />
              )}
            </>
          )}

          <div>
            <Label htmlFor="tx-desc">Description</Label>
            <FocusInput
              id="tx-desc"
              value={txDesc}
              onChange={(e) => setTxDesc(e.target.value)}
              placeholder={txBucket === "INCOME" ? "Bonus, freelance gig, gift…" : "Rent, groceries, gym…"}
              onKeyDown={(e) => e.key === "Enter" && (txSplitMode ? commitSplitTransaction() : addTransaction())}
            />
            {!txSplitMode && txBucket !== "INCOME" && looksRecurring(txDesc, txDate, activeTx, financials.recurring ?? []) && (
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
            onClick={txSplitMode ? commitSplitTransaction : addTransaction}
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
              <p className="text-xs" style={{ color: T.mute }}>No entries yet this month</p>
            </div>
          ) : (
            <>
              <div className="space-y-2 max-h-72 overflow-y-auto pr-0.5">
                {monthTx.map((tx) => {
                  const b = TX_BUCKETS.find((b) => b.value === tx.bucket)!;
                  const divergence = cycleMonthDivergence(tx, financials.recurring ?? []);
                  return (
                    <div key={tx.id}>
                        <div
                          className="flex items-center justify-between rounded-xl px-3 py-2.5 group"
                          style={{ background: T.panelSoft, borderLeft: `3px solid ${b.color}` }}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm">{b.icon}</span>
                            <div className="min-w-0">
                              <span className="text-xs truncate block" style={{ color: T.text }}>
                                {tx.description}
                                {divergence && <span title={divergence} style={{ color: T.brass }}> ⚠</span>}
                              </span>
                              {/* Was hover-only (title= alone) -- unreachable on touch. Same message, always visible when present, matching 2.4.36's own confirm-form warning below. */}
                              {divergence && (
                                <span className="text-[9px] block" style={{ color: T.brass }}>{divergence}</span>
                              )}
                              {(tx.paymentMethod || tx.category) && (
                                <span className="text-[9px]" style={{ color: T.mute }}>
                                  {tx.paymentMethod && (
                                    tx.paymentMethod === "card" && tx.cardLabel
                                      ? tx.cardLabel
                                      : tx.paymentMethod === "cash"
                                      ? "💵 Cash"
                                      : tx.paymentMethod === "card"
                                      ? "💳 Card"
                                      : tx.paymentNote
                                      ? `🤝 ${tx.paymentNote}`
                                      : "🤝 Other"
                                  )}
                                  {tx.paymentMethod && tx.category && " · "}
                                  {tx.category && `${categoryIcon(tx.category, financials.customCategories)} ${categoryLabel(tx.category, financials.customCategories)}`}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span className="text-xs font-semibold tabular-nums" style={{ color: b.color }}>
                              {fmtCur(tx.amount, tx.currency ?? "USD")}
                            </span>
                            <button
                              onClick={() => onEdit("transaction", tx.id)}
                              aria-label="Edit transaction"
                              className="opacity-70 hover:!opacity-100 transition-opacity text-[10px] px-1.5 py-0.5 rounded"
                              style={{ color: T.brass, border: `1px solid ${T.brass}40` }}
                            >✎</button>
                            <button
                              onClick={() => { if (confirm("Delete this transaction?")) softDeleteTransaction(tx.id); }}
                              aria-label="Delete transaction"
                              className="opacity-70 hover:!opacity-100 transition-opacity text-xs px-1"
                              style={{ color: T.coral }}
                            >✕</button>
                          </div>
                        </div>
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
          const pastTx = activeTx.filter((t) => !t.date.startsWith(prefix));
          if (pastTx.length === 0) return null;
          const byMonth: Record<string, StoredTransaction[]> = {};
          pastTx.forEach((t) => {
            const ym = t.date.slice(0, 7);
            if (!byMonth[ym]) byMonth[ym] = [];
            byMonth[ym].push(t);
          });
          const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
          const label = (ym: string) => { const [y, m] = ym.split("-"); return `${months[parseInt(m)-1]} ${y}`; };
          return (
            <Section title="History" icon="📚" badge={pastTx.length} defaultOpen={false}>
              <div className="space-y-4">
                {Object.keys(byMonth).sort().reverse().map((ym) => {
                  const txs = byMonth[ym];
                  // Excludes INCOME, matching the current month's total just
                  // above (totalOut) and every other "spend" figure in the
                  // app -- this used to include it, inflating past months'
                  // totals for anyone who ever logged a gift/reimbursement.
                  // TRANSFER (2.4.55) excluded too -- not spend, and its
                  // amount can be negative (an incoming leg).
                  const total = txs.filter((t) => t.bucket !== "INCOME" && t.bucket !== "TRANSFER").reduce((s, t) => s + toUSD(t.amount, t.currency), 0);
                  return (
                    <div key={ym}>
                      <div className="flex justify-between items-center mb-2">
                        <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.mute }}>{label(ym)}</p>
                        <p className="text-[10px] tabular-nums font-semibold" style={{ color: T.text }}>{fmt(total)}</p>
                      </div>
                      <div className="space-y-1.5">
                        {txs.sort((a, b) => b.date.localeCompare(a.date)).map((tx) => {
                          const b = TX_BUCKETS.find((b) => b.value === tx.bucket)!;
                          const divergence = cycleMonthDivergence(tx, financials.recurring ?? []);
                          return (
                            <div key={tx.id}>
                                <div
                                  className="flex items-center justify-between rounded-lg px-2.5 py-2 group"
                                  style={{ background: T.panelSoft, borderLeft: `2px solid ${b.color}` }}
                                >
                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs truncate" style={{ color: T.text }}>
                                      {tx.description}
                                      {divergence && <span title={divergence} style={{ color: T.brass }}> ⚠</span>}
                                    </p>
                                    <p className="text-[9px]" style={{ color: T.mute }}>
                                      {fmtDate(tx.date)}{tx.category && ` · ${categoryIcon(tx.category, financials.customCategories)} ${categoryLabel(tx.category, financials.customCategories)}`}
                                    </p>
                                    {/* Was hover-only (title= alone) -- unreachable on touch. */}
                                    {divergence && (
                                      <p className="text-[9px]" style={{ color: T.brass }}>{divergence}</p>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <span className="text-xs tabular-nums font-medium" style={{ color: b.color }}>{fmtCur(tx.amount, tx.currency ?? "USD")}</span>
                                    <button
                                      onClick={() => onEdit("transaction", tx.id)}
                                      aria-label="Edit transaction"
                                      className="opacity-70 hover:!opacity-100 transition-opacity text-[10px] px-1.5 py-0.5 rounded"
                                      style={{ color: T.brass, border: `1px solid ${T.brass}40` }}
                                    >✎</button>
                                    <button
                                      onClick={() => { if (confirm("Delete this transaction?")) softDeleteTransaction(tx.id); }}
                                      aria-label="Delete transaction"
                                      className="opacity-70 hover:!opacity-100 transition-opacity text-[10px] px-1"
                                      style={{ color: T.coral }}
                                    >✕</button>
                                  </div>
                                </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          );
        })()}

        </>}

        {/* ── SETUP TAB (continued) — Goals, Recurring, Debts ─ */}
        {activeTab === "setup" && <>

        {/* Goals */}
        <Section title="Goals" icon="🎯" badge={financials.goals.length} defaultOpen={false}>
          {financials.goals.map((g) => {
            // Matches computeDashboard.ts's own convention exactly (targetAmount
            // of exactly 0 reads as met, not 0%) -- this used to disagree with
            // every other goal display (GoalsScreen, FinancialDashboard, all of
            // which read dashData.goals) for a goal edited down to a $0 target.
            const pct = g.targetAmount > 0 ? Math.min(100, (g.currentAmount / g.targetAmount) * 100) : 100;
            const remaining = Math.max(0, g.targetAmount - g.currentAmount);
            const isContrib  = contributeGoalId === g.id;
            return (
              <div key={g.id}>
                <div
                  className="rounded-xl px-3 py-2.5 group"
                  style={{ background: T.panelSoft, border: `1px solid ${T.line}`, opacity: g.pausedAt ? 0.65 : 1 }}
                >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm flex items-center gap-1.5 min-w-0" style={{ color: T.text }}>
                          <span className="truncate">{g.emoji} {g.name}</span>
                          {g.achievedAt && (
                            <span className="flex-shrink-0 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: T.jade + "22", color: T.jade }}>Achieved</span>
                          )}
                          {g.pausedAt && (
                            <span className="flex-shrink-0 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: T.mute + "22", color: T.mute }}>Paused</span>
                          )}
                        </p>
                        <p className="text-[10px] tabular-nums mt-0.5" style={{ color: T.mute }}>
                          {fmtCur(g.currentAmount, g.currency)} of {fmtCur(g.targetAmount, g.currency)}
                          {remaining > 0 && <span style={{ color: T.brass }}> · {fmtCur(remaining, g.currency)} to go</span>}
                        </p>
                        {(g.createdAt || g.achievedAt || g.pausedAt) && (
                          <p className="text-[9px] mt-0.5" style={{ color: T.mute }}>
                            {g.createdAt && <span>Added {fmtDate(g.createdAt)}</span>}
                            {g.achievedAt && <span style={{ color: T.jade }}> · Achieved {fmtDate(g.achievedAt)}</span>}
                            {g.pausedAt && <span> · Paused {fmtDate(g.pausedAt)}</span>}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1.5 opacity-70 transition-opacity flex-shrink-0">
                        <button
                          onClick={() => onEdit("goal", g.id)}
                          aria-label="Edit goal"
                          className="text-[10px] px-1.5 py-0.5 rounded transition-all hover:opacity-80"
                          style={{ color: T.brass, border: `1px solid ${T.brass}40` }}
                        >✎</button>
                        <button
                          onClick={() => toggleGoalPause(g.id)}
                          aria-label={g.pausedAt ? "Resume goal" : "Pause goal"}
                          title={g.pausedAt ? "Resume this goal" : "Pause this goal — won't count toward pace/score until resumed"}
                          className="text-[10px] px-1.5 py-0.5 rounded transition-all hover:opacity-80"
                          style={{ color: g.pausedAt ? T.jade : T.mute, border: `1px solid ${g.pausedAt ? T.jade : T.mute}40` }}
                        >{g.pausedAt ? "▶" : "⏸"}</button>
                        <button
                          onClick={() => { setContributeGoalId(isContrib ? null : g.id); setContributeGoalAmt(""); setContributeDate(todayISO()); }}
                          aria-label="Add to this goal"
                          className="text-[10px] px-1.5 py-0.5 rounded transition-all hover:opacity-80"
                          style={{ color: T.jade, border: `1px solid ${T.jade}40` }}
                        >+add</button>
                        <button
                          onClick={() => { if (confirm("Delete this goal?")) update({ goals: financials.goals.filter((x) => x.id !== g.id) }); }}
                          aria-label="Delete goal"
                          className="text-xs"
                          style={{ color: T.coral }}
                        >✕</button>
                      </div>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: T.line }}>
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: pct >= 100 ? T.jade : T.brass }} />
                    </div>
                    <div className="flex justify-between text-[9px] mt-1">
                      <span style={{ color: pct >= 100 ? T.jade : T.brass }}>{pct.toFixed(0)}%</span>
                      <span style={{ color: T.mute }}>by {fmtDate(g.targetDate)}</span>
                    </div>
                  </div>
                {isContrib && (
                  <div className="mt-1 rounded-xl p-3 space-y-2" style={{ background: T.ink, border: `1px solid ${T.line}` }}>
                    <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.jade }}>
                      Add to this goal
                    </p>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <MoneyInput value={contributeGoalAmt} onChange={setContributeGoalAmt} placeholder="Amount" />
                      </div>
                      <button
                        onClick={() => contributeToGoal(g.id)}
                        className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all hover:opacity-90"
                        style={{ background: T.jade, color: T.ink }}
                      >Save</button>
                      <button onClick={() => setContributeGoalId(null)} aria-label="Cancel contribution" className="px-2 py-1.5 rounded-xl text-xs" style={{ color: T.mute }}>✕</button>
                    </div>
                    <div>
                      <Label htmlFor={`contribute-date-${g.id}`}>Date paid</Label>
                      <DateFieldDMY id={`contribute-date-${g.id}`} value={contributeDate} onChange={setContributeDate} />
                    </div>
                    <PaymentMethodPicker
                      value={contributeMethod}
                      onChange={setContributeMethod}
                      cardId={contributeCardId}
                      onCardIdChange={setContributeCardId}
                      otherNote={contributeOtherNote}
                      onOtherNoteChange={setContributeOtherNote}
                      cards={cards}
                      onSaveCard={saveCard}
                    />
                    <p className="text-[10px]" style={{ color: T.mute }}>Logged as a Savings transaction.</p>
                  </div>
                )}
              </div>
            );
          })}

          <div
            className="rounded-xl p-4 space-y-3"
            style={{ background: T.ink, border: `1px solid ${T.line}` }}
          >
            <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.brass }}>
              New goal
            </p>
            <div className="flex gap-2">
              <div style={{ width: 68 }}>
                <Label htmlFor="new-goal-emoji">Emoji</Label>
                <FocusInput id="new-goal-emoji" value={gEmoji} onChange={(e) => setGEmoji(e.target.value)} />
              </div>
              <div className="flex-1">
                <Label htmlFor="new-goal-name">Name</Label>
                <FocusInput id="new-goal-name" value={gName} onChange={(e) => setGName(e.target.value)} placeholder="Travel fund…" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="new-goal-target">Target ({gCurrency === "LBP" ? "L£" : "$"})</Label>
                <MoneyInput id="new-goal-target" value={gTarget} onChange={setGTarget} placeholder="5,000" />
              </div>
              <div>
                <Label htmlFor="new-goal-saved">Saved ({gCurrency === "LBP" ? "L£" : "$"})</Label>
                <MoneyInput id="new-goal-saved" value={gCurrent} onChange={setGCurrent} placeholder="0" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="new-goal-date">Target date</Label>
                <DateFieldDMY id="new-goal-date" value={gDate} onChange={setGDate} />
              </div>
              <div>
                <Label>Currency</Label>
                <CurrencyToggle value={gCurrency} onChange={setGCurrency} />
              </div>
            </div>
            <PrimaryBtn onClick={addGoal} color={T.brass} disabled={!gName.trim() || !gTarget || !gDate}>+ Add goal</PrimaryBtn>
          </div>
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
            const totalMonthly = recs.reduce((s, r) => s + nominalMonthlyEquivalent(r, now), 0);
            return (
              <>
                {recs.length > 0 && (
                  <div className="space-y-2 mb-1">
                    {recs.map((r) => {
                      const mo     = nominalMonthlyEquivalent(r, now);
                      const b      = BUCKETS.find((b) => b.value === r.bucket)!;
                      const cur    = r.currency ?? "USD";
                      const sym    = cur === "LBP" ? "L£" : "$";
                      const ended  = !isRecurringActive(r, now);
                      const target = nextConfirmTarget(r, financials.transactions, todayMidnight);
                      const overdue = (target?.overdueCount ?? 0) > 0;
                      // Covers both "confirmed on time" and "confirmed early" (paid ahead of its due date) -- either way still shown as paid.
                      const paidThisCycle = target ? isCycleConfirmed(r, target.dueDate, financials.transactions) : false;
                      const paid   = r.totalAmount ? recurringPaidSoFar(r, financials.transactions) : null;
                      const pct    = paid != null && r.totalAmount ? Math.min(100, (paid / r.totalAmount) * 100) : null;
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
                                  {sym}{r.amount.toLocaleString()} · {FREQ_LABELS[r.frequency]}
                                  <span style={{ color: b.color }}> · {b.label}</span>
                                </p>
                                {r.createdAt && (
                                  <p className="text-[9px] mt-0.5" style={{ color: T.mute }}>Added {fmtDate(r.createdAt)}</p>
                                )}
                                {r.totalAmount ? (
                                  <div className="mt-1.5">
                                    <div className="flex justify-between text-[9px] mb-0.5" style={{ color: T.mute }}>
                                      <span>{sym}{(paid ?? 0).toLocaleString()} paid</span>
                                      <span>{sym}{r.totalAmount.toLocaleString()} total</span>
                                    </div>
                                    <div className="h-1 rounded-full overflow-hidden" style={{ background: T.line }}>
                                      <div className="h-full rounded-full transition-all" style={{ width: `${pct ?? 0}%`, background: ended ? T.mute : b.color }} />
                                    </div>
                                  </div>
                                ) : (
                                  <p className="text-[10px] mt-0.5" style={{ color: T.mute }}>
                                    {fmtDate(r.startDate)} → {r.endDate ? fmtDate(r.endDate) : <span style={{ color: T.jade }}>∞ ongoing</span>}
                                  </p>
                                )}
                              </div>
                              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                <span className="text-xs font-semibold tabular-nums" style={{ color: b.color }}>
                                  {sym}{mo.toFixed(0)}<span className="font-normal" style={{ color: T.mute }}>/mo</span>
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
                                        transactions: financials.transactions.map((t) =>
                                          t.recurringId !== r.id ? t : { ...t, recurringId: undefined, cycleDate: null, updatedAt: new Date().toISOString() }
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
                                  Log extra payment this month
                                </p>
                                <div className="flex gap-2">
                                  <div className="flex-1">
                                    <MoneyInput
                                      value={extraRecAmt}
                                      onChange={setExtraRecAmt}
                                      placeholder="Extra amount"
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
                                  Logged as a transaction in {b.label} · {cur} this month.
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
                                  const dueYm = target.dueDate.toISOString().slice(0, 7);
                                  const diverges = !!confirmDate && confirmDate.slice(0, 7) !== dueYm;
                                  const [dueY, dueM] = dueYm.split("-");
                                  const dueMonthLabel = `${["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+dueM]} ${dueY}`;
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
                        ${totalMonthly.toFixed(0)}<span style={{ color: T.mute }}>/mo total</span>
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
                      <MoneyInput id="new-rec-amount" value={rAmount} onChange={setRAmount} placeholder="0" />
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
                      {allCategories(financials.customCategories).map((c) => (
                        <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
                      ))}
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
        <Section title="Debts" icon="💳" badge={financials.debts.filter((d) => !d.paidOffAt).length} defaultOpen={false}>
          {financials.debts.map((d) => {
            // Phase 2.6.3a: derived once per row from openingBalance + the
            // linked transaction ledger, not read from the stored `balance`
            // field.
            const balance = derivedDebtBalance(d, financials.transactions);
            return (
              <div key={d.id}>
                <div
                  className="rounded-xl px-3 py-2.5 group"
                  style={{
                    background: T.panelSoft,
                    borderLeft: `3px solid ${d.paidOffAt ? T.jade : T.coral}`,
                    opacity: d.paidOffAt ? 0.65 : 1,
                  }}
                >
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm flex items-center gap-1.5 min-w-0" style={{ color: T.text }}>
                          <span className="truncate">{d.name}</span>
                          {d.paidOffAt && (
                            <span className="flex-shrink-0 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: T.jade + "22", color: T.jade }}>Paid off</span>
                          )}
                        </p>
                        <p className="text-[10px] tabular-nums mt-0.5" style={{ color: T.mute }}>
                          {fmtCur(balance, d.currency)} · {d.apr}% APR · min {fmtCur(d.minPayment, d.currency)}/mo
                        </p>
                        {(d.openedDate || d.createdAt || d.paidOffAt) && (
                          <p className="text-[9px] mt-1" style={{ color: T.mute }}>
                            {d.openedDate && <span>Opened {fmtDate(d.openedDate)}</span>}
                            {d.openedDate && d.createdAt && <span> · </span>}
                            {d.createdAt && <span>Added {fmtDate(d.createdAt)}</span>}
                            {d.paidOffAt && <span style={{ color: T.jade }}> · Paid {fmtDate(d.paidOffAt)}</span>}
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
                        {!d.paidOffAt && (
                          <button
                            onClick={() => onPay(d.id)}
                            aria-label="Record a payment"
                            className="text-[10px] px-1.5 py-0.5 rounded transition-all hover:opacity-80"
                            style={{ color: T.jade, border: `1px solid ${T.jade}40` }}
                          >pay</button>
                        )}
                        <button
                          onClick={() => { if (confirm("Delete this debt?")) update({ debts: financials.debts.filter((x) => x.id !== d.id) }); }}
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
                <MoneyInput id="new-debt-balance" value={dBalance} onChange={setDBalance} placeholder="0" />
              </div>
              <div>
                <Label htmlFor="new-debt-apr">APR (%)</Label>
                <FocusInput id="new-debt-apr" type="number" min="0" step="0.1" value={dApr} onChange={(e) => setDApr(e.target.value)} placeholder="20" />
              </div>
              <div>
                <Label htmlFor="new-debt-min">Min/mo</Label>
                <MoneyInput id="new-debt-min" value={dMin} onChange={setDMin} placeholder="25" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="new-debt-opened">Opened date (optional: when this debt started)</Label>
                <DateFieldDMY id="new-debt-opened" value={dOpenedDate} onChange={setDOpenedDate} />
              </div>
              <div>
                <Label>Currency</Label>
                <CurrencyToggle value={dCurrency} onChange={setDCurrency} />
              </div>
            </div>
            <PrimaryBtn onClick={addDebt} color={T.coral} disabled={!dName.trim() || !dBalance}>+ Add debt</PrimaryBtn>
          </div>
        </Section>

        <Section title="Other Assets" icon="🏦" badge={(financials.assets ?? []).length} defaultOpen={false}>
          <p className="text-xs" style={{ color: T.mute }}>
            Anything besides goals and your safety net: a car, a brokerage account, crypto. Counted toward net worth.
          </p>
          {(financials.assets ?? []).length > 0 && (
            <div className="space-y-2">
              {(financials.assets ?? []).map((a) => (
                <div key={a.id} className="rounded-xl p-3 flex items-center justify-between gap-2" style={{ background: T.panelSoft, border: `1px solid ${T.line}` }}>
                  <div>
                    <p className="text-sm font-medium" style={{ color: T.text }}>{a.name}</p>
                    <p className="text-xs tabular-nums" style={{ color: T.jade }}>
                      {a.currency === "LBP" ? "L£" : "$"}{a.value.toLocaleString()}
                    </p>
                  </div>
                  <button
                    onClick={() => deleteAsset(a.id)}
                    className="text-xs px-2 py-1 rounded-lg hover:opacity-70 transition-opacity flex-shrink-0"
                    style={{ color: T.coral }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          <div
            className="rounded-xl p-4 space-y-3"
            style={{ background: T.ink, border: `1px solid ${T.line}` }}
          >
            <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.jade }}>
              New asset
            </p>
            <div>
              <Label htmlFor="new-asset-name">Name</Label>
              <FocusInput id="new-asset-name" value={aName} onChange={(e) => setAName(e.target.value)} placeholder="Car, brokerage account…" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="new-asset-value">Value</Label>
                <MoneyInput id="new-asset-value" value={aValue} onChange={setAValue} placeholder="0" />
              </div>
              <div>
                <Label>Currency</Label>
                <CurrencyToggle value={aCurrency} onChange={setACurrency} />
              </div>
            </div>
            <PrimaryBtn onClick={addAsset} color={T.jade} disabled={!aName.trim() || !aValue}>+ Add asset</PrimaryBtn>
          </div>
        </Section>

        <Section title="Balance Check" icon="🔍" badge={(financials.trackedBalances ?? []).length} defaultOpen={false}>
          <p className="text-xs" style={{ color: T.mute }}>
            Set a starting balance for your cash or a card. ESSA subtracts every transaction logged on that payment
            method since then to tell you what you <em>should</em> have. Compare it to what you actually see, and a
            gap usually means a payment never got logged. (A recurring bill that hasn&apos;t been confirmed yet
            won&apos;t show up here — a known limit, not a bug.)
          </p>
          {(financials.trackedBalances ?? []).length > 0 && (
            <div className="space-y-2">
              {(financials.trackedBalances ?? []).map((tb) => {
                const card = tb.cardId ? financials.cards.find((c) => c.id === tb.cardId) : null;
                return (
                  <div key={tb.id} className="rounded-xl p-3 space-y-2" style={{ background: T.panelSoft, border: `1px solid ${T.line}` }}>
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium" style={{ color: T.text }}>{tb.name}</p>
                        <p className="text-[10px]" style={{ color: T.mute }}>
                          {tb.paymentMethod === "cash" ? "💵 Cash" : tb.paymentMethod === "card" ? `💳 ${card?.label ?? "Card"}` : "🤝 Other"}
                          {" · since "}{fmtDate(tb.startingDate)}
                        </p>
                      </div>
                      <button
                        onClick={() => deleteTrackedBalance(tb.id)}
                        className="text-xs px-2 py-1 rounded-lg hover:opacity-70 transition-opacity flex-shrink-0"
                        style={{ color: T.coral }}
                      >
                        Remove
                      </button>
                    </div>
                    <div className="pt-2 space-y-1.5" style={{ borderTop: `1px solid ${T.line}` }}>
                      {tb.actualBalance != null && (
                        <p className="text-[10px]" style={{ color: T.mute }}>
                          Last checked: <span style={{ color: T.text }}>{tb.currency === "LBP" ? "L£" : "$"}{tb.actualBalance.toLocaleString()}</span>
                          {tb.actualBalanceDate && ` on ${fmtDate(tb.actualBalanceDate)}`}
                        </p>
                      )}
                      {(() => {
                        const check = dashData.balanceChecks.find((b) => b.id === tb.id);
                        return check ? (
                          <p className="text-[10px]" style={{ color: T.mute }}>
                            Expected now: <span style={{ color: T.text }}>{fmtCur(check.expected, "USD")}</span>
                          </p>
                        ) : null;
                      })()}
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <MoneyInput
                            value={actualInputs[tb.id] ?? ""}
                            onChange={(v) => setActualInputs((prev) => ({ ...prev, [tb.id]: v }))}
                            placeholder="What you actually have now"
                          />
                        </div>
                        <button
                          onClick={() => updateActualBalance(tb.id)}
                          className="px-3 py-1.5 rounded-xl text-xs font-semibold hover:opacity-90 flex-shrink-0"
                          style={{ background: T.jade, color: T.ink }}
                        >
                          Update
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div
            className="rounded-xl p-4 space-y-3"
            style={{ background: T.ink, border: `1px solid ${T.line}` }}
          >
            <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.jade }}>
              Track a new balance
            </p>
            <div>
              <Label htmlFor="new-tb-name">Name</Label>
              <FocusInput id="new-tb-name" value={tbName} onChange={(e) => setTbName(e.target.value)} placeholder="Cash, Chase Checking…" />
            </div>
            <div>
              <Label>Payment method</Label>
              <div className="grid grid-cols-3 gap-1.5">
                {(["cash", "card", "other"] as PaymentMethod[]).map((m) => (
                  <button key={m} onClick={() => setTbMethod(m)}
                    aria-pressed={tbMethod === m}
                    className="py-1.5 rounded-lg text-[10px] font-medium transition-all"
                    style={{ background: tbMethod === m ? T.jade + "22" : T.panelSoft, border: `1px solid ${tbMethod === m ? T.jade : T.line}`, color: tbMethod === m ? T.jade : T.mute }}>
                    {m === "cash" ? "💵 Cash" : m === "card" ? "💳 Card" : "🤝 Other"}
                  </button>
                ))}
              </div>
            </div>
            {tbMethod === "card" && (
              <div>
                <Label>Which card</Label>
                {/* 2.4.40: was a static "No saved cards yet" message with no
                    action -- CardPicker gives this form the same inline
                    "+ New card" affordance the main transaction form has
                    always had, instead of forcing a trip to a different
                    screen and losing whatever was already typed here. */}
                <CardPicker cardId={tbCardId || null} onCardIdChange={(id) => setTbCardId(id ?? "")} cards={cards} onSaveCard={saveCard} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="new-tb-balance">Starting balance</Label>
                <MoneyInput id="new-tb-balance" value={tbStartBal} onChange={setTbStartBal} placeholder="0" />
              </div>
              <div>
                <Label>Currency</Label>
                <CurrencyToggle value={tbCurrency} onChange={setTbCurrency} />
              </div>
            </div>
            <div>
              <Label htmlFor="new-tb-date">As of date</Label>
              <DateFieldDMY id="new-tb-date" value={tbStartDate} onChange={setTbStartDate} />
            </div>
            <PrimaryBtn onClick={addTrackedBalance} color={T.jade} disabled={!tbName.trim() || !tbStartBal || (tbMethod === "card" && !tbCardId)}>+ Track this balance</PrimaryBtn>
          </div>
        </Section>

        </>}

        <div className="h-6" />
      </div>
      {/* end scrollable body */}

      {/* ── Footer ──────────────────────────────────────────── */}
      <div
        className="px-6 py-3 flex-shrink-0"
        style={{ borderTop: `1px solid ${T.line}` }}
      >
        {!showResetConfirm ? (
          <div className="flex items-center justify-between">
            <p className="text-[10px]" style={{ color: T.mute }}>Saved in your browser</p>
            <button
              onClick={() => setShowResetConfirm(true)}
              className="text-[10px] px-2.5 py-1.5 rounded-lg transition-opacity hover:opacity-80"
              style={{ color: T.coral }}
            >
              Reset all data
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[10px]" style={{ color: T.coral }}>
              This permanently erases every transaction, goal, debt, recurring item, card, asset, and tracked balance. Type <strong>reset</strong> to confirm.
            </p>
            <div className="flex items-center gap-2">
              <input
                value={resetConfirmText}
                onChange={(e) => setResetConfirmText(e.target.value)}
                placeholder="reset"
                className="flex-1 min-w-0 rounded-lg px-2.5 py-1.5 text-xs"
                style={{ background: T.ink, border: `1px solid ${T.line}`, color: T.text, outline: "none" }}
              />
              <button
                onClick={() => {
                  // DEFAULT_DATA directly, not a hand-maintained copy of its
                  // shape -- this literal had already drifted from it (missing
                  // customCategories/categoryRules/wishlist/budgetRule and the
                  // history arrays, all silently allowed since those fields are
                  // optional) before schemaVersion made the gap a type error.
                  onChange({ ...DEFAULT_DATA });
                  setShowResetConfirm(false); setResetConfirmText("");
                }}
                disabled={resetConfirmText.toLowerCase() !== "reset"}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0 transition-all disabled:opacity-40 disabled:pointer-events-none"
                style={{ background: T.coral, color: T.ink }}
              >
                Confirm
              </button>
              <button
                onClick={() => { setShowResetConfirm(false); setResetConfirmText(""); }}
                className="px-2.5 py-1.5 rounded-lg text-xs flex-shrink-0 hover:opacity-70"
                style={{ color: T.mute }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
    {showImport && (
      <ImportStatement financials={financials} onImport={update} onClose={() => setShowImport(false)} />
    )}
    {lbpConfirm && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: "rgba(0,0,0,0.6)" }}
        onClick={(e) => { if (e.target === e.currentTarget) setLbpConfirm(null); }}
        onKeyDown={(e) => { if (e.key === "Escape") setLbpConfirm(null); }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm low LBP amount"
          className="w-full max-w-sm rounded-2xl p-6 shadow-2xl"
          style={{ background: T.panel, border: `1px solid ${T.line}` }}
        >
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: T.brass }}>Double-check this amount</p>
          <p className="text-sm mb-5" style={{ color: T.text }}>
            <strong>{lbpConfirm.amount.toLocaleString()} LBP</strong> is unusually low for a real purchase — most things this cheap are actually meant to be USD. Did you mean to log this in USD instead?
          </p>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => setLbpConfirm(null)}
              className="w-full py-2.5 rounded-xl text-sm font-semibold hover:opacity-90"
              style={{ background: T.jade, color: T.ink }}
            >
              Let me fix the currency
            </button>
            <button
              onClick={() => { const proceed = lbpConfirm.proceed; setLbpConfirm(null); proceed(); }}
              className="w-full py-2.5 rounded-xl text-sm hover:opacity-90"
              style={{ background: T.panelSoft, color: T.mute, border: `1px solid ${T.line}` }}
            >
              No, save it as {lbpConfirm.amount.toLocaleString()} LBP
            </button>
          </div>
        </div>
      </div>
    )}

    {actionMsg && (
      <div
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-xs font-medium shadow-lg"
        style={{ background: T.panel, border: `1px solid ${T.jade}50`, color: T.text }}
      >
        <span style={{ color: T.jade }}>✓</span> {actionMsg}
      </div>
    )}
    </>
  );
}
