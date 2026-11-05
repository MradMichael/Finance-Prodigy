"use client";

// Travel slice 2 (HELD; its wording approved in session 17): trips
// (lib/trips.ts). A trip has a name, dates and a budget in USD, optionally by
// category; each shows planned against actual in USD (foreign cash, model 2:
// an exchange counts, a change-back or refund lowers it), by category, the
// trip's euro spends in euros by category (approved, session 19; for information),
// and the rows counted. Rows are tagged in the edit sheet and the
// foreign-cash forms. A trip can be edited (session 17: "Edit trip", "Save
// changes"), with the same fields and errors as a new one; every tag stays.
// Deleting a trip keeps its rows' tags (owner, approved). Each card also
// shows each sheet's balance and opens the Currency screen's own foreign-cash
// forms, its trip preset (session 20, item 1; approved labels only).
import { Fragment, useCallback, useEffect, useState, type ComponentType } from "react";
import type { LocalFinancials } from "../../lib/localData";
import { categoryLabel, fmtDate, moneyEquals, MONEY_MAX_USD } from "../../lib/localData";
import { dayLabel } from "../../lib/period";
import { useTheme } from "../../contexts/ThemeContext";
import { SERIF } from "./shared";
import { Label, FocusInput, MoneyInput, DateFieldDMY } from "../form/Primitives";
import { buildTrip, deleteTrip, editTrip, tagToTrip, tripActual, tripCategoryView, tripForeignSpends, untaggedDuringTrip, type StoredTrip, type TripCategoryRow } from "../../lib/trips";
import { fmtForeign, sheet, sheetCodes } from "../../lib/foreignCash";
import { ExchangeForm, SpendForm } from "../ForeignCashForms";
import CategoryOptions from "../form/CategoryOptions";
import StopFields, { placesOf, stopsOf, type CitiesState, type PlaceDraft } from "../travel/StopFields";
import { countryName, loadCities, type CityRow } from "../../lib/places";
import { todayCalendarDay } from "../../lib/calendarDay";

/**
 * Travel map plan, Phase 1c: the Map view's panel (components/travel/MapPanel.tsx), loaded only by the dynamic
 * import below when Map opens. Never imported statically, not even its types: preloadScreens fetches every
 * screen's code, so a static import would put the map's code (d3-geo, topojson-client) on every device.
 */
type MapPanelProps = { trips: StoredTrip[]; today: string; onAddTrip: () => void; onShowTrip: (tripId: string) => void };

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const num = (s: string) => parseFloat(s.replace(/,/g, ""));
// Session 22, item 1d (approved and merged in session 23, 2f5d30c): a category's line. With no cash it keeps the approved form ("Dining out: $0.00
// of $400.00"); with cash, the euros sit beside the dollars, never added, and the budget compares against both.
function categoryLine(label: string, r: TripCategoryRow): string {
  const of = r.budgetUSD !== undefined ? ` of ${usd(r.budgetUSD)}` : "";
  if (r.fromCash.length === 0) return `${label}: ${usd(r.countedUSD)}${of}`;
  // The owner's wording (session 23): "Food & dining: $15.00 + €40.00 from cash (≈ $46.00) · ≈ $61.00 of $100.00";
  // the dollars only when there are some; " of $X" only with a category budget.
  const cash = r.fromCash.map((c) => `${fmtForeign(c.amount, c.code)} from cash${c.approxUSD !== null ? ` (≈ ${usd(c.approxUSD)})` : ""}`).join(" + ");
  const spent = r.countedUSD !== 0 ? `${usd(r.countedUSD)} + ${cash}` : cash;
  const approx = r.fromCash.some((c) => c.approxUSD !== null) ? "≈ " : "";
  return `${label}: ${spent}${of ? ` · ${approx}${usd(r.comparedUSD)}${of}` : ""}`;
}
const dayOf = (iso: string) => dayLabel(new Date(`${iso}T12:00:00`));
/**
 * Travel map plan, Phase 1b (format APPROVED, owner 2026-11-05): a trip's places, "France · Paris, Lyon — Italy ·
 * Rome — Malta". Cities are grouped under their country, countries in the order first visited; a country with no
 * city is its name alone. "" for a trip without stops.
 */
