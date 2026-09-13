"use client";

import { useState } from "react";
import type { LocalFinancials, TrackedBalance, PaymentMethod, StoredCard, Currency } from "../../lib/localData";
import {
  uid, todayISO, fmtDate, withRate, reanchorTrackedBalance, moneyMaxFor, DEFAULT_LBP_RATE,
} from "../../lib/localData";
import { balanceCheckReconciliation, type computeDashboard } from "../../lib/computeDashboard";
import { useTheme } from "../../contexts/ThemeContext";
import { SERIF, NUMS, money, fmtCur } from "./shared";
import {
  Label, FocusInput, MoneyInput, PrimaryBtn, CurrencyToggle, DateFieldDMY, CardPicker,
} from "../form/Primitives";

/**
 * Balance Check, moved out of InputPanel's Manage tab into its own page
 * (the CurrencyScreen precedent).
 *
 * This is a PRESENTATION move. `reanchorTrackedBalance` is untouched, and so
 * is every figure: `expected`, `discrepancy` and `changeSinceCheck` are read
 * from `dashData.balanceChecks` exactly as before, never re-derived here.
 *
 * The reconciliation verdict -- the badge, the frozen discrepancy, and the
 * residual/explained-by-activity copy from 2.4.53 and 2.4.64 -- now lives
 * ONLY here. It previously also rendered on Overview; two surfaces rendering
 * the same judgement is how the cross-surface disagreements this project has
 * repeatedly logged begin. Overview keeps its non-verdict "expected" readout
 * (a figure, not a judgement) and the alert that already existed, which now
 * routes here.
 */
