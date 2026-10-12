"use client";

// Travel slice 2 (HELD; its wording approved in session 17): trips
// (lib/trips.ts). A trip has a name, dates and a budget in USD, optionally by
// category; each shows planned against actual in USD at cost, its foreign cash
// bought, and the rows tagged to it. Rows are tagged in the edit sheet and the
// foreign-cash forms. A trip can be edited (session 17: "Edit trip", "Save
// changes"), with the same fields and errors as a new one; every tag stays.
// Deleting a trip keeps its rows' tags (owner, approved).
import { useState } from "react";
import type { LocalFinancials } from "../../lib/localData";
import { allCategories, categoryLabel, fmtDate, MONEY_MAX_USD } from "../../lib/localData";
import { dayLabel } from "../../lib/period";
import { useTheme } from "../../contexts/ThemeContext";
import { SERIF } from "./shared";
import { Label, FocusInput, MoneyInput, DateFieldDMY } from "../form/Primitives";
import { buildTrip, deleteTrip, editTrip, tripActual, tripCashBought, type StoredTrip } from "../../lib/trips";
import { fmtForeign } from "../../lib/foreignCash";

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const num = (s: string) => parseFloat(s.replace(/,/g, ""));
const dayOf = (iso: string) => dayLabel(new Date(`${iso}T12:00:00`));
const REASONS = {
  name: "Name the trip.",
  dates: "The end date can't be before the start date.",
  budget: "A budget can't be negative.",
} as const;

/** A trip form's fields as typed. */
interface Draft { name: string; start: string; end: string; budget: string; catRows: { category: string; amount: string }[] }
const EMPTY: Draft = { name: "", start: "", end: "", budget: "", catRows: [] };
const draftOf = (t: StoredTrip): Draft => ({
  name: t.name, start: t.startDate, end: t.endDate, budget: String(t.budgetUSD),
  catRows: Object.entries(t.categoryBudgetsUSD ?? {}).map(([category, amount]) => ({ category, amount: String(amount) })),
});
/** What the form asks for: an empty budget is 0; a category row without both a category and an amount is left out. */
function paramsOf(d: Draft): Parameters<typeof buildTrip>[0] {
  const categoryBudgetsUSD = Object.fromEntries(d.catRows.filter((r) => r.category && r.amount !== "").map((r) => [r.category, num(r.amount)]));
  return { name: d.name, startDate: d.start, endDate: d.end, budgetUSD: d.budget === "" ? 0 : num(d.budget), ...(Object.keys(categoryBudgetsUSD).length ? { categoryBudgetsUSD } : {}) };
}

/** The fields a new trip and an edited one share. `idPrefix` keeps two open forms' ids apart. */
function TripFields({ idPrefix, testIdPrefix, draft, onDraft, financials }: {
  idPrefix: string; testIdPrefix: string; draft: Draft; onDraft: (d: Draft) => void; financials: LocalFinancials;
}) {
  const T = useTheme();
  const field = { background: T.ink, border: `1px solid ${T.line}`, color: T.text };
  const categories = allCategories(financials.customCategories);
  const setRow = (i: number, patch: Partial<Draft["catRows"][number]>) => onDraft({ ...draft, catRows: draft.catRows.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <>
      <div>
        <Label htmlFor={`${idPrefix}-name`}>Name</Label>
        <FocusInput id={`${idPrefix}-name`} value={draft.name} onChange={(e) => onDraft({ ...draft, name: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div data-testid={`${testIdPrefix}-start`}>
          <Label htmlFor={`${idPrefix}-start-day`}>Starts</Label>
          <DateFieldDMY id={`${idPrefix}-start-day`} value={draft.start} onChange={(v) => onDraft({ ...draft, start: v })} />
        </div>
        <div data-testid={`${testIdPrefix}-end`}>
          <Label htmlFor={`${idPrefix}-end-day`}>Ends</Label>
          <DateFieldDMY id={`${idPrefix}-end-day`} value={draft.end} onChange={(v) => onDraft({ ...draft, end: v })} />
        </div>
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-budget`}>Budget ($)</Label>
        <MoneyInput id={`${idPrefix}-budget`} value={draft.budget} onChange={(v) => onDraft({ ...draft, budget: v })} placeholder="0" max={MONEY_MAX_USD} />
      </div>
      {draft.catRows.map((r, i) => (
        <div key={i} className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor={`${idPrefix}-cat-${i}`}>Category</Label>
            <select id={`${idPrefix}-cat-${i}`} value={r.category} onChange={(e) => setRow(i, { category: e.target.value })}
              className="w-full rounded-lg px-2 py-1.5 text-sm" style={field}>
              <option value="">Choose a category</option>
              {categories.map((c) => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-cat-amount-${i}`}>Category budget ($)</Label>
            <MoneyInput id={`${idPrefix}-cat-amount-${i}`} value={r.amount} onChange={(v) => setRow(i, { amount: v })} placeholder="0" max={MONEY_MAX_USD} />
          </div>
        </div>
      ))}
      <button type="button" onClick={() => onDraft({ ...draft, catRows: [...draft.catRows, { category: "", amount: "" }] })} className="text-xs underline" style={{ color: T.mute }}>
        Add a category budget
      </button>
    </>
  );
}

