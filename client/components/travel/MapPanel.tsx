"use client";

// Travel map plan, Phase 1c (owner-approved; wording APPROVED 2026-11-05): the
// Map view's panel. Loaded only by a dynamic import when the Map view opens, so
// neither the Trips screen nor the Overview carries the map's code.
//   - No trip has a country: the approved empty state and "Add a trip", and
//     nothing is fetched.
//   - Otherwise the map files load (lib/worldMap.ts): a placeholder the map's
//     shape while they do (brief §5: honest loading, no spinner forever), "Still
//     loading the map…" past 10 seconds, and on failure the approved line with
//     "Try again". The trips are never affected; the List has them all.
//   - Under the map, the keyboard and screen-reader route (the map itself is
//     hidden from them): "Countries visited (N)", N visited only, and below it
//     "Planned (N)" for countries with only planned trips (owner). Either list,
//     or the map, opens a country's sheet (CountrySheet).
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { loadWorld, type World } from "../../lib/worldMap";
import type { StoredTrip } from "../../lib/trips";
import { visitedCountries } from "../../lib/travel";
import { countryName } from "../../lib/places";
import TravelMap from "./TravelMap";
import CountrySheet from "./CountrySheet";

const SLOW_MS = 10_000;

export default function MapPanel({ trips, today, onAddTrip, onShowTrip }: {
  trips: StoredTrip[]; today: string; onAddTrip: () => void; onShowTrip: (tripId: string) => void;
}) {
  const T = useTheme();
  const hasPlaces = trips.some((t) => (t.stops ?? []).length > 0);
  const [world, setWorld] = useState<World | null>(null);
  const [failed, setFailed] = useState(false);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const lists = useMemo(() => visitedCountries(trips, today), [trips, today]);

  useEffect(() => {
    if (!hasPlaces || world) return;
    let live = true;
    setFailed(false); setSlow(false);
    const timer = setTimeout(() => { if (live) setSlow(true); }, SLOW_MS);
    loadWorld().then((w) => { if (live) setWorld(w); }, () => { if (live) setFailed(true); }).finally(() => clearTimeout(timer));
    return () => { live = false; clearTimeout(timer); };
  }, [hasPlaces, world, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (!hasPlaces) {
    return (
      <div className="rounded-2xl p-5 space-y-3" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
        <p className="text-sm" style={{ color: T.text }}>Your travel map. Add a trip with the countries and cities you visited and they&apos;ll appear here. The map is drawn on your device; your places aren&apos;t sent to any map service.</p>
        <button type="button" onClick={onAddTrip} className="px-4 rounded-xl text-sm font-semibold" style={{ background: T.jade, color: T.ink, minHeight: 44 }}>Add a trip</button>
      </div>
    );
  }
  if (failed) {
    return (
      <div role="status" className="rounded-2xl p-5 space-y-3" style={{ background: T.panel, border: `1px solid ${T.line}` }}>
        <p className="text-sm" style={{ color: T.text }}>Couldn&apos;t load the map. Your trips are safe. They&apos;re all in the list.</p>
        <button type="button" onClick={retry} className="px-4 rounded-xl text-sm font-semibold" style={{ background: T.jade, color: T.ink, minHeight: 44 }}>Try again</button>
      </div>
    );
  }
  if (!world) {
    return (
      <div className="space-y-2">
        <div data-map-placeholder="" className="w-full rounded-xl animate-pulse" style={{ aspectRatio: "960 / 468" /* the map's shape: Equal Earth, 960 wide, measured 468 tall (lib/worldMap.ts) */, background: T.panelSoft, border: `1px solid ${T.line}` }} />
        <div role="status">{slow && <p className="text-xs" style={{ color: T.mute }}>Still loading the map…</p>}</div>
      </div>
    );
  }
  const byName = (codes: string[]) => codes.map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name));
  const list = (title: string, codes: string[]) => (
    <div className="space-y-2">
      <h3 className="text-[10px] uppercase tracking-widest font-medium" style={{ color: T.mute }}>{title}</h3>
      <ul className="flex flex-wrap gap-2">
        {byName(codes).map((c) => (
          <li key={c.code}>
            <button type="button" onClick={() => setSelected(c.code)} aria-pressed={selected === c.code} className="px-3 rounded-lg text-xs"
              style={{ minHeight: 44, background: selected === c.code ? T.brass20 : T.ink, border: `1px solid ${selected === c.code ? T.brass : T.line}`, color: T.text }}>{c.name}</button>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div className="space-y-4">
      {/* Design pass, 5: the sheet opens below the map at its width (a bottom sheet on a phone), never beside it. */}
      <div className="space-y-4">
        <TravelMap world={world} trips={trips} today={today} onCountry={setSelected} selected={selected} fitTo={lists.visited} />
        {selected && <CountrySheet code={selected} trips={trips} today={today} onClose={() => setSelected(null)} onShowTrip={onShowTrip} />}
      </div>
      {list(`Countries visited (${lists.visited.length})`, lists.visited)}
      {lists.planned.length > 0 && list(`Planned (${lists.planned.length})`, lists.planned)}
    </div>
  );
}
