"use client";

import { useState } from "react";
import type { LocalFinancials, TrackedBalance, PaymentMethod, StoredCard, Currency, StoredDebt } from "../../lib/localData";
import {
  uid, todayISO, fmtDate, withRate, reanchorTrackedBalance, moneyMaxFor, DEFAULT_LBP_RATE,
  buildPeriodClose, cycleStartDayOf, unclosedCycles, isCycleClosedBySpan,
  closeMovesBaselineBackwards, canReopen, reopenCycle, activeCloseForCycle, rateForMonth,
  derivedEfBalance, derivedDebtBalance, planEfClose, planDebtClose,
} from "../../lib/localData";
import { balanceCheckReconciliation, trackedBalanceExpectedAsOf, type computeDashboard } from "../../lib/computeDashboard";
import { useTheme } from "../../contexts/ThemeContext";
import CloseCycleModal, { type CloseRow, type AdjustmentRow } from "../CloseCycleModal";
import { currentCycleKey, cycleCloseInstant, cycleBounds, cycleLabel as fmtCycle, type CycleKey } from "../../lib/period";
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

  // ── Period close (docs/PERIOD_CLOSE_PLAN.md Phase 2) ──
  // Phase 3: holds the cycle KEY being closed, so the same dialog serves the
  // current cycle and any past one. null = shut.
  const [closing, setClosing] = useState<CycleKey | null>(null);
  const startDay = cycleStartDayOf(financials);
  const currentKey = currentCycleKey(new Date(), startDay);
  const closingKey = closing ?? currentKey;
  const unclosed = unclosedCycles(financials, new Date());
  // The cycle's last LOCAL day, formatted. Not fmtDate on the close
  // instant's ISO string: that is the UTC day, which for a 23:59:59.999
  // local instant can name the day either side of the real one.
  const closingRangeEnd = (() => {
    const d = new Date(cycleBounds(closingKey, startDay).end.getTime() - 1);
    return fmtDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  })();

  /**
   * ONE write for every account. Not a loop of per-account updates: the
   * reanchors and the record land in a single onChange, so there is no
   * partway state to recover from -- either the whole close happened or
   * none of it did. saveData is likewise one setItem.
   *
   * Pinned to the cycle's END INSTANT, not today. reanchorTrackedBalance
   * takes that instant for `startingAt` and derives a bare `startingDate`
   * from it -- passing the instant straight through used to break
   * isAfterBalanceBaseline's tier 3 for every boundary-day transaction.
   */
  function commitClose(
    entries: Parameters<React.ComponentProps<typeof CloseCycleModal>["onConfirm"]>[0],
    adjustments: Parameters<React.ComponentProps<typeof CloseCycleModal>["onConfirm"]>[1],
  ) {
    const key = closingKey;
    // Phase 3: re-closing an already-closed cycle is REFUSED, not replaced.
    // A re-close with the same asOf mints an IDENTICAL startingAt, so a
    // silent replace could re-attach an old acknowledgement to a new figure.
    // The way back is Phase 4's reopen, which is why the copy promises none.
    if (isCycleClosedBySpan(financials, key, startDay).closed) { setClosing(null); return; }

    const at = cycleCloseInstant(key, startDay);
    const now = new Date();
    // An account whose baseline is already NEWER than this cycle's end is
    // recorded but not reanchored -- see closeMovesBaselineBackwards.
    const backwards = (tb: TrackedBalance) => closeMovesBaselineBackwards(tb, at);

    // Phase 5a: plan every adjustment BEFORE writing anything, so the close
    // stays one write. A zero delta plans no transaction at all, which is
    // what makes confirming an unchanged fund or debt free.
    const countedOf = (k: string) => adjustments.find((a) => a.key === k)?.counted;
    const efCounted = countedOf("ef");
    const efPlan = efCounted != null && !isNaN(efCounted) ? planEfClose(financials, efCounted) : null;
    const debtPlans = openDebts
      .map(({ d }) => ({ d, counted: countedOf(d.id) }))
      .filter((x): x is { d: StoredDebt; counted: number } => x.counted != null && !isNaN(x.counted))
      .map(({ d, counted }) => planDebtClose(d, financials.transactions ?? [], counted));
    const newTransactions = [
      ...(efPlan?.transaction ? [efPlan.transaction] : []),
      ...debtPlans.flatMap((p) => (p.transaction ? [p.transaction] : [])),
    ];

    const record = buildPeriodClose({
      cycleKey: key, startDay, closedAt: now,
      ...(efPlan ? { emergencyFund: efPlan.entry } : {}),
      ...(debtPlans.length ? { debts: debtPlans.map((p) => p.entry) } : {}),
      // The rate the figures were actually converted at, so the record's
      // lbpRateAtClose names the rate its own arithmetic used.
      lbpRate: lbpRateAtClose,
      accounts: entries.map((e) => ({
        tb: e.tb, actual: e.actual, actualUSD: e.actualUSD, expectedAtClose: e.expectedAtClose,
        // `!backwards` here is a SECOND layer and no test can redden it:
        // the dialog already withholds the acknowledgement control from a
        // recorded-only row, so nothing reachable through the UI arrives
        // here with one. Kept because this is the persistence boundary and
        // the dialog is a different layer -- recorded as NOT load-bearing
        // rather than counted as covered (same call as Phase 2's
        // !tb.startingAt early return).
        ...(e.acknowledgement && !backwards(e.tb)
          ? { acknowledgement: { ...e.acknowledgement, acknowledgedAt: now.toISOString(), startingAt: at } }
          : {}),
      })),
    });
    update({
      trackedBalances: tracked.map((t) => {
        const e = entries.find((x) => x.tb.id === t.id);
        if (!e || backwards(t)) return t;
        return reanchorTrackedBalance(t, e.actual, e.expectedAtClose, lbpRate, at);
      }),
      // The reanchors, the adjustments and the record land together. Phase
      // 2 made this one write so there is no partway state to recover from;
      // adding a second account type must not quietly make it two.
      ...(newTransactions.length
        ? { transactions: [...newTransactions, ...(financials.transactions ?? [])] }
        : {}),
      periodCloses: [...(financials.periodCloses ?? []), record],
    });
    setClosing(null);
  }

  // Expected AS OF the cycle end, not the live figure. For the current cycle
  // the two coincide; for a late close they do not, and comparing a stated
  // balance against today's expected would subtract one moment from another.
  // ── Phase 4: reopen ──
  // Rendered from canReopen and acted on through canReopen -- the same
  // call, not two conditions that could disagree. The line only appears
  // for the CURRENT cycle: reopen restores anchors, not the transactions
  // logged since, so it is exact immediately after a close and steadily
  // less so afterwards. Past cycles in the unclosed list are a different
  // question and stay closed.
  const activeClose = activeCloseForCycle(financials, currentKey, startDay);
  const reopenVerdict = canReopen(financials, currentKey, new Date());
  // closedAt is an INSTANT, so its local day -- not fmtDate on a UTC slice,
  // which names the wrong day either side of midnight. Same trap as
  // closingRangeEnd above.
  const closedOnLabel = activeClose
    ? (() => {
        const d = new Date(activeClose.closedAt);
        return fmtDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
      })()
    : "";

  function commitReopen() {
    // ONE decision point. reopenCycle re-asks canReopen internally against
    // the clock at THIS moment, so a cycle that rolled over while the
    // screen sat open is refused here even though the button was rendered
    // from a verdict taken earlier -- and refused BEFORE the question is
    // asked, rather than asked and then quietly ignored.
    //
    // An explicit canReopen call here as well would be a third guard of the
    // kind this phase set out to stop adding: no test could reach it, since
    // reopenCycle already returns null on the same condition. Nothing is
    // written until update(), so computing the result before confirming
    // costs nothing.
    const next = reopenCycle(financials, currentKey, new Date());
    if (!next) return;
    if (!confirm(
      "Reopen this cycle? Every account goes back to the balance and baseline it " +
      "had before the close. Transactions you have logged since are untouched, and " +
      "any note you wrote to account for a gap stops applying -- it stays on the " +
      "record as history."
    )) return;
    update({ trackedBalances: next.trackedBalances, periodCloses: next.periodCloses });
  }
  // THE rate for this close, chosen in one place. rateForMonth against the
  // CLOSING cycle, not the live rate: a late close states what an account
  // held at the cycle end, and expectedAtClose is already built from
  // historized rates, so converting the stated figure at today's rate would
  // compare two moments -- 2.4.134's fault in a second dimension.
  const lbpRateAtClose = rateForMonth(financials.lbpRateHistory, closingKey, lbpRate);

  // Phase 5a. The fund appears only if it is in use, and a debt only while
  // something is owed -- an account with nothing in it is not a question
  // worth asking at a close, and the length of this dialog is the main
  // thing standing between the ritual and being abandoned.
  const efExpectedUSD = derivedEfBalance(financials);
  const efInUse = efExpectedUSD !== 0 || (financials.emergencyFundOpeningBalance ?? 0) !== 0;
  const openDebts = (financials.debts ?? [])
    .map((d) => ({ d, expectedNative: derivedDebtBalance(d, financials.transactions ?? []) }))
    .filter(({ expectedNative }) => expectedNative > 0);
  const adjustmentRows: AdjustmentRow[] = [
    ...(efInUse
      ? [{ key: "ef", name: "Emergency fund", currency: "USD" as Currency,
           expected: efExpectedUSD, hint: "What the fund actually holds" }]
      : []),
    // "owed", not "held": for a debt the counterparty holds the truth, so
    // the figure comes off a statement rather than off a count. Saying so
    // in the label is the difference between an answerable question and a
    // guess.
    ...openDebts.map(({ d, expectedNative }) => ({
      key: d.id, name: d.name, currency: d.currency,
      expected: expectedNative, hint: `What ${d.name} says is owed`,
    })),
  ];

  const closeRows: CloseRow[] = tracked.map((tb) => ({
    tb,
    expectedAtClose: trackedBalanceExpectedAsOf(tb, financials, cycleCloseInstant(closingKey, startDay)),
    recordedOnly: closeMovesBaselineBackwards(tb, cycleCloseInstant(closingKey, startDay)),
  }));

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
        {/* The close action lives OUTSIDE the reconciliation block on
            purpose. That block is gated on at least one account having been
            checked in, and closing a cycle is precisely how you state a
            balance for the first time -- nesting the button inside it made
            the action unreachable for exactly the account that needs it
            most. Found by perturbation: the original "not offered with zero
            tracked balances" test passed either way, because the outer gate
            hid the button regardless of its own condition.

            Phase 5a: a fund or an open debt is reason enough to close a
            cycle, so the gate is no longer about tracked balances alone --
            this was the last place the feature still assumed they were the
            only kind of account. */}
        {(tracked.length > 0 || adjustmentRows.length > 0) && (
          <div className="flex justify-end items-center gap-2 px-1">
            {activeClose ? (
              <>
                <span className="text-[10px]" style={{ color: T.mute }}>
                  Closed on {closedOnLabel}
                </span>
                {reopenVerdict.ok ? (
                  <button
                    onClick={commitReopen}
                    className="text-[10px] font-semibold px-2.5 py-1 rounded-lg transition-all hover:opacity-80"
                    style={{ color: T.mute, border: `1px solid ${T.mute}40` }}
                  >
                    Reopen
                  </button>
                ) : (
                  // The only refusal reachable here: the record predates
                  // Phase 4 and captured four of the seven fields a close
                  // overwrites. Restoring those four would pair a pre-close
                  // balance with the close's expected figure and invent a
                  // gap, so the honest answer is to say why, not to offer a
                  // button that half-works.
                  <span className="text-[10px]" style={{ color: T.mute }}>
                    (closed before reopening was supported)
                  </span>
                )}
              </>
            ) : (
              <button
                onClick={() => setClosing(currentKey)}
                className="text-[10px] font-semibold px-2.5 py-1 rounded-lg transition-all hover:opacity-80"
                style={{ color: T.jade, border: `1px solid ${T.jade}40` }}
              >
                Close this cycle
              </button>
            )}
          </div>
        )}
        {dashData.balanceChecks.some((b) => b.actual != null) && (
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-widest px-1" style={{ color: T.mute }}>Reconciliation</p>
            <div className="grid gap-3 md:grid-cols-2">
              {dashData.balanceChecks.filter((b) => b.actual != null).map((b) => {
                const gap = b.discrepancy ?? 0;
                // >= $1, and the reason is stated here for the first time:
                // this is a PER-ACCOUNT verdict on a screen opened
                // deliberately, so it flags anything a person would call a
                // real difference. The Overview alert's $5 threshold is
                // higher on purpose -- that one INTERRUPTS, and earns a
                // higher bar. The asymmetry was UNDESIGNED until 2026-09-22:
                // the $5 always carried a stated reason, this one never did.
                const mismatch = Math.abs(gap) >= 1;
                // Phase 2 / 2.4.124: three-valued. `acknowledged` is computed
                // once in computeDashboard and read here AND by the Overview
                // alert, so the two surfaces cannot disagree.
                const ack = b.acknowledged;
                const verdict = !mismatch ? "Matches" : ack ? "Accounted for" : "Mismatch";
                // Brass, deliberately NOT jade. 2.4.64 refused to assert
                // `Matches` on a balance nobody re-confirmed, and that
                // objection survives: "Accounted for" means a real gap,
                // explained -- it must not look like no gap.
                const accent = !mismatch ? T.jade : ack ? T.brass : T.coral;
                const { residual, explainedByActivity, netActivitySinceCheck } = balanceCheckReconciliation(gap, b.changeSinceCheck);
                const residualStillOpen = Math.abs(residual) >= 1;
                const expectedAsOfCheck = Math.round((b.expected - b.changeSinceCheck) * 100) / 100;
                const hasActivitySince = Math.abs(netActivitySinceCheck) >= 0.01;
                return (
                  <div key={b.id} className="rounded-2xl px-5 py-4" style={{ background: T.panel, border: `1px solid ${mismatch ? accent + "40" : T.line}` }}>
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <span className="text-sm font-medium" style={{ color: T.text }}>{b.name}</span>
                      <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: accent }}>
                        {verdict}
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
                    {ack && (
                      <p className="text-[10px] mt-2" style={{ color: T.brass }}>
                        Accounted for on {fmtDate(ack.acknowledgedAt)} &mdash; &ldquo;{ack.note}&rdquo;
                      </p>
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

        {/* Phase 3: the unclosed-cycle list. QUIET BY CONSTRUCTION -- no
            count on the nav, no Overview alert, no chip, and nothing at all
            until the first close. A ritual that generates guilt gets
            abandoned, and then the record is worse than none. */}
        {unclosed.rows.length > 0 && (
          <div className="rounded-2xl px-5 py-4 space-y-2" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
            <p className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>Cycles not closed</p>
            <div className="space-y-1.5">
              {unclosed.rows.map((r) => (
                <div key={r.cycleKey} className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-sm" style={{ color: T.text }}>{fmtCycle(r.cycleKey, startDay)}</span>
                    {r.closedUnderOtherSpan && (
                      <p className="text-[10px] mt-0.5" style={{ color: T.mute }}>
                        You closed {fmtDate(r.closedUnderOtherSpan.rangeStart)} &ndash; {fmtDate(r.closedUnderOtherSpan.rangeEnd)} under
                        your previous payday; that was a different period.
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => setClosing(r.cycleKey)}
                    aria-label={`Close the cycle ${fmtCycle(r.cycleKey, startDay)}`}
                    className="text-[10px] font-semibold px-2.5 py-1 rounded-lg flex-shrink-0 transition-all hover:opacity-80"
                    style={{ color: T.jade, border: `1px solid ${T.jade}40` }}
                  >
                    Close
                  </button>
                </div>
              ))}
            </div>
            {unclosed.hiddenEarlier > 0 && (
              <p className="text-[10px]" style={{ color: T.mute }}>+{unclosed.hiddenEarlier} earlier</p>
            )}
          </div>
        )}

      </div>
      {closing && (
        <CloseCycleModal
          cycleLabel={fmtCycle(closingKey, startDay)}
          rows={closeRows}
          daysLate={Math.max(0, Math.floor((Date.now() - new Date(cycleCloseInstant(closingKey, startDay)).getTime()) / 86_400_000))}
          rangeEnd={closingRangeEnd}
          reopenable={closingKey === currentKey}
          lbpRateAtClose={lbpRateAtClose}
          adjustmentRows={adjustmentRows}
          onCancel={() => setClosing(null)}
          onConfirm={commitClose}
        />
      )}
    </main>
  );
}
