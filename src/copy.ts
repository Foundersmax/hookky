// Copy helpers shared by the creative formats and the motion-graphics planner: the brief, filling
// its gaps, and marking the word that matters with *asterisks*.

export interface Brief {
  /** product or brand name */
  product: string;
  /** what it is / does, one line */
  what: string;
  /** who it's for */
  audience: string;
  /** up to 4 benefits */
  benefits: string[];
  /** the offer, if any ("30% off this week") */
  offer: string;
  cta: string;
  url: string;
}

const STOP = new Set("a an the and or for to of in on with your you our we is are it its that this from by at as".split(" "));
/** Mark the strongest word with *asterisks* (a number, else the longest meaningful word). */
export function em(text: string): string {
  if (!text || text.includes("*")) return text;
  const ws = text.split(" ");
  let best = -1, sc = 0;
  ws.forEach((w, i) => {
    const t = w.replace(/[^\p{L}\p{N}%$€£]/gu, "");
    if (!t || STOP.has(t.toLowerCase())) return;
    const s = /\d/.test(t) ? 99 : t.length + (i === ws.length - 1 ? 1 : 0);
    if (s > sc) (sc = s), (best = i);
  });
  if (best < 0) return text;
  const m = ws[best].match(/^([^\p{L}\p{N}$€£]*)(.*?)([.,!?;:]*)$/u)!;
  ws[best] = `${m[1]}*${m[2]}*${m[3]}`;
  return ws.join(" ");
}
/** Highlight the word the speaker actually stressed, if it's in the line; else the strongest word. */
export function emSpoken(text: string, stressed?: string[]): string {
  if (!text || text.includes("*") || !stressed?.length) return em(text);
  const ws = text.split(" ");
  const i = ws.findIndex((w) => stressed.includes(w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "")));
  if (i < 0) return em(text);
  const m = ws[i].match(/^([^\p{L}\p{N}$€£]*)(.*?)([.,!?;:]*)$/u)!;
  ws[i] = `${m[1]}*${m[2]}*${m[3]}`;
  return ws.join(" ");
}
export const STOP_WORDS = STOP;
export const words = (s: string, n: number) => s.split(/\s+/).filter(Boolean).slice(0, n).join(" ");
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Fill the gaps in a brief so every format has something good to say. */
export function fill(raw: Partial<Brief>): Brief {
  const product = raw.product?.trim() || "Orbit";
  const what = raw.what?.trim() || "the smartwatch that keeps up with you";
  const benefits = (raw.benefits ?? []).map((b) => b.trim()).filter(Boolean);
  return {
    product,
    what,
    audience: raw.audience?.trim() || "people on the move",
    benefits: benefits.length ? benefits.slice(0, 4) : ["Set up in minutes", "Built to last", "Loved by thousands"],
    offer: raw.offer?.trim() || "",
    cta: raw.cta?.trim() || (raw.offer?.trim() ? "Claim the offer" : "Get yours"),
    url: raw.url?.trim() || "",
  };
}
