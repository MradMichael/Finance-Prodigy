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
import { geoArea, geoEqualEarth, geoPath } from "d3-geo";
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
  /** One per shape; `code` is null for the two no trip can name (N. Cyprus, Somaliland). */
  shapes: { code: string | null; d: string }[];
  /** The listed countries without a shape, at their centroid. */
  dots: { code: string; x: number; y: number }[];
  project: (lon: number, lat: number) => [number, number];
  /** Where on Earth an SVG point is, or null off the Earth's outline. */
  invert: (x: number, y: number) => [lon: number, lat: number] | null;
  /** The box around these countries' main land (and dots); the whole world when none is known. */
  bounds: (codes: string[]) => Box;
}

export const WORLD_URLS = ["/geo/countries-110m.json", "/geo/countries.json"] as const;
const WIDTH = 960;
const DOT_BOX = 8; // SVG units around a dot, so a lone small country still gets a box

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
  const shapes: World["shapes"] = [];
  for (const f of fc.features) {
    const code = f.id != null ? byNumeric.get(String(f.id).padStart(3, "0")) ?? null : f.properties.name === "Kosovo" ? "XK" : null;
    const d = path(f);
    if (!d) continue;
    shapes.push({ code, d });
    const poly = code ? largestPolygon(f.geometry) : null;
    if (code && poly) main.set(code, poly);
  }
  const project = (lon: number, lat: number) => projection([lon, lat]) as [number, number];
  const shaped = new Set(shapes.map((s) => s.code));
  const dots = list.rows.filter((r) => !shaped.has(r[0])).map(([code, , lat, lon]) => { const [x, y] = project(lon, lat); return { code, x, y }; });
  const dotBy = new Map(dots.map((d) => [d.code, d]));

  return {
    width: WIDTH, height, outline: path(sphere) ?? "", shapes, dots, project,
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
