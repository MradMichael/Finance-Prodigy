"use client";

import { useState } from "react";
import type {
  LocalFinancials, StoredTransaction, StoredGoal, StoredDebt,
  StoredRecurring, StoredCard, RecurringFrequency, Currency, PaymentMethod, BudgetRuleKey, TrackedBalance,
} from "../lib/localData";
import type { Session } from "../lib/auth";
import { uid, todayISO, fmtDate, FREQ_LABELS, FREQ_MONTHLY, BUDGET_RULES, monthlyEquivalent, recurringPaidSoFar, toUSD as toUSDShared } from "../lib/localData";
import { useTheme } from "../contexts/ThemeContext";
import { Signet } from "./EssaBrand";
import { Label, FocusInput, MoneyInput, PrimaryBtn, Section, CurrencyToggle, DateFieldDMY } from "./form/Primitives";
import ImportStatement from "./ImportStatement";

type Bucket = "NEEDS" | "WANTS" | "SAVINGS";

const PM_OPTIONS: { value: PaymentMethod; label: string; icon: string }[] = [
  { value: "cash",  label: "Cash",  icon: "💵" },
  { value: "card",  label: "Card",  icon: "💳" },
  { value: "other", label: "Other", icon: "🔗" },
];

const CARD_TYPES: StoredCard["type"][] = ["Visa", "Mastercard", "Amex", "Other"];

/**
 * Data-driven "this might be recurring" signal: the same description has
 * already been logged in a DIFFERENT calendar month (e.g. "Claude
 * subscription" showing up every month), and isn't already tracked as a
 * Recurring item. Deliberately not a hardcoded list of known subscription
 * names — that would miss anything not on the list and go stale; this
 * catches whatever the user's own history actually repeats.
 */
function looksRecurring(description: string, date: string, transactions: StoredTransaction[], recurring: StoredRecurring[]): boolean {
  const norm = description.trim().toLowerCase();
  if (!norm) return false;
  if (recurring.some((r) => r.name.trim().toLowerCase() === norm)) return false;
  const thisMonth = date.slice(0, 7);
  return transactions.some((t) => t.description.trim().toLowerCase() === norm && t.date.slice(0, 7) !== thisMonth);
}

// ── main panel ──────────────────────────────────────────────────── //

interface Props {
  financials: LocalFinancials;
  onChange: (updated: LocalFinancials) => void;
  session?: Session;
}