export default function BalanceCheckScreen({
  financials, dashData, onChange,
}: {
  financials: LocalFinancials;
  dashData: ReturnType<typeof computeDashboard>;
  onChange: (updated: LocalFinancials) => void;
}) {
  const T = useTheme();
  const lbpRate = financials.lbpRate ?? DEFAULT_LBP_RATE;
  const cards = financials.cards ?? [];
  const tracked = financials.trackedBalances ?? [];
  const update = (patch: Partial<LocalFinancials>) => onChange({ ...financials, ...patch });

  const [actualInputs, setActualInputs] = useState<Record<string, string>>({});
  const [tbName, setTbName] = useState("");
  const [tbMethod, setTbMethod] = useState<PaymentMethod>("cash");
  const [tbCardId, setTbCardId] = useState("");
  const [tbStartBal, setTbStartBal] = useState("");
  const [tbCurrency, setTbCurrency] = useState<Currency>("USD");
  const [tbStartDate, setTbStartDate] = useState(todayISO());

  // Same six lines InputPanel uses; a tracked balance on a card needs the
  // inline "+ New card" affordance rather than a trip to another screen.
  function saveCard(type: StoredCard["type"], last4: string): StoredCard | null {
    if (last4.length !== 4 || !/^\d{4}$/.test(last4)) return null;
    const card: StoredCard = { id: uid(), type, last4, label: `${type} •••• ${last4}` };
    update({ cards: [...cards, card] });
    return card;
  }

  function addTrackedBalance() {
    if (!tbName.trim() || !tbStartBal) return;
    if (tbMethod === "card" && !tbCardId) return;
    const tb: TrackedBalance = {
      id: uid(), name: tbName.trim(), paymentMethod: tbMethod,
      ...(tbMethod === "card" ? { cardId: tbCardId } : {}),
      startingBalance: parseFloat(tbStartBal.replace(/,/g, "")),
      startingDate: tbStartDate, currency: tbCurrency,
      ...withRate(tbCurrency, lbpRate),
    };
    update({ trackedBalances: [...tracked, tb] });
    setTbName(""); setTbMethod("cash"); setTbCardId(""); setTbStartBal(""); setTbStartDate(todayISO()); setTbCurrency("USD");
  }

  function updateActualBalance(id: string) {
    const amt = parseFloat((actualInputs[id] ?? "").replace(/,/g, ""));
    if (isNaN(amt)) return;
    // 2.4.42: replacing a previous check destroys the last real snapshot, so
    // it is worth confirming -- but only when there IS one to lose.
    const tb = tracked.find((t) => t.id === id);
    if (!tb) return;
    if (tb.actualBalance != null && !confirm(`Replace your last check (${fmtCur(tb.actualBalance, tb.currency)} on ${fmtDate(tb.actualBalanceDate ?? "")}) with this new figure? This also resets the tracking baseline to today, so past drift won't keep affecting future checks. The old figure won't be recoverable.`)) {
      return;
    }
    // The OLD baseline's prediction, captured before reanchorTrackedBalance
    // moves startingBalance/startingDate (2.4.53), so the discrepancy this
    // check-in reveals survives the re-anchor. Read from dashData rather than
    // recomputed -- see computeDashboard.ts's balanceChecks for why it can't
    // be reconstructed from transaction dates afterwards.
    const expectedNow = dashData.balanceChecks.find((b) => b.id === id)?.expected;
    update({
      trackedBalances: tracked.map((t) =>
        t.id !== id ? t : reanchorTrackedBalance(t, amt, expectedNow, lbpRate)),
    });
    setActualInputs((prev) => ({ ...prev, [id]: "" }));
  }

  function deleteTrackedBalance(id: string) {
    if (!confirm("Remove this tracked balance?")) return;
    update({ trackedBalances: tracked.filter((tb) => tb.id !== id) });
  }

  return (
    <main className="min-h-screen px-4 py-8 md:px-10" style={{ background: T.ink }}>
      <div className="max-w-3xl mx-auto space-y-6">

        <div>
          <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>ESSA</p>
          <h1 className="text-3xl mt-1" style={SERIF}>Balance Check</h1>
          <p className="text-sm mt-2" style={{ color: T.mute }}>
            What you should have, against what you actually have.
          </p>
        </div>

        <div className="rounded-2xl p-5 space-y-2" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <p className="text-xs" style={{ color: T.mute }}>
            Set a starting balance for your cash or a card. ESSA subtracts every transaction logged on that payment
            method since then to tell you what you <em>should</em> have. Compare it to what you actually see, and a
            gap usually means a payment never got logged. (A recurring bill that hasn&apos;t been confirmed yet
            won&apos;t show up here — a known limit, not a bug.)
          </p>
          <p className="text-[10px]" style={{ color: T.mute }}>
            Entering what you actually have resets the baseline to that figure and today — so a gap you&apos;ve
            already noticed and accounted for won&apos;t keep reappearing in every future check.
          </p>
        </div>

        {/* ── Reconciliation: one card per checked-in balance ──
            Moved verbatim from FinancialDashboard.tsx. The badge reads the
            FROZEN discrepancy (2.4.53) -- it verdicts on a fact captured at
            check-in and only a fresh check-in may update it.
            residual/explainedByActivity (2.4.64) separate "the original gap,
            still standing" from "real activity that has since narrowed it"
            for the BODY COPY only; an unreconciled balance keeps its Mismatch
            badge regardless of how well activity happens to line up. */}
        {dashData.balanceChecks.some((b) => b.actual != null) && (
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-widest px-1" style={{ color: T.mute }}>Reconciliation</p>
            <div className="grid gap-3 md:grid-cols-2">
              {dashData.balanceChecks.filter((b) => b.actual != null).map((b) => {
                const gap = b.discrepancy ?? 0;
                const mismatch = Math.abs(gap) >= 1;
                const accent = mismatch ? T.coral : T.jade;
                const { residual, explainedByActivity, netActivitySinceCheck } = balanceCheckReconciliation(gap, b.changeSinceCheck);
                const residualStillOpen = Math.abs(residual) >= 1;
                const expectedAsOfCheck = Math.round((b.expected - b.changeSinceCheck) * 100) / 100;
                const hasActivitySince = Math.abs(netActivitySinceCheck) >= 0.01;
                return (
                  <div key={b.id} className="rounded-2xl px-5 py-4" style={{ background: T.panel, border: `1px solid ${mismatch ? T.coral + "40" : T.line}` }}>
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <span className="text-sm font-medium" style={{ color: T.text }}>{b.name}</span>
                      <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: accent }}>
                        {mismatch ? "Mismatch" : "Matches"}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between text-xs" style={{ color: T.mute }}>
                      <span>Expected at check-in</span>
                      <span style={{ ...NUMS, color: T.text }}>{money(expectedAsOfCheck)}</span>
                    </div>
                    <div className="flex items-baseline justify-between text-xs mt-1" style={{ color: T.mute }}>
                      <span>You said you had</span>
                      <span style={{ ...NUMS, color: T.text }}>{money(b.actual ?? 0)}</span>
                    </div>
                    {mismatch && (
                      <div className="flex items-baseline justify-between text-xs mt-1" style={{ color: T.mute }}>
                        <span>Difference</span>
                        <span style={{ ...NUMS, color: accent }}>{money(gap)}</span>
                      </div>
                    )}
                    {b.actualDate && (
                      <p className="text-[10px] mt-2" style={{ color: T.mute }}>Checked {fmtDate(b.actualDate)}</p>
                    )}
                    {mismatch && (
                      <p className="text-[11px] mt-3 pt-3" style={{ color: T.mute, borderTop: `1px solid ${T.line}` }}>
                        {!hasActivitySince
                          ? "Nothing has been logged against this balance since the check, so the gap is still exactly as found — usually a payment that never got entered."
                          : explainedByActivity
                            ? "Activity logged since the check accounts for this gap — nothing further to chase."
                            : residualStillOpen
                              ? `Activity since the check explains part of it; about ${money(Math.abs(residual))} is still unaccounted for.`
                              : "Activity since the check has closed the gap."}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Tracked balances: check in, or remove ── */}
        {tracked.length > 0 && (
          <div className="rounded-2xl p-5 space-y-3" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
            <p className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>Tracked balances</p>
            <div className="space-y-2">
              {tracked.map((tb) => {
                const card = tb.cardId ? cards.find((c) => c.id === tb.cardId) : null;
                const check = dashData.balanceChecks.find((b) => b.id === tb.id);
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
                      {check && (
                        <p className="text-[10px]" style={{ color: T.mute }}>
                          Expected now: <span style={{ color: T.text }}>{fmtCur(check.expected, "USD")}</span>
                        </p>
                      )}
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <MoneyInput
                            value={actualInputs[tb.id] ?? ""}
                            onChange={(v) => setActualInputs((prev) => ({ ...prev, [tb.id]: v }))}
                            placeholder="What you actually have now"
                            max={moneyMaxFor(tb.currency, lbpRate)}
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
          </div>
        )}

        {/* ── Add ── */}
        <div className="rounded-2xl p-5 space-y-3" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
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
              <CardPicker cardId={tbCardId || null} onCardIdChange={(id) => setTbCardId(id ?? "")} cards={cards} onSaveCard={saveCard} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="new-tb-balance">Starting balance</Label>
              <MoneyInput id="new-tb-balance" value={tbStartBal} onChange={setTbStartBal} placeholder="0" max={moneyMaxFor(tbCurrency, lbpRate)} />
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

      </div>
    </main>
  );
}
