// Travel map plan, Phase 1a (owner-approved): writes the bundled country list.
//
//   public/geo/countries.json  {"fields":["code","numeric","lat","lon"],"rows":[...]}
//     every ISO 3166-1 country and Kosovo (XK), its numeric code (null for XK,
//     which has none), and a centroid in WGS84 degrees to 2 decimals, taken on
//     the country's LARGEST piece of land (so France's sits in France, not
//     between it and French Guiana). The map draws the small countries its
//     110m shapes leave out as dots there.
//   lib/countryCodes.ts        the codes alone, for validating a trip's countries
//     without loading the file. lib/countries.test.ts keeps the two in step.
//
//   public/geo/countries-110m.json (Phase 1c; D5): world-atlas's 110m country
//     shapes, copied as is (ISO numeric ids; Natural Earth, public domain).
//     The map draws them; lib/map-file.test.ts checks it.
//   public/geo/cities15000.json (Phase 1b; D6: one file, loaded on first use)
//     {"fields":["name","country","lat","lon"],"source":"...","rows":[...]}
//     GeoNames cities15000 (every place of 15,000 people or more; CC BY 4.0,
//     credited on the About page): the name as GeoNames writes it, accents
//     kept; coordinates to 2 decimals; sorted by country, then name. Written
//     only when the GeoNames file is given. lib/cities-file.test.ts checks it.
//
// Run by hand, never during `next build` (it reads packages that aren't this
// app's dependencies). Sends nothing anywhere; reads only the files below.
//
//   npm install --prefix <dir> world-atlas@2.0.2 i18n-iso-countries@7.14.0 d3-geo@3.1.1 topojson-client@3.1.0
//   node client/scripts/build-geo.mjs <dir>
//   # and the city file, from https://download.geonames.org/export/dump/cities15000.zip, unzipped:
//   node client/scripts/build-geo.mjs <dir> path/to/cities15000.txt <the dump's date, YYYY-MM-DD>
//
// Sources: Natural Earth via world-atlas (public domain; ISC package), codes
// from i18n-iso-countries (MIT). Shapes are the 10m set, the most complete:
// shapes without an ISO code (N. Cyprus, Somaliland, bases, reefs) are ignored,
// except Kosovo, matched by name.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [deps, citiesTxt, citiesDate] = process.argv.slice(2);
if (!deps || (citiesTxt && !/^\d{4}-\d{2}-\d{2}$/.test(citiesDate ?? ""))) {
  console.error("usage: node client/scripts/build-geo.mjs <dir with node_modules> [<cities15000.txt> <YYYY-MM-DD>]");
  process.exit(2);
}
const req = createRequire(path.join(path.resolve(deps), "node_modules", "_.js"));
const { feature } = req("topojson-client");
const { geoArea, geoCentroid } = req("d3-geo");
const iso = req("i18n-iso-countries");
const topo = JSON.parse(readFileSync(req.resolve("world-atlas/countries-10m.json"), "utf8"));

const shapes = feature(topo, topo.objects.countries).features;
const byNumeric = new Map(shapes.filter((f) => f.id != null).map((f) => [String(f.id).padStart(3, "0"), f]));
const kosovo = shapes.find((f) => f.properties.name === "Kosovo");

/** The centroid of a shape's largest polygon, rounded to 2 decimals. */
function mainCentroid(f) {
  const g = f.geometry;
  const polys = g.type === "MultiPolygon" ? g.coordinates.map((c) => ({ type: "Polygon", coordinates: c })) : [g];
  const largest = polys.reduce((a, b) => (geoArea(b) > geoArea(a) ? b : a));
  const [lon, lat] = geoCentroid(largest);
  return [Math.round(lat * 100) / 100, Math.round(lon * 100) / 100];
}

