"use client";

/**
 * ESSA — Financial Dashboard
 * --------------------------
 * The Overview screen. It always receives its figures through the `data`
 * prop (computeDashboard runs entirely client-side). CODE-02: the old fetch
 * of a dashboard route the server never had, and its mock "demo data"
 * fallback, were removed.
 *
 * Design language: "ledger ink & brass" — deep green-ink surfaces,
 * brass for milestones, jade for progress, coral reserved for the few
 * places attention is genuinely needed. Engraved-serif numerals carry
 * the dates: this dashboard is about *time*, not guilt.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ResponsiveContainer,
  AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line,
} from "recharts";
import { useTheme } from "../contexts/ThemeContext";
import { moneyEquals, type LocalFinancials, cycleStartDayOf } from "../lib/localData";
import { getLastSyncTime, serverCopyExists } from "../lib/syncService";
import { getSession } from "../lib/auth";
import { periodTotals, bucketDisplayState, type DashboardPayload } from "../lib/computeDashboard";
import OnboardingChecklist from "./OnboardingChecklist";
import { fmtCur, type Screen } from "./screens/shared";
import {currentCycleKey, cycleKeyForISO, cycleLabel, cycleLabelLong, cycleTickLabel, ymKeyToCycleKey, cycleBounds, periodNoun, asCalendarKey, asCycleKey, type CycleKey, type CalendarKey } from "../lib/period";
const SERIF: React.CSSProperties = { fontFamily: "Georgia, 'Times New Roman', serif" };
const NUMS: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };

const money = (n: number, digits = 0) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits }).format(n);
/**
 * sixMonthTrend's ymKey is a CYCLE key in numeric form. It used to render as
 * a calendar month name ("Aug '26") beneath a panel titled "last 6 cycles" --
 * form (a), under a cycle-titled chart (2.4.101). Ticks now carry the
 * cycle's start date and the tooltip carries the full range.
 */
const ymTick = (ymKey: number, startDay: number) => cycleTickLabel(ymKeyToCycleKey(ymKey), startDay);
const ymFull = (ymKey: number, startDay: number) => cycleLabelLong(ymKeyToCycleKey(ymKey), startDay);
/**
 * A CALENDAR month, short ("Sep '26"). netWorthHistory is the one
 * calendar-keyed series (2.4.87), and this is its formatter. Cycle keys get
 * cycleLabel instead -- the two key spaces had been sharing this one
 * function, which is the two-meanings-one-label shape 2.4.87 exists to
 * prevent, just in the display layer rather than the data.
 */
const ymStrLabel = (ym: CalendarKey) => {
  const [y, m] = ym.split("-").map(Number);
  return `${["", "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m]} ’${String(y).slice(2)}`;
};

// --------------------------- sub-views --------------------------- //

function HealthRing({ score, grade }: { score: number; grade: string }) {
  const T = useTheme();
  const color = score >= 80 ? T.jade : score >= 60 ? T.jade : score >= 40 ? T.brass : T.coral;
  const r     = 38;
  const circ  = 2 * Math.PI * r;
  const dash  = (score / 100) * circ;
  const gap   = circ - dash;
  return (
    <div className="relative w-40 h-40 mx-auto">
      <svg viewBox="0 0 100 100" className="w-full h-full" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="50" cy="50" r={r} fill="none" stroke={T.line} strokeWidth="7" />
        <circle
          cx="50" cy="50" r={r} fill="none"
          stroke={color} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${dash} ${gap}`}
          style={{ transition: "stroke-dasharray 1s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-6">
        <span className="text-5xl font-medium tabular-nums" style={{ ...SERIF, color: T.text }}>{score}</span>
        <span className="text-[10px] tracking-widest uppercase text-center leading-tight" style={{ color }}>{grade}</span>
      </div>
    </div>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  const T = useTheme();
  return (
    <div className="h-2 rounded-full overflow-hidden" style={{ background: T.line }}>
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </div>
  );
}

function BucketRow({ label, actual, target, color, bucket, noun }: { label: string; actual: number; target: number; color: string; noun: string; bucket: "NEEDS" | "WANTS" | "SAVINGS" }) {
  const T = useTheme();
  const pct = target > 0 ? (actual / target) * 100 : 0;
  // budgetPace's own carve-outs (computeDashboard.ts), applied here too: a
  // target rolled to $0 by rollover isn't a real ceiling, and Savings is a
  // floor, not a ceiling -- it never reads "over".
  const state = bucketDisplayState(bucket, target, actual);
  const alarmed = state.kind === "over";
  return (
    <div>
      <div className="flex justify-between text-sm mb-1.5">
        <span style={{ color: T.text }}>{label}</span>
        <span style={{ ...NUMS, color: T.mute }}>
          {money(actual)} <span style={{ color: T.line }}>/</span> {money(target)}
        </span>
      </div>
      <Bar pct={pct} color={alarmed ? T.coral : color} />
      <p className="text-xs mt-1" style={{ color: alarmed ? T.coral : T.mute }}>
        {state.kind === "zeroed"
          ? `target rolled to $0 this ${noun}`
          : state.kind === "met"
          ? `target met`
          : state.kind === "over"
          ? `${money(state.over)} over — carries into next ${noun}'s target`
          : `${money(state.headroom)} ${bucket === "SAVINGS" ? "to go" : "of room left"}`}
      </p>
    </div>
  );
}

