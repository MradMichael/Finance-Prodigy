"use client";

// Travel map plan, Phase 1c (owner-approved; wording APPROVED 2026-11-05): the
// world map, drawn from lib/worldMap.ts. Loaded only with the Map view or
// "Place on map" (a dynamic import), never with the Trips screen's own code.
//   - Visited (a trip there has started; D12): a soft brass fill, decoration
//     only, and a SOLID brass border. Planned-only: a DASHED brass border and no
//     brass fill. The border and its dash carry the meaning, not colour.
//   - Countries without a 110m shape are dots, each with a 44 px tap area.
//   - City markers: jade with an ink halo; planned ones hollow and dashed.
//   - "+" / "−" (read "Zoom in" / "Zoom out"), drag to move, "Show my countries".
//   - The picture is hidden from screen readers: the country lists below it
//     (MapPanel) are their route.
//   - With `onPoint` (Place on map), a tap gives back where on Earth it was.
// Units: the view box is in the world's SVG units; taps arrive in CSS px.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import type { World, Box } from "../../lib/worldMap";
import { cityMarkers, visitedCountries } from "../../lib/travel";
import type { StoredTrip } from "../../lib/trips";

const TAP_PX = 44; // a dot's tap area, across
const MARKER_PX = 4; // a city marker's radius
const DRAG_PX = 5; // further than this is a drag, not a tap
const MIN_WIDTH = 24; // the closest zoom, in SVG units

