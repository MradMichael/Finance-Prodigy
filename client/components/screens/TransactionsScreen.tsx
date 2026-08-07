"use client";

import { useState } from "react";
import type { LocalFinancials } from "../../lib/localData";
import { fmtDate, toUSD as toUSDShared } from "../../lib/localData";
import { useTheme } from "../../contexts/ThemeContext";
import { SERIF, money } from "./shared";

export default function TransactionsScreen({ financials }: { financials: LocalFinancials }) {
  const T = useTheme();
  const [filter, setFilter] = useState("all");

  const lbpRate = financials.lbpRate ?? 89500;
  const toUSD   = (n: number, cur?: string) => toUSDShared(n, cur as "USD" | "LBP" | undefined, lbpRate);

  const allTx  = [...financials.transactions].sort((a, b) => b.date.localeCompare(a.date));
  const months = Array.from(new Set(allTx.map((t) => t.date.slice(0, 7)))).sort().reverse();
  const filtered = filter === "all" ? allTx : allTx.filter((t) => t.date.startsWith(filter));

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

  return (
    <main className="min-h-screen px-4 py-8 md:px-10" style={{ background: T.ink }}>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>ESSA</p>
            <h1 className="text-3xl mt-1" style={SERIF}>Transactions</h1>
          </div>
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
                      <p className="text-sm font-medium tabular-nums" style={{ color: BC[t.bucket] }}>{money(toUSD(t.amount, t.currency))}</p>
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
            <p className="text-sm" style={{ color: T.mute }}>No transactions yet — add them in My Finances.</p>
          </div>
        )}
      </div>
    </main>
  );
}
