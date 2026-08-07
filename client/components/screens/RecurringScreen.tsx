"use client";

import type { LocalFinancials } from "../../lib/localData";
import { monthlyEquivalent, FREQ_LABELS, toUSD as toUSDShared } from "../../lib/localData";
import { useTheme } from "../../contexts/ThemeContext";
import { SERIF, money } from "./shared";

export default function RecurringScreen({ financials }: { financials: LocalFinancials }) {
  const T    = useTheme();
  const now  = new Date();
  const lbpRate = financials.lbpRate ?? 89500;
  const toUSD   = (n: number, cur?: string) => toUSDShared(n, cur as "USD" | "LBP" | undefined, lbpRate);
  const BC   = { NEEDS: T.sky, WANTS: T.brass, SAVINGS: T.jade } as const;
  const BL   = { NEEDS: "Needs", WANTS: "Wants", SAVINGS: "Savings" } as const;

  const totalMonthly = financials.recurring.reduce((s, r) => s + toUSD(monthlyEquivalent(r, now), r.currency), 0);

  const buckets = (["NEEDS","WANTS","SAVINGS"] as const).map((b) => ({
    bucket: b,
    items: financials.recurring.filter((r) => r.bucket === b),
    total: financials.recurring.filter((r) => r.bucket === b)
      .reduce((s, r) => s + toUSD(monthlyEquivalent(r, now), r.currency), 0),
  }));

  return (
    <main className="min-h-screen px-4 py-8 md:px-10" style={{ background: T.ink }}>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>ESSA</p>
          <h1 className="text-3xl mt-1" style={SERIF}>Recurring</h1>
        </div>

        {financials.recurring.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-sm" style={{ color: T.mute }}>No recurring items yet — add them in My Finances.</p>
          </div>
        ) : (
          <>
            {/* Total */}
            <div className="rounded-2xl px-5 py-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
              <p className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>Total committed monthly</p>
              <p className="text-4xl font-medium tabular-nums mt-1" style={{ ...SERIF, color: T.text }}>{money(totalMonthly)}</p>
            </div>

            {/* By bucket */}
            {buckets.map(({ bucket, items, total }) => items.length > 0 && (
              <div key={bucket}>
                <div className="flex justify-between items-baseline mb-2 px-1">
                  <p className="text-xs uppercase tracking-widest" style={{ color: BC[bucket] }}>{BL[bucket]}</p>
                  <p className="text-xs tabular-nums" style={{ color: T.mute }}>{money(total)}/mo</p>
                </div>
                <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${T.line}` }}>
                  {items.map((r, i) => {
                    const monthly = toUSD(monthlyEquivalent(r, now), r.currency);
                    return (
                      <div
                        key={r.id}
                        className="flex items-center gap-3 px-4 py-3"
                        style={{ background: T.panel, borderTop: i > 0 ? `1px solid ${T.line}` : undefined }}
                      >
                        <span className="text-xl">{r.emoji}</span>
                        <div className="flex-1">
                          <p className="text-sm" style={{ color: T.text }}>{r.name}</p>
                          <p className="text-[10px]" style={{ color: T.mute }}>
                            {r.currency === "LBP" ? `LBP ${r.amount.toLocaleString()}` : money(r.amount, 2)} · {FREQ_LABELS[r.frequency]}
                          </p>
                        </div>
                        <p className="text-sm font-medium tabular-nums" style={{ color: BC[bucket] }}>
                          {money(monthly)}/mo
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </main>
  );
}