function placesLine(t: StoredTrip): string {
  const by = new Map<string, string[]>();
  for (const s of t.stops ?? []) {
    const cities = by.get(s.countryCode) ?? [];
    if (s.city && !cities.includes(s.city)) cities.push(s.city);
    by.set(s.countryCode, cities);
  }
  return [...by].map(([code, cities]) => (cities.length ? `${countryName(code)} · ${cities.join(", ")}` : countryName(code))).join(" — ");
}
const REASONS = {
  name: "Name the trip.",
  dates: "The end date can't be before the start date.",
  budget: "A budget can't be negative.",
  // Travel map plan, Phase 1a (owner: refuse, with one line here). APPROVED (owner, 2026-11-05, Phase 1b).
  stops: "One of the countries or cities couldn't be saved. Check them and try again.",
} as const;

/** A trip form's fields as typed. Travel map plan, Phase 1b: its countries and cities (`places`) and notes. */
interface Draft { name: string; start: string; end: string; budget: string; catRows: { category: string; amount: string }[]; places: PlaceDraft[]; notes: string }
const EMPTY: Draft = { name: "", start: "", end: "", budget: "", catRows: [], places: [], notes: "" };
const draftOf = (t: StoredTrip): Draft => ({
  name: t.name, start: t.startDate, end: t.endDate, budget: String(t.budgetUSD),
  catRows: Object.entries(t.categoryBudgetsUSD ?? {}).map(([category, amount]) => ({ category, amount: String(amount) })),
  places: placesOf(t.stops), notes: t.notes ?? "",
});
/**
 * What the form asks for: an empty budget is 0; a category row without both a category and an amount is left out.
 * Phase 1b: the stops and notes are always sent, so an edit that removes them all clears them (lib/trips.ts).
 */
function paramsOf(d: Draft, cityRows: CityRow[] | null): Parameters<typeof buildTrip>[0] {
  const categoryBudgetsUSD = Object.fromEntries(d.catRows.filter((r) => r.category && r.amount !== "").map((r) => [r.category, num(r.amount)]));
  return {
    name: d.name, startDate: d.start, endDate: d.end, budgetUSD: d.budget === "" ? 0 : num(d.budget), ...(Object.keys(categoryBudgetsUSD).length ? { categoryBudgetsUSD } : {}),
    stops: stopsOf(d.places, cityRows), notes: d.notes,
  };
}

