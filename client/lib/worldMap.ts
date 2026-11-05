// Travel map plan, Phase 1c (owner-approved, D5): the map's geometry, so the
// map component only draws. Built from the two bundled files: the country
// shapes (public/geo/countries-110m.json, world-atlas: ISO numeric ids) and the
// country list (public/geo/countries.json: alpha-2 code, numeric, centroid).
// Equal Earth projection, fitted to an SVG space 960 units wide.
// Units: lon/lat are WGS84 degrees; x/y and boxes are SVG units.
// A country with no 110m shape (Malta, Singapore, ...) is a dot at its centroid.
// The view is fitted to each country's LARGEST piece of land, as the centroids
// are, so France's box isn't stretched to French Guiana.
// Both files are fetched once from this app's own site by their paths alone;
// both are precached by the service worker (sw/build-sw.mjs), so the map works
// offline after one visit.
import { geoArea, geoContains, geoDistance, geoEqualEarth, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { Feature, Geometry, MultiPolygon, Polygon } from "geojson";

type ListFile = { rows: [code: string, numeric: string | null, lat: number, lon: number][] };
export interface Box { x: number; y: number; width: number; height: number }
export interface World {
  width: number;
  height: number;
  /** The Earth's outline, for the sea. */
  outline: string;
  /** The listed countries without a shape, at their centroid. */
  dots: { code: string; x: number; y: number }[];
  project: (lon: number, lat: number) => [number, number];
  /** Where on Earth an SVG point is, or null off the Earth's outline. */
  invert: (x: number, y: number) => [lon: number, lat: number] | null;
  /** The box around these countries' main land (and dots); the whole world when none is known. */
  bounds: (codes: string[]) => Box;
  /**
   * Design pass, 4 (rule B): every shape in pieces, one path each, each country's mainland (its largest
   * piece) first. `code` is null for the two shapes no trip can name.
   */
  pieces: { code: string | null; index: number; d: string }[];
  /** A country's pieces, in `pieces` order: mainland, home (within 650 km of the chain) or overseas. Worked out on first use. */
  roles: (code: string) => PieceRole[];
  /**
   * Each piece's group, in `pieces` order: 0 for the mainland and home pieces; overseas pieces within 650 km
   * of each other share a group (Hawaii's islands; Alaska with its islands; Svalbard), numbered from 1.
   * A group lights as a whole.
   */
  groups: (code: string) => number[];
  /** One piece's box (design pass, 4c: the views fit what lights). */
  pieceBox: (code: string, index: number) => Box | null;
  /** The index of the country's piece holding this point (50 km of slack for coarse coasts), or null. */
  locate: (code: string, lon: number, lat: number) => number | null;
  /** A territory with no shape of its own (TERRITORIES): the piece of another country's shape that holds its point, or null. */
  territory: (code: string) => { code: string; index: number } | null;
}

export const WORLD_URLS = ["/geo/countries-110m.json", "/geo/countries.json"] as const;
const WIDTH = 960;
const DOT_BOX = 8; // SVG units around a dot, so a lone small country still gets a box
export type PieceRole = "mainland" | "home" | "overseas";
const EARTH_KM = 6371;
/** Rule B (owner, 2026-11-05): a piece this close to the mainland, or to another home piece, is home. */
export const HOME_KM = 650;
/** 110m coastlines are coarse: a city this far outside a piece's outline still counts as in it. */
export const SLACK_KM = 50;
/**
 * The ISO territories with no shape of their own in Natural Earth (scripts/build-geo.mjs's TERRITORIES;
 * lib/worldMap.pieces.test.ts keeps the two in step). Only these map onto another country's piece: a
 * country with its own dot (Singapore) never lights its neighbour's shape, however close.
 */
export const TERRITORIES = ["BQ", "BV", "CC", "CX", "GF", "GP", "MQ", "RE", "SJ", "TK", "YT"] as const;

const ringKm = (a: number[][], b: number[][], stopAt: number) => {
  let m = Infinity;
  for (const p of a) for (const q of b) {
    const d = geoDistance(p as [number, number], q as [number, number]) * EARTH_KM;
    if (d < m) { m = d; if (m <= stopAt) return m; }
  }
  return m;
};
const pointKm = (ring: number[][], lon: number, lat: number) => {
  let m = Infinity;
  for (const p of ring) m = Math.min(m, geoDistance(p as [number, number], [lon, lat]) * EARTH_KM);
  return m;
};

function largestPolygon(g: Geometry): Polygon | null {
  if (g.type === "Polygon") return g;
  if (g.type !== "MultiPolygon") return null;
  const polys = (g as MultiPolygon).coordinates.map((coordinates): Polygon => ({ type: "Polygon", coordinates }));
  return polys.reduce((a, b) => (geoArea(b) > geoArea(a) ? b : a));
}

export function buildWorld(topo: unknown, list: ListFile): World {
  const t = topo as Topology<{ countries: GeometryCollection<{ name: string }> }>;
  const fc = feature(t, t.objects.countries) as unknown as { features: Feature<Geometry, { name: string }>[] };
  const sphere = { type: "Sphere" } as const;
  const projection = geoEqualEarth().fitWidth(WIDTH, sphere);
  const path = geoPath(projection);
  const height = Math.ceil(path.bounds(sphere)[1][1]);
  const byNumeric = new Map(list.rows.filter((r) => r[1]).map((r) => [r[1]!, r[0]]));

  const main = new Map<string, Polygon>();
  // The codes that have a shape (a listed country without one is a dot). Design pass: the per-shape paths are
  // gone; the map draws pieces.
  const shaped = new Set<string | null>();
  const pieces: World["pieces"] = [];
  const polysBy = new Map<string, Polygon[]>();
  for (const f of fc.features) {
    const code = f.id != null ? byNumeric.get(String(f.id).padStart(3, "0")) ?? null : f.properties.name === "Kosovo" ? "XK" : null;
    const d = path(f);
    if (!d) continue;
    shaped.add(code);
    const poly = code ? largestPolygon(f.geometry) : null;
    if (code && poly) main.set(code, poly);
    // Its pieces, largest first, so index 0 is the mainland.
    const g = f.geometry;
    const polys = (g.type === "Polygon" ? [g as Polygon] : g.type === "MultiPolygon" ? (g as MultiPolygon).coordinates.map((coordinates): Polygon => ({ type: "Polygon", coordinates })) : [])
      .map((pg) => ({ pg, area: geoArea(pg) })).sort((a, b) => b.area - a.area).map((x) => x.pg);
    polys.forEach((pg, index) => { const pd = path(pg); if (pd) pieces.push({ code, index, d: pd }); });
    if (code) polysBy.set(code, polys);
  }
  const project = (lon: number, lat: number) => projection([lon, lat]) as [number, number];
  const dots = list.rows.filter((r) => !shaped.has(r[0])).map(([code, , lat, lon]) => { const [x, y] = project(lon, lat); return { code, x, y }; });
  const dotBy = new Map(dots.map((d) => [d.code, d]));

  const rolesBy = new Map<string, PieceRole[]>();
  const roles = (code: string): PieceRole[] => {
    const known = rolesBy.get(code);
    if (known) return known;
    const polys = polysBy.get(code) ?? [];
    const home = new Set<number>(polys.length ? [0] : []);
    for (let grew = true; grew;) {
      grew = false;
      polys.forEach((pg, i) => {
        if (home.has(i)) return;
        if ([...home].some((h) => ringKm(pg.coordinates[0], polys[h].coordinates[0], HOME_KM) <= HOME_KM)) { home.add(i); grew = true; }
      });
    }
    const out = polys.map((_, i): PieceRole => (i === 0 ? "mainland" : home.has(i) ? "home" : "overseas"));
    rolesBy.set(code, out);
    return out;
  };
  const groupsBy = new Map<string, number[]>();
  const groups = (code: string): number[] => {
    const known = groupsBy.get(code);
    if (known) return known;
    const r = roles(code), polys = polysBy.get(code) ?? [];
    const out: number[] = r.map((role) => (role === "overseas" ? -1 : 0));
    let next = 1;
    out.forEach((g, i) => {
      if (g !== -1) return;
      const queue = [i];
      out[i] = next;
      while (queue.length) {
        const k = queue.pop()!;
        out.forEach((h, j) => {
          if (h === -1 && ringKm(polys[k].coordinates[0], polys[j].coordinates[0], HOME_KM) <= HOME_KM) { out[j] = next; queue.push(j); }
        });
      }
      next++;
    });
    groupsBy.set(code, out);
    return out;
  };
  const locate = (code: string, lon: number, lat: number): number | null => {
    const polys = polysBy.get(code);
    if (!polys) return null;
    const inside = polys.findIndex((pg) => geoContains(pg, [lon, lat]));
    if (inside >= 0) return inside;
    let best: number | null = null, bestKm = SLACK_KM;
    polys.forEach((pg, i) => { const km = pointKm(pg.coordinates[0], lon, lat); if (km <= bestKm) { bestKm = km; best = i; } });
    return best;
  };
  const listed = new Map(list.rows.map((r) => [r[0], r]));
  const territories = new Map<string, { code: string; index: number } | null>();
  const territory = (code: string) => {
    if (territories.has(code)) return territories.get(code)!;
    const row = listed.get(code);
    let found: { code: string; index: number } | null = null;
    if (row && (TERRITORIES as readonly string[]).includes(code) && !polysBy.has(code)) {
      // Inside a piece first; else within the same slack a city gets (Svalbard's point, 78 N 20 E, sits just
      // outside the coarse 110m outline).
      for (const [other, polys] of polysBy) {
        const index = polys.findIndex((pg) => geoContains(pg, [row[3], row[2]]));
        if (index >= 0) { found = { code: other, index }; break; }
      }
      if (!found) for (const other of polysBy.keys()) {
        const index = locate(other, row[3], row[2]);
        if (index !== null) { found = { code: other, index }; break; }
      }
    }
    territories.set(code, found);
    return found;
  };

  return {
    pieces, roles, groups, locate, territory,
    pieceBox: (code, index) => {
      const pg = polysBy.get(code)?.[index];
      if (!pg) return null;
      const [[x0, y0], [x1, y1]] = path.bounds(pg);
      return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    },
    width: WIDTH, height, outline: path(sphere) ?? "", dots, project,
    invert: (x, y) => {
      const p = projection.invert?.([x, y]);
      if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) return null;
      const [bx, by] = project(p[0], p[1]);
      return Math.hypot(bx - x, by - y) < 0.5 ? [p[0], p[1]] : null; // off the outline, the inverse doesn't come back
    },
    bounds: (codes) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const c of codes) {
        const poly = main.get(c), dot = dotBy.get(c);
        const [[a, b], [cc, d]] = poly ? path.bounds(poly) : dot ? [[dot.x - DOT_BOX, dot.y - DOT_BOX], [dot.x + DOT_BOX, dot.y + DOT_BOX]] : [[Infinity, Infinity], [-Infinity, -Infinity]];
        x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, cc); y1 = Math.max(y1, d);
      }
      return Number.isFinite(x0) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : { x: 0, y: 0, width: WIDTH, height };
    },
  };
}

let pending: Promise<World> | null = null;
/** Both map files, fetched once. A failed load (or an error page) is forgotten, so the next call asks again. */
export function loadWorld(): Promise<World> {
  return (pending ??= Promise.all(WORLD_URLS.map(async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
  }))
    .then(([topo, list]) => buildWorld(topo, list as ListFile))
    .catch((err) => { pending = null; throw err; }));
}

/** Tests only: forget a loaded world. */
export function forgetWorld(): void {
  pending = null;
}
