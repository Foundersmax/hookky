// Generates src/mograph/world.ts: a dotted land mask of the world (equirectangular) and a small
// gazetteer (country centroids from Natural Earth, plus major cities) for the map templates.
// Data: world-atlas (Natural Earth, public domain). Run: npx tsx scripts/gen-world.ts
import fs from "node:fs";
import { createRequire } from "node:module";
import { feature } from "topojson-client";
const require = createRequire(import.meta.url);
const land = feature(require("world-atlas/land-50m.json"), require("world-atlas/land-50m.json").objects.land) as any;
const countries = feature(require("world-atlas/countries-110m.json"), require("world-atlas/countries-110m.json").objects.countries) as any;

const COLS = 180, LAT0 = 80, LAT1 = -58, STEP = 360 / COLS, ROWS = Math.round((LAT0 - LAT1) / STEP);
const polys = (g: any): number[][][][] => (g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []);
const ring = (pt: number[], r: number[][]) => {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const inPoly = (pt: number[], p: number[][][]) => ring(pt, p[0]) && !p.slice(1).some((h) => ring(pt, h));
// Rings that straddle the antimeridian (Wrangel Island, Chukotka) are unwrapped to 0..360°;
// the point is then tested at lon and lon + 360.
const unwrap = (p: number[][][]) => (p[0].some((q) => q[0] > 170) && p[0].some((q) => q[0] < -170) ? p.map((r) => r.map(([x, y]) => [x < -90 ? x + 360 : x, y])) : p);
const landPolys = land.features.flatMap((f: any) => polys(f.geometry)).map(unwrap);
const bytes = new Uint8Array(Math.ceil((COLS * ROWS) / 8));
let n = 0;
for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++) {
    const pt = [-180 + (c + 0.5) * STEP + 0.0071, LAT0 - (r + 0.5) * STEP + 0.0137]; // off-grid: no point sits on an edge
    if (landPolys.some((p: number[][][]) => inPoly(pt, p) || inPoly([pt[0] + 360, pt[1]], p))) {
      const k = r * COLS + c;
      bytes[k >> 3] |= 1 << (k & 7);
      n++;
    }
  }

