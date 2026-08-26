"use client";

import { useState } from "react";
import type { LocalFinancials } from "../../lib/localData";
import { historizedRecurringContribution, toUSD as toUSDShared, todayISO, moneyEquals, activeTransactions, DEFAULT_LBP_RATE } from "../../lib/localData";
import { computeHoldingsByCurrency } from "../../lib/computeDashboard";
import { useTheme } from "../../contexts/ThemeContext";
import { SERIF, money } from "./shared";
import Donut from "../charts/Donut";

export default function CurrencyScreen({ financials }: { financials: LocalFinancials }) {
  const T = useTheme();
  const lbpRate = financials.lbpRate ?? DEFAULT_LBP_RATE;
  const toUSD = (n: number, cur?: string) => toUSDShared(n, cur as "USD" | "LBP" | undefined, lbpRate);
  const [stressRate, setStressRate] = useState(lbpRate);

  // ── Spend by currency: this month's transactions + active recurring,
  // native currency (not converted) so this actually measures which
  // currency money is changing hands in, not just USD-equivalent totals. ──
  const currentYm = todayISO().slice(0, 7);
  const monthTx = activeTransactions(financials.transactions).filter((t) => t.date.startsWith(currentYm) && t.bucket !== "INCOME");
  const spendUSD = monthTx.filter((t) => (t.currency ?? "USD") === "USD").reduce((s, t) => s + t.amount, 0)
    + (financials.recurring ?? []).filter((r) => (r.currency ?? "USD") === "USD").reduce((s, r) => s + historizedRecurringContribution(r, currentYm, new Date()), 0);
  const spendLBP = monthTx.filter((t) => t.currency === "LBP").reduce((s, t) => s + t.amount, 0)
    + (financials.recurring ?? []).filter((r) => r.currency === "LBP").reduce((s, r) => s + historizedRecurringContribution(r, currentYm, new Date()), 0);
  const spendTotalUSD = toUSD(spendUSD, "USD") + toUSD(spendLBP, "LBP");

  // See computeHoldingsByCurrency's own doc comment for why debts are
  // deliberately excluded from this bucket while goals are included.
  const { usdAssets, lbpAssets, holdingsTotalUSD } = computeHoldingsByCurrency(financials, lbpRate);

  const lbpAtStress = stressRate > 0 ? lbpAssets / stressRate : 0;
  const lbpAtCurrent = toUSD(lbpAssets, "LBP");
  const stressLossUSD = lbpAtCurrent - lbpAtStress;

  const colors = { usd: T.jade, lbp: T.brass };
  // Every figure on this page is shown in its own native currency AND its
  // equivalent in the other one -- the whole point of a currency-exposure
  // page is comparing the two, not just converting everything to USD and
  // hiding which currency the money is actually held/spent in.
  const toLBP = (usd: number) => Math.round(usd * lbpRate);

  return (
    <main className="min-h-screen px-4 py-8 md:px-10" style={{ background: T.ink }}>
      <div className="max-w-3xl mx-auto space-y-6">

        <div>
          <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>ESSA</p>
          <h1 className="text-3xl mt-1" style={SERIF}>Currency</h1>
          <p className="text-sm mt-2" style={{ color: T.mute }}>How much of your money moves in Lebanese Pounds, and what a further devaluation would mean for it.</p>
        </div>

        {/* Spend by currency */}
        <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <p className="text-xs uppercase tracking-widest mb-4" style={{ color: T.mute }}>This month&apos;s spending, by currency</p>
          {moneyEquals(spendTotalUSD, 0) ? (
            <p className="text-sm" style={{ color: T.mute }}>No spending logged yet this month.</p>
          ) : (
            <div className="flex items-center gap-6 flex-wrap">
              <Donut
                segments={[
                  { value: toUSD(spendUSD, "USD"), color: colors.usd, label: "USD" },
                  { value: toUSD(spendLBP, "LBP"), color: colors.lbp, label: "LBP" },
                ]}
                trackColor={T.line} labelColor={T.text}
                centerLabel={money(spendTotalUSD)} centerSublabel="this month"
              />
              <div className="flex-1 min-w-[180px] space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2" style={{ color: T.text }}>
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: colors.usd }} /> USD
                  </span>
                  <span className="text-right">
                    <span style={{ color: T.text }}>{money(spendUSD)}</span>
                    <span style={{ color: T.mute }}> · {Math.round((toUSD(spendUSD, "USD") / spendTotalUSD) * 100)}%</span>
                    <br />
                    <span className="text-[10px]" style={{ color: T.mute }}>≈ L£{toLBP(spendUSD).toLocaleString()}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2" style={{ color: T.text }}>
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: colors.lbp }} /> LBP
                  </span>
                  <span className="text-right">
                    <span style={{ color: T.text }}>L£{spendLBP.toLocaleString()}</span>
                    <span style={{ color: T.mute }}> · {Math.round((toUSD(spendLBP, "LBP") / spendTotalUSD) * 100)}%</span>
                    <br />
                    <span className="text-[10px]" style={{ color: T.mute }}>≈ {money(toUSD(spendLBP, "LBP"))}</span>
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Holdings by currency */}
        <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: T.mute }}>Cash & assets, by currency</p>
          <p className="text-[11px] mb-4" style={{ color: T.mute }}>
            Tracked balances, assets, and goals — each counted in whichever currency it&apos;s held in. Your safety net is always USD. Debts aren&apos;t counted here: a liability moves the opposite direction from an asset when LBP devalues, so it isn&apos;t &ldquo;exposure&rdquo; in the same sense.
          </p>
          {moneyEquals(holdingsTotalUSD, 0) ? (
            <p className="text-sm" style={{ color: T.mute }}>No LBP or USD assets/balances tracked yet.</p>
          ) : (
            <div className="flex items-center gap-6 flex-wrap">
              <Donut
                segments={[
                  { value: toUSD(usdAssets, "USD"), color: colors.usd, label: "USD" },
                  { value: toUSD(lbpAssets, "LBP"), color: colors.lbp, label: "LBP" },
                ]}
                trackColor={T.line} labelColor={T.text}
                centerLabel={money(holdingsTotalUSD)} centerSublabel="tracked"
              />
              <div className="flex-1 min-w-[180px] space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2" style={{ color: T.text }}>
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: colors.usd }} /> USD
                  </span>
                  <span className="text-right">
                    <span style={{ color: T.text }}>{money(usdAssets)}</span>
                    <span style={{ color: T.mute }}> · {Math.round((toUSD(usdAssets, "USD") / holdingsTotalUSD) * 100)}%</span>
                    <br />
                    <span className="text-[10px]" style={{ color: T.mute }}>≈ L£{toLBP(usdAssets).toLocaleString()}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2" style={{ color: T.text }}>
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: colors.lbp }} /> LBP
                  </span>
                  <span className="text-right">
                    <span style={{ color: T.text }}>L£{lbpAssets.toLocaleString()}</span>
                    <span style={{ color: T.mute }}> · {Math.round((toUSD(lbpAssets, "LBP") / holdingsTotalUSD) * 100)}%</span>
                    <br />
                    <span className="text-[10px]" style={{ color: T.mute }}>≈ {money(toUSD(lbpAssets, "LBP"))}</span>
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Devaluation stress-test */}
        {lbpAssets > 0 && (
          <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
            <p className="text-xs uppercase tracking-widest mb-1" style={{ color: T.mute }}>Devaluation stress-test</p>
            <p className="text-[11px] mb-4" style={{ color: T.mute }}>
              What your L£{lbpAssets.toLocaleString()} in tracked assets, balances, and goals would be worth in USD at a worse exchange rate.
            </p>
            <div className="flex items-center justify-between gap-3 mb-2">
              <span className="text-xs" style={{ color: T.mute }}>Hypothetical rate</span>
              <span className="text-sm font-semibold tabular-nums" style={{ color: T.brass }}>L£ {stressRate.toLocaleString()} / $1</span>
            </div>
            <input
              type="range" min={lbpRate} max={lbpRate * 3} step={500}
              value={stressRate}
              onChange={(e) => setStressRate(Number(e.target.value))}
              className="w-full" style={{ accentColor: T.brass }}
              aria-label="Hypothetical LBP exchange rate"
            />
            <div className="flex justify-between text-[10px] mt-1 mb-4" style={{ color: T.mute }}>
              <span>today&apos;s rate</span>
              <span>3× today&apos;s rate</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl px-4 py-3" style={{ background: T.ink }}>
                <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>Worth today</p>
                <p className="text-lg font-medium tabular-nums mt-0.5" style={{ ...SERIF, color: T.text }}>{money(lbpAtCurrent)}</p>
              </div>
              <div className="rounded-xl px-4 py-3" style={{ background: T.ink }}>
                <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>Worth at this rate</p>
                <p className="text-lg font-medium tabular-nums mt-0.5" style={{ ...SERIF, color: stressLossUSD > 0 ? T.coral : T.text }}>{money(lbpAtStress)}</p>
              </div>
            </div>
            {stressLossUSD > 0 && (
              <p className="text-xs mt-3" style={{ color: T.coral }}>
                A loss of {money(stressLossUSD)} in USD terms, with no change in your LBP balance itself.
              </p>
            )}
          </div>
        )}

      </div>
    </main>
  );
}
