"use client";

import { useState } from "react";
import type { LocalFinancials } from "../../lib/localData";
import { fmtDate, toUSD as toUSDShared } from "../../lib/localData";
import { useTheme } from "../../contexts/ThemeContext";
import { SERIF, NUMS, money } from "./shared";

type TrendPeriod = "monthly" | "quarterly" | "yearly";

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

export default function TransactionsScreen({ financials }: { financials: LocalFinancials }) {
  const T = useTheme();
  const [filter, setFilter] = useState("all");
  const [query,  setQuery]  = useState("");

  const lbpRate = financials.lbpRate ?? 89500;
  const toUSD   = (n: number, cur?: string) => toUSDShared(n, cur as "USD" | "LBP" | undefined, lbpRate);

  const allTx  = [...financials.transactions].sort((a, b) => b.date.localeCompare(a.date));
  const months = Array.from(new Set(allTx.map((t) => t.date.slice(0, 7)))).sort().reverse();

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

  // Category trends: % of spend in each bucket per period, across ALL
  // history (not the search/month filter above, which is about finding one
  // transaction, not seeing the long-run pattern).
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>("monthly");
  const trendCap = trendPeriod === "yearly" ? 5 : 6;
  const trendData = (() => {
    const byPeriod: Record<string, { needs: number; wants: number; savings: number }> = {};
    for (const t of allTx) {
      const k = periodKey(t.date, trendPeriod);
      const b = byPeriod[k] ?? (byPeriod[k] = { needs: 0, wants: 0, savings: 0 });
      const usd = toUSD(t.amount, t.currency);
      if (t.bucket === "NEEDS") b.needs += usd;
      else if (t.bucket === "WANTS") b.wants += usd;
      else b.savings += usd;
    }
    return Object.keys(byPeriod).sort().reverse().slice(0, trendCap).reverse().map((k) => {
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
          {(["NEEDS","WANTS","SAVINGS"] as const).map((b) => {
            const sum = filtered.filter((t) => t.bucket === b).reduce((s, t) => s + toUSD(t.amount, t.currency), 0);
            return (
              <div key={b} className="rounded-2xl px-4 py-4" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
                <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: T.mute }}>{BL[b]}</p>
                <p className="text-xl font-medium tabular-nums" style={{ ...SERIF, color: BC[b] }}>{money(sum)}</p>
              </div>
            );
          })}
        </div>

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
          const moTotal = txs.reduce((s, t) => s + toUSD(t.amount, t.currency), 0);
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