/** The fields a new trip and an edited one share. `idPrefix` keeps two open forms' ids apart. */
function TripFields({ idPrefix, testIdPrefix, draft, onDraft, financials, cities, needCities }: {
  idPrefix: string; testIdPrefix: string; draft: Draft; onDraft: (d: Draft) => void; financials: LocalFinancials;
  cities: CitiesState; needCities: () => void;
}) {
  const T = useTheme();
  const field = { background: T.ink, border: `1px solid ${T.line}`, color: T.text };
  const setRow = (i: number, patch: Partial<Draft["catRows"][number]>) => onDraft({ ...draft, catRows: draft.catRows.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <>
      <div>
        <Label htmlFor={`${idPrefix}-name`}>Name</Label>
        <FocusInput id={`${idPrefix}-name`} value={draft.name} onChange={(e) => onDraft({ ...draft, name: e.target.value })} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
              <CategoryOptions customCategories={financials.customCategories} />
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
      <StopFields idPrefix={idPrefix} places={draft.places} onPlaces={(places) => onDraft({ ...draft, places })} cities={cities} needCities={needCities} />
      <div>
        <Label htmlFor={`${idPrefix}-notes`}>Notes</Label>
        <textarea id={`${idPrefix}-notes`} value={draft.notes} onChange={(e) => onDraft({ ...draft, notes: e.target.value })} rows={3}
          className="w-full rounded-xl px-3 py-2.5 text-sm" style={{ background: T.panelSoft, border: `1px solid ${T.line}`, color: T.text }} />
      </div>
    </>
  );
}

export default function TripsScreen({ financials, onChange }: { financials: LocalFinancials; onChange: (f: LocalFinancials) => void }) {
  const T = useTheme();
  const trips = [...(financials.trips ?? [])].sort((a, b) => b.startDate.localeCompare(a.startDate));
  // Travel map plan, Phase 1b: grouped by the year each trip starts in, newest first (trips is already newest first).
  const years: [string, StoredTrip[]][] = [];
  for (const t of trips) {
    const y = t.startDate.slice(0, 4);
    if (years.at(-1)?.[0] === y) years.at(-1)![1].push(t); else years.push([y, [t]]);
  }

  // Travel map plan, Phase 1c: Map or List. Opens on Map once a trip has a country, otherwise on List, as Trips
  // always has (owner, 2026-11-05). The New trip form stays at the bottom in both.
  const hasPlaces = trips.some((t) => (t.stops ?? []).length > 0);
  const [view, setView] = useState<"map" | "list">(hasPlaces ? "map" : "list");
  const [Panel, setPanel] = useState<ComponentType<MapPanelProps> | null>(null);
  const [panelFailed, setPanelFailed] = useState(false);
  const [panelAttempt, setPanelAttempt] = useState(0);
  useEffect(() => {
    if (view !== "map" || Panel) return;
    let live = true;
    setPanelFailed(false);
    import("../travel/MapPanel").then((m) => { if (live) setPanel(() => m.default); }, () => { if (live) setPanelFailed(true); });
    return () => { live = false; };
  }, [view, Panel, panelAttempt]);
  // A trip's name in a country's sheet: its card in the List, focused (and scrolled to, where the browser can).
  const [showTripId, setShowTripId] = useState<string | null>(null);
  useEffect(() => {
    if (view !== "list" || !showTripId) return;
    const card = document.getElementById(`trip-card-${showTripId}`);
    card?.scrollIntoView?.({ block: "start" });
    card?.focus();
    setShowTripId(null);
  }, [view, showTripId]);
  const showTrip = useCallback((id: string) => { setView("list"); setShowTripId(id); }, []);
  // "Add a trip" (the Map view's empty state): the New trip form's Name.
  const addTrip = useCallback(() => {
    const name = document.getElementById("trip-name");
    name?.scrollIntoView?.({ block: "center" });
    name?.focus();
  }, []);
  const today = todayCalendarDay();
  const seg = (active: boolean) => ({ minHeight: 44, background: active ? T.brass20 : T.ink, border: `1px solid ${active ? T.brass : T.line}`, color: active ? T.text : T.mute });

  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState("");
  // One trip's edit form open at a time.
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY);
  const [editError, setEditError] = useState("");
  // Session 20, item 1: one card's foreign-cash form open at a time (the
  // Currency screen's own form components, with this card's trip preset).
  const [fxOpen, setFxOpen] = useState<{ tripId: string; form: "exchange" | "spend" } | null>(null);
  const codes = sheetCodes(financials);
  const toggleFx = (tripId: string, form: "exchange" | "spend") =>
    setFxOpen(fxOpen?.tripId === tripId && fxOpen.form === form ? null : { tripId, form });
  // Travel map plan, Phase 1b (D6): the city file, asked for the first time a form needs it (adding a country or a
  // city, or a city box getting focus), never on opening the screen. A failed load is asked again next time.
  const [cities, setCities] = useState<CitiesState>({ rows: null, failed: false });
  const [loadingCities, setLoadingCities] = useState(false);
  const needCities = useCallback(() => {
    if (cities.rows || loadingCities) return;
    setLoadingCities(true);
    loadCities().then(
      (rows) => setCities({ rows, failed: false }),
      () => setCities({ rows: null, failed: true }),
    ).finally(() => setLoadingCities(false));
  }, [cities.rows, loadingCities]);
  const fxBtn = (active: boolean) => ({ background: active ? T.jade + "22" : T.ink, border: `1px solid ${active ? T.jade : T.line}`, color: active ? T.jade : T.mute });

  function save() {
    const r = buildTrip(paramsOf(draft, cities.rows));
    if (!r.ok) { setError(REASONS[r.reason]); return; }
    onChange({ ...financials, trips: [...(financials.trips ?? []), r.trip] });
    setDraft(EMPTY); setError("");
  }

  function toggleEdit(trip: StoredTrip) {
    if (editing === trip.id) { setEditing(null); return; }
    setEditing(trip.id); setEditDraft(draftOf(trip)); setEditError("");
  }

  function saveEdit(trip: StoredTrip) {
    const r = editTrip(financials, trip.id, paramsOf(editDraft, cities.rows));
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
      {/* Design pass, 5b (owner, after the screenshots): in Map view the header and the toggle line up with the
          wide map (max-w-6xl); in List view they keep the 768 px column with the cards. */}
      <div className={`${view === "map" ? "max-w-6xl" : "max-w-3xl"} mx-auto space-y-6`}>
        <div>
          <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>ESSA</p>
          <h1 className="text-3xl mt-1" style={SERIF}>Trips</h1>
          <p className="text-sm mt-2" style={{ color: T.mute }}>A trip&apos;s budget against what it actually cost, in dollars at what you paid.</p>
        </div>

        <div className="flex gap-2">
          <button type="button" aria-pressed={view === "map"} onClick={() => setView("map")} className="px-4 rounded-xl text-sm font-semibold" style={seg(view === "map")}>Map</button>
          <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} className="px-4 rounded-xl text-sm font-semibold" style={seg(view === "list")}>List</button>
        </div>
      </div>

      {/* Design pass, 5 (owner, 2026-11-05): in Map view the map breaks out of the 768 px column to the main
          area's width, capped at max-w-6xl; the header above and the cards and forms below keep the column. */}
      {view === "map" && (
        <div className="max-w-6xl mx-auto mt-6">
        {Panel ? <Panel trips={trips} today={today} onAddTrip={addTrip} onShowTrip={showTrip} />
          : panelFailed ? (
            <div role="status" className="rounded-2xl p-5 space-y-3" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
              <p className="text-sm" style={{ color: T.text }}>Couldn&apos;t load the map. Your trips are safe. They&apos;re all in the list.</p>
              <button type="button" onClick={() => setPanelAttempt((n) => n + 1)} className="px-4 rounded-xl text-sm font-semibold" style={{ background: T.jade, color: T.ink, minHeight: 44 }}>Try again</button>
            </div>
          ) : <div className="w-full rounded-xl animate-pulse" style={{ aspectRatio: "960 / 468", background: T.panelSoft, border: `1px solid ${T.line}` }} />}
        </div>
      )}

      <div className="max-w-3xl mx-auto space-y-6 mt-6">
        {view === "list" && trips.length === 0 && <p className="text-sm" style={{ color: T.mute }}>No trips yet.</p>}

        {view === "list" && years.map(([year, inYear]) => (
          <Fragment key={year}>
          <h2 className="text-xl pt-2 tabular-nums" style={{ ...SERIF, color: T.mute }}>{year}</h2>
          {inYear.map((trip) => {
          const actual = tripActual(financials, trip);
          const left = trip.budgetUSD - actual.totalUSD;
          const euros = tripForeignSpends(financials, trip);
          const view = tripCategoryView(financials, trip);
          const untagged = untaggedDuringTrip(financials, trip);
          return (
            <section key={trip.id} id={`trip-card-${trip.id}`} tabIndex={-1} aria-label={trip.name} className="rounded-2xl p-5 space-y-3" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg" style={{ ...SERIF, color: T.text }}>{trip.name}</h3>
                  <p className="text-[11px]" style={{ color: T.mute }}>{`${dayOf(trip.startDate)} – ${dayOf(trip.endDate)}`}</p>
                  {trip.stops?.length ? <p className="text-xs mt-1" style={{ color: T.text }}>{placesLine(trip)}</p> : null}
                </div>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => toggleEdit(trip)} aria-expanded={editing === trip.id} className="text-xs underline" style={{ color: T.mute }}>Edit trip</button>
                  <button type="button" onClick={() => remove(trip)} className="text-xs" style={{ color: T.coral }}>Delete trip</button>
                </div>
              </div>
              {editing === trip.id && (
                <form aria-label="Edit trip" className="space-y-3 pb-3" style={{ borderBottom: `1px solid ${T.line}` }} onSubmit={(e) => { e.preventDefault(); saveEdit(trip); }}>
                  <TripFields idPrefix={`trip-edit-${trip.id}`} testIdPrefix="trip-edit" draft={editDraft} onDraft={setEditDraft} financials={financials} cities={cities} needCities={needCities} />
                  <div role="status">{editError && <p className="text-[11px]" style={{ color: T.coral }}>{editError}</p>}</div>
                  <button type="submit" className="w-full py-2 rounded-xl text-sm font-semibold" style={{ background: T.jade, color: T.ink }}>Save changes</button>
                </form>
              )}
              {/* Travel map plan, Phase 1b (owner, D9): a $0 budget is no budget. With spending, "Spent $X" in plain
                  text, never "over" in coral; with none, no line. A budget above 0 keeps its line. */}
              {trip.budgetUSD > 0 ? (
                <p className="text-sm tabular-nums" style={{ color: left < 0 ? T.coral : T.text }}>
                  {`Budget ${usd(trip.budgetUSD)} · spent ${usd(actual.totalUSD)} · ${left < 0 ? `${usd(-left)} over` : `${usd(left)} left`}`}
                </p>
              ) : !moneyEquals(actual.totalUSD, 0) && (
                <p className="text-sm tabular-nums" style={{ color: T.text }}>{`Spent ${usd(actual.totalUSD)}`}</p>
              )}
              {/* Session 22, item 1d (approved and merged in session 23, 2f5d30c): the trip by category. The exchanges count in the total
                  and in no category: they're the money moving, not a purchase. */}
              {(view.rows.length > 0 || view.exchangesUSD !== 0) && (
                <div className="space-y-0.5">
                  <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>By category</p>
                  <ul className="space-y-0.5">
                    {view.rows.map((r) => (
                      <li key={r.key || "_none"} className="text-[11px] tabular-nums" style={{ color: T.mute }}>{categoryLine(categoryLabel(r.key || undefined, financials.customCategories), r)}</li>
                    ))}
                  </ul>
                  {view.exchangesUSD !== 0 && (
                    <p className="text-[11px] tabular-nums" style={{ color: T.mute }}>{`Exchanges: ${usd(view.exchangesUSD)}, counted in the total, not by category`}</p>
                  )}
                </div>
              )}
              {euros.map((e) => (
                <p key={e.code} className="text-[11px] tabular-nums" style={{ color: T.mute }}>{`Spent from ${e.code} cash: ${fmtForeign(e.amount, e.code)}`}</p>
              ))}
              {/* Session 20, item 1: what's left, in view while spending (the sheet's approved heading). */}
              {codes.map((c) => (
                <p key={c} className="text-[11px] tabular-nums" style={{ color: T.text }}>{`${c} cash · balance ${fmtForeign(sheet(financials, c).balance, c)}`}</p>
              ))}
              <div className="flex flex-wrap gap-2">
                {codes.length > 0 && (
                  <button type="button" onClick={() => toggleFx(trip.id, "spend")} aria-expanded={fxOpen?.tripId === trip.id && fxOpen.form === "spend"}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={fxBtn(fxOpen?.tripId === trip.id && fxOpen.form === "spend")}>Spend from foreign cash</button>
                )}
                <button type="button" onClick={() => toggleFx(trip.id, "exchange")} aria-expanded={fxOpen?.tripId === trip.id && fxOpen.form === "exchange"}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={fxBtn(fxOpen?.tripId === trip.id && fxOpen.form === "exchange")}>Record an exchange</button>
              </div>
              {fxOpen?.tripId === trip.id && fxOpen.form === "spend" && (
                <SpendForm financials={financials} onChange={onChange} onDone={() => setFxOpen(null)} presetTripId={trip.id} idPrefix={`trip-${trip.id}-sp`} />
              )}
              {fxOpen?.tripId === trip.id && fxOpen.form === "exchange" && (
                <ExchangeForm financials={financials} onChange={onChange} onDone={() => setFxOpen(null)} presetTripId={trip.id} idPrefix={`trip-${trip.id}-ex`} />
              )}
              {actual.rows.length > 0 && (
                <ul className="space-y-1 pt-2" style={{ borderTop: `1px solid ${T.line}` }}>
                  {[...actual.rows].sort((a, b) => a.date.localeCompare(b.date)).map((t) => (
                    <li key={t.id} className="text-[11px] tabular-nums flex justify-between gap-2" style={{ color: T.text }}>
                      <span>{`${fmtDate(t.date)} · ${t.description}`}</span>
                      <span>{`${t.bucket === "INCOME" || t.bucket === "TRANSFER" ? "−" : ""}${t.currency === "LBP" ? `L£${t.amount.toLocaleString("en-US")}` : usd(t.amount)}${t.fx ? ` (${fmtForeign(t.fx.amount, t.fx.code)})` : ""}`}</span>
                    </li>
                  ))}
                </ul>
              )}
              {/* Session 22, item 1c (HELD; heading the owner's, the button DRAFT): spends dated inside the trip with no
                  trip tag, one tap each to tag them. Never income, a transfer or an exchange. */}
              {untagged.length > 0 && (
                <div className="space-y-1 pt-2" style={{ borderTop: `1px solid ${T.line}` }}>
                  <p id={`untagged-${trip.id}`} className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>Untagged during this trip</p>
                  <ul aria-labelledby={`untagged-${trip.id}`} className="space-y-1">
                    {untagged.map((t) => (
                      <li key={t.id} className="text-[11px] tabular-nums flex justify-between items-center gap-2" style={{ color: T.text }}>
                        <span>{`${fmtDate(t.date)} · ${t.description} · ${t.currency === "LBP" ? `L£${t.amount.toLocaleString("en-US")}` : usd(t.amount)}`}</span>
                        <button type="button" onClick={() => onChange(tagToTrip(financials, t.id, trip.id))} aria-label={`Add ${t.description} to this trip`}
                          className="px-2 py-1 rounded-md text-[10px] font-semibold flex-shrink-0" style={{ ...fxBtn(false), minHeight: 24 }}>Add to this trip</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {trip.notes && <p className="text-xs whitespace-pre-line" style={{ color: T.mute }}>{trip.notes}</p>}
            </section>
          );
        })}
          </Fragment>
        ))}

        {/* U7 (session 33): the New trip form after your trips, so they come first on a phone. */}
        <form aria-label="New trip" className="rounded-2xl p-5 space-y-3" style={{ background: T.panel, border: `1px solid ${T.line}` }} onSubmit={(e) => { e.preventDefault(); save(); }}>
          <p className="text-xs uppercase tracking-widest" style={{ color: T.mute }}>New trip</p>
          <TripFields idPrefix="trip" testIdPrefix="trip" draft={draft} onDraft={setDraft} financials={financials} cities={cities} needCities={needCities} />
          <div role="status">{error && <p className="text-[11px]" style={{ color: T.coral }}>{error}</p>}</div>
          <button type="submit" className="w-full py-2 rounded-xl text-sm font-semibold" style={{ background: T.jade, color: T.ink }}>Save trip</button>
        </form>
      </div>
    </main>
  );
}
