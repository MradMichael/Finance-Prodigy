"use client";

// Travel map plan, Phase 1b (owner-approved; wording APPROVED 2026-11-05): a
// trip form's countries and cities, in route order. Each country is a row
// (France, Italy, then France again is three rows); each holds its cities. A
// country is picked by name; a city is picked from the one bundled file or
// typed. A typed city the file holds (accents aside) takes its spelling and
// point; one it doesn't is kept as typed. Phase 1c (D14): such a city can be
// given a point with "Place on map", a tap on the map (PlacePicker, loaded only
// by a dynamic import, so the trip forms carry no map code). Nothing here
// writes a trip: stopsOf hands buildTrip what the rows say, and buildTrip
// checks it.
import { useEffect, useState, type ComponentType } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { Label, FocusInput } from "../form/Primitives";
import { countryName, findCity, foldName, searchCities, searchCountries, type CityRow } from "../../lib/places";
import type { TripStop, TripStopInput } from "../../lib/trips";

/** `placed`: the point came from a tap (Place on map), not from the list, so correcting the name keeps it. */
export interface CityDraft { key: string; id?: string; name: string; point?: { lat: number; lon: number }; placed?: boolean }
export interface PlaceDraft { key: string; id?: string; countryCode?: string; countryText: string; cities: CityDraft[] }
/** The city file as the screen holds it: not asked for yet, loading, there, or failed. */
export interface CitiesState { rows: CityRow[] | null; failed: boolean }

let seq = 0;
const key = () => `p${++seq}`;

/** A trip's stops as rows: consecutive stops in one country share a row. */
export function placesOf(stops: TripStop[] | undefined): PlaceDraft[] {
  const out: PlaceDraft[] = [];
  for (const s of stops ?? []) {
    const last = out[out.length - 1];
    const row = last && last.countryCode === s.countryCode && s.city && last.cities.length > 0 ? last
      : (out.push({ key: key(), countryCode: s.countryCode, countryText: countryName(s.countryCode), cities: [] }), out[out.length - 1]);
    if (s.city) row.cities.push({ key: key(), id: s.id, name: s.city, ...(s.lat !== undefined && s.lon !== undefined ? { point: { lat: s.lat, lon: s.lon } } : {}) });
    else row.id = s.id;
  }
  return out;
}

/** The country a typed, unpicked name is: only an exact name (accents and case aside), never its text as a code. */
function countryOfText(text: string): string | undefined {
  const q = foldName(text);
  return q ? searchCountries(text, 400).find((c) => foldName(c.name) === q)?.code : undefined;
}

/**
 * What the rows say, for buildTrip. An empty row never filled in adds nothing.
 * A country typed but not a country's name is passed as "" so buildTrip
 * refuses it ("stops"), never dropped silently. A city with no point takes the
 * file's spelling and point when the file holds it.
 */
export function stopsOf(places: PlaceDraft[], rows: CityRow[] | null): TripStopInput[] {
  const out: TripStopInput[] = [];
  for (const p of places) {
    const code = p.countryCode ?? countryOfText(p.countryText);
    const named = p.cities.filter((c) => c.name.trim());
    if (!code) { if (p.countryText.trim() || named.length) out.push({ countryCode: "" }); continue; }
    if (named.length === 0) { out.push({ ...(p.id ? { id: p.id } : {}), countryCode: code }); continue; }
    for (const c of named) {
      const listed = c.point ? undefined : rows ? findCity(rows, code, c.name) : undefined;
      const point = c.point ?? (listed ? { lat: listed[2], lon: listed[3] } : undefined);
      out.push({ ...(c.id ? { id: c.id } : {}), countryCode: code, city: listed ? listed[0] : c.name.trim(), ...(point ?? {}) });
    }
  }
  return out;
}

const TAP = { minHeight: 44 } as const;
type PickerProps = { countryCode: string; onPoint: (lat: number, lon: number) => void };

