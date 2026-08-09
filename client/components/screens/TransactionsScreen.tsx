"use client";

import { useState } from "react";
import type { LocalFinancials, StoredRecurring } from "../../lib/localData";
import { fmtDate, monthlyEquivalent, toUSD as toUSDShared } from "../../lib/localData";
import { useTheme } from "../../contexts/ThemeContext";
import { SERIF, NUMS, money } from "./shared";
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
    const usd = toUSD(monthlyEquivalent(r, asOf), r.currency);
    if (r.bucket === "NEEDS") out.needs += usd;
    else if (r.bucket === "WANTS") out.wants += usd;
    else out.savings += usd;
  }
  return out;
}

export default function TransactionsScreen({ financials }: { financials: LocalFinancials }) {
  const T = useTheme();
  const [filter, setFilter] = useState("all");
  const [query,  setQuery]  = useState("");

  const lbpRate = financials.lbpRate ?? 89500;
  const toUSD   = (n: number, cur?: string) => toUSDShared(n, cur as "USD" | "LBP" | undefined, lbpRate);

  const allTx  = [...financials.transactions].sort((a, b) => b.date.localeCompare(a.date));
  const months = Array.from(new Set(allTx.map((t) => t.date.slice(0, 7)))).sort().reverse();
  const recurring = financials.recurring ?? [];
  const currentYm = new Date().toISOString().slice(0, 7);

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
  const BC = { NEEDS: T.sky, WANTS: T.brass, SAVINGS: T.jade } as const;
  const BL = { NEEDS: "Needs", WANTS: "Wants", SAVINGS: "Savings" } as const;

  // Recurring items already fed the bucket-summary totals and category
  // trends above, but never appeared as rows here -- someone scanning the
  // month's list for "did my tuition payment show up" would never find it,
  // even though it was already counted in every total on this page. Shown
  // only for months that already have a real logged-transaction group
  // (matches this list's existing per-month structure); a month with only
  // recurring and nothing logged yet doesn't get a group here at all,
  // same as before this change.
  function recurringRowsForMonth(mo: string) {
    const asOf = mo === currentYm ? new Date() : new Date(`${mo}-01T00:00:00`);
    return recurring
      .map((r) => ({ r, usd: toUSD(monthlyEquivalent(r, asOf), r.currency) }))
      .filter(({ usd }) => usd > 0)
      .filter(({ r }) => !q || r.name.toLowerCase().includes(q) || r.bucket.toLowerCase().includes(q));
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

  // Category trends: % of spend in each bucket per period, across ALL
  // history (not the search/month filter above, which is about finding one
  // transaction, not seeing the long-run pattern).
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>("monthly");
  const trendCap = trendPeriod === "yearly" ? 5 : 6;
  const trendData = (() => {
    const byPeriod: Record<string, BucketTotals> = {};
    for (const t of allTx) {
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
    for (const k of periodKeys) {
      const b = byPeriod[k] ?? (byPeriod[k] = { needs: 0, wants: 0, savings: 0 });
      for (const ym of monthsInPeriod(k, trendPeriod)) {
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
          <div className="flex gap-2">
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
          </div>
        </div>

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
        {bucketTotal > 0 && (
          <div className="rounded-2xl p-5 flex items-center gap-6 flex-wrap" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
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
          </div>
        )}

        {/* Category trends */}
        {allTx.length > 0 && (
          <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
            <div className="flex items-center justify-between gap-3 mb-4">
              <p className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>Category trends</p>
              <div className="flex gap-1.5">
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
          const moTotal = txs.reduce((s, t) => s + toUSD(t.amount, t.currency), 0) + recurRows.reduce((s, rr) => s + rr.usd, 0);
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
                    className="flex items-center gap-3 px-4 py-3"
                    style={{ background: T.panel, borderTop: i > 0 ? `1px solid ${T.line}` : undefined }}
                  >
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: BC[t.bucket] }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate" style={{ color: T.text }}>{t.description}</p>
                      <p className="text-[10px]" style={{ color: T.mute }}>
                        {fmtDate(t.date)} · {BL[t.bucket]}
                        {t.cardLabel
                          ? ` · ${t.cardLabel}`
                          : t.paymentMethod === "cash"
                          ? " · Cash"
                          : t.paymentMethod === "other"
                          ? t.paymentNote ? ` · 🤝 ${t.paymentNote}` : " · Other"
                          : ""}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-medium tabular-nums" style={{ color: BC[t.bucket] }}>{money(toUSD(t.amount, t.currency), 2)}</p>
                      {t.currency === "LBP" && (
                        <p className="text-[10px]" style={{ color: T.mute }}>LBP {t.amount.toLocaleString()}</p>
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
                        Recurring · {BL[r.bucket]} · {FREQ_LABEL[r.frequency]}
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
      </div>
    </main>
  );
}
