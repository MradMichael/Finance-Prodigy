"use client";

// Travel map plan, Phase 1c (owner-approved; wording APPROVED 2026-11-05): a
// country's sheet, opened from the map or the lists under it. A bottom sheet on
// a phone; from sm up, below the map at its width, its trips in two columns
// (design pass, 5). The country's name; its
// trips newest first (lib/travel.ts), each with its dates (DD/MM/YYYY, as the
// app shows dates), "Planned" for a trip that hasn't started (D12), and its
// cities there. A trip's name shows its card in the List. "✕" (read "Close")
// or Escape closes it; its heading takes focus when it opens.
import { useEffect, useRef } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { countryName } from "../../lib/places";
import { dayLabel } from "../../lib/period";
import { tripsInCountry } from "../../lib/travel";
import type { StoredTrip } from "../../lib/trips";

const dayOf = (iso: string) => dayLabel(new Date(`${iso}T12:00:00`));

export default function CountrySheet({ code, trips, today, onClose, onShowTrip }: {
  code: string; trips: StoredTrip[]; today: string; onClose: () => void; onShowTrip: (tripId: string) => void;
}) {
  const T = useTheme();
  const name = countryName(code);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [code]);
  const rows = tripsInCountry(trips, code, today);

  return (
    <div role="dialog" aria-label={name} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      // The bottom sheet clears the home indicator (PWA P2's rule, safe-area.test.ts: class and inset on one line).
      className="fixed inset-x-0 bottom-0 z-30 max-h-[60vh] overflow-y-auto rounded-t-2xl p-5 space-y-3 sm:static sm:z-auto sm:max-h-none sm:rounded-2xl" style={{ background: T.panel, border: `1px solid ${T.line}`, paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}>
      <div className="flex items-start justify-between gap-3">
        <h3 ref={heading} tabIndex={-1} className="text-lg outline-none" style={{ fontFamily: "Spectral, Georgia, serif", color: T.text }}>{name}</h3>
        <button type="button" onClick={onClose} aria-label="Close" className="text-lg leading-none" style={{ color: T.mute, minWidth: 44, minHeight: 44 }}>✕</button>
      </div>
      <ul className="space-y-3 sm:space-y-0 sm:grid sm:grid-cols-2 sm:gap-x-6 sm:gap-y-3">
        {rows.map(({ trip, cities, planned }) => (
          <li key={trip.id} className="space-y-0.5">
            <button type="button" onClick={() => onShowTrip(trip.id)} className="text-sm underline text-left" style={{ color: T.text, minHeight: 44 }}>{trip.name}</button>
            <p className="text-[11px] tabular-nums" style={{ color: T.mute }}>{`${dayOf(trip.startDate)} – ${dayOf(trip.endDate)}`}</p>
            {planned && <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: T.brass }}>Planned</p>}
            {cities.length > 0 && <p className="text-xs" style={{ color: T.text }}>{cities.join(", ")}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