export default function TravelMap({ world, trips, today, onCountry, onPoint, selected }: {
  world: World; trips: StoredTrip[]; today: string;
  onCountry?: (code: string) => void;
  /** Place on map: a tap gives back its lon/lat (WGS84 degrees) instead of naming a country. */
  onPoint?: (lon: number, lat: number) => void;
  selected?: string | null;
}) {
  const T = useTheme();
  const full: Box = { x: 0, y: 0, width: world.width, height: world.height };
  const [view, setView] = useState<Box>(full);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; view: Box; moved: boolean } | null>(null);
  // The map's drawn width in CSS px, measured after layout and on resize (a phone's until then), so the tap
  // areas and markers keep their size in px at any zoom.
  const [drawnPx, setDrawnPx] = useState(375);
  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const measure = () => { const w = el.getBoundingClientRect().width; if (w > 0) setDrawnPx(w); };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const dragged = useRef(false);

  const { visited, planned } = useMemo(() => visitedCountries(trips, today), [trips, today]);
  const visitedSet = useMemo(() => new Set(visited), [visited]);
  const plannedSet = useMemo(() => new Set(planned), [planned]);
  const markers = useMemo(() => cityMarkers(trips, today), [trips, today]);
  const stateOf = (code: string | null) => (code && visitedSet.has(code) ? "visited" : code && plannedSet.has(code) ? "planned" : "none");

  const aspect = world.width / world.height;
  /** A view of this width centred on (cx, cy), clamped inside the world. */
  const viewAt = (cx: number, cy: number, width: number): Box => {
    if (width >= world.width) return full;
    const w = Math.max(MIN_WIDTH, width), h = w / aspect;
    return { x: Math.min(world.width - w, Math.max(0, cx - w / 2)), y: Math.min(world.height - h, Math.max(0, cy - h / 2)), width: w, height: h };
  };
  const zoom = (by: number) => setView((v) => viewAt(v.x + v.width / 2, v.y + v.height / 2, v.width * by));
  function showMine() {
    const b = world.bounds([...visited, ...planned]);
    const width = Math.max(b.width, b.height * aspect) * 1.2; // a margin round them, at the map's shape
    setView(viewAt(b.x + b.width / 2, b.y + b.height / 2, width));
  }

  /** SVG units per CSS px, at the map's drawn width (a phone's, before the first layout). */
  const rect = () => svgRef.current?.getBoundingClientRect();
  const unitsPerPx = () => view.width / drawnPx;

  function onPointerDown(e: React.PointerEvent) {
    drag.current = { x: e.clientX, y: e.clientY, view, moved: false };
    dragged.current = false;
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_PX) return;
    d.moved = true;
    const k = d.view.width / (rect()?.width || drawnPx);
    setView(viewAt(d.view.x + d.view.width / 2 - dx * k, d.view.y + d.view.height / 2 - dy * k, d.view.width));
  }
  function onPointerUp() {
    dragged.current = !!drag.current?.moved;
    drag.current = null;
  }
  /** A tap, unless it ended a drag. */
  const tap = (fn: () => void) => () => {
    if (dragged.current) { dragged.current = false; return; }
    fn();
  };
  function onSvgClick(e: React.MouseEvent) {
    if (!onPoint) return;
    if (dragged.current) { dragged.current = false; return; }
    const r = rect();
    if (!r?.width) return;
    const x = view.x + ((e.clientX - r.left) / r.width) * view.width, y = view.y + ((e.clientY - r.top) / r.height) * view.height;
    const p = world.invert(x, y);
    if (p) onPoint(p[0], p[1]);
  }

  const k = unitsPerPx();
  const border = { strokeWidth: 1.25, vectorEffect: "non-scaling-stroke" } as const;
  const dash = "3 2";
  const country = (code: string | null) => onPoint || !code || !onCountry ? undefined : tap(() => onCountry(code));
  const btn = { background: T.panel, border: `1px solid ${T.line}`, color: T.text, minWidth: 44, minHeight: 44 };

  return (
    <div className="space-y-2">
      <div className="relative w-full overflow-hidden rounded-xl" style={{ aspectRatio: `${world.width} / ${world.height}`, background: T.panel, border: `1px solid ${T.line}` }}>
        <svg ref={svgRef} aria-hidden="true" viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} preserveAspectRatio="xMidYMid meet"
          className="block w-full h-full touch-none select-none" style={{ cursor: onPoint ? "crosshair" : "grab" }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onClick={onSvgClick}>
          <path d={world.outline} fill={T.ink} />
          {world.shapes.map((s, i) => {
            const state = stateOf(s.code);
            return (
              <path key={s.code ?? `u${i}`} d={s.d} data-shape="" {...(s.code ? { "data-code": s.code } : {})} data-state={state}
                fill={state === "visited" ? T.brass30 : T.panelSoft}
                stroke={state === "none" ? T.line : T.brass}
                strokeWidth={state === "none" ? 0.5 : selected === s.code ? 2.5 : border.strokeWidth}
                vectorEffect="non-scaling-stroke"
                {...(state === "planned" ? { strokeDasharray: dash } : {})}
                onClick={country(s.code)} />
            );
          })}
          {world.dots.map((d) => {
            const state = stateOf(d.code);
            return (
              <g key={d.code}>
                <circle data-dot={d.code} data-state={state} cx={d.x} cy={d.y} r={(state === "none" ? 1.5 : 4) * k}
                  fill={state === "visited" ? T.brass30 : state === "planned" ? T.panelSoft : T.line}
                  stroke={state === "none" ? "none" : T.brass} {...(state === "none" ? {} : border)}
                  {...(state === "planned" ? { strokeDasharray: dash } : {})} />
                <circle data-hit={d.code} cx={d.x} cy={d.y} r={(TAP_PX / 2) * k} fill="transparent" onClick={country(d.code)} />
              </g>
            );
          })}
          {markers.map((m) => {
            const [x, y] = world.project(m.lon, m.lat);
            return (
              <circle key={`${m.countryCode}|${m.city ?? ""}|${m.lat}|${m.lon}`} data-city={m.city ?? ""} cx={x} cy={y} r={MARKER_PX * k}
                fill={m.planned ? "none" : T.jade} stroke={m.planned ? T.jade : T.ink} strokeWidth={1.5} vectorEffect="non-scaling-stroke"
                {...(m.planned ? { strokeDasharray: "2 1.5" } : {})} pointerEvents="none" />
            );
          })}
        </svg>
        <div className="absolute top-2 right-2 flex flex-col gap-1">
          <button type="button" aria-label="Zoom in" onClick={() => zoom(0.5)} className="rounded-lg text-lg leading-none" style={btn}>+</button>
          <button type="button" aria-label="Zoom out" onClick={() => zoom(2)} className="rounded-lg text-lg leading-none" style={btn}>−</button>
        </div>
      </div>
      <button type="button" onClick={showMine} className="text-xs underline" style={{ color: T.mute, minHeight: 44 }}>Show my countries</button>
    </div>
  );
}
