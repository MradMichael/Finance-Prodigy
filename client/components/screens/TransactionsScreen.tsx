"use client";

import { useState } from "react";
import type { LocalFinancials, StoredRecurring } from "../../lib/localData";
import { fmtDate, historizedRecurringContribution, toUSD as toUSDShared, categoryLabel as categoryLabelShared, categoryIcon as categoryIconShared, todayISO, activeTransactions, cycleMonthDivergence, DEFAULT_LBP_RATE } from "../../lib/localData";
import { useTheme } from "../../contexts/ThemeContext";
import { SERIF, NUMS, money, fmtCur } from "./shared";
import Donut from "../charts/Donut";

type TrendPeriod = "monthly" | "quarterly" | "yearly";
type BucketTotals = { needs: number; wants: number; savings: number };

const FREQ_LABEL = { weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", every2months: "Every 2 months", quarterly: "Quarterly", biannually: "Every 6 months", yearly: "Yearly" } as const;

/** YYYY-MM / YYYY-Q# / YYYY grouping key for a transaction date, depending on the selected trend period. */
function periodKey(dateStr: string, mode: TrendPeriod): string {
  const [y, m] = dateStr.slice(0, 7).split("-");
  if (mode === "yearly") return y;
  if (mode === "quarterly") return `${y}-Q${Math.ceil(parseInt(m, 10) / 3)}`;
  return `${y}-${m}`;
}

function periodLabel(key: string, mode: TrendPeriod): string {
  if (mode === "yearly") return key;
  if (mode === "quarterly") return key.replace("-", " ");
  const [y, m] = key.split("-");
  return `${["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+m]} ${y}`;
}

/** Every calendar month (YYYY-MM) a period key covers: one for "monthly", three for "quarterly", twelve for "yearly". Recurring bills don't create a transaction row each month, so a period's real total needs each covered month evaluated separately, not just the period's own key. */
function monthsInPeriod(key: string, mode: TrendPeriod): string[] {
  if (mode === "monthly") return [key];
  if (mode === "quarterly") {
    const [y, q] = key.split("-Q");
    const startMonth = (parseInt(q, 10) - 1) * 3 + 1;
    return [0, 1, 2].map((i) => `${y}-${String(startMonth + i).padStart(2, "0")}`);
  }
  return Array.from({ length: 12 }, (_, i) => `${key}-${String(i + 1).padStart(2, "0")}`);
}

/**
 * Recurring items' monthly-equivalent contribution for one calendar month,
 * by bucket. Mirrors computeDashboard's own convention: the current month
 * is evaluated as of today (so a mid-month start/end is reflected exactly
 * like the dashboard's own totals), any other month as of its first day
 * (all that matters for a past/future month is whether the item was
 * active then at all).
 */
function recurringForMonth(recurring: StoredRecurring[], ym: string, currentYm: string, toUSD: (n: number, cur?: string) => number): BucketTotals {
  const asOf = ym === currentYm ? new Date() : new Date(`${ym}-01T00:00:00`);
  const out: BucketTotals = { needs: 0, wants: 0, savings: 0 };
  for (const r of recurring) {
    const usd = toUSD(historizedRecurringContribution(r, ym, asOf), r.currency);
    if (r.bucket === "NEEDS") out.needs += usd;
    else if (r.bucket === "WANTS") out.wants += usd;
    else out.savings += usd;
  }
  return out;
}

export default function TransactionsScreen({ financials, onChange, onEdit }: { financials: LocalFinancials; onChange: (f: LocalFinancials) => void; onEdit: (id: string) => void }) {
  const T = useTheme();
  const [filter, setFilter] = useState("all");
  const [query,  setQuery]  = useState("");
  const [donutView, setDonutView] = useState<"type" | "category">("type");
  // Phase 2.6.3b: "Recently deleted" -- always-visible entry point (the pill
  // renders even at 0), so the recovery path is discoverable by anyone
  // looking at this screen, not just someone who already knows it exists.
  const [showDeleted, setShowDeleted] = useState(false);

  const lbpRate = financials.lbpRate ?? DEFAULT_LBP_RATE;
  const toUSD   = (n: number, cur?: string) => toUSDShared(n, cur as "USD" | "LBP" | undefined, lbpRate);

  // Every normal read on this screen (totals, search, trends, the month
  // list) is meant to see only active transactions -- a soft-deleted one
  // must vanish from here exactly the way the old hard-delete made it
  // vanish. The deleted-only view below reads financials.transactions
  // directly instead.
  const allTx  = activeTransactions(financials.transactions).sort((a, b) => b.date.localeCompare(a.date));
  const deletedTx = financials.transactions
    .filter((t) => t.deletedAt != null)
    .sort((a, b) => (b.deletedAt as string).localeCompare(a.deletedAt as string));

  function restoreTransaction(txId: string) {
    onChange({
      ...financials,
      transactions: financials.transactions.map((t) => t.id !== txId ? t : { ...t, deletedAt: undefined, updatedAt: new Date().toISOString() }),
    });
  }
  const recurring = financials.recurring ?? [];
  const currentYm = todayISO().slice(0, 7);
  // Months where at least one recurring item was active, independent of the
  // search query below -- feeds the month dropdown so a recurring-only
  // month (rent/tuition auto-debited, nothing else logged) can still be
  // selected. Bounded to the last 24 months back from now (matches the
  // history cap used elsewhere) so a years-old recurring start date can't
  // produce an unbounded list.
  const recurActiveMonths: string[] = [];
  {
    const cursor = new Date(`${currentYm}-01T00:00:00`);
    for (let i = 0; i < 24; i++) {
      const mo = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      const asOf = mo === currentYm ? new Date() : new Date(cursor);
      if (recurring.some((r) => toUSD(historizedRecurringContribution(r, mo, asOf), r.currency) > 0)) recurActiveMonths.push(mo);
      cursor.setMonth(cursor.getMonth() - 1);
    }
  }
  const months = Array.from(new Set([...allTx.map((t) => t.date.slice(0, 7)), ...recurActiveMonths])).sort().reverse();

  const q = query.trim().toLowerCase();
  const matchesQuery = (t: (typeof allTx)[number]) => {
    if (!q) return true;
    return (
      t.description.toLowerCase().includes(q)
      || String(t.amount).includes(q)
      || toUSD(t.amount, t.currency).toFixed(2).includes(q)
      || t.bucket.toLowerCase().includes(q)
      || (t.cardLabel ?? "").toLowerCase().includes(q)
      || (t.paymentNote ?? "").toLowerCase().includes(q)
    );
  };
  const filtered = (filter === "all" ? allTx : allTx.filter((t) => t.date.startsWith(filter))).filter(matchesQuery);
  // Recurring bills don't create a transaction row, so a specific month's
  // real totals need their monthly-equivalent added in (matches how the
  // Overview dashboard already blends the two). Deliberately skipped for
  // "all time" — summing a recurring item's contribution across its whole
  // active history is a different, fuzzier question than "what did this
  // month cost."
  const recurForFilter: BucketTotals = filter !== "all"
    ? recurringForMonth(recurring, filter, currentYm, toUSD)
    : { needs: 0, wants: 0, savings: 0 };

  const fmtMo = (ym: string) => {
    const [y, m] = ym.split("-");
    return `${["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m]} ${y}`;
  };
  const grouped = filtered.reduce<Record<string, typeof allTx>>((acc, t) => {
    const k = t.date.slice(0, 7);
    (acc[k] = acc[k] ?? []).push(t);
    return acc;
  }, {});
  const BC = { NEEDS: T.sky, WANTS: T.brass, SAVINGS: T.jade, INCOME: T.jade } as const;
  const BL = { NEEDS: "Needs", WANTS: "Wants", SAVINGS: "Savings", INCOME: "Income" } as const;

  // Recurring items already fed the bucket-summary totals and category
  // trends above, but never appeared as rows here -- someone scanning the
  // month's list for "did my tuition payment show up" would never find it,
  // even though it was already counted in every total on this page.
  function recurringRowsForMonth(mo: string) {
    const asOf = mo === currentYm ? new Date() : new Date(`${mo}-01T00:00:00`);
    return recurring
      .map((r) => ({ r, usd: toUSD(historizedRecurringContribution(r, mo, asOf), r.currency) }))
      .filter(({ usd }) => usd > 0)
      .filter(({ r }) => !q || r.name.toLowerCase().includes(q) || r.bucket.toLowerCase().includes(q));
  }

  // A month with only recurring bills (rent, tuition, ...) and nothing
  // manually logged never got a key in `grouped` above, so it silently
  // never appeared in this list at all, even though the total at the top of
  // this page already counted it. Seed an empty group for any such month
  // (that still matches the current search) so its recurring rows below
  // actually render.
  const recurOnlyCandidates = filter !== "all" ? [filter] : recurActiveMonths;
  for (const mo of recurOnlyCandidates) {
    if (!grouped[mo] && recurringRowsForMonth(mo).length > 0) grouped[mo] = [];
  }

  // Same totals the bucket-summary cards use (logged transactions in the
  // current filter + that filter's recurring contribution), reshaped for
  // the donut below so the chart and the cards never disagree.
  const bucketBreakdown = (["NEEDS", "WANTS", "SAVINGS"] as const).map((b) => {
    const txSum = filtered.filter((t) => t.bucket === b).reduce((s, t) => s + toUSD(t.amount, t.currency), 0);
    const recurSum = b === "NEEDS" ? recurForFilter.needs : b === "WANTS" ? recurForFilter.wants : recurForFilter.savings;
    return { bucket: b, value: txSum + recurSum };
  });
  const bucketTotal = bucketBreakdown.reduce((s, b) => s + b.value, 0);

  // Finer-grained than bucket -- same "spend only" scope as bucketBreakdown
  // above (INCOME excluded, recurring blended in only for a specific month,
  // never for "all time"), just grouped by the optional category tag
  // instead. A handful of theme-derived swatches cycle if there are more
  // distinct categories in use than colors, same tradeoff the app already
  // makes elsewhere rather than introducing off-brand hues.
  const categoryBreakdown = (() => {
    const totals = new Map<string, number>();
    const bump = (key: string, amt: number) => totals.set(key, (totals.get(key) ?? 0) + amt);
    for (const t of filtered) {
      if (t.bucket === "INCOME") continue;
      bump(t.category ?? "uncategorized", toUSD(t.amount, t.currency));
    }
    if (filter !== "all") {
      const asOf = filter === currentYm ? new Date() : new Date(`${filter}-01T00:00:00`);
      for (const r of recurring) {
        const amt = toUSD(historizedRecurringContribution(r, filter, asOf), r.currency);
        if (amt > 0) bump(r.category ?? "uncategorized", amt);
      }
    }
    return Array.from(totals.entries())
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => b.value - a.value);
  })();
  const categoryTotal = categoryBreakdown.reduce((s, c) => s + c.value, 0);
  const categoryLabel = (key: string) => categoryLabelShared(key, financials.customCategories);
  const categoryIcon  = (key: string) => categoryIconShared(key, financials.customCategories);
  const categoryColors = [T.jade, T.brass, T.sky, T.coral, T.jade + "80", T.brass + "80", T.sky + "80", T.coral + "80", T.mute];

  // Category trends: % of spend in each bucket per period, across ALL
  // history (not the search/month filter above, which is about finding one
  // transaction, not seeing the long-run pattern).
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>("monthly");
  const trendCap = trendPeriod === "yearly" ? 5 : 6;
  const trendData = (() => {
    const byPeriod: Record<string, BucketTotals> = {};
    for (const t of allTx) {
      // Trends are specifically the Needs/Wants/Savings spend mix -- INCOME
      // transactions aren't spend, and the old catch-all would have
      // miscounted them as extra savings.
      if (t.bucket === "INCOME") continue;
      const k = periodKey(t.date, trendPeriod);
      const b = byPeriod[k] ?? (byPeriod[k] = { needs: 0, wants: 0, savings: 0 });
      const usd = toUSD(t.amount, t.currency);
      if (t.bucket === "NEEDS") b.needs += usd;
      else if (t.bucket === "WANTS") b.wants += usd;
      else b.savings += usd;
    }
    // Always include the current period even with zero logged transactions
    // so far, otherwise a period with only recurring bills and nothing
    // manually logged yet would silently vanish from the trend entirely.
    const currentKey = periodKey(new Date().toISOString().slice(0, 10), trendPeriod);
    const periodKeys = Array.from(new Set([...Object.keys(byPeriod), currentKey])).sort().reverse().slice(0, trendCap).reverse();
    // allTx is sorted newest-first, so the last entry is the earliest
    // logged transaction. Recurring still accrues for every month it's
    // been active (matching budgetRollover/sixMonthTrend elsewhere), but
    // only from that earliest real month onward -- otherwise a recurring
    // item with an old startDate retroactively balloons a period like
    // Yearly with months of accrual the account never actually experienced,
    // producing a Needs/Wants/Savings mix that disagrees sharply with
    // Monthly for no reason a user logged.
    const earliestTxYm = allTx.length > 0 ? allTx[allTx.length - 1].date.slice(0, 7) : null;
    for (const k of periodKeys) {
      const b = byPeriod[k] ?? (byPeriod[k] = { needs: 0, wants: 0, savings: 0 });
      for (const ym of monthsInPeriod(k, trendPeriod)) {
        if (earliestTxYm && ym < earliestTxYm) continue;
        const r = recurringForMonth(recurring, ym, currentYm, toUSD);
        b.needs += r.needs; b.wants += r.wants; b.savings += r.savings;
      }
    }
    return periodKeys.map((k) => {
      const { needs, wants, savings } = byPeriod[k];
      const total = needs + wants + savings;
      return {
        key: k, label: periodLabel(k, trendPeriod), total,
        needsPct: total > 0 ? Math.round((needs / total) * 100) : 0,
        wantsPct: total > 0 ? Math.round((wants / total) * 100) : 0,
        savingsPct: total > 0 ? Math.round((savings / total) * 100) : 0,
      };
    });
  })();

  return (
    <main className="min-h-screen px-4 py-8 md:px-10" style={{ background: T.ink }}>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>ESSA</p>
            <h1 className="text-3xl mt-1" style={SERIF}>Transactions</h1>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, amount, category…"
              className="px-3 py-2 rounded-xl text-sm w-48 sm:w-64"
              style={{ background: T.panel, border: `1px solid ${T.line}`, color: T.text, outline: "none" }}
            />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="px-3 py-2 rounded-xl text-sm"
              style={{ background: T.panel, border: `1px solid ${T.line}`, color: T.text, outline: "none" }}
            >
              <option value="all">All time</option>
              {months.map((m) => <option key={m} value={m}>{fmtMo(m)}</option>)}
            </select>
            {/* Always visible, even with nothing deleted -- the point is to
                prove the recovery path exists, not just to surface it once
                there's something to recover. */}
            <button
              onClick={() => setShowDeleted((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all"
              style={{
                background: showDeleted ? T.brass + "22" : T.panel,
                border: `1px solid ${showDeleted ? T.brass : T.line}`,
                color: showDeleted ? T.brass : T.mute,
              }}
            >
              🗑 Recently deleted
              {deletedTx.length > 0 && (
                <span
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{ background: T.brass + "30", color: T.brass }}
                >
                  {deletedTx.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {showDeleted ? (
          <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${T.line}` }}>
            {deletedTx.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-sm" style={{ color: T.mute }}>Nothing deleted.</p>
              </div>
            ) : (
              deletedTx.map((t, i) => (
                <div
                  key={t.id}
                  className="flex items-center gap-3 px-4 py-3"
                  style={{ background: T.panel, borderTop: i > 0 ? `1px solid ${T.line}` : undefined, opacity: 0.75 }}
                >
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: BC[t.bucket] }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" style={{ color: T.text }}>{t.description}</p>
                    <p className="text-[10px]" style={{ color: T.mute }}>
                      {fmtDate(t.date)} · {BL[t.bucket]} · deleted {fmtDate(t.deletedAt)}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-medium tabular-nums" style={{ color: BC[t.bucket] }}>{money(toUSD(t.amount, t.currency), 2)}</p>
                  </div>
                  <button
                    onClick={() => restoreTransaction(t.id)}
                    className="text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all hover:opacity-90 flex-shrink-0"
                    style={{ background: T.jade, color: T.ink }}
                  >
                    Restore
                  </button>
                </div>
              ))
            )}
          </div>
        ) : (
        <>
        {/* Bucket summary */}
        <div className="grid grid-cols-3 gap-3">
          {bucketBreakdown.map(({ bucket: b, value }) => {
            const recurSum = b === "NEEDS" ? recurForFilter.needs : b === "WANTS" ? recurForFilter.wants : recurForFilter.savings;
            return (
              <div key={b} className="rounded-2xl px-4 py-4" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
                <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: T.mute }}>{BL[b]}</p>
                <p className="text-xl font-medium tabular-nums" style={{ ...SERIF, color: BC[b] }}>{money(value)}</p>
                {recurSum > 0 && <p className="text-[10px] mt-0.5" style={{ color: T.mute }}>incl. {money(recurSum)} recurring</p>}
              </div>
            );
          })}
        </div>

        {/* Where it went — visual breakdown for the current filter */}
        {(bucketTotal > 0 || categoryTotal > 0) && (
          <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
            <div className="flex gap-1.5 mb-4">
              {(["type", "category"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setDonutView(v)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: donutView === v ? T.brass + "22" : T.panelSoft,
                    border: `1px solid ${donutView === v ? T.brass : T.line}`,
                    color: donutView === v ? T.brass : T.mute,
                  }}
                >
                  {v === "type" ? "By type" : "By category"}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-6 flex-wrap">
              {donutView === "type" ? (
                <>
                  <Donut
                    segments={bucketBreakdown.map((b) => ({ value: b.value, color: BC[b.bucket], label: BL[b.bucket] }))}
                    trackColor={T.line}
                    labelColor={T.text}
                    centerLabel={money(bucketTotal)}
                    centerSublabel={filter === "all" ? "all time" : fmtMo(filter)}
                  />
                  <div className="flex-1 min-w-[160px] space-y-2.5">
                    <p className="text-xs uppercase tracking-widest mb-1" style={{ color: T.mute }}>Where it went{filter !== "all" ? ` · ${fmtMo(filter)}` : ""}</p>
                    {bucketBreakdown.map(({ bucket: b, value }) => (
                      <div key={b} className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2" style={{ color: T.text }}>
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: BC[b] }} />
                          {BL[b]}
                        </span>
                        <span style={{ ...NUMS, color: T.mute }}>
                          {money(value)} <span style={{ color: T.text }}>· {bucketTotal > 0 ? Math.round((value / bucketTotal) * 100) : 0}%</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <Donut
                    segments={categoryBreakdown.map((c, i) => ({ value: c.value, color: categoryColors[i % categoryColors.length], label: categoryLabel(c.key) }))}
                    trackColor={T.line}
                    labelColor={T.text}
                    centerLabel={money(categoryTotal)}
                    centerSublabel={filter === "all" ? "all time" : fmtMo(filter)}
                  />
                  <div className="flex-1 min-w-[160px] space-y-2.5">
                    <p className="text-xs uppercase tracking-widest mb-1" style={{ color: T.mute }}>Where it went{filter !== "all" ? ` · ${fmtMo(filter)}` : ""}</p>
                    {categoryBreakdown.map((c, i) => (
                      <div key={c.key} className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2" style={{ color: T.text }}>
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: categoryColors[i % categoryColors.length] }} />
                          {categoryIcon(c.key)} {categoryLabel(c.key)}
                        </span>
                        <span style={{ ...NUMS, color: T.mute }}>
                          {money(c.value)} <span style={{ color: T.text }}>· {categoryTotal > 0 ? Math.round((c.value / categoryTotal) * 100) : 0}%</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Category trends */}
        {allTx.length > 0 && (
          <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
            <div className="flex items-center flex-wrap justify-between gap-3 mb-4">
              <p className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>Category trends</p>
              <div className="flex gap-1.5 flex-wrap">
                {(["monthly", "quarterly", "yearly"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setTrendPeriod(p)}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-medium capitalize transition-all"
                    style={{
                      background: trendPeriod === p ? T.brass + "22" : T.panelSoft,
                      border: `1px solid ${trendPeriod === p ? T.brass : T.line}`,
                      color: trendPeriod === p ? T.brass : T.mute,
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              {trendData.map((p) => (
                <div key={p.key}>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span style={{ color: T.text }}>{p.label}</span>
                    <span style={{ ...NUMS, color: T.mute }}>
                      <span style={{ color: T.sky }}>{p.needsPct}%</span> · <span style={{ color: T.brass }}>{p.wantsPct}%</span> · <span style={{ color: T.jade }}>{p.savingsPct}%</span>
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full overflow-hidden flex" style={{ background: T.line }}>
                    {p.needsPct > 0 && <div style={{ width: `${p.needsPct}%`, background: T.sky }} />}
                    {p.wantsPct > 0 && <div style={{ width: `${p.wantsPct}%`, background: T.brass }} />}
                    {p.savingsPct > 0 && <div style={{ width: `${p.savingsPct}%`, background: T.jade }} />}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-4 text-[11px] mt-4" style={{ color: T.mute }}>
              <span><span style={{ color: T.sky }}>■</span> Needs</span>
              <span><span style={{ color: T.brass }}>■</span> Wants</span>
              <span><span style={{ color: T.jade }}>■</span> Savings</span>
            </div>
          </div>
        )}

        {/* List by month */}
        {Object.keys(grouped).sort().reverse().map((mo) => {
          const txs = grouped[mo];
          const recurRows = recurringRowsForMonth(mo);
          // Spend total for the header -- INCOME rows are shown in the list
          // below but excluded here, same as everywhere else on this page
          // that means "spend" (bucket-summary cards, the donut, trends).
          const moTotal = txs.filter((t) => t.bucket !== "INCOME").reduce((s, t) => s + toUSD(t.amount, t.currency), 0) + recurRows.reduce((s, rr) => s + rr.usd, 0);
          return (
            <div key={mo}>
              <div className="flex justify-between items-baseline mb-2 px-1">
                <p className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>{fmtMo(mo)}</p>
                <p className="text-xs tabular-nums" style={{ color: T.mute }}>{money(moTotal)}</p>
              </div>
              <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${T.line}` }}>
                {txs.map((t, i) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-3 px-4 py-3 group"
                    style={{ background: T.panel, borderTop: i > 0 ? `1px solid ${T.line}` : undefined }}
                  >
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: BC[t.bucket] }} />
                    <div className="flex-1 min-w-0">
                      {(() => {
                        const divergence = cycleMonthDivergence(t, recurring);
                        return (
                          <>
                            <p className="text-sm truncate" style={{ color: T.text }}>
                              {t.description}
                              {divergence && <span title={divergence} style={{ color: T.brass }}> ⚠</span>}
                            </p>
                            {/* Was hover-only (title= alone) -- unreachable on touch. */}
                            {divergence && (
                              <p className="text-[10px]" style={{ color: T.brass }}>{divergence}</p>
                            )}
                          </>
                        );
                      })()}
                      <p className="text-[10px]" style={{ color: T.mute }}>
                        {fmtDate(t.date)} · {BL[t.bucket]}
                        {t.category && ` · ${categoryIcon(t.category)} ${categoryLabel(t.category)}`}
                        {t.cardLabel
                          ? ` · ${t.cardLabel}`
                          : t.paymentMethod === "cash"
                          ? " · Cash"
                          : t.paymentMethod === "other"
                          ? t.paymentNote ? ` · 🤝 ${t.paymentNote}` : " · Other"
                          : ""}
                      </p>
                    </div>
                    <button
                      onClick={() => onEdit(t.id)}
                      aria-label="Edit transaction"
                      className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded transition-all opacity-70 hover:!opacity-100"
                      style={{ color: T.brass, border: `1px solid ${T.brass}40` }}
                    >✎</button>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-medium tabular-nums" style={{ color: BC[t.bucket] }}>{money(toUSD(t.amount, t.currency), 2)}</p>
                      {t.currency === "LBP" && (
                        <p className="text-[10px]" style={{ color: T.mute }}>{fmtCur(t.amount, t.currency)}</p>
                      )}
                    </div>
                  </div>
                ))}
                {recurRows.map(({ r, usd }, i) => (
                  <div
                    key={`recur-${r.id}`}
                    className="flex items-center gap-3 px-4 py-3"
                    style={{ background: T.panelSoft, borderTop: (txs.length > 0 || i > 0) ? `1px solid ${T.line}` : undefined }}
                  >
                    <span className="text-xs flex-shrink-0" style={{ color: T.mute }}>↻</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate" style={{ color: T.text }}>{r.emoji ? `${r.emoji} ` : ""}{r.name}</p>
                      <p className="text-[10px]" style={{ color: T.mute }}>
                        Recurring · {BL[r.bucket]}{r.category && ` · ${categoryIcon(r.category)} ${categoryLabel(r.category)}`} · {FREQ_LABEL[r.frequency]}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-medium tabular-nums" style={{ color: BC[r.bucket] }}>{money(usd, 2)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-20">
            <p className="text-sm" style={{ color: T.mute }}>
              {allTx.length === 0 ? "No transactions yet. Add them in My Finances." : "No transactions match your search."}
            </p>
          </div>
        )}
        </>
        )}
      </div>
    </main>
  );
}
