"use client";

// R17 (session 55): the Overview's cash-flow chart, moved here line for line from FinancialDashboard.tsx. It loads
// after the first paint (../charts.lazy.tsx); its box and height stay in the Overview.
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useTheme } from "../../contexts/ThemeContext";
import { cycleTickLabel, cycleLabelLong, ymKeyToCycleKey } from "../../lib/period";
import { money } from "./format";

/**
 * sixMonthTrend's ymKey is a CYCLE key in numeric form. It used to render as
 * a calendar month name ("Aug '26") beneath a panel titled "last 6 cycles" --
 * form (a), under a cycle-titled chart (2.4.101). Ticks now carry the
 * cycle's start date and the tooltip carries the full range.
 */
const ymTick = (ymKey: number, startDay: number) => cycleTickLabel(ymKeyToCycleKey(ymKey), startDay);
const ymFull = (ymKey: number, startDay: number) => cycleLabelLong(ymKeyToCycleKey(ymKey), startDay);

export default function CashFlowChart({ data, startDay }: { data: { ymKey: number; income: number; spend: number }[]; startDay: number }) {
  const T = useTheme();
  return (
    <ResponsiveContainer>
      <AreaChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
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
  );
}
