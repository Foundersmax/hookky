// Places a voice-over names, found on the map: countries, regions and major cities.
import { PLACES, WORLD } from "./world";

/** Common words that are also place names; never read from speech as places. */
const AMBIGUOUS = new Set(["us", "la", "chad", "jordan", "georgia", "turkey", "guinea", "niger", "america"]);

/** [longitude, latitude] of a place name, or undefined. */
export function placeAt(name: string): [number, number] | undefined {
  const k = name.toLowerCase().replace(/[.*]/g, "").replace(/\s+/g, " ").trim();
  return PLACES[k] ?? PLACES[k.replace(/^the /, "")];
}

/** Place names said in a line, in order (two-word names first: "New York", "Cape Town"). */
export function placesIn(line: string): string[] {
  const words = line.replace(/[^\p{L}\s'-]/gu, " ").split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    for (const n of [3, 2, 1]) {
      const phrase = words.slice(i, i + n).join(" ");
      const k = phrase.toLowerCase();
      if (words.length < i + n) continue;
      // ambiguous words count only capitalised mid-sentence ("sold in America", not "us" or "Turkey dinner" at the start)
      if (n === 1 && AMBIGUOUS.has(k) && (k.length < 3 || i === 0 || !/^\p{Lu}/u.test(phrase))) continue;
      // single words must be capitalised in the transcript to count (so "turkey dinner" isn't Turkey)
      if (PLACES[k] && (n > 1 || /^\p{Lu}/u.test(phrase) || k.length > 3)) {
        if (!out.some((o) => o.toLowerCase() === k)) out.push(phrase.replace(/\b\p{Ll}/gu, (m) => m.toUpperCase()));
        i += n - 1;
        break;
      }
    }
  }
  return out.slice(0, 6);
}

let mask: Uint8Array | null = null;
/** Is the world-mask cell at (col, row) land? */
export function landAt(col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= WORLD.cols || row >= WORLD.rows) return false;
  if (!mask) {
    const s = typeof atob === "function" ? atob(WORLD.bits) : Buffer.from(WORLD.bits, "base64").toString("binary");
    mask = Uint8Array.from(s, (ch) => ch.charCodeAt(0));
  }
  const k = row * WORLD.cols + col;
  return ((mask[k >> 3] >> (k & 7)) & 1) === 1;
}