// Country centroids: the area-weighted centre of each country's largest polygon.
const places: Record<string, [number, number]> = {};
for (const f of countries.features) {
  const name = String(f.properties?.name ?? "").toLowerCase();
  if (!name) continue;
  const ps = polys(f.geometry);
  let best: number[][] | null = null, bestA = 0;
  for (const p of ps) {
    const r = p[0];
    let a = 0;
    for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
    if (Math.abs(a) > bestA) (bestA = Math.abs(a)), (best = r);
  }
  if (!best) continue;
  let A = 0, cx = 0, cy = 0;
  for (let i = 0; i < best.length - 1; i++) {
    const [x0, y0] = best[i], [x1, y1] = best[i + 1];
    const k = x0 * y1 - x1 * y0;
    A += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k;
  }
  places[name] = [+(cx / (3 * A)).toFixed(1), +(cy / (3 * A)).toFixed(1)];
}
// Major cities [lon, lat].
const CITIES: Record<string, [number, number]> = {
  london: [-0.1, 51.5], paris: [2.35, 48.86], berlin: [13.4, 52.52], madrid: [-3.7, 40.42], rome: [12.5, 41.9], amsterdam: [4.9, 52.37], lisbon: [-9.14, 38.72], dublin: [-6.26, 53.35], stockholm: [18.07, 59.33], zurich: [8.54, 47.37], milan: [9.19, 45.46], barcelona: [2.17, 41.39], vienna: [16.37, 48.21], warsaw: [21.01, 52.23], istanbul: [28.98, 41.01], moscow: [37.62, 55.76], kyiv: [30.52, 50.45], athens: [23.73, 37.98],
  "new york": [-74, 40.71], nyc: [-74, 40.71], "los angeles": [-118.24, 34.05], la: [-118.24, 34.05], "san francisco": [-122.42, 37.77], chicago: [-87.63, 41.88], miami: [-80.19, 25.76], austin: [-97.74, 30.27], seattle: [-122.33, 47.61], boston: [-71.06, 42.36], toronto: [-79.38, 43.65], vancouver: [-123.12, 49.28], montreal: [-73.57, 45.5], "mexico city": [-99.13, 19.43], "sao paulo": [-46.63, -23.55], "são paulo": [-46.63, -23.55], "rio de janeiro": [-43.17, -22.91], "buenos aires": [-58.38, -34.6], bogota: [-74.07, 4.71], lima: [-77.04, -12.05], santiago: [-70.67, -33.45],
  lagos: [3.38, 6.52], abuja: [7.49, 9.06], accra: [-0.19, 5.6], nairobi: [36.82, -1.29], cairo: [31.24, 30.04], johannesburg: [28.05, -26.2], "cape town": [18.42, -33.92], casablanca: [-7.59, 33.57], kigali: [30.06, -1.94], "addis ababa": [38.75, 9.03], dakar: [-17.47, 14.72], kinshasa: [15.27, -4.44],
  dubai: [55.27, 25.2], "abu dhabi": [54.37, 24.45], riyadh: [46.68, 24.71], doha: [51.53, 25.29], "tel aviv": [34.78, 32.09], mumbai: [72.88, 19.08], delhi: [77.1, 28.7], "new delhi": [77.21, 28.61], bangalore: [77.59, 12.97], bengaluru: [77.59, 12.97], karachi: [67.01, 24.86], dhaka: [90.41, 23.81],
  singapore: [103.82, 1.35], "hong kong": [114.17, 22.32], shanghai: [121.47, 31.23], beijing: [116.4, 39.9], shenzhen: [114.06, 22.54], tokyo: [139.69, 35.69], osaka: [135.5, 34.69], seoul: [126.98, 37.57], taipei: [121.56, 25.03], bangkok: [100.5, 13.76], jakarta: [106.85, -6.21], manila: [120.98, 14.6], "kuala lumpur": [101.69, 3.14], "ho chi minh city": [106.63, 10.82], hanoi: [105.83, 21.03],
  sydney: [151.21, -33.87], melbourne: [144.96, -37.81], brisbane: [153.03, -27.47], perth: [115.86, -31.95], auckland: [174.76, -36.85],
};
// Regions and aliases.
const REGIONS: Record<string, [number, number]> = {
  europe: [12, 50], africa: [20, 5], asia: [95, 35], "north america": [-100, 42], "south america": [-60, -15], "latin america": [-75, 5], "middle east": [47, 27], oceania: [140, -25], australia: [134, -25], uk: [-1.8, 52.8], "united kingdom": [-1.8, 52.8], britain: [-1.8, 52.8], usa: [-98, 39], us: [-98, 39], america: [-98, 39], "united states": [-98, 39], uae: [54.3, 23.9], emea: [20, 35], apac: [115, 10],
};
Object.assign(places, REGIONS, CITIES);
delete places["united states of america"];
places["united states"] = [-98, 39];

const b64 = Buffer.from(bytes).toString("base64");
fs.writeFileSync(
  "src/mograph/world.ts",
  `// Generated by scripts/gen-world.ts from Natural Earth via world-atlas (public domain). Do not edit.
/** Land mask: ${COLS}×${ROWS} cells of ${STEP}°, rows from ${LAT0}° to ${LAT1}° latitude, bit-packed. */
export const WORLD = { cols: ${COLS}, rows: ${ROWS}, lat0: ${LAT0}, lat1: ${LAT1}, step: ${STEP}, bits: "${b64}" };
/** Places by lower-case name: [longitude, latitude]. Countries, regions and major cities. */
export const PLACES: Record<string, [number, number]> = ${JSON.stringify(places)};
`,
);
console.log(`${COLS}x${ROWS}, ${n} land cells, ${Object.keys(places).length} places, ${b64.length} bytes`);