export default function TripsScreen({ financials, onChange }: { financials: LocalFinancials; onChange: (f: LocalFinancials) => void }) {
  const T = useTheme();
  const trips = [...(financials.trips ?? [])].sort((a, b) => b.startDate.localeCompare(a.startDate));

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState("");
  // One trip's edit form open at a time.
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY);
  const [editError, setEditError] = useState("");

  function save() {
    const r = buildTrip(paramsOf(draft));
    if (!r.ok) { setError(REASONS[r.reason]); return; }
    onChange({ ...financials, trips: [...(financials.trips ?? []), r.trip] });
    setDraft(EMPTY); setError("");
  }

  function toggleEdit(trip: StoredTrip) {
    if (editing === trip.id) { setEditing(null); return; }
    setEditing(trip.id); setEditDraft(draftOf(trip)); setEditError("");
  }

  function saveEdit(trip: StoredTrip) {
    const r = editTrip(financials, trip.id, paramsOf(editDraft));
    if (!r.ok) { setEditError(REASONS[r.reason]); return; }
    onChange(r.data);
    setEditing(null);
  }

  function remove(trip: StoredTrip) {
    if (!confirm("Delete this trip? Its entries stay as they are, but won't count toward any trip.")) return;
    onChange(deleteTrip(financials, trip.id));
  }

  return (
    <main className="min-h-screen px-4 py-8 md:px-10" style={{ background: T.ink }}>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>ESSA</p>
          <h1 className="text-3xl mt-1" style={SERIF}>Trips</h1>
          <p className="text-sm mt-2" style={{ color: T.mute }}>A trip&apos;s budget against what it actually cost, in dollars at what you paid.</p>
        </div>

        <form aria-label="New trip" className="rounded-2xl p-5 space-y-3" style={{ background: T.panel, border: `1px solid ${T.line}` }} onSubmit={(e) => { e.preventDefault(); save(); }}>
          <p className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>New trip</p>
          <TripFields idPrefix="trip" testIdPrefix="trip" draft={draft} onDraft={setDraft} financials={financials} />
          <div role="status">{error && <p className="text-[11px]" style={{ color: T.coral }}>{error}</p>}</div>
          <button type="submit" className="w-full py-2 rounded-xl text-sm font-semibold" style={{ background: T.jade, color: T.ink }}>Save trip</button>
        </form>

        {trips.length === 0 && <p className="text-sm" style={{ color: T.mute }}>No trips yet.</p>}

        {trips.map((trip) => {
          const actual = tripActual(financials, trip);
          const left = trip.budgetUSD - actual.totalUSD;
          const cash = tripCashBought(financials, trip);
          const budgeted = trip.categoryBudgetsUSD ?? {};
          const catKeys = [...new Set([...Object.keys(budgeted), ...Object.keys(actual.byCategoryUSD)])];
          return (
            <section key={trip.id} aria-label={trip.name} className="rounded-2xl p-5 space-y-3" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg" style={{ ...SERIF, color: T.text }}>{trip.name}</h2>
                  <p className="text-[11px]" style={{ color: T.mute }}>{`${dayOf(trip.startDate)} – ${dayOf(trip.endDate)}`}</p>
                </div>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => toggleEdit(trip)} aria-expanded={editing === trip.id} className="text-xs underline" style={{ color: T.mute }}>Edit trip</button>
                  <button type="button" onClick={() => remove(trip)} className="text-xs" style={{ color: T.coral }}>Delete trip</button>
                </div>
              </div>
              {editing === trip.id && (
                <form aria-label="Edit trip" className="space-y-3 pb-3" style={{ borderBottom: `1px solid ${T.line}` }} onSubmit={(e) => { e.preventDefault(); saveEdit(trip); }}>
                  <TripFields idPrefix={`trip-edit-${trip.id}`} testIdPrefix="trip-edit" draft={editDraft} onDraft={setEditDraft} financials={financials} />
                  <div role="status">{editError && <p className="text-[11px]" style={{ color: T.coral }}>{editError}</p>}</div>
                  <button type="submit" className="w-full py-2 rounded-xl text-sm font-semibold" style={{ background: T.jade, color: T.ink }}>Save changes</button>
                </form>
              )}
              <p className="text-sm tabular-nums" style={{ color: left < 0 ? T.coral : T.text }}>
                {`Budget ${usd(trip.budgetUSD)} · spent ${usd(actual.totalUSD)} · ${left < 0 ? `${usd(-left)} over` : `${usd(left)} left`}`}
              </p>
              {catKeys.length > 0 && (
                <ul className="space-y-0.5">
                  {catKeys.map((k) => (
                    <li key={k || "_none"} className="text-[11px] tabular-nums" style={{ color: T.mute }}>
                      {`${categoryLabel(k || undefined, financials.customCategories)}: ${usd(actual.byCategoryUSD[k] ?? 0)}${budgeted[k] !== undefined ? ` of ${usd(budgeted[k])}` : ""}`}
                    </li>
                  ))}
                </ul>
              )}
              {cash.map((c) => (
                <p key={c.code} className="text-[11px] tabular-nums" style={{ color: T.mute }}>{`Foreign cash bought for this trip: ${fmtForeign(c.amount, c.code)} for ${usd(c.costUSD)}`}</p>
              ))}
              {actual.rows.length > 0 && (
                <ul className="space-y-1 pt-2" style={{ borderTop: `1px solid ${T.line}` }}>
                  {[...actual.rows].sort((a, b) => a.date.localeCompare(b.date)).map((t) => (
                    <li key={t.id} className="text-[11px] tabular-nums flex justify-between gap-2" style={{ color: T.text }}>
                      <span>{`${fmtDate(t.date)} · ${t.description}`}</span>
                      <span>{t.fx?.kind === "spend" ? `${usd(t.amount)} (${fmtForeign(t.fx.amount, t.fx.code)})` : `${t.currency === "LBP" ? `L£${t.amount.toLocaleString("en-US")}` : usd(t.amount)}`}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
