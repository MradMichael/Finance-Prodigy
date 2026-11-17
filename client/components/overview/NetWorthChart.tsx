"use client";

// R17 (session 55): the Overview's net-worth chart, moved here line for line from FinancialDashboard.tsx. It loads
// after the first paint (../charts.lazy.tsx); its box and height stay in the Overview.
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useTheme } from "../../contexts/ThemeContext";
import { asCalendarKey, type CalendarKey } from "../../lib/period";
import { money } from "./format";

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

export default function NetWorthChart({ data, color }: { data: { ym: CalendarKey; value: number }[]; color: string }) {
  const T = useTheme();
  const nwColor = color;
  return (
    <ResponsiveContainer>
      <LineChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
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
  );
}
