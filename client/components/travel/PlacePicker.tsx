"use client";

// Travel map plan, Phase 1c (owner-approved, D14; wording APPROVED 2026-11-05):
// "Place on map" for a typed city the list doesn't hold. Loaded by a dynamic
// import from StopFields, so the trip forms carry no map code. The map opens
// fitted to the row's country (StopFields shows "Tap the map where <city> is."
// and "Cancel" at once, before this code arrives); one tap is the
// city's point, WGS84 degrees rounded to 2 decimals (as the city file's are),
// checked by buildTrip as every point is. While
// the map files load, a placeholder; if they can't, the map's approved failure
// line and "Try again".
import { useEffect, useState } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { loadWorld, type World } from "../../lib/worldMap";
import TravelMap from "./TravelMap";

const round2 = (n: number) => Math.round(n * 100) / 100;

export default function PlacePicker({ countryCode, onPoint }: { countryCode: string; onPoint: (lat: number, lon: number) => void }) {
  const T = useTheme();
  const [world, setWorld] = useState<World | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setFailed(false);
    loadWorld().then((w) => { if (live) setWorld(w); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [attempt]);

  return (
    <div data-testid="place-map">
      {world ? (
        <TravelMap world={world} trips={[]} today="" fitTo={[countryCode]} onPoint={(lon, lat) => onPoint(round2(lat), round2(lon))} />
      ) : failed ? (
        <div role="status" className="space-y-2">
          <p className="text-xs" style={{ color: T.text }}>Couldn&apos;t load the map. Your trips are safe. They&apos;re all in the list.</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="px-4 rounded-xl text-sm font-semibold" style={{ background: T.jade, color: T.ink, minHeight: 44 }}>Try again</button>
        </div>
      ) : (
        <div className="w-full rounded-xl animate-pulse" style={{ aspectRatio: "960 / 468", background: T.panelSoft, border: `1px solid ${T.line}` }} />
      )}
    </div>
  );
}
