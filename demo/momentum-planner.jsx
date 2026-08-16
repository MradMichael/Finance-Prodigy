/**
 * ESSA — Interactive Financial Planner
 * -----------------------------------------
 * Adjust the levers — watch the dates move.
 *
 * Self-contained demo of the planning engine: the same constant-commitment
 * payoff simulation and rollover waterfall the API uses, running live in
 * the browser. Freed debt payments cascade into the emergency fund, and an
 * overflowing emergency fund cascades into the travel goal — so every
 * slider nudge ripples through all three milestone dates at once.
 *
 * Design language: "ledger ink & brass". Dates are the heroes.
 */

import { useMemo, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis,
  Tooltip, CartesianGrid, ReferenceDot,
} from "recharts";

// ------------------------------ theme ------------------------------ //
const T = {
  ink: "#0B1F1E", panel: "#11302C", panelSoft: "#16403A", line: "#1E4A43",
  text: "#EAF2EF", mute: "#8FAFA7",
  brass: "#E3B341", jade: "#4FD1A5", coral: "#F08A7E", sky: "#7FB8D8",
};
const SERIF = { fontFamily: "Georgia, 'Times New Roman', serif" };
const NUMS = { fontVariantNumeric: "tabular-nums" };

const money = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const M_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Anchor the plan to the 1st of next month — clean month math.
const NOW = new Date();
const START = new Date(NOW.getFullYear(), NOW.getMonth() + 1, 1);
const atMonth = (m) => new Date(START.getFullYear(), START.getMonth() + m, 1);
const fmtFull = (d) =>
  `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
const fmtShort = (d) => `${M_SHORT[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`;

// --------------------------- sample data ---------------------------- //
const DEBTS = [
  { name: "Credit Card", balance: 2400, apr: 24.9, min: 75 },
  { name: "Personal Loan", balance: 4000, apr: 11.0, min: 130 },
  { name: "Car Loan", balance: 8500, apr: 6.5, min: 220 },
];
const MIN_SUM = DEBTS.reduce((s, d) => s + d.min, 0); // 425
const DEBT_TOTAL = DEBTS.reduce((s, d) => s + d.balance, 0); // 14,900
const EF_START = 1000;
const TRAVEL_START = 1500;
const TRAVEL_TARGET = 12000;

// --------------------------- simulation ----------------------------- //
/**
 * Month-by-month projection with the rollover waterfall:
 *   debt budget (Σ minimums + extra, held constant)
 *     → freed money flows to the emergency fund once debts die
 *     → EF overflow flows to the travel goal once the net is full.
 */
function simulate({ strategy, extraDebt, efMonthly, travelMonthly, efTarget }) {
  const debts = DEBTS.map((d) => ({ ...d }));
  let ef = EF_START;
  let travel = TRAVEL_START;
  let totalInterest = 0;
  let debtFreeMonth = null, efFullMonth = null, travelMonth = null;
  const killOrder = [];
  const series = [{ m: 0, debt: DEBT_TOTAL, ef, travel }];

  for (let m = 1; m <= 360; m++) {
    let freed = 0;
    const active = debts.filter((d) => d.balance > 0.005);

    if (active.length > 0) {
      for (const d of active) {
        const interest = (d.balance * d.apr) / 1200;
        d.balance += interest;
        totalInterest += interest;
      }
      let budget = MIN_SUM + extraDebt;
      const order = [...active].sort((a, b) =>
        strategy === "SNOWBALL" ? a.balance - b.balance : b.apr - a.apr
      );
      // Minimums first across the board…
      for (const d of order) {
        const pay = Math.min(d.min, d.balance, budget);
        d.balance -= pay;
        budget -= pay;
        if (d.balance <= 0.005 && !killOrder.includes(d.name)) killOrder.push(d.name);
      }
      // …then every remaining dollar attacks the strategy target.
      for (const d of order) {
        if (budget <= 0.005) break;
        if (d.balance <= 0.005) continue;
        const pay = Math.min(budget, d.balance);
        d.balance -= pay;
        budget -= pay;
        if (d.balance <= 0.005 && !killOrder.includes(d.name)) killOrder.push(d.name);
      }
      freed = budget; // leftover in the payoff month rolls forward immediately
      if (debts.every((d) => d.balance <= 0.005) && debtFreeMonth === null) debtFreeMonth = m;
    } else {
      freed = MIN_SUM + extraDebt; // the whole debt budget is yours again
    }

    // Emergency fund: planned contribution + anything freed upstream.
    let inflow = efMonthly + freed;
    if (ef < efTarget) {
      const put = Math.min(inflow, efTarget - ef);
      ef += put;
      inflow -= put;
      if (ef >= efTarget - 0.005 && efFullMonth === null) efFullMonth = m;
    }
    // Travel: planned contribution + EF overflow.
    if (travel < TRAVEL_TARGET) {
      travel = Math.min(TRAVEL_TARGET, travel + travelMonthly + inflow);
      if (travel >= TRAVEL_TARGET - 0.005 && travelMonth === null) travelMonth = m;
    }

    series.push({
      m,
      debt: Math.max(0, Math.round(debts.reduce((s, d) => s + d.balance, 0))),
      ef: Math.round(ef),
      travel: Math.round(travel),
    });

    if (debtFreeMonth !== null && efFullMonth !== null && travelMonth !== null) {
      if (m >= Math.max(debtFreeMonth, efFullMonth, travelMonth) + 3) break;
    }
  }
  return { series, debtFreeMonth, efFullMonth, travelMonth, totalInterest: Math.round(totalInterest), killOrder };
}

// ------------------------------ atoms ------------------------------- //
function Slider({ label, value, min, max, step = 50, onChange, fmt = money, accent = T.brass, hint }) {
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-sm" style={{ color: T.text }}>{label}</span>
        <span className="text-lg" style={{ ...SERIF, ...NUMS, color: accent }}>{fmt(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 cursor-pointer appearance-none rounded-full"
        style={{ accentColor: accent, background: T.line }}
      />
      {hint && <p className="text-xs mt-1" style={{ color: T.mute }}>{hint}</p>}
    </div>
  );
}

function Milestone({ title, month, sub, color }) {
  const reached = month !== null;
  return (
    <div className="rounded-xl p-4" style={{ background: T.panelSoft, border: `1px solid ${T.line}` }}>
      <p className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>{title}</p>
      <p className="text-2xl mt-1" style={{ ...SERIF, ...NUMS, color: reached ? color : T.mute }}>
        {reached ? fmtFull(atMonth(month)) : "beyond 30 yrs"}
      </p>
      <p className="text-xs mt-1" style={{ color: T.mute }}>{sub}</p>
    </div>
  );
}

// -------------------------- milestone runway ------------------------ //
function Runway({ horizon, marks }) {
  return (
    <div className="rounded-2xl px-5 pt-5 pb-3" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
      <div className="flex justify-between items-baseline mb-8">
        <h2 className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>The runway</h2>
        <span className="text-xs" style={{ color: T.mute }}>
          today → {fmtShort(atMonth(horizon))}
        </span>
      </div>
      <div className="relative mx-2" style={{ height: 64 }}>
        {/* track */}
        <div className="absolute left-0 right-0 rounded-full" style={{ top: 38, height: 4, background: T.line }} />
        {/* today */}
        <div className="absolute" style={{ left: 0, top: 30 }}>
          <div className="rounded-full" style={{ width: 10, height: 10, background: T.mute, marginLeft: -5, marginTop: 4 }} />
          <p className="text-[10px] mt-2 -translate-x-1/2" style={{ color: T.mute }}>today</p>
        </div>
        {/* milestone flags — they slide as the plan changes */}
        {marks.filter((mk) => mk.month !== null).map((mk) => {
          const pct = Math.min(100, (mk.month / horizon) * 100);
          return (
            <div
              key={mk.key}
              className="absolute transition-all duration-500 ease-out"
              style={{ left: `${pct}%`, top: 0 }}
            >
              <p className="text-[10px] whitespace-nowrap -translate-x-1/2 text-center" style={{ color: mk.color }}>
                {mk.label}
              </p>
              <p
                className="text-xs whitespace-nowrap -translate-x-1/2 text-center mt-0.5"
                style={{ ...SERIF, ...NUMS, color: T.text }}
              >
                {fmtShort(atMonth(mk.month))}
              </p>
              <div className="mx-auto" style={{ width: 2, height: 12, background: mk.color, marginTop: 3 }} />
              <div
                className="rounded-full mx-auto"
                style={{ width: 10, height: 10, background: mk.color, marginTop: -1, boxShadow: `0 0 0 3px ${T.panel}` }}
              />
            </div>
          );
        })}
      </div>
      <p className="text-xs mt-3" style={{ color: T.mute }}>
        Move a slider and watch the flags slide left. That's months of your life coming back.
      </p>
    </div>
  );
}

// ------------------------------ screen ------------------------------ //
export default function EssaPlanner() {
  const [income, setIncome] = useState(3500);
  const [needs, setNeeds] = useState(1650);
  const [wants, setWants] = useState(700);
  const [efTargetMonths, setEfTargetMonths] = useState(4);
  const [extraDebt, setExtraDebt] = useState(250);
  const [efMonthly, setEfMonthly] = useState(200);
  const [travelMonthly, setTravelMonthly] = useState(200);
  const [strategy, setStrategy] = useState("AVALANCHE");

  const efTarget = efTargetMonths * needs;

  const plan = useMemo(
    () => simulate({ strategy, extraDebt, efMonthly, travelMonthly, efTarget }),
    [strategy, extraDebt, efMonthly, travelMonthly, efTarget]
  );
  const baseline = useMemo(
    () => simulate({ strategy, extraDebt: 0, efMonthly, travelMonthly, efTarget }),
    [strategy, efMonthly, travelMonthly, efTarget]
  );
  const alt = useMemo(
    () => simulate({ strategy: strategy === "AVALANCHE" ? "SNOWBALL" : "AVALANCHE", extraDebt, efMonthly, travelMonthly, efTarget }),
    [strategy, extraDebt, efMonthly, travelMonthly, efTarget]
  );

  const lastMilestone = Math.max(plan.debtFreeMonth ?? 0, plan.efFullMonth ?? 0, plan.travelMonth ?? 0);
  const horizon = Math.min(360, Math.max(24, (plan.travelMonth ? lastMilestone : 360) + 4));
  const chartData = plan.series.filter((p) => p.m <= horizon);

  const allocated = needs + wants + MIN_SUM + extraDebt + efMonthly + travelMonthly;
  const cushion = income - allocated;

  const monthsSooner = baseline.debtFreeMonth && plan.debtFreeMonth ? baseline.debtFreeMonth - plan.debtFreeMonth : 0;
  const interestSaved = baseline.totalInterest - plan.totalInterest;
  const stratDelta = alt.totalInterest - plan.totalInterest;

  return (
    <div className="min-h-screen px-4 py-8 md:px-10" style={{ background: T.ink, color: T.text }}>
      <div className="mx-auto max-w-6xl space-y-6">

        {/* header */}
        <header>
          <p className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>ESSA · Planner</p>
          <h1 className="text-3xl md:text-4xl mt-1" style={SERIF}>
            Adjust the levers — <span style={{ color: T.brass }}>watch the dates move.</span>
          </h1>
        </header>

        {/* the signature element */}
        <Runway
          horizon={horizon}
          marks={[
            { key: "debt", label: "debt-free", month: plan.debtFreeMonth, color: T.coral },
            { key: "ef", label: `${efTargetMonths}-mo safety net`, month: plan.efFullMonth, color: T.jade },
            { key: "travel", label: "30 Before 30 ✈", month: plan.travelMonth, color: T.brass },
          ]}
        />

        <div className="grid gap-6 lg:grid-cols-5">
          {/* controls */}
          <section className="lg:col-span-2 rounded-2xl p-5 space-y-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
            <h2 className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>Your monthly plan</h2>

            <Slider label="Take-home income" value={income} min={1500} max={8000} step={50} onChange={setIncome} accent={T.jade} />
            <Slider label="Essential expenses (needs)" value={needs} min={500} max={4000} step={50} onChange={setNeeds} accent={T.sky}
                    hint={`Safety net target: ${efTargetMonths} × needs = ${money(efTarget)}`} />
            <Slider label="Lifestyle (wants)" value={wants} min={0} max={2500} step={50} onChange={setWants} accent={T.sky} />
            <Slider label="Extra to debt" value={extraDebt} min={0} max={1500} step={25} onChange={setExtraDebt}
                    hint={`On top of ${money(MIN_SUM)} in minimums — held constant, so freed payments roll forward`} />
            <Slider label="Emergency fund / month" value={efMonthly} min={0} max={1500} step={25} onChange={setEfMonthly} accent={T.jade} />
            <Slider label="Travel fund / month" value={travelMonthly} min={0} max={1500} step={25} onChange={setTravelMonthly}
                    hint={`Target ${money(TRAVEL_TARGET)} — the 30 Before 30 fund`} />
            <Slider label="Safety net size" value={efTargetMonths} min={3} max={6} step={1} onChange={setEfTargetMonths}
                    fmt={(v) => `${v} months`} accent={T.jade} />

            {/* strategy toggle */}
            <div>
              <p className="text-sm mb-2">Payoff strategy</p>
              <div className="flex gap-2">
                {["AVALANCHE", "SNOWBALL"].map((s) => (
                  <button
                    key={s}
                    onClick={() => setStrategy(s)}
                    className="px-3 py-1.5 rounded-full text-xs tracking-wider transition-all"
                    style={{
                      border: `1px solid ${strategy === s ? T.brass : T.line}`,
                      background: strategy === s ? "rgba(227,179,65,0.12)" : "transparent",
                      color: strategy === s ? T.brass : T.mute,
                    }}
                  >
                    {s === "AVALANCHE" ? "Avalanche · highest rate first" : "Snowball · smallest first"}
                  </button>
                ))}
              </div>
              <p className="text-xs mt-2" style={{ color: T.mute }}>
                Kill order: {plan.killOrder.length ? plan.killOrder.join(" → ") : "—"}
              </p>
            </div>

            {/* cushion */}
            <div className="rounded-xl px-4 py-3 text-sm"
                 style={{ background: T.panelSoft, border: `1px solid ${cushion < 0 ? T.coral : T.line}` }}>
              {cushion >= 0 ? (
                <span style={{ color: T.mute }}>
                  <span style={{ ...NUMS, color: T.jade }}>{money(cushion)}</span>/mo unallocated — breathing room is part of the plan.
                </span>
              ) : (
                <span style={{ color: T.coral }}>
                  This plan spends {money(-cushion)}/mo more than you earn — pull a lever back.
                </span>
              )}
            </div>
          </section>

          {/* results */}
          <section className="lg:col-span-3 space-y-6">
            {/* milestone cards */}
            <div className="grid gap-4 sm:grid-cols-3">
              <Milestone title="Debt-free" month={plan.debtFreeMonth} color={T.coral}
                         sub={`${money(DEBT_TOTAL)} gone · ${money(plan.totalInterest)} lifetime interest`} />
              <Milestone title="Safety net full" month={plan.efFullMonth} color={T.jade}
                         sub={`${money(efTarget)} = ${efTargetMonths} months of essentials`} />
              <Milestone title="30 Before 30" month={plan.travelMonth} color={T.brass}
                         sub={`${money(TRAVEL_TARGET)} travel fund, fully banked`} />
            </div>

            {/* projection chart */}
            <div className="rounded-2xl p-5" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
              <h2 className="text-xs uppercase tracking-widest mb-4" style={{ color: T.mute }}>
                The cascade · debt falls, funds rise
              </h2>
              <div className="h-64">
                <ResponsiveContainer>
                  <ComposedChart data={chartData} margin={{ top: 8, right: 10, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="debtFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={T.coral} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={T.coral} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={T.line} strokeDasharray="2 6" vertical={false} />
                    <XAxis
                      dataKey="m" type="number" domain={[0, horizon]}
                      ticks={Array.from({ length: Math.floor(horizon / 12) + 1 }, (_, i) => i * 12)}
                      tickFormatter={(m) => fmtShort(atMonth(m))}
                      tick={{ fill: T.mute, fontSize: 11 }} axisLine={false} tickLine={false}
                    />
                    <YAxis tick={{ fill: T.mute, fontSize: 11 }} axisLine={false} tickLine={false}
                           tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                    <Tooltip
                      contentStyle={{ background: T.panelSoft, border: `1px solid ${T.line}`, borderRadius: 12, color: T.text }}
                      labelFormatter={(m) => fmtShort(atMonth(Number(m)))}
                      formatter={(v, name) => [
                        money(v),
                        name === "debt" ? "Debt remaining" : name === "ef" ? "Safety net" : "Travel fund",
                      ]}
                    />
                    <Area type="monotone" dataKey="debt" stroke={T.coral} strokeWidth={2} fill="url(#debtFill)" />
                    <Line type="monotone" dataKey="ef" stroke={T.jade} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="travel" stroke={T.brass} strokeWidth={2} dot={false} />
                    {plan.debtFreeMonth && (
                      <ReferenceDot x={plan.debtFreeMonth} y={0} r={5} fill={T.coral} stroke={T.panel} strokeWidth={2} />
                    )}
                    {plan.efFullMonth && (
                      <ReferenceDot x={plan.efFullMonth} y={efTarget} r={5} fill={T.jade} stroke={T.panel} strokeWidth={2} />
                    )}
                    {plan.travelMonth && (
                      <ReferenceDot x={plan.travelMonth} y={TRAVEL_TARGET} r={5} fill={T.brass} stroke={T.panel} strokeWidth={2} />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs mt-2" style={{ color: T.mute }}>
                The dots are your milestones. Freed debt payments feed the jade line; an overflowing safety net feeds the brass one.
              </p>
            </div>

            {/* comparison strip */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl p-4" style={{ background: T.panelSoft, border: `1px solid ${T.line}` }}>
                <p className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>vs. minimums only</p>
                {extraDebt > 0 && monthsSooner > 0 ? (
                  <p className="text-sm mt-2" style={{ color: T.text }}>
                    Your extra {money(extraDebt)}/mo lands debt-free{" "}
                    <span style={{ ...SERIF, ...NUMS, color: T.brass }}>{monthsSooner} months sooner</span>{" "}
                    and keeps <span style={{ ...NUMS, color: T.jade }}>{money(interestSaved)}</span> out of lenders' pockets.
                  </p>
                ) : (
                  <p className="text-sm mt-2" style={{ color: T.mute }}>
                    Slide "Extra to debt" up to see months and interest fall off the plan.
                  </p>
                )}
              </div>
              <div className="rounded-xl p-4" style={{ background: T.panelSoft, border: `1px solid ${T.line}` }}>
                <p className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>
                  {strategy === "AVALANCHE" ? "avalanche vs. snowball" : "snowball vs. avalanche"}
                </p>
                <p className="text-sm mt-2" style={{ color: T.text }}>
                  {stratDelta > 0 ? (
                    <>Your pick saves <span style={{ ...NUMS, color: T.jade }}>{money(stratDelta)}</span> in interest over the alternative.</>
                  ) : stratDelta < 0 ? (
                    <>The alternative would save <span style={{ ...NUMS, color: T.brass }}>{money(-stratDelta)}</span> — but quick wins have value too.</>
                  ) : (
                    <>Both strategies cost the same here — pick the one that keeps you motivated.</>
                  )}
                </p>
              </div>
            </div>
          </section>
        </div>

        <footer className="text-xs pb-4" style={{ color: T.mute }}>
          Sample debts: Credit Card {money(2400)} @ 24.9% · Personal Loan {money(4000)} @ 11% · Car Loan {money(8500)} @ 6.5% —
          the production app runs this exact engine on your real numbers.
        </footer>
      </div>
    </div>
  );
}