export default function StopFields({ idPrefix, places, onPlaces, cities, needCities }: {
  idPrefix: string; places: PlaceDraft[]; onPlaces: (p: PlaceDraft[]) => void; cities: CitiesState; needCities: () => void;
}) {
  const T = useTheme();
  const setPlace = (i: number, patch: Partial<PlaceDraft>) => onPlaces(places.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const setCity = (i: number, k: number, patch: Partial<CityDraft>) =>
    setPlace(i, { cities: places[i].cities.map((c, j) => (j === k ? { ...c, ...patch } : c)) });
  const pill = { background: T.ink, border: `1px solid ${T.line}`, color: T.text };
  // Place on map: one city's picker open at a time (its row's key), its code fetched the first time.
  const [placing, setPlacing] = useState<string | null>(null);
  const [Picker, setPicker] = useState<ComponentType<PickerProps> | null>(null);
  useEffect(() => {
    if (!placing || Picker) return;
    let live = true;
    import("./PlacePicker").then((m) => { if (live) setPicker(() => m.default); }, () => { if (live) setPlacing(null); });
    return () => { live = false; };
  }, [placing, Picker]);

  return (
    <div className="space-y-3">
      <p className="text-[10px] uppercase tracking-widest font-medium" style={{ color: T.mute }}>Countries and cities</p>
      {cities.failed && <p role="status" className="text-[11px]" style={{ color: T.mute }}>The city list couldn&apos;t load. You can still type a city.</p>}
      {places.map((p, i) => (
        <div key={p.key} className="rounded-xl p-3 space-y-2" style={{ border: `1px solid ${T.line}` }}>
          {p.countryCode ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm" style={{ color: T.text }}>{countryName(p.countryCode)}</span>
              <button type="button" onClick={() => onPlaces(places.filter((_, j) => j !== i))} aria-label={`Remove ${countryName(p.countryCode)}`}
                className="text-xs underline px-2" style={{ ...TAP, color: T.mute }}>Remove</button>
            </div>
          ) : (
            <div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Label htmlFor={`${idPrefix}-country-${p.key}`}>Country</Label>
                  <FocusInput id={`${idPrefix}-country-${p.key}`} value={p.countryText} placeholder="Type a country" autoComplete="off"
                    onChange={(e) => setPlace(i, { countryText: e.target.value })} />
                </div>
                <button type="button" onClick={() => onPlaces(places.filter((_, j) => j !== i))} {...(p.countryText.trim() ? { "aria-label": `Remove ${p.countryText.trim()}` } : {})}
                  className="text-xs underline px-2" style={{ ...TAP, color: T.mute }}>Remove</button>
              </div>
              {p.countryText.trim() && (
                <ul className="flex flex-wrap gap-2 mt-2">
                  {searchCountries(p.countryText).map((c) => (
                    <li key={c.code}>
                      <button type="button" onClick={() => setPlace(i, { countryCode: c.code, countryText: c.name })} className="px-3 rounded-lg text-xs" style={{ ...TAP, ...pill }}>{c.name}</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {p.countryCode && p.cities.map((c, k) => {
            const typed = c.name.trim();
            const offered = cities.rows && typed && !c.point ? searchCities(cities.rows, p.countryCode!, typed) : [];
            const notListed = cities.rows && typed && !c.point && !findCity(cities.rows, p.countryCode!, typed);
            // A typed city with no point from the list (it isn't there, or the list didn't load), or one placed by a tap.
            const canPlace = !!typed && (c.placed || (!c.point && (!cities.rows || !findCity(cities.rows, p.countryCode!, typed))));
            return (
              <div key={c.key}>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Label htmlFor={`${idPrefix}-city-${c.key}`}>City</Label>
                    <FocusInput id={`${idPrefix}-city-${c.key}`} value={c.name} placeholder="Type a city" autoComplete="off" onFocus={needCities}
                      onChange={(e) => setCity(i, k, c.placed ? { name: e.target.value } : { name: e.target.value, point: undefined })} />
                  </div>
                  <button type="button" onClick={() => setPlace(i, { cities: p.cities.filter((_, j) => j !== k) })} {...(typed ? { "aria-label": `Remove ${typed}` } : {})}
                    className="text-xs underline px-2" style={{ ...TAP, color: T.mute }}>Remove</button>
                </div>
                {offered.length > 0 && (
                  <ul className="flex flex-wrap gap-2 mt-2">
                    {offered.map((r) => (
                      <li key={`${r[0]}|${r[2]}|${r[3]}`}>
                        <button type="button" onClick={() => setCity(i, k, { name: r[0], point: { lat: r[2], lon: r[3] } })} className="px-3 rounded-lg text-xs" style={{ ...TAP, ...pill }}>{r[0]}</button>
                      </li>
                    ))}
                  </ul>
                )}
                {notListed && <p className="text-[11px] mt-1" style={{ color: T.mute }}>Not in the list. It&apos;ll be saved as you typed it. Use Place on map to show it on the map.</p>}
                {canPlace && placing !== c.key && (
                  <button type="button" onClick={() => setPlacing(c.key)} className="text-xs underline" style={{ ...TAP, color: T.mute }}>Place on map</button>
                )}
                {placing === c.key && (
                  <div className="space-y-2 mt-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs" style={{ color: T.text }}>{`Tap the map where ${typed} is.`}</p>
                      <button type="button" onClick={() => setPlacing(null)} className="text-xs underline px-2" style={{ ...TAP, color: T.mute }}>Cancel</button>
                    </div>
                    {Picker
                      ? <Picker countryCode={p.countryCode!} onPoint={(lat, lon) => { setCity(i, k, { point: { lat, lon }, placed: true }); setPlacing(null); }} />
                      : <div className="w-full rounded-xl animate-pulse" style={{ aspectRatio: "960 / 468", background: T.panelSoft, border: `1px solid ${T.line}` }} />}
                  </div>
                )}
              </div>
            );
          })}
          {p.countryCode && (
            <button type="button" onClick={() => { needCities(); setPlace(i, { cities: [...p.cities, { key: key(), name: "" }] }); }}
              className="text-xs underline" style={{ ...TAP, color: T.mute }}>Add a city</button>
          )}
        </div>
      ))}
      <button type="button" onClick={() => { needCities(); onPlaces([...places, { key: key(), countryText: "", cities: [] }]); }}
        className="text-xs underline" style={{ ...TAP, color: T.mute }}>Add a country</button>
    </div>
  );
}