// Eleven ISO territories have no shape of their own in Natural Earth: their land is drawn as part
// of France, the Netherlands, Norway, Australia or New Zealand. Their point is GeoNames' own for the
// territory (geonameId; feature PCLD, PCLIX or TERR), from download.geonames.org/export/dump/<CODE>.zip,
// read 2026-11-05 (CC BY 4.0), rounded to 2 decimals. The map shows them as dots.
const TERRITORIES = {
  BQ: [12.21, -68.29],  // 7626844 Bonaire, Saint Eustatius and Saba
  BV: [-54.43, 3.4],    // 3371123 Bouvet Island
  CC: [-12.16, 96.87],  // 1547376 Cocos (Keeling) Islands
  CX: [-10.5, 105.67],  // 2078138 Christmas Island
  GF: [4, -53],         // 3381670 Guyane
  GP: [16.25, -61.58],  // 3579143 Guadeloupe
  MQ: [14.67, -61],     // 3570311 Martinique
  RE: [-21.1, 55.6],    // 935317  Reunion
  SJ: [78, 20],         // 607072  Svalbard and Jan Mayen
  TK: [-9.17, -171.83], // 4031074 Tokelau
  YT: [-12.83, 45.17],  // 1024031 Mayotte
};

const rows = [], missing = [];
for (const code of Object.keys(iso.getAlpha2Codes()).sort()) {
  const numeric = code === "XK" ? null : iso.alpha2ToNumeric(code);
  const f = code === "XK" ? kosovo : byNumeric.get(numeric);
  if (f) rows.push([code, numeric, ...mainCentroid(f)]);
  else if (TERRITORIES[code]) rows.push([code, numeric, ...TERRITORIES[code]]);
  else missing.push(code);
}
if (missing.length) { console.error(`No shape for: ${missing.join(" ")}`); process.exit(1); }

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const json = `{"fields":["code","numeric","lat","lon"],"rows":[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]}\n`;
writeFileSync(path.join(root, "public", "geo", "countries.json"), json);
const ts = `// Generated by scripts/build-geo.mjs -- do not edit by hand (lib/countries.test.ts checks it).
// Every ISO 3166-1 alpha-2 code, and XK (Kosovo): the countries a trip can name.
export const COUNTRY_CODES: ReadonlySet<string> = new Set([
${rows.map((r) => r[0]).reduce((lines, c, i) => { if (i % 20 === 0) lines.push([]); lines[lines.length - 1].push(JSON.stringify(c)); return lines; }, []).map((l) => `  ${l.join(", ")},`).join("\n")}
]);
`;
writeFileSync(path.join(root, "lib", "countryCodes.ts"), ts);
writeFileSync(path.join(root, "public", "geo", "countries-110m.json"), readFileSync(req.resolve("world-atlas/countries-110m.json")));
console.log(`${rows.length} countries; countries.json ${Buffer.byteLength(json)} bytes`);

if (citiesTxt) {
  // GeoNames' tab-separated columns: 1 name, 4 latitude, 5 longitude, 8 country code.
  const known = new Set(rows.map((r) => r[0]));
  const round2 = (v) => Math.round(Number(v) * 100) / 100;
  const cities = readFileSync(citiesTxt, "utf8").split("\n").filter(Boolean).map((line) => {
    const c = line.split("\t");
    return [c[1].trim(), c[8], round2(c[4]), round2(c[5])];
  });
  const bad = cities.filter(([name, cc, lat, lon]) => !name || !known.has(cc) || !(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180));
  if (bad.length) { console.error(`Rows this app can't keep: ${bad.slice(0, 5).map((r) => JSON.stringify(r)).join(" ")}`); process.exit(1); }
  const key = (r) => `${r[1]}\u0000${r[0]}`;
  cities.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  const out = `{"fields":["name","country","lat","lon"],"source":"GeoNames cities15000, ${citiesDate}, CC BY 4.0","rows":[\n${cities.map((r) => JSON.stringify(r)).join(",\n")}\n]}\n`;
  writeFileSync(path.join(root, "public", "geo", "cities15000.json"), out);
  console.log(`${cities.length} cities; cities15000.json ${Buffer.byteLength(out)} bytes`);
}