export default function InputPanel({ financials, onChange, session }: Props) {
  const T = useTheme();
  const BUCKETS: { value: Bucket; label: string; icon: string; color: string }[] = [
    { value: "NEEDS",   label: "Needs",   icon: "🏠", color: T.sky   },
    { value: "WANTS",   label: "Wants",   icon: "✨", color: T.brass },
    { value: "SAVINGS", label: "Savings", icon: "💰", color: T.jade  },
  ];
  const update = (patch: Partial<LocalFinancials>) => onChange({ ...financials, ...patch });

  // Transaction form
  const [txAmt,    setTxAmt]    = useState("");
  const [txBucket, setTxBucket] = useState<Bucket>("NEEDS");
  const [txDesc,   setTxDesc]   = useState("");
  const [txDate,   setTxDate]   = useState(todayISO());
  const [txCurrency,  setTxCurrency]  = useState<Currency>("USD");
  const [txPayMethod, setTxPayMethod] = useState<PaymentMethod>("cash");
  const [txPayNote,   setTxPayNote]   = useState("");
  const [txAddToEF,   setTxAddToEF]   = useState(false);
  const [txFromEF,    setTxFromEF]    = useState(false);
  const [txCardId,    setTxCardId]    = useState<string | null>(null);
  const [showAddCard, setShowAddCard] = useState(false);
  const [newCardType, setNewCardType] = useState<StoredCard["type"]>("Visa");
  const [newCardLast4, setNewCardLast4] = useState("");
  const [showImport, setShowImport] = useState(false);

  // Goal form
  const [gName,    setGName]    = useState("");
  const [gEmoji,   setGEmoji]   = useState("🎯");
  const [gTarget,  setGTarget]  = useState("");
  const [gCurrent, setGCurrent] = useState("");
  const [gDate,    setGDate]    = useState("");

  // Debt form
  const [dName,    setDName]    = useState("");
  const [dBalance, setDBalance] = useState("");
  const [dApr,     setDApr]     = useState("");
  const [dMin,     setDMin]     = useState("");
  // Debt payment state: track which debt is open for payment
  const [payingDebtId, setPayingDebtId] = useState<string | null>(null);
  const [debtPayAmt,   setDebtPayAmt]   = useState("");

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
  const [rEmoji,       setREmoji]       = useState("🔄");
  const [rAmount,      setRAmount]      = useState("");
  const [rCurrency,    setRCurrency]    = useState<Currency>("USD");
  const [rFreq,        setRFreq]        = useState<RecurringFrequency>("monthly");
  const [rBucket,      setRBucket]      = useState<"NEEDS" | "WANTS" | "SAVINGS">("NEEDS");
  const [rStart,       setRStart]       = useState(todayISO());
  const [rEndType,     setREndType]     = useState<"infinite" | "date" | "amount">("infinite");
  const [rEnd,         setREnd]         = useState("");
  const [rTotalAmount, setRTotalAmount] = useState("");
  // Recurring extra payment state
  const [extraRecId,  setExtraRecId]  = useState<string | null>(null);
  const [extraRecAmt, setExtraRecAmt] = useState("");

  // Goal contribution state
  const [contributeGoalId,  setContributeGoalId]  = useState<string | null>(null);
  const [contributeGoalAmt, setContributeGoalAmt] = useState("");

  // ── edit state ──────────────────────────────────────────────── //
  const [editDebtId,       setEditDebtId]       = useState<string | null>(null);
  const [editDName,        setEditDName]        = useState("");
  const [editDBalance,     setEditDBalance]     = useState("");
  const [editDApr,         setEditDApr]         = useState("");
  const [editDMin,         setEditDMin]         = useState("");
  const [editDOpened,      setEditDOpened]      = useState("");
  const [dOpenedDate,      setDOpenedDate]      = useState("");

  const [editGoalId,       setEditGoalId]       = useState<string | null>(null);
  const [editGName,        setEditGName]        = useState("");
  const [editGEmoji,       setEditGEmoji]       = useState("");
  const [editGTarget,      setEditGTarget]      = useState("");
  const [editGCurrent,     setEditGCurrent]     = useState("");
  const [editGDate,        setEditGDate]        = useState("");

  const [editRecId,        setEditRecId]        = useState<string | null>(null);
  const [editRName,        setEditRName]        = useState("");
  const [editREmoji,       setEditREmoji]       = useState("");
  const [editRAmount,      setEditRAmount]      = useState("");
  const [editRCurrency,    setEditRCurrency]    = useState<Currency>("USD");
  const [editRFreq,        setEditRFreq]        = useState<RecurringFrequency>("monthly");
  const [editRBucket,      setEditRBucket]      = useState<Bucket>("NEEDS");
  const [editRStart,       setEditRStart]       = useState("");
  const [editREndType,     setEditREndType]     = useState<"infinite" | "date" | "amount">("infinite");
  const [editREnd,         setEditREnd]         = useState("");
  const [editRTotalAmount, setEditRTotalAmount] = useState("");

  const [editTxId,         setEditTxId]         = useState<string | null>(null);
  const [editTxAmt,        setEditTxAmt]        = useState("");
  const [editTxDesc,       setEditTxDesc]       = useState("");
  const [editTxDate,       setEditTxDate]       = useState("");
  const [editTxBucket,     setEditTxBucket]     = useState<Bucket>("NEEDS");
  const [editTxCurrency,   setEditTxCurrency]   = useState<Currency>("USD");

  // ── helpers ────────────────────────────────────────────────────── //

  const cards = financials.cards ?? [];

  function saveCard(): StoredCard | null {
    if (newCardLast4.length !== 4 || !/^\d{4}$/.test(newCardLast4)) return null;
    const card: StoredCard = {
      id: uid(),
      type: newCardType,
      last4: newCardLast4,
      label: `${newCardType} •••• ${newCardLast4}`,
    };
    update({ cards: [...cards, card] });
    setNewCardLast4(""); setShowAddCard(false);
    return card;
  }

  function addTransaction() {
    const amt = parseFloat(txAmt);
    if (!amt || amt <= 0) return;
    if (txCurrency === "LBP" && amt < 500 && !confirm(`${amt.toLocaleString()} LBP is unusually low for a real purchase. Did you mean to log this in USD instead? Click Cancel to fix the currency, or OK to save it as LBP.`)) return;
    let cardId: string | undefined;
    let cardLabel: string | undefined;
    if (txPayMethod === "card") {
      if (showAddCard) {
        const saved = saveCard();
        if (saved) { cardId = saved.id; cardLabel = saved.label; }
      } else if (txCardId) {
        const card = cards.find((c) => c.id === txCardId);
        if (card) { cardId = card.id; cardLabel = card.label; }
      }
    }
    const amtUSD = txCurrency === "LBP" ? amt / (financials.lbpRate ?? 89500) : amt;
    const tx: StoredTransaction = {
      id: uid(), amount: amt, currency: txCurrency, bucket: txBucket,
      description: txDesc.trim() || txBucket.charAt(0) + txBucket.slice(1).toLowerCase(),
      date: txDate,
      paymentMethod: txPayMethod,
      ...(txPayMethod === "other" && txPayNote.trim() ? { paymentNote: txPayNote.trim() } : {}),
      ...(cardId ? { cardId, cardLabel } : {}),
    };
    update({
      transactions: [tx, ...financials.transactions],
      ...(txBucket === "SAVINGS" && txAddToEF
        ? { emergencyFundBalance: (financials.emergencyFundBalance ?? 0) + amtUSD }
        : {}),
      ...(txBucket !== "SAVINGS" && txFromEF
        ? { emergencyFundBalance: Math.max(0, (financials.emergencyFundBalance ?? 0) - amtUSD) }
        : {}),
    });
    setTxAmt(""); setTxDesc(""); setTxPayNote(""); setTxAddToEF(false); setTxFromEF(false);
  }

  function addGoal() {
    if (!gName.trim() || !gTarget || !gDate) return;
    const goal: StoredGoal = {
      id: uid(), name: gName.trim(), emoji: gEmoji || "🎯",
      targetAmount: parseFloat(gTarget.replace(/,/g, "")),
      currentAmount: parseFloat(gCurrent.replace(/,/g, "")) || 0,
      targetDate: gDate,
      createdAt: new Date().toISOString(),
    };
    update({ goals: [...financials.goals, goal] });
    setGName(""); setGTarget(""); setGCurrent(""); setGDate(""); setGEmoji("🎯");
  }

  function addDebt() {
    if (!dName.trim() || !dBalance) return;
    const debt: StoredDebt = {
      id: uid(), name: dName.trim(),
      balance: parseFloat(dBalance.replace(/,/g, "")),
      apr: Math.max(0, parseFloat(dApr) || 0),
      minPayment: parseFloat(dMin.replace(/,/g, "")) || 0,
      createdAt: new Date().toISOString(),
      ...(dOpenedDate ? { openedDate: dOpenedDate } : {}),
    };
    update({ debts: [...financials.debts, debt] });
    setDName(""); setDBalance(""); setDApr(""); setDMin(""); setDOpenedDate("");
  }

  function addAsset() {
    if (!aName.trim() || !aValue) return;
    const asset = {
      id: uid(), name: aName.trim(),
      value: parseFloat(aValue.replace(/,/g, "")),
      currency: aCurrency,
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
    };
    update({ trackedBalances: [...(financials.trackedBalances ?? []), tb] });
    setTbName(""); setTbMethod("cash"); setTbCardId(""); setTbStartBal(""); setTbStartDate(todayISO()); setTbCurrency("USD");
  }

  function updateActualBalance(id: string) {
    const raw = actualInputs[id];
    const amt = parseFloat((raw ?? "").replace(/,/g, ""));
    if (isNaN(amt)) return;
    update({
      trackedBalances: (financials.trackedBalances ?? []).map((tb) =>
        tb.id !== id ? tb : { ...tb, actualBalance: amt, actualBalanceDate: new Date().toISOString() }),
    });
    setActualInputs((prev) => ({ ...prev, [id]: "" }));
  }

  function deleteTrackedBalance(id: string) {
    if (!confirm("Remove this tracked balance?")) return;
    update({ trackedBalances: (financials.trackedBalances ?? []).filter((tb) => tb.id !== id) });
  }

  function recordDebtPayment(debtId: string) {
    const amt = parseFloat(debtPayAmt.replace(/,/g, ""));
    if (!amt || amt <= 0) return;
    const updated = financials.debts.map((d) => {
      if (d.id !== debtId) return d;
      const newBal = Math.max(0, d.balance - amt);
      return { ...d, balance: newBal, paidOffAt: newBal === 0 ? (d.paidOffAt ?? new Date().toISOString()) : d.paidOffAt };
    });
    update({ debts: updated });
    setPayingDebtId(null); setDebtPayAmt("");
  }

  function addRecurring() {
    if (!rName.trim() || !rAmount || !rStart) return;
    const rec: StoredRecurring = {
      id: uid(), name: rName.trim(), emoji: rEmoji || "🔄",
      amount: parseFloat(rAmount.replace(/,/g, "")), currency: rCurrency, frequency: rFreq,
      bucket: rBucket, startDate: rStart,
      endDate:     rEndType === "date"   ? (rEnd.trim() || null) : null,
      totalAmount: rEndType === "amount" ? (parseFloat(rTotalAmount.replace(/,/g, "")) || null) : null,
      createdAt: new Date().toISOString(),
    };
    update({ recurring: [...(financials.recurring ?? []), rec] });
    setRName(""); setRAmount(""); setREmoji("🔄"); setRStart(todayISO()); setREnd(""); setRTotalAmount(""); setREndType("infinite");
  }

  /** Quick-add a Recurring item from a transaction that looksRecurring flagged — starts today, monthly, editable further in the Recurring screen. Past transactions are left untouched; this only affects future months. */
  function convertToRecurring(name: string, amount: string, currency: Currency, bucket: Bucket) {
    const amt = parseFloat(amount.replace(/,/g, ""));
    if (!name.trim() || !amt) return;
    const rec: StoredRecurring = {
      id: uid(), name: name.trim(), emoji: "🔄",
      amount: amt, currency, frequency: "monthly", bucket,
      startDate: todayISO(), endDate: null, totalAmount: null,
      createdAt: new Date().toISOString(),
    };
    update({ recurring: [...(financials.recurring ?? []), rec] });
  }

  function contributeToGoal(goalId: string) {
    const amt = parseFloat(contributeGoalAmt.replace(/,/g, ""));
    if (!amt || amt <= 0) return;
    const goal = financials.goals.find((g) => g.id === goalId);
    const goals = financials.goals.map((g) =>
      g.id === goalId ? { ...g, currentAmount: g.currentAmount + amt } : g
    );
    const tx: StoredTransaction = {
      id: uid(), amount: amt, currency: "USD" as Currency,
      bucket: "SAVINGS", description: `Goal: ${goal?.name ?? "savings"}`,
      date: todayISO(), paymentMethod: "other",
    };
    update({ goals, transactions: [tx, ...financials.transactions] });
    setContributeGoalId(null); setContributeGoalAmt("");
  }

  function logExtraPayment(rec: StoredRecurring) {
    const amt = parseFloat(extraRecAmt.replace(/,/g, ""));
    if (!amt || amt <= 0) return;
    const tx: StoredTransaction = {
      id: uid(), amount: amt, currency: rec.currency,
      bucket: rec.bucket,
      description: `Extra: ${rec.name}`,
      date: todayISO(),
      paymentMethod: "cash",
    };
    update({ transactions: [tx, ...financials.transactions] });
    setExtraRecId(null); setExtraRecAmt("");
  }

  // ── edit helpers ───────────────────────────────────────────── //

  function startEditDebt(d: StoredDebt) {
    setEditDebtId(d.id); setEditDName(d.name);
    setEditDBalance(String(d.balance)); setEditDApr(String(d.apr));
    setEditDMin(String(d.minPayment)); setEditDOpened(d.openedDate ?? "");
    setPayingDebtId(null);
  }
  function saveEditDebt(debtId: string) {
    const bal = parseFloat(editDBalance.replace(/,/g, ""));
    if (!editDName.trim() || isNaN(bal)) return;
    update({
      debts: financials.debts.map((d) => d.id !== debtId ? d : {
        ...d, name: editDName.trim(), balance: bal,
        apr: Math.max(0, parseFloat(editDApr) || 0),
        minPayment: parseFloat(editDMin.replace(/,/g, "")) || 0,
        openedDate: editDOpened || undefined,
        // Clear paidOffAt when the edited balance goes back above 0 (e.g.
        // correcting a mistake, or a new charge) — otherwise a live debt
        // keeps showing the "Paid off" badge and gets excluded from the
        // active-debt count indefinitely.
        paidOffAt: bal <= 0 ? (d.paidOffAt ?? new Date().toISOString()) : undefined,
      }),
    });
    setEditDebtId(null);
  }

  function startEditGoal(g: StoredGoal) {
    setEditGoalId(g.id); setEditGName(g.name); setEditGEmoji(g.emoji);
    setEditGTarget(String(g.targetAmount)); setEditGCurrent(String(g.currentAmount));
    setEditGDate(g.targetDate);
  }
  function saveEditGoal(goalId: string) {
    const target  = parseFloat(editGTarget.replace(/,/g, ""));
    const current = parseFloat(editGCurrent.replace(/,/g, "")) || 0;
    if (!editGName.trim() || isNaN(target) || !editGDate) return;
    update({
      goals: financials.goals.map((g) => g.id !== goalId ? g : {
        ...g, name: editGName.trim(), emoji: editGEmoji || "🎯",
        targetAmount: target, currentAmount: current, targetDate: editGDate,
        achievedAt: current >= target ? (g.achievedAt ?? new Date().toISOString()) : undefined,
      }),
    });
    setEditGoalId(null);
  }

  function startEditRec(r: StoredRecurring) {
    setEditRecId(r.id); setEditRName(r.name); setEditREmoji(r.emoji);
    setEditRAmount(String(r.amount)); setEditRCurrency(r.currency);
    setEditRFreq(r.frequency); setEditRBucket(r.bucket); setEditRStart(r.startDate);
    if (r.endDate)       { setEditREndType("date");   setEditREnd(r.endDate); setEditRTotalAmount(""); }
    else if (r.totalAmount) { setEditREndType("amount"); setEditRTotalAmount(String(r.totalAmount)); setEditREnd(""); }
    else                 { setEditREndType("infinite"); setEditREnd(""); setEditRTotalAmount(""); }
    setExtraRecId(null);
  }
  function saveEditRec(recId: string) {
    const amt = parseFloat(editRAmount.replace(/,/g, ""));
    if (!editRName.trim() || isNaN(amt) || !editRStart) return;
    update({
      recurring: (financials.recurring ?? []).map((r) => r.id !== recId ? r : {
        ...r, name: editRName.trim(), emoji: editREmoji || "🔄",
        amount: amt, currency: editRCurrency, frequency: editRFreq,
        bucket: editRBucket, startDate: editRStart,
        endDate:     editREndType === "date"   ? (editREnd.trim() || null) : null,
        totalAmount: editREndType === "amount" ? (parseFloat(editRTotalAmount.replace(/,/g, "")) || null) : null,
      }),
    });
    setEditRecId(null);
  }

  function startEditTx(tx: StoredTransaction) {
    setEditTxId(tx.id); setEditTxAmt(String(tx.amount));
    setEditTxDesc(tx.description); setEditTxDate(tx.date);
    setEditTxBucket(tx.bucket as Bucket); setEditTxCurrency(tx.currency ?? "USD");
  }
  function saveEditTx(txId: string) {
    const amt = parseFloat(editTxAmt.replace(/,/g, ""));
    if (!editTxDesc.trim() || isNaN(amt) || !editTxDate) return;
    if (editTxCurrency === "LBP" && amt < 500 && !confirm(`${amt.toLocaleString()} LBP is unusually low for a real purchase. Did you mean to log this in USD instead? Click Cancel to fix the currency, or OK to save it as LBP.`)) return;
    update({
      transactions: financials.transactions.map((t) => t.id !== txId ? t : {
        ...t, amount: amt, description: editTxDesc.trim(),
        date: editTxDate, bucket: editTxBucket, currency: editTxCurrency,
      }),
    });
    setEditTxId(null);
  }

  // ── tab state ─────────────────────────────────────────────────── //
  const [activeTab, setActiveTab] = useState<"daily" | "setup">("daily");

  // ── derived ───────────────────────────────────────────────────── //

  const prefix   = todayISO().slice(0, 7);
  const monthTx  = financials.transactions.filter((t) => t.date.startsWith(prefix));
  const now      = new Date();
  const lbpRate  = financials.lbpRate ?? 89500;
  const toUSD    = (amt: number, cur?: Currency) => toUSDShared(amt, cur, lbpRate);
  const fmtCur   = (amt: number, cur: Currency) => cur === "LBP"
    ? `L£${amt.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : `$${amt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const recs     = financials.recurring ?? [];
  const needsOut = monthTx.filter((t) => t.bucket === "NEEDS").reduce((s, t)   => s + toUSD(t.amount, t.currency), 0)
                 + recs.filter((r) => r.bucket === "NEEDS").reduce((s, r)   => s + toUSD(monthlyEquivalent(r, now), r.currency), 0);
  const wantsOut = monthTx.filter((t) => t.bucket === "WANTS").reduce((s, t)   => s + toUSD(t.amount, t.currency), 0)
                 + recs.filter((r) => r.bucket === "WANTS").reduce((s, r)   => s + toUSD(monthlyEquivalent(r, now), r.currency), 0);
  const savOut   = monthTx.filter((t) => t.bucket === "SAVINGS").reduce((s, t) => s + toUSD(t.amount, t.currency), 0)
                 + recs.filter((r) => r.bucket === "SAVINGS").reduce((s, r) => s + toUSD(monthlyEquivalent(r, now), r.currency), 0);
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

          <div>
            <Label>Category</Label>
            <div className="grid grid-cols-3 gap-2">
              {BUCKETS.map((b) => (
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

          {/* Savings context: target hint + EF toggle */}
          {txBucket === "SAVINGS" && financials.income > 0 && (() => {
            const ruleKey: BudgetRuleKey = financials.budgetRule ?? "50-30-20";
            const needsPct = ruleKey === "custom" ? (financials.budgetCustomNeeds ?? 50) : BUDGET_RULES[ruleKey].needs;
            const savPct  = ruleKey === "custom"
              ? Math.max(0, 100 - (financials.budgetCustomNeeds ?? 50) - (financials.budgetCustomWants ?? 30))
              : BUDGET_RULES[ruleKey].savings;
            const targetAmt = Math.round(financials.income * savPct / 100);
            // Mirrors computeDashboard.ts's efMonthlyBase/efTarget exactly (months
            // of NEEDS, not months of full income) -- these two used to disagree,
            // showing a materially different EF target here than on Overview/
            // Projections for the same account.
            const efTarget  = Math.round((financials.emergencyFundTargetMonths ?? 6) * financials.income * needsPct / 100);
            const efBalance = financials.emergencyFundBalance ?? 0;
            const efRemaining = Math.max(0, efTarget - efBalance);
            const efFull = efTarget > 0 && efBalance >= efTarget;
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
                ) : (
                  <div className="rounded-xl px-3 py-2" style={{ background: T.jade + "14", border: `1px solid ${T.jade}30` }}>
                    <p className="text-xs font-medium" style={{ color: T.jade }}>✓ Safety net is fully funded</p>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Needs/Wants: option to pay this from the Emergency Fund instead of new spending */}
          {txBucket !== "SAVINGS" && (financials.emergencyFundBalance ?? 0) > 0 && (
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
                  EF balance: ${(financials.emergencyFundBalance ?? 0).toLocaleString()} · reduces it by this amount
                </p>
              </div>
              <span className="text-base ml-2">{txFromEF ? "✓" : "○"}</span>
            </button>
          )}

          <div>
            <Label htmlFor="tx-desc">Description</Label>
            <FocusInput
              id="tx-desc"
              value={txDesc}
              onChange={(e) => setTxDesc(e.target.value)}
              placeholder="Rent, groceries, gym…"
              onKeyDown={(e) => e.key === "Enter" && addTransaction()}
            />
            {looksRecurring(txDesc, txDate, financials.transactions, financials.recurring ?? []) && (
              <div className="mt-2 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2" style={{ background: T.brass + "14", border: `1px solid ${T.brass}30` }}>
                <p className="text-[11px]" style={{ color: T.brass }}>You&apos;ve logged this before in another month. Looks recurring.</p>
                <button
                  type="button"
                  onClick={() => convertToRecurring(txDesc, txAmt, txCurrency, txBucket)}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-lg flex-shrink-0 hover:opacity-80 transition-opacity"
                  style={{ background: T.brass + "22", color: T.brass }}
                >
                  Add to Recurring
                </button>
              </div>
            )}
          </div>

          <div>
            <Label>Currency</Label>
            <CurrencyToggle value={txCurrency} onChange={setTxCurrency} />
          </div>

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
                          const saved = saveCard();
                          if (saved) setTxCardId(saved.id);
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

          <PrimaryBtn onClick={addTransaction} color={T.jade}>
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
        <Section title="This month" icon="📋" badge={monthTx.length} defaultOpen={monthTx.length > 0}>
          {monthTx.length === 0 ? (
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
                  const b = BUCKETS.find((b) => b.value === tx.bucket)!;
                  const isEditingTx = editTxId === tx.id;
                  return (
                    <div key={tx.id}>
                      {isEditingTx ? (
                        <div className="rounded-xl p-3 space-y-2" style={{ background: T.panelSoft, border: `1px solid ${T.jade}50` }}>
                          <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.jade }}>Edit entry</p>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label htmlFor="edit-tx-amount">Amount</Label>
                              <MoneyInput id="edit-tx-amount" value={editTxAmt} onChange={setEditTxAmt} placeholder="0" />
                            </div>
                            <div>
                              <Label htmlFor="edit-tx-date">Date</Label>
                              <DateFieldDMY id="edit-tx-date" value={editTxDate} onChange={setEditTxDate} />
                            </div>
                          </div>
                          <div>
                            <Label htmlFor="edit-tx-desc">Description</Label>
                            <FocusInput id="edit-tx-desc" value={editTxDesc} onChange={(e) => setEditTxDesc(e.target.value)} />
                            {looksRecurring(editTxDesc, editTxDate, financials.transactions.filter((t) => t.id !== tx.id), financials.recurring ?? []) && (
                              <div className="mt-2 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2" style={{ background: T.brass + "14", border: `1px solid ${T.brass}30` }}>
                                <p className="text-[11px]" style={{ color: T.brass }}>You&apos;ve logged this before in another month. Looks recurring.</p>
                                <button
                                  type="button"
                                  onClick={() => convertToRecurring(editTxDesc, editTxAmt, editTxCurrency, editTxBucket)}
                                  className="text-[11px] font-semibold px-2.5 py-1 rounded-lg flex-shrink-0 hover:opacity-80 transition-opacity"
                                  style={{ background: T.brass + "22", color: T.brass }}
                                >
                                  Add to Recurring
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="grid grid-cols-3 gap-1.5">
                            {BUCKETS.map((bkt) => (
                              <button key={bkt.value} onClick={() => setEditTxBucket(bkt.value)}
                                className="py-1.5 rounded-lg text-[10px] font-medium transition-all"
                                style={{ background: editTxBucket === bkt.value ? bkt.color + "22" : T.ink, border: `1px solid ${editTxBucket === bkt.value ? bkt.color : T.line}`, color: editTxBucket === bkt.value ? bkt.color : T.mute }}>
                                {bkt.icon} {bkt.label}
                              </button>
                            ))}
                          </div>
                          <CurrencyToggle value={editTxCurrency} onChange={setEditTxCurrency} />
                          <div className="flex gap-2">
                            <button onClick={() => saveEditTx(tx.id)} className="px-3 py-1.5 rounded-xl text-xs font-semibold hover:opacity-90" style={{ background: T.jade, color: T.ink }}>Save</button>
                            <button onClick={() => setEditTxId(null)} className="px-3 py-1.5 rounded-xl text-xs hover:opacity-70" style={{ color: T.mute }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div
                          className="flex items-center justify-between rounded-xl px-3 py-2.5 group"
                          style={{ background: T.panelSoft, borderLeft: `3px solid ${b.color}` }}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm">{b.icon}</span>
                            <div className="min-w-0">
                              <span className="text-xs truncate block" style={{ color: T.text }}>{tx.description}</span>
                              {tx.paymentMethod && (
                                <span className="text-[9px]" style={{ color: T.mute }}>
                                  {tx.paymentMethod === "card" && tx.cardLabel
                                    ? tx.cardLabel
                                    : tx.paymentMethod === "cash"
                                    ? "💵 Cash"
                                    : tx.paymentMethod === "card"
                                    ? "💳 Card"
                                    : tx.paymentNote
                                    ? `🤝 ${tx.paymentNote}`
                                    : "🤝 Other"}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span className="text-xs font-semibold tabular-nums" style={{ color: b.color }}>
                              {fmtCur(tx.amount, tx.currency ?? "USD")}
                            </span>
                            <button
                              onClick={() => startEditTx(tx)}
                              aria-label="Edit transaction"
                              className="opacity-70 md:opacity-0 md:group-hover:opacity-100 hover:!opacity-100 transition-opacity text-[10px] px-1.5 py-0.5 rounded"
                              style={{ color: T.brass, border: `1px solid ${T.brass}40` }}
                            >✎</button>
                            <button
                              onClick={() => { if (confirm("Delete this transaction?")) update({ transactions: financials.transactions.filter((t) => t.id !== tx.id) }); }}
                              aria-label="Delete transaction"
                              className="opacity-70 md:opacity-0 md:group-hover:opacity-100 hover:!opacity-100 transition-opacity text-xs px-1"
                              style={{ color: T.coral }}
                            >✕</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div
                className="flex justify-between text-xs px-3 py-2 rounded-xl"
                style={{ background: T.ink, color: T.mute }}
              >
                <span>{monthTx.length} entries</span>
                <span className="font-semibold tabular-nums" style={{ color: T.text }}>{fmt(totalOut)} logged</span>
              </div>
            </>
          )}
        </Section>

        {/* History — past months */}
        {(() => {
          const pastTx = financials.transactions.filter((t) => !t.date.startsWith(prefix));
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
                  const total = txs.reduce((s, t) => s + toUSD(t.amount, t.currency), 0);
                  return (
                    <div key={ym}>
                      <div className="flex justify-between items-center mb-2">
                        <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.mute }}>{label(ym)}</p>
                        <p className="text-[10px] tabular-nums font-semibold" style={{ color: T.text }}>{fmt(total)}</p>
                      </div>
                      <div className="space-y-1.5">
                        {txs.sort((a, b) => b.date.localeCompare(a.date)).map((tx) => {
                          const b = BUCKETS.find((b) => b.value === tx.bucket)!;
                          const isEditingTx = editTxId === tx.id;
                          return (
                            <div key={tx.id}>
                              {isEditingTx ? (
                                <div className="rounded-lg p-3 space-y-2" style={{ background: T.panelSoft, border: `1px solid ${T.jade}50` }}>
                                  <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.jade }}>Edit entry</p>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <Label htmlFor="edit-tx-amount">Amount</Label>
                                      <MoneyInput id="edit-tx-amount" value={editTxAmt} onChange={setEditTxAmt} placeholder="0" />
                                    </div>
                                    <div>
                                      <Label htmlFor="edit-tx-date">Date</Label>
                                      <DateFieldDMY id="edit-tx-date" value={editTxDate} onChange={setEditTxDate} />
                                    </div>
                                  </div>
                                  <div>
                                    <Label htmlFor="edit-tx-desc">Description</Label>
                                    <FocusInput id="edit-tx-desc" value={editTxDesc} onChange={(e) => setEditTxDesc(e.target.value)} />
                                  </div>
                                  <div className="grid grid-cols-3 gap-1.5">
                                    {BUCKETS.map((bkt) => (
                                      <button key={bkt.value} onClick={() => setEditTxBucket(bkt.value)}
                                        className="py-1.5 rounded-lg text-[10px] font-medium transition-all"
                                        style={{ background: editTxBucket === bkt.value ? bkt.color + "22" : T.ink, border: `1px solid ${editTxBucket === bkt.value ? bkt.color : T.line}`, color: editTxBucket === bkt.value ? bkt.color : T.mute }}>
                                        {bkt.icon} {bkt.label}
                                      </button>
                                    ))}
                                  </div>
                                  <CurrencyToggle value={editTxCurrency} onChange={setEditTxCurrency} />
                                  <div className="flex gap-2">
                                    <button onClick={() => saveEditTx(tx.id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold hover:opacity-90" style={{ background: T.jade, color: T.ink }}>Save</button>
                                    <button onClick={() => setEditTxId(null)} className="px-3 py-1.5 rounded-lg text-xs hover:opacity-70" style={{ color: T.mute }}>Cancel</button>
                                  </div>
                                </div>
                              ) : (
                                <div
                                  className="flex items-center justify-between rounded-lg px-2.5 py-2 group"
                                  style={{ background: T.panelSoft, borderLeft: `2px solid ${b.color}` }}
                                >
                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs truncate" style={{ color: T.text }}>{tx.description}</p>
                                    <p className="text-[9px]" style={{ color: T.mute }}>{fmtDate(tx.date)}</p>
                                  </div>
                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <span className="text-xs tabular-nums font-medium" style={{ color: b.color }}>{fmtCur(tx.amount, tx.currency ?? "USD")}</span>
                                    <button
                                      onClick={() => startEditTx(tx)}
                                      aria-label="Edit transaction"
                                      className="opacity-70 md:opacity-0 md:group-hover:opacity-100 hover:!opacity-100 transition-opacity text-[10px] px-1.5 py-0.5 rounded"
                                      style={{ color: T.brass, border: `1px solid ${T.brass}40` }}
                                    >✎</button>
                                    <button
                                      onClick={() => { if (confirm("Delete this transaction?")) update({ transactions: financials.transactions.filter((t) => t.id !== tx.id) }); }}
                                      aria-label="Delete transaction"
                                      className="opacity-70 md:opacity-0 md:group-hover:opacity-100 hover:!opacity-100 transition-opacity text-[10px] px-1"
                                      style={{ color: T.coral }}
                                    >✕</button>
                                  </div>
                                </div>
                              )}
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
            const pct = g.targetAmount > 0 ? Math.min(100, (g.currentAmount / g.targetAmount) * 100) : 0;
            const remaining = Math.max(0, g.targetAmount - g.currentAmount);
            const isContrib  = contributeGoalId === g.id;
            const isEditing  = editGoalId === g.id;
            return (
              <div key={g.id}>
                {isEditing ? (
                  <div className="rounded-xl p-3 space-y-2.5" style={{ background: T.panelSoft, border: `1px solid ${T.jade}50` }}>
                    <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.jade }}>Edit goal</p>
                    <div className="flex gap-2">
                      <div style={{ width: 68 }}>
                        <Label htmlFor="edit-goal-emoji">Emoji</Label>
                        <FocusInput id="edit-goal-emoji" value={editGEmoji} onChange={(e) => setEditGEmoji(e.target.value)} />
                      </div>
                      <div className="flex-1">
                        <Label htmlFor="edit-goal-name">Name</Label>
                        <FocusInput id="edit-goal-name" value={editGName} onChange={(e) => setEditGName(e.target.value)} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div><Label htmlFor="edit-goal-target">Target ($)</Label><MoneyInput id="edit-goal-target" value={editGTarget} onChange={setEditGTarget} placeholder="0" /></div>
                      <div><Label htmlFor="edit-goal-saved">Saved ($)</Label><MoneyInput id="edit-goal-saved" value={editGCurrent} onChange={setEditGCurrent} placeholder="0" /></div>
                    </div>
                    <div>
                      <Label htmlFor="edit-goal-date">Target date</Label>
                      <DateFieldDMY id="edit-goal-date" value={editGDate} onChange={setEditGDate} />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => saveEditGoal(g.id)} className="px-3 py-1.5 rounded-xl text-xs font-semibold hover:opacity-90" style={{ background: T.jade, color: T.ink }}>Save</button>
                      <button onClick={() => setEditGoalId(null)} className="px-3 py-1.5 rounded-xl text-xs hover:opacity-70" style={{ color: T.mute }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="rounded-xl px-3 py-2.5 group"
                    style={{ background: T.panelSoft, border: `1px solid ${T.line}` }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm truncate" style={{ color: T.text }}>
                          {g.emoji} {g.name}
                          {g.achievedAt && (
                            <span className="ml-1.5 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: T.jade + "22", color: T.jade }}>Achieved</span>
                          )}
                        </p>
                        <p className="text-[10px] tabular-nums mt-0.5" style={{ color: T.mute }}>
                          ${g.currentAmount.toLocaleString()} of ${g.targetAmount.toLocaleString()}
                          {remaining > 0 && <span style={{ color: T.brass }}> · ${remaining.toLocaleString()} to go</span>}
                        </p>
                        {(g.createdAt || g.achievedAt) && (
                          <p className="text-[9px] mt-0.5" style={{ color: T.mute }}>
                            {g.createdAt && <span>Added {fmtDate(g.createdAt)}</span>}
                            {g.achievedAt && <span style={{ color: T.jade }}> · Achieved {fmtDate(g.achievedAt)}</span>}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1.5 opacity-70 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button
                          onClick={() => startEditGoal(g)}
                          aria-label="Edit goal"
                          className="text-[10px] px-1.5 py-0.5 rounded transition-all hover:opacity-80"
                          style={{ color: T.brass, border: `1px solid ${T.brass}40` }}
                        >✎</button>
                        <button
                          onClick={() => { setContributeGoalId(isContrib ? null : g.id); setContributeGoalAmt(""); }}
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
                )}
                {isContrib && !isEditing && (
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
                      <button onClick={() => setContributeGoalId(null)} className="px-2 py-1.5 rounded-xl text-xs" style={{ color: T.mute }}>✕</button>
                    </div>
                    <p className="text-[10px]" style={{ color: T.mute }}>Logged as a Savings transaction today.</p>
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
                <Label htmlFor="new-goal-target">Target ($)</Label>
                <MoneyInput id="new-goal-target" value={gTarget} onChange={setGTarget} placeholder="5,000" />
              </div>
              <div>
                <Label htmlFor="new-goal-saved">Saved ($)</Label>
                <MoneyInput id="new-goal-saved" value={gCurrent} onChange={setGCurrent} placeholder="0" />
              </div>
            </div>
            <div>
              <Label htmlFor="new-goal-date">Target date</Label>
              <DateFieldDMY id="new-goal-date" value={gDate} onChange={setGDate} />
            </div>
            <PrimaryBtn onClick={addGoal} color={T.brass}>+ Add goal</PrimaryBtn>
          </div>
        </Section>

        {/* Recurring Payments */}
        <Section title="Recurring Payments" icon="🔄" badge={(financials.recurring ?? []).length} defaultOpen={false}>
          {(() => {
            const recs = financials.recurring ?? [];
            const now  = new Date();
            const totalMonthly = recs.reduce((s, r) => s + monthlyEquivalent(r, now), 0);
            return (
              <>
                {recs.length > 0 && (
                  <div className="space-y-2 mb-1">
                    {recs.map((r) => {
                      const mo     = monthlyEquivalent(r, now);
                      const b      = BUCKETS.find((b) => b.value === r.bucket)!;
                      const cur    = r.currency ?? "USD";
                      const sym    = cur === "LBP" ? "L£" : "$";
                      const ended  = mo === 0 && new Date(r.startDate) < now;
                      const paid   = r.totalAmount ? recurringPaidSoFar(r, now) : null;
                      const pct    = paid != null && r.totalAmount ? Math.min(100, (paid / r.totalAmount) * 100) : null;
                      const isAddingExtra = extraRecId === r.id;
                      const isEditingRec  = editRecId === r.id;
                      return (
                        <div key={r.id}>
                          {isEditingRec ? (
                            <div className="rounded-xl p-3 space-y-2.5" style={{ background: T.panelSoft, border: `1px solid ${T.jade}50` }}>
                              <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.jade }}>Edit recurring</p>
                              <div className="flex gap-2">
                                <div style={{ width: 68 }}>
                                  <Label htmlFor="edit-rec-emoji">Icon</Label>
                                  <FocusInput id="edit-rec-emoji" value={editREmoji} onChange={(e) => setEditREmoji(e.target.value)} />
                                </div>
                                <div className="flex-1">
                                  <Label htmlFor="edit-rec-name">Name</Label>
                                  <FocusInput id="edit-rec-name" value={editRName} onChange={(e) => setEditRName(e.target.value)} />
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <Label htmlFor="edit-rec-amount">Amount</Label>
                                  <MoneyInput id="edit-rec-amount" value={editRAmount} onChange={setEditRAmount} placeholder="0" />
                                </div>
                                <div>
                                  <Label htmlFor="edit-rec-freq">Frequency</Label>
                                  <select id="edit-rec-freq" value={editRFreq} onChange={(e) => setEditRFreq(e.target.value as RecurringFrequency)}
                                    className="w-full rounded-xl px-3 py-2.5 text-sm"
                                    style={{ background: T.ink, border: `1px solid ${T.line}`, color: T.text, outline: "none", colorScheme: "dark" }}>
                                    {(Object.keys(FREQ_LABELS) as RecurringFrequency[]).map((f) => (
                                      <option key={f} value={f}>{FREQ_LABELS[f]}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                              <div>
                                <Label>Currency</Label>
                                <CurrencyToggle value={editRCurrency} onChange={setEditRCurrency} />
                              </div>
                              <div>
                                <Label>Category</Label>
                                <div className="grid grid-cols-3 gap-1.5">
                                  {BUCKETS.map((bkt) => (
                                    <button key={bkt.value} onClick={() => setEditRBucket(bkt.value)}
                                      aria-label={bkt.label}
                                      aria-pressed={editRBucket === bkt.value}
                                      className="py-1.5 rounded-xl text-[10px] font-medium transition-all"
                                      style={{ background: editRBucket === bkt.value ? bkt.color + "22" : T.ink, border: `1px solid ${editRBucket === bkt.value ? bkt.color : T.line}`, color: editRBucket === bkt.value ? bkt.color : T.mute }}>
                                      {bkt.icon} {bkt.label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <div>
                                <Label htmlFor="edit-rec-start">Start date</Label>
                                <DateFieldDMY id="edit-rec-start" value={editRStart} onChange={setEditRStart} />
                              </div>
                              <div>
                                <Label>Ends</Label>
                                <div className="grid grid-cols-3 gap-1.5 mb-2">
                                  {(["infinite", "date", "amount"] as const).map((t) => (
                                    <button key={t} onClick={() => setEditREndType(t)}
                                      className="py-1.5 rounded-xl text-[10px] font-medium transition-all"
                                      style={{ background: editREndType === t ? T.jade + "22" : T.ink, border: `1px solid ${editREndType === t ? T.jade : T.line}`, color: editREndType === t ? T.jade : T.mute }}>
                                      {t === "infinite" ? "∞ Never" : t === "date" ? "📅 Date" : "💰 Amount"}
                                    </button>
                                  ))}
                                </div>
                                {editREndType === "date" && <DateFieldDMY value={editREnd} onChange={setEditREnd} />}
                                {editREndType === "amount" && <MoneyInput value={editRTotalAmount} onChange={setEditRTotalAmount} placeholder="Total amount" />}
                              </div>
                              <div className="flex gap-2">
                                <button onClick={() => saveEditRec(r.id)} className="px-3 py-1.5 rounded-xl text-xs font-semibold hover:opacity-90" style={{ background: T.jade, color: T.ink }}>Save</button>
                                <button onClick={() => setEditRecId(null)} className="px-3 py-1.5 rounded-xl text-xs hover:opacity-70" style={{ color: T.mute }}>Cancel</button>
                              </div>
                            </div>
                          ) : (
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
                                <div className="flex gap-1.5 opacity-70 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => startEditRec(r)}
                                    aria-label="Edit recurring payment"
                                    className="text-[10px] px-1.5 py-0.5 rounded transition-all hover:opacity-80"
                                    style={{ color: T.brass, border: `1px solid ${T.brass}40` }}
                                  >✎</button>
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
                                    onClick={() => { if (confirm("Delete this recurring payment?")) update({ recurring: recs.filter((x) => x.id !== r.id) }); }}
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
                                    className="px-2 py-1.5 rounded-xl text-xs transition-all hover:opacity-70"
                                    style={{ color: T.mute }}
                                  >✕</button>
                                </div>
                                <p className="text-[10px]" style={{ color: T.mute }}>
                                  Logged as a transaction in {b.label} · {cur} this month.
                                </p>
                              </div>
                            )}
                          </div>
                          )}
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
                    <p className="text-2xl mb-1">🔄</p>
                    <p className="text-xs" style={{ color: T.mute }}>Rent, subscriptions, loan payments…</p>
                  </div>
                )}

                {/* Add form */}
                <div className="rounded-xl p-4 space-y-3" style={{ background: T.ink, border: `1px solid ${T.line}` }}>
                  <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.jade }}>New recurring payment</p>

                  <div className="flex gap-2">
                    <div style={{ width: 68 }}>
                      <Label htmlFor="new-rec-emoji">Icon</Label>
                      <FocusInput id="new-rec-emoji" value={rEmoji} onChange={(e) => setREmoji(e.target.value)} placeholder="🔄" />
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
                    <Label>Category</Label>
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

                  <PrimaryBtn onClick={addRecurring} color={T.jade}>+ Add recurring</PrimaryBtn>
                </div>
              </>
            );
          })()}
        </Section>

        {/* Debts */}
        <Section title="Debts" icon="💳" badge={financials.debts.filter((d) => !d.paidOffAt).length} defaultOpen={false}>
          {financials.debts.map((d) => {
            const isPaying  = payingDebtId === d.id;
            const isEditing = editDebtId === d.id;
            return (
              <div key={d.id}>
                {isEditing ? (
                  <div className="rounded-xl p-3 space-y-2.5" style={{ background: T.panelSoft, border: `1px solid ${T.jade}50` }}>
                    <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.jade }}>Edit debt</p>
                    <div>
                      <Label htmlFor="edit-debt-name">Name</Label>
                      <FocusInput id="edit-debt-name" value={editDName} onChange={(e) => setEditDName(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div><Label htmlFor="edit-debt-balance">Balance ($)</Label><MoneyInput id="edit-debt-balance" value={editDBalance} onChange={setEditDBalance} placeholder="0" /></div>
                      <div><Label htmlFor="edit-debt-apr">APR (%)</Label><FocusInput id="edit-debt-apr" type="number" min="0" step="0.1" value={editDApr} onChange={(e) => setEditDApr(e.target.value)} placeholder="0" /></div>
                      <div><Label htmlFor="edit-debt-min">Min/mo</Label><MoneyInput id="edit-debt-min" value={editDMin} onChange={setEditDMin} placeholder="0" /></div>
                    </div>
                    <div>
                      <Label htmlFor="edit-debt-opened">Opened date (when this debt started)</Label>
                      <DateFieldDMY id="edit-debt-opened" value={editDOpened} onChange={setEditDOpened} />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => saveEditDebt(d.id)} className="px-3 py-1.5 rounded-xl text-xs font-semibold hover:opacity-90" style={{ background: T.jade, color: T.ink }}>Save</button>
                      <button onClick={() => setEditDebtId(null)} className="px-3 py-1.5 rounded-xl text-xs hover:opacity-70" style={{ color: T.mute }}>Cancel</button>
                    </div>
                  </div>
                ) : (
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
                        <p className="text-sm truncate" style={{ color: T.text }}>
                          {d.name}
                          {d.paidOffAt && (
                            <span className="ml-1.5 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: T.jade + "22", color: T.jade }}>Paid off</span>
                          )}
                        </p>
                        <p className="text-[10px] tabular-nums mt-0.5" style={{ color: T.mute }}>
                          ${d.balance.toLocaleString()} · {d.apr}% APR · min ${d.minPayment.toLocaleString()}/mo
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
                      <div className="flex items-center gap-1.5 opacity-70 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2">
                        <button
                          onClick={() => startEditDebt(d)}
                          aria-label="Edit debt"
                          className="text-[10px] px-1.5 py-0.5 rounded transition-all hover:opacity-80"
                          style={{ color: T.brass, border: `1px solid ${T.brass}40` }}
                        >✎</button>
                        {!d.paidOffAt && (
                          <button
                            onClick={() => { setPayingDebtId(isPaying ? null : d.id); setDebtPayAmt(""); }}
                            aria-label={isPaying ? "Cancel payment" : "Record a payment"}
                            className="text-[10px] px-1.5 py-0.5 rounded transition-all hover:opacity-80"
                            style={{ color: T.jade, border: `1px solid ${T.jade}40` }}
                          >{isPaying ? "cancel" : "pay"}</button>
                        )}
                        <button
                          onClick={() => { if (confirm("Delete this debt?")) update({ debts: financials.debts.filter((x) => x.id !== d.id) }); }}
                          aria-label="Delete debt"
                          className="text-xs"
                          style={{ color: T.coral }}
                        >✕</button>
                      </div>
                    </div>
                    {/* Inline payment form */}
                    {isPaying && (
                      <div className="mt-2 pt-2 space-y-2" style={{ borderTop: `1px solid ${T.line}` }}>
                        <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: T.jade }}>
                          Record a payment
                        </p>
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <MoneyInput value={debtPayAmt} onChange={setDebtPayAmt} placeholder="Payment amount" />
                          </div>
                          <button
                            onClick={() => recordDebtPayment(d.id)}
                            className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all hover:opacity-90"
                            style={{ background: T.jade, color: T.ink }}
                          >Apply</button>
                        </div>
                        <p className="text-[10px]" style={{ color: T.mute }}>
                          Balance after: ${Math.max(0, d.balance - (parseFloat(debtPayAmt.replace(/,/g, "")) || 0)).toLocaleString()}
                          {parseFloat(debtPayAmt.replace(/,/g, "")) >= d.balance && (
                            <span style={{ color: T.jade }}>, fully paid off 🏁</span>
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                )}
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
                <Label htmlFor="new-debt-balance">Balance ($)</Label>
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
            <div>
              <Label htmlFor="new-debt-opened">Opened date (optional: when this debt started)</Label>
              <DateFieldDMY id="new-debt-opened" value={dOpenedDate} onChange={setDOpenedDate} />
            </div>
            <PrimaryBtn onClick={addDebt} color={T.coral}>+ Add debt</PrimaryBtn>
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
            <PrimaryBtn onClick={addAsset} color={T.jade}>+ Add asset</PrimaryBtn>
          </div>
        </Section>

        <Section title="Balance Check" icon="🔍" badge={(financials.trackedBalances ?? []).length} defaultOpen={false}>
          <p className="text-xs" style={{ color: T.mute }}>
            Set a starting balance for your cash or a card. ESSA subtracts every transaction logged on that payment
            method since then to tell you what you <em>should</em> have. Compare it to what you actually see, and a
            gap usually means a payment never got logged. (Debt payments and recurring charges without an &quot;+extra&quot;
            log won&apos;t show up here: a known limit, not a bug.)
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
                      <p className="text-[10px]" style={{ color: T.mute }}>See the actual-vs-expected comparison on the Overview screen.</p>
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
                <Label htmlFor="new-tb-card">Which card</Label>
                {financials.cards.length === 0 ? (
                  <p className="text-xs" style={{ color: T.coral }}>No saved cards yet. Add one when logging a transaction first.</p>
                ) : (
                  <select
                    id="new-tb-card"
                    value={tbCardId}
                    onChange={(e) => setTbCardId(e.target.value)}
                    className="w-full rounded-xl px-3 py-2.5 text-sm"
                    style={{ background: T.panelSoft, border: `1px solid ${T.line}`, color: T.text }}
                  >
                    <option value="">Select a card…</option>
                    {financials.cards.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                )}
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
            <PrimaryBtn onClick={addTrackedBalance} color={T.jade}>+ Track this balance</PrimaryBtn>
          </div>
        </Section>

        </>}

        <div className="h-6" />
      </div>
      {/* end scrollable body */}

      {/* ── Footer ──────────────────────────────────────────── */}
      <div
        className="px-6 py-3 flex items-center justify-between flex-shrink-0"
        style={{ borderTop: `1px solid ${T.line}` }}
      >
        <p className="text-[10px]" style={{ color: T.mute }}>Saved in your browser</p>
        <button
          className="text-[10px] transition-opacity hover:opacity-80"
          style={{ color: T.coral }}
          onClick={() => {
            if (confirm("Clear all data?"))
              onChange({ userName: "You", income: 0, lbpRate: 89500, emergencyFundTargetMonths: 6, emergencyFundBalance: 0, transactions: [], goals: [], debts: [], recurring: [], cards: [], assets: [], trackedBalances: [], netWorthHistory: [] });
          }}
        >
          Reset
        </button>
      </div>
    </aside>
    {showImport && (
      <ImportStatement financials={financials} onImport={update} onClose={() => setShowImport(false)} />
    )}
    </>
  );
}