function Panel({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) {
  const T = useTheme();
  return (
    <section className={`rounded-2xl p-5 ${className}`} style={{ background: T.panel, border: `1px solid ${T.line}` }}>
      {title && <h2 className="text-xs uppercase tracking-widest mb-4" style={{ color: T.mute }}>{title}</h2>}
      {children}
    </section>
  );
}

// ---------------------------- screen ----------------------------- //

export default function FinancialDashboard({
  data, financials, onNavigate, onConfirmRecurring, loggingRecurringIds, justConfirmedIds,
}: {
  data: DashboardPayload;
  /** 2.4.55 sub-phase 3 -- the raw ledger, needed only for the past-month
      review card below (periodTotals takes LocalFinancials, not the
      already-computed DashboardPayload). Optional: the past-month card
      simply doesn't render without it. */
  financials?: LocalFinancials;
  onNavigate?: (screen: Screen) => void;
  /** Confirms a recurring item's oldest outstanding cycle -- see the "Confirm" button on Renewing soon. Quick-confirm only here (defaults to the due date); date-override lives in My Finances' Recurring section. */
  onConfirmRecurring?: (recurringId: string) => void;
  /** Recurring item ids whose confirm write is currently in flight -- disables that item's button so a second click can't create a duplicate transaction while the first is still saving. */
  loggingRecurringIds?: Set<string>;
  /** Recurring item ids that just finished confirming, briefly, before their target moves on to the next cycle (2.4.30, finding 3). */
  justConfirmedIds?: Set<string>;
}) {
  const T = useTheme();
  const router = useRouter();

  // Recovery (the recovery-code flow on a lost/wiped device) only has
  // anything to recover if this account has pushed at least once -- with
  // no server copy, a valid recovery code still finds nothing. This is a
  // real gap for anyone using ESSA on exactly one device and never opening
  // Profile -- surfaced here rather than silently discovered the day it's
  // too late to matter. sessionStorage/localStorage read, so it's done in
  // an effect rather than during render.
  //
  // Session 10, item 5 (owner): said only when it's known there's no server
  // copy. No sync time here doesn't mean that: the time is per account since
  // DI-16 (one that synced under the old browser-wide time has none of its
  // own), and storage can refuse to save it. So the server is asked, and only
  // when the banner would otherwise show; a copy, or no answer, claims nothing.
  const [neverSynced, setNeverSynced] = useState(false);
  const wouldClaim = financials?.syncChoice?.enabled !== false && (data.month.income > 0 || data.hasLoggedTransactions);
  useEffect(() => {
    if (!wouldClaim) return;
    const s = getSession();
    if (!s || getLastSyncTime(s.userId) !== null) return;
    let live = true;
    void serverCopyExists(s.email).then((exists) => { if (live) setNeverSynced(exists === false); });
    return () => { live = false; };
  }, [wouldClaim]);

  // 2.4.55 sub-phase 3 -- past-month review. Deliberately NOT a
  // parameterized version of this whole live dashboard: health score,
  // alerts, upcoming renewals, and Balance Check are all now-concepts
  // (is EF currently funded, what's due next) that don't mean anything
  // for a closed past month, and reconstructing them historically would be
  // a much bigger, different feature nobody asked for. Empty string = no
  // selection, nothing extra shown -- Overview stays exactly as it always
  // has by default.
  const [selectedPastMonth, setSelectedPastMonth] = useState<CycleKey | "">("");
  const [pastPickerFocused, setPastPickerFocused] = useState(false); // A11Y-05: its focus ring
  // Dismissal is per-mount, not persisted: the banner already expires by
  // itself when the cycle advances, so persisting a flag would add a field
  // whose only job is to be cleaned up later.
  const [paydayBannerDismissed, setPaydayBannerDismissed] = useState(false);

  const { health, month, periodLabel, emergencyFund: ef, debt, goals, sixMonthTrend, encouragements, user, netWorth, streaks, budgetPace, netWorthTrend, upcomingRenewals, balanceChecks, budgetTargetPct, alerts } = data;
  const targets     = data.budgetTargets;
  const budgetLabel = data.budgetRule === "custom" ? "Custom split" : data.budgetRule.replace(/-/g, " / ");

  // Every month with a real logged transaction, most recent first, current
  // month excluded (already shown live above). A month whose only activity
  // was grandfathered recurring accrual with zero actual transactions
  // logged won't appear here -- a narrow, pre-Phase-2.5 case, not worth the
  // extra complexity of also walking recurring history for this list.
  const startDay = cycleStartDayOf(financials ?? { });
  const currentYm = currentCycleKey(new Date(), startDay);
  const noun = periodNoun(startDay);
  const showPaydayBanner = !paydayBannerDismissed
    && startDay > 1
    && !!financials?.cycleStartDayChangedAt
    && cycleKeyForISO(financials.cycleStartDayChangedAt, startDay) === currentYm;
  const pastMonths = financials
    ? Array.from(new Set((financials.transactions ?? []).filter((t) => t.deletedAt == null).map((t) => cycleKeyForISO(t.date, startDay))))
        .filter((ym) => ym !== currentYm)
        .sort()
        .reverse()
    : [];
  const pastMonthReview = financials && selectedPastMonth
    // The selected cycle's own first day, not the 1st of the calendar month
    // its key names -- periodTotals uses this as the recurring as-of.
    ? periodTotals(financials, selectedPastMonth, cycleBounds(selectedPastMonth, startDay).start)
    : null;
  const budgetPct   = {
    needs:   Math.round(targets.needs   / Math.max(month.income, 1) * 100),
    wants:   Math.round(targets.wants   / Math.max(month.income, 1) * 100),
    savings: Math.round(targets.savings / Math.max(month.income, 1) * 100),
  };

  return (
    <main className="min-h-screen px-4 py-8 md:px-10" style={{ background: T.ink, color: T.text }}>
      <div className="mx-auto max-w-6xl space-y-6">

        {/* Header */}
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>ESSA · {periodLabel}</p>
            <h1 className="text-3xl md:text-4xl mt-1" style={SERIF}>
              {moneyEquals(month.income, 0)
                ? <>Set your income to see the full picture, {user.name.split(" ")[0]}.</>
                : budgetTargetPct.savings > 0 && month.savingsRatePct >= budgetTargetPct.savings
                ? <>{user.name.split(" ")[0]}, you saved <span style={{ color: T.jade }}>{money(month.savingsContrib)}</span>, at or above your {budgetTargetPct.savings}% target.</>
                : month.netCashFlow > 0
                ? <>You kept <span style={{ color: T.brass }}>{money(month.netCashFlow)}</span> this {noun}, {user.name.split(" ")[0]}. Every dollar counts.</>
                : <>Spending exceeded income by <span style={{ color: T.coral }}>{money(-month.netCashFlow)}</span> this {noun}, {user.name.split(" ")[0]}. The plan below shows the path.</>}
            </h1>
          </div>
        </header>

        {/* Keeps showing until BOTH steps are actually done (not just "income
            set"), so a user who sets income first doesn't lose the nudge to
            log a transaction — it used to be gated on income === 0 alone and
            vanished the instant step 1 was done, even if step 2 wasn't. */}
        {onNavigate && !(month.income > 0 && data.hasLoggedTransactions) && (
          <OnboardingChecklist hasIncome={month.income > 0} hasTransactions={data.hasLoggedTransactions} onNavigate={onNavigate} />
        )}

        {/* Not part of `alerts` (computeDashboard is a pure function of
            LocalFinancials and has no way to know sync state) -- this reads
            localStorage directly instead. Sync is deliberately opt-in
            (see Privacy Policy), so this only ever warns, never auto-pushes. */}
        {/* COPY-05 (owner, 2026-09-30): with backup off, nothing prompts an
            upload -- the choice was made, and Profile already says what it
            means. On, or still undecided, the banner shows as before. */}
        {neverSynced && wouldClaim && (
          <button
            onClick={() => router.push("/profile")}
            className="w-full text-left transition-opacity hover:opacity-80"
          >
            <div
              className="flex items-center gap-2.5 rounded-2xl px-4 py-3"
              style={{ background: T.brass + "12", border: `1px solid ${T.brass}30` }}
            >
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: T.brass }} />
              <span className="text-sm flex-1" style={{ color: T.text }}>
                This data has never been backed up. If this device is lost, it can&apos;t be recovered — go to Profile and push a backup.
              </span>
              <span className="text-xs flex-shrink-0" style={{ color: T.brass }}>→</span>
            </div>
          </button>
        )}

        {/* Payday just moved. Shown for the FIRST cycle under the new
            boundary only, and gated on a timestamp rather than a
            dismissed-flag: once the cycle key of the change no longer
            matches the current cycle key, the banner is gone on its own.
            That means no seen-flag to persist, no stale flag left behind if
            the payday changes again, and nothing to clean up later -- the
            same reasoning as cycleStartDayChangedAt being a stamp. It is
            still dismissible for the rest of that cycle. */}
        {showPaydayBanner && (
          <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: T.brass + "12", border: `1px solid ${T.brass}30` }}>
            <div className="flex-1">
              <p className="text-sm font-medium" style={{ color: T.text }}>Your budget {periodNoun(startDay)} now runs {periodLabel}</p>
              <p className="text-xs mt-1" style={{ color: T.mute }}>
                Every figure here is measured over that range instead of the calendar month, history included, so some numbers will have moved. Net worth is the exception &mdash; it stays dated by the calendar. You can change payday back in Setup.
              </p>
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              className="text-xs px-2 py-1 rounded-lg"
              style={{ color: T.mute }}
              onClick={() => setPaydayBannerDismissed(true)}
            >
              &times;
            </button>
          </div>
        )}

        {/* Needs attention — the 2-3 most urgent things, aggregated from
            signals that already exist elsewhere on this dashboard (budget
            pace, safety net, debt plan, upcoming renewals, balance checks)
            so noticing them doesn't require checking every card yourself. */}
        {alerts.length > 0 && (
          <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
            <h2 className="text-xs uppercase tracking-widest mb-3" style={{ color: T.mute }}>Needs attention</h2>
            <div className="space-y-2">
              {alerts.slice(0, 3).map((a) => {
                const color = a.severity === "critical" ? T.coral : T.brass;
                const body = (
                  <div
                    className="flex items-center gap-2.5 rounded-xl px-3.5 py-2.5"
                    style={{ background: color + "12", border: `1px solid ${color}30` }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
                    <span className="text-sm flex-1" style={{ color: T.text }}>{a.message}</span>
                    {onNavigate && <span className="text-xs flex-shrink-0" style={{ color }}>→</span>}
                  </div>
                );
                return onNavigate ? (
                  <button key={a.id} onClick={() => onNavigate(a.screen as Screen)} className="w-full text-left transition-opacity hover:opacity-80">
                    {body}
                  </button>
                ) : (
                  <div key={a.id}>{body}</div>
                );
              })}
            </div>
          </div>
        )}

        {/* Month at a glance */}
        {month.income > 0 && (
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Income",  value: money(month.income),        sub: `this ${noun}`,                       color: T.text  },
              { label: "Spent",   value: money(month.totalSpend),    sub: `${Math.round(month.totalSpend / month.income * 100)}% of income`, color: month.totalSpend > month.income ? T.coral : T.mute },
              { label: "Saved",   value: money(month.savingsContrib), sub: `${month.savingsRatePct.toFixed(1)}% rate`,                       color: T.jade  },
            ].map(({ label, value, sub, color }) => (
              <div key={label} className="rounded-2xl px-4 py-4" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
                <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: T.mute }}>{label}</p>
                <p className="text-xl font-medium tabular-nums" style={{ ...SERIF, color }}>{value}</p>
                <p className="text-[10px] mt-1" style={{ color: T.mute }}>{sub}</p>
              </div>
            ))}
          </div>
        )}

        {/* Past-month review (2.4.55 sub-phase 3) -- a closed month's own
            Income/Spent/Saved, reusing periodTotals (shared with
            Statistics' own this-month-vs-last-month comparison). Not a
            historical version of the cards above: health score, alerts,
            upcoming renewals, and Balance Check all describe a NOW state,
            not a specific month, so they stay exactly as they are and
            aren't reachable from here. */}
        {pastMonths.length > 0 && (
          <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <label htmlFor="past-month-select" className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>
                Review a past {noun}
              </label>
              <select
                id="past-month-select"
                value={selectedPastMonth}
                // A <select> yields a plain string; the option values are cycle keys
                // built from the transaction list, so this is a boundary cast.
                onChange={(e) => setSelectedPastMonth(e.target.value === "" ? "" : asCycleKey(e.target.value))}
                onFocus={() => setPastPickerFocused(true)}
                onBlur={() => setPastPickerFocused(false)}
                className="rounded-xl px-3 py-2 text-sm"
                // The outline is replaced by the same ring as MoneyInput's, not removed outright.
                style={{ background: T.panelSoft, border: `1px solid ${pastPickerFocused ? T.jade : T.line}`, boxShadow: pastPickerFocused ? `0 0 0 3px ${T.jade}28` : "none", color: T.text, outline: "none", colorScheme: "dark" }}
              >
                <option value="">Select a {noun}…</option>
                {pastMonths.map((ym) => (
                  <option key={ym} value={ym}>{cycleLabel(ym, startDay)}</option>
                ))}
              </select>
            </div>
            {pastMonthReview && (
              <div className="grid grid-cols-3 gap-3 mt-4">
                {[
                  { label: "Income", value: money(pastMonthReview.income), color: T.text },
                  { label: "Spent",  value: money(pastMonthReview.needs + pastMonthReview.wants), color: T.mute },
                  { label: "Saved",  value: money(pastMonthReview.savings), color: T.jade },
                ].map(({ label, value, color }) => (
                  <div key={label} className="rounded-2xl px-4 py-4" style={{ background: T.panelSoft, border: `1px solid ${T.line}` }}>
                    <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: T.mute }}>{label}</p>
                    <p className="text-xl font-medium tabular-nums" style={{ ...SERIF, color }}>{value}</p>
                  </div>
                ))}
                <p className="col-span-3 text-[10px]" style={{ color: T.mute }}>
                  Net: {money(pastMonthReview.income - pastMonthReview.needs - pastMonthReview.wants - pastMonthReview.savings)} · {cycleLabel(asCycleKey(selectedPastMonth), startDay)}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Encouragements */}
        <div className="rounded-2xl px-5 py-4 space-y-1.5" style={{ background: T.panelSoft, borderLeft: `3px solid ${T.brass}` }}>
          {encouragements.map((e, i) => (
            <p key={i} className="text-sm" style={{ color: i === 0 ? T.text : T.mute }}>{e}</p>
          ))}
          {streaks.map((s) => (
            <p key={s.key} className="text-sm" style={{ color: T.jade }}>{s.message}</p>
          ))}
        </div>

        {/* Upcoming renewals */}
        {upcomingRenewals.length > 0 && (
          <div className="rounded-2xl px-5 py-4 flex flex-wrap gap-3" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
            <p className="text-xs uppercase tracking-widest flex-shrink-0 self-center" style={{ color: T.mute }}>Renewing soon</p>
            {upcomingRenewals.map((r) => {
              const overdue = r.overdueCount > 0;
              return (
                <span
                  key={r.id}
                  className="text-xs pl-3 pr-1.5 py-1.5 rounded-full flex items-center gap-1.5"
                  style={overdue
                    ? { background: T.coral + "18", border: `1px solid ${T.coral}`, color: T.text }
                    : { background: T.panelSoft, border: `1px solid ${T.line}`, color: T.text }}
                >
                  <span>{r.emoji}</span>
                  <span>{r.name}</span>
                  <span style={{ color: T.mute }}>· {fmtCur(r.amount, r.currency)}</span>
                  <span style={{ color: overdue || r.dueInDays <= 2 ? T.coral : T.brass, fontWeight: overdue ? 600 : undefined }}>
                    · {overdue ? `${r.overdueCount} overdue` : r.dueInDays === 0 ? "today" : r.dueInDays === 1 ? "tomorrow" : `in ${r.dueInDays}d`}
                  </span>
                  {onConfirmRecurring && (
                    <button
                      onClick={() => onConfirmRecurring(r.id)}
                      disabled={loggingRecurringIds?.has(r.id)}
                      className="text-[10px] font-semibold px-2 py-1 rounded-full transition-all hover:opacity-80 disabled:opacity-40 disabled:hover:opacity-40"
                      style={{ background: T.jade + "22", color: T.jade }}
                      title={`Confirm this ${r.name} payment`}
                    >
                      {loggingRecurringIds?.has(r.id) ? "Confirming…" : justConfirmedIds?.has(r.id) ? "Confirmed ✓" : "Confirm"}
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        )}

        {/* Balance Check's reconciliation moved to its own page
            (BalanceCheckScreen) on 2026-09-13. It rendered here AND in
            InputPanel's Manage tab; a third copy was the trigger for
            consolidating rather than duplicating -- two surfaces rendering
            the same Mismatch/Matches verdict is how the cross-surface
            disagreements logged repeatedly in this project begin.

            Overview deliberately keeps two things and no more: the existing
            balance-check ALERT (computeDashboard.ts, >= $5 threshold, now
            routed to the new page), and the plain "expected" readout in the
            cash-flow panel below -- a figure, not a judgement, so there is
            no verdict here to disagree with the page. */}

        {/* Row 1: health · 50/30/20 · trend */}
        <div className="grid gap-6 md:grid-cols-3">
          <Panel title="Financial health">
            <HealthRing score={health.score} grade={health.grade} />
            <div className="mt-4 space-y-3">
              {health.components.map((c) => {
                const col = c.score >= 70 ? T.jade : c.score >= 40 ? T.brass : T.coral;
                return (
                  <div key={c.key}>
                    <div className="flex justify-between items-baseline mb-1.5">
                      <span className="text-xs" style={{ color: T.mute }}>{c.label}</span>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-sm font-semibold tabular-nums" style={{ color: col }}>{c.score}</span>
                        <span className="text-[9px]" style={{ color: T.mute }}>/ 100</span>
                      </div>
                    </div>
                    <Bar pct={c.score} color={col} />
                    <p className="text-[10px] mt-1" style={{ color: T.mute }}>{c.detail}</p>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title={`Budget · ${budgetLabel}`}>
            <div className="space-y-5">
              {/* 2.4.70: income * pct for this month, no rollover applied, so
                  each dollar figure reconciles against the percentage in its own
                  label and the three sum to income. Rollover is not removed --
                  budgetPace and its alerts still judge spend against the
                  rollover-adjusted target. */}
              <BucketRow noun={noun} label={`Needs · ${budgetPct.needs}%`}   actual={month.needsSpend}    target={data.budgetTargets.needs}   color={T.sky}   bucket="NEEDS" />
              <BucketRow noun={noun} label={`Wants · ${budgetPct.wants}%`}   actual={month.wantsSpend}    target={data.budgetTargets.wants}   color={T.brass} bucket="WANTS" />
              <BucketRow noun={noun} label={`Savings · ${budgetPct.savings}%`} actual={month.savingsContrib} target={data.budgetTargets.savings} color={T.jade}  bucket="SAVINGS" />
            </div>

            {/* Pace warnings — Copilot-style "on track to exceed" heads-up */}
            {budgetPace.filter((p) => p.status !== "ok").length > 0 && (
              <div className="mt-4 space-y-2">
                {budgetPace.filter((p) => p.status !== "ok").map((p) => (
                  <div
                    key={p.bucket}
                    className="rounded-xl px-3 py-2 text-xs"
                    style={{
                      background: p.status === "over" ? T.coral + "18" : T.brass + "18",
                      border: `1px solid ${p.status === "over" ? T.coral : T.brass}40`,
                      color: T.text,
                    }}
                  >
                    {p.message}
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs mt-5 pt-4" style={{ color: T.mute, borderTop: `1px solid ${T.line}` }}>
              Savings rate this {noun}: <span style={{ ...NUMS, color: T.jade }}>{month.savingsRatePct.toFixed(1)}%</span> of income
            </p>
          </Panel>

          <Panel title={`Cash flow · last 6 ${noun}s`}>
            <div className="h-56">
              <ResponsiveContainer>
                <AreaChart data={sixMonthTrend} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="inc" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={T.jade} stopOpacity={0.45} />
                      <stop offset="100%" stopColor={T.jade} stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={T.line} strokeDasharray="2 6" vertical={false} />
                  <XAxis dataKey="ymKey" tickFormatter={(v) => ymTick(Number(v), startDay)} tick={{ fill: T.mute, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: T.mute, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: T.panelSoft, border: `1px solid ${T.line}`, borderRadius: 12, color: T.text }}
                    labelFormatter={(v) => ymFull(Number(v), startDay)}
                    formatter={(v: number, name: string) => [money(v), name === "income" ? "Income" : "Spend"]}
                  />
                  <Area type="monotone" dataKey="income" stroke={T.jade} strokeWidth={2} fill="url(#inc)" />
                  <Area type="monotone" dataKey="spend" stroke={T.coral} strokeWidth={2} fill="transparent" strokeDasharray="5 4" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs mt-2" style={{ color: T.mute }}>
              The gap between the lines is your progress so far. {periodLabel} is still in progress, so its spend line will keep rising (and the gap will keep shrinking) as the rest of it gets logged.
            </p>
            <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${T.line}` }}>
              <div className="flex items-baseline justify-between">
                <span className="text-xs" style={{ color: T.mute }}>Left this {noun} · income minus spending so far</span>
                <span className="text-lg" style={{ ...SERIF, ...NUMS, color: month.netCashFlow >= 0 ? T.jade : T.coral }}>
                  {money(month.netCashFlow)}
                </span>
              </div>
              {balanceChecks.length > 0 && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
                  {balanceChecks.map((b) => (
                    <span key={b.id} className="text-xs" style={{ color: T.mute }}>
                      {b.name} (expected): <span style={{ ...NUMS, color: T.text }}>{money(b.expected)}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </Panel>
        </div>

        {/* Row 2: debt countdown · emergency fund */}
        <div className="grid gap-6 md:grid-cols-2">
          <Panel title={`Debt freedom · ${user.payoffStrategy.toLowerCase()} strategy`}>
            {debt.plan?.feasible && debt.plan.debtFreeDateDisplay ? (
              <>
                <p className="text-sm" style={{ color: T.mute }}>At {money(debt.plan.monthlyCommitment)}/month, your last payment lands</p>
                <p className="text-4xl md:text-5xl my-2" style={{ ...SERIF, ...NUMS, color: T.brass }}>
                  {debt.plan.debtFreeDateDisplay}
                </p>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm mt-3" style={{ color: T.mute }}>
                  <span><span style={{ ...NUMS, color: T.text }}>{money(debt.totalBalance)}</span> remaining across {debt.count} debts</span>
                  <span><span style={{ ...NUMS, color: T.text }}>{debt.plan.months}</span> months to go</span>
                  <span>lifetime interest <span style={{ ...NUMS, color: T.text }}>{money(debt.plan.totalInterest)}</span></span>
                </div>
              </>
            ) : moneyEquals(debt.totalBalance, 0) ? (
              // totalBalance, not count — paid-off debts are kept in the
              // array for history (see computeDashboard.ts), so count alone
              // stays nonzero even once every debt is actually cleared.
              <p className="text-2xl" style={SERIF}>No debts. Every dollar you earn already belongs to you. 🏁</p>
            ) : (
              <p className="text-sm" style={{ color: T.coral }}>{debt.plan?.warning ?? "Add balances and rates to project your debt-free date."}</p>
            )}
          </Panel>

          <Panel title={`Safety net · ${ef.targetMonths} months of essentials`}>
            <div className="flex items-baseline justify-between">
              <p className="text-4xl" style={{ ...SERIF, ...NUMS }}>
                {ef.coverageMonths.toFixed(1)}<span className="text-lg" style={{ color: T.mute }}> / {ef.targetMonths} months</span>
              </p>
              <span className="text-sm" style={{ ...NUMS, color: T.jade }}>{ef.pctFunded.toFixed(0)}%</span>
            </div>
            <div className="mt-3"><Bar pct={ef.pctFunded} color={T.jade} /></div>
            <p className="text-xs mt-3" style={{ color: T.mute }}>
              {money(ef.balance)} banked ·{" "}
              {ef.targetAmount <= 0
                ? (month.income <= 0
                    ? "set your income to calculate a real target"
                    // Needs% itself can no longer collapse this to $0 (custom
                    // splits are floored at MIN_SPLIT_PCT in localData.ts), so
                    // with real income the only other way targetAmount hits 0
                    // is an unset months-of-coverage target.
                    : "set a target number of months in Setup to calculate a real target")
                : ef.remaining > 0 ? `${money(ef.remaining)} to a fully funded net` : "fully funded, exhale"}
            </p>
          </Panel>
        </div>

        {/* Row 3: Net worth */}
        {(() => {
          const nwColor = netWorth.tierColor === "jade" ? T.jade : netWorth.tierColor === "brass" ? T.brass : netWorth.tierColor === "coral" ? T.coral : T.mute;
          return (
            <Panel title="Net worth">
              <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
                <div>
                  <p className="text-5xl font-medium" style={{ ...SERIF, ...NUMS, color: netWorth.total >= 0 ? T.jade : T.coral }}>
                    {netWorth.total >= 0 ? "+" : ""}{money(netWorth.total)}
                  </p>
                  <span
                    className="inline-block mt-2 text-xs px-2.5 py-1 rounded-full font-medium"
                    style={{ background: nwColor + "18", color: nwColor, border: `1px solid ${nwColor}40` }}
                  >
                    {netWorth.tier}
                  </span>
                </div>
                <div className="flex gap-6 text-right">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: T.mute }}>Assets</p>
                    <p className="text-xl font-medium tabular-nums" style={{ ...SERIF, color: T.jade }}>{money(netWorth.assets)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: T.mute }}>Liabilities</p>
                    <p className="text-xl font-medium tabular-nums" style={{ ...SERIF, color: netWorth.liabilities > 0 ? T.coral : T.mute }}>{money(netWorth.liabilities)}</p>
                  </div>
                </div>
              </div>

              {netWorthTrend.length >= 2 && startDay > 1 && (
                <p className="text-[10px] mb-1" style={{ color: T.mute }}>
                  Calendar month-ends &mdash; net worth is a snapshot of a moment, so it is dated by the calendar, not by your {periodNoun(startDay)}.
                </p>
              )}
              {netWorthTrend.length >= 2 && (
                <div className="h-40 mb-2">
                  <ResponsiveContainer>
                    <LineChart data={netWorthTrend} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke={T.line} strokeDasharray="2 6" vertical={false} />
                      <XAxis dataKey="ym" tickFormatter={ymStrLabel} tick={{ fill: T.mute, fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: T.mute, fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ background: T.panelSoft, border: `1px solid ${T.line}`, borderRadius: 12, color: T.text }}
                        labelFormatter={(v) => ymStrLabel(asCalendarKey(String(v)))}
                        formatter={(v: number) => [money(v), "Net worth"]}
                      />
                      <Line type="monotone" dataKey="value" stroke={nwColor} strokeWidth={2} dot={{ r: 3, fill: nwColor }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="space-y-2 pt-4" style={{ borderTop: `1px solid ${T.line}` }}>
                <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: T.mute }}>To grow your net worth</p>
                {netWorth.suggestions.map((s, i) => (
                  <p key={i} className="text-sm flex gap-2" style={{ color: i === 0 ? T.text : T.mute }}>
                    <span style={{ color: nwColor, flexShrink: 0 }}>→</span>
                    {s}
                  </p>
                ))}
              </div>
            </Panel>
          );
        })()}

        {/* Row 4: goals */}
        <Panel title="Goals & milestones">
          <div className="grid gap-4 sm:grid-cols-2">
            {goals.map((g) => (
              <div key={g.id} className="rounded-xl p-4" style={{ background: T.panelSoft, border: `1px solid ${T.line}` }}>
                <div className="flex justify-between items-start gap-2">
                  <p className="font-medium">{g.emoji} {g.name}</p>
                  <span
                    className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap"
                    style={{ border: `1px solid ${g.projection.onTrack ? T.jade : T.brass}`, color: g.projection.onTrack ? T.jade : T.brass }}
                  >
                    {g.projection.onTrack ? "on pace" : "needs a push"}
                  </span>
                </div>
                <div className="mt-3"><Bar pct={g.projection.pctComplete} color={T.brass} /></div>
                <div className="flex justify-between text-xs mt-2" style={{ color: T.mute }}>
                  <span style={NUMS}>{fmtCur(g.currentAmount, g.currency)} of {fmtCur(g.targetAmount, g.currency)}</span>
                  <span style={NUMS}>{g.projection.pctComplete.toFixed(0)}%</span>
                </div>
                <p className="text-xs mt-2" style={{ color: T.text }}>
                  <span style={{ ...NUMS, color: T.brass }}>{fmtCur(g.projection.requiredMonthly, g.currency)}/mo</span> keeps this on schedule for {g.projection.targetDateDisplay}
                </p>
              </div>
            ))}
            {goals.length === 0 && (
              <p className="text-sm" style={{ color: T.mute }}>An empty canvas. Add your first milestone and the math starts working for you.</p>
            )}
          </div>
        </Panel>
      </div>
    </main>
  );
}
