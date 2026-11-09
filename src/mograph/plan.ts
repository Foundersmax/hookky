// The motion script: what each spoken line becomes in a minimal motion-graphics edit. A line with
// a number becomes a metric ring, a list becomes an icon list, "first… then…" a process, two
// numbers a bar comparison, the product's name its orbit, anything else an icon hero. Every beat
// lists the ideas its icons should show; the studio finds them in one kit. Pure (no DOM).
import type { Aspect, Scene, Word } from "../types";
import type { KitId } from "./icons";
import { voiceSlots, type VoiceIn } from "../soundTemplates";
import { keywords } from "../footage/plan";
import { emSpoken, fill, type Brief } from "../copy";

export type MotionTemplate = "icon-hero" | "icon-list" | "metric-ring" | "process-flow" | "bar-compare" | "icon-orbit" | "cta-end";
export const MOTION_TEMPLATES: MotionTemplate[] = ["icon-hero", "icon-list", "metric-ring", "process-flow", "bar-compare", "icon-orbit", "cta-end"];

/** One beat of the script, timed to a stretch of the voice-over. */
export interface MotionBeat {
  s: number;
  e: number;
  /** what's said over it */
  line: string;
  template: MotionTemplate;
  kicker?: string;
  headline?: string;
  items?: string[];
  stat?: Scene["stat"];
  /** ideas for its icons, in order ("sleep", "battery charging") */
  ideas: string[];
}

/** A motion-graphics look: the kit, the palette (a style preset), the ground and the pace. */
export interface MotionStyle {
  id: string;
  name: string;
  blurb: string;
  kit: KitId;
  style: string;
  background: NonNullable<Scene["background"]>;
  aspect: Aspect;
  motion: NonNullable<Scene["motion"]>;
  swatch: [string, string];
}

export const MOTION_STYLES: MotionStyle[] = [
  { id: "line-explainer", name: "Line Explainer", blurb: "Lime line icons drawing on over a fine grid on near-black. The classic product explainer.", kit: "lucide", style: "noir", background: "grid", aspect: "16:9", motion: "smooth", swatch: ["#0B0B0C", "#C8FF3D"] },
  { id: "clean-product", name: "Clean Product", blurb: "White space, crisp blue, even geometric icons. Calm, premium, SaaS-ready.", kit: "tabler", style: "clean", background: "solid", aspect: "16:9", motion: "smooth", swatch: ["#FFFFFF", "#0A66FF"] },
  { id: "data-story", name: "Data Story", blurb: "Numbers lead: rings, bars and counters on deep navy, glowing violet.", kit: "lucide", style: "aurora", background: "dots", aspect: "1:1", motion: "smooth", swatch: ["#0C0D19", "#8B6CFF"] },
  { id: "swiss-mono", name: "Swiss Mono", blurb: "Fine 1.5 px icons on warm paper, signal orange, strict grid.", kit: "iconoir", style: "swiss", background: "grid", aspect: "4:5", motion: "snappy", swatch: ["#F3F0E9", "#FF4D1A"] },
  { id: "soft-light", name: "Soft Light", blurb: "Light outlined icons, rosy neutrals and a gentle gradient. Beauty and lifestyle.", kit: "ph", style: "blush", background: "gradient", aspect: "9:16", motion: "calm", swatch: ["#F6E9E4", "#C8553D"] },
  { id: "editorial-line", name: "Editorial Line", blurb: "Serif headlines, cobalt line icons on stone. Considered, magazine-quiet.", kit: "iconoir", style: "editorial", background: "solid", aspect: "4:5", motion: "calm", swatch: ["#EEEAE3", "#2F55FF"] },
  { id: "terminal-mono", name: "Terminal Mono", blurb: "Monospace, ink-black icons on paper, dotted grid. For dev tools and fintech.", kit: "tabler", style: "mono", background: "dots", aspect: "1:1", motion: "snappy", swatch: ["#E9E7E1", "#0D0D0D"] },
  { id: "vertical-explainer", name: "Vertical Explainer", blurb: "The line-icon explainer built for Reels and Shorts: one idea per screen.", kit: "lucide", style: "noir", background: "solid", aspect: "9:16", motion: "smooth", swatch: ["#0B0B0C", "#2CF5C1"] },
];
export const motionStyle = (id: string) => MOTION_STYLES.find((m) => m.id === id) ?? MOTION_STYLES[0];

// ---------------------------------------------------------------- reading a line
const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100, twice: 2, double: 2, half: 50 };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const clean = (s: string) => s.replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();
const shortWords = (s: string, n: number) => clean(s).split(" ").slice(0, n).join(" ");

/** Numbers said in a line: digits ("87%", "$19") or words ("ten days", "fifty percent"). */
export function numbersIn(line: string): { value: number; suffix: string; prefix: string; at: number }[] {
  const out: { value: number; suffix: string; prefix: string; at: number }[] = [];
  for (const m of line.matchAll(/([$€£])?\s?(\d+(?:[.,]\d+)?)\s?(%|percent|x|times|days?|hours?|minutes?|k|m)?/gi)) {
    const unit = (m[3] ?? "").toLowerCase();
    out.push({ value: parseFloat(m[2].replace(",", ".")), prefix: m[1] ?? "", suffix: unit === "percent" || unit === "%" ? "%" : unit ? ` ${unit}` : "", at: m.index ?? 0 });
  }
  for (const m of line.matchAll(/\b(one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|hundred|twice|double|half)\b\s?(percent|days?|hours?|times|x)?/gi)) {
    const unit = (m[2] ?? "").toLowerCase();
    out.push({ value: NUM_WORDS[m[1].toLowerCase()], prefix: "", suffix: unit === "percent" ? "%" : unit ? ` ${unit}` : "", at: m.index ?? 0 });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** "fast, simple and secure" → ["Fast", "Simple", "Secure"]; null if the line isn't a list. */
export function listIn(line: string): string[] | null {
  const body = clean(line).replace(/^.*?:\s*/, "");
  const parts = body.split(/,\s*|\s+(?:and|&|plus)\s+/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return null;
  // With commas, items of up to 3 words; joined only by "and", short items (2 words) in a short line.
  const hasComma = body.includes(",");
  const firstWords = parts[0].replace(/^(it's|its|they're|it is)\s+/i, "").split(" ").length;
  if (parts.some((p, i) => (i === 0 ? firstWords : p.split(" ").length) > (hasComma ? 3 : 2))) return null;
  return parts.map((p) => cap(p.replace(/^(it's|its|they're|it is)\s+/i, "")));
}

/** "First you…, then…, finally…" → the steps; null if it's not a sequence. */
export function stepsIn(line: string): string[] | null {
  if (!/\b(first|then|next|finally|after that|step)\b/i.test(line)) return null;
  const parts = clean(line).split(/\b(?:first|then|next|finally|after that)\b[,:]?\s*/i).map((p) => p.replace(/^[,\s]+|[,\s]+$/g, "")).filter((p) => p.length > 1);
  return parts.length >= 2 ? parts.slice(0, 4).map((p) => cap(shortWords(p, 4))) : null;
}

const IDEA_SKIP = new Set("okay ok really actually just like thing things way".split(" "));
/** The ideas worth an icon in a line, strongest first. */
export function ideasIn(line: string, brand?: string): string[] {
  return keywords(line, brand ? [brand] : []).filter((w) => !IDEA_SKIP.has(w)).slice(0, 4);
}

// ---------------------------------------------------------------- the local planner
/**
 * Plan a motion-graphics edit for a voice-over: one beat per spoken phrase (cut in its pauses),
 * the template each line calls for, the words on screen and the ideas to find icons for.
 */
export function planMotion(v: VoiceIn & { insight?: { stressedWords?: string[] } }, raw: Partial<Brief>): MotionBeat[] {
  const b = fill(raw);
  const slots = voiceSlots(v, 2, 4.2);
  const stressed = v.insight?.stressedWords;
  const named = (t: string) => new RegExp(`\\b${b.product.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t);
  let orbitUsed = false;
  const beats: MotionBeat[] = slots.map((slot, i) => {
    const line = slot.text ?? (v.words?.length ? wordsBetween(v.words, slot.s, slot.e) : "");
    const base = { s: slot.s, e: slot.e, line };
    const headline = line ? emSpoken(shortWords(line, 6), stressed) : undefined;
    const last = i === slots.length - 1 && slots.length > 2;
    if (last) return { ...base, template: "cta-end", headline: emSpoken(`${b.product}`, stressed), ideas: [] };
    const nums = numbersIn(line);
    if (nums.length >= 2 && /\b(than|vs|versus|instead|compared|while|others|most)\b/i.test(line)) {
      return { ...base, template: "bar-compare", headline: emSpoken(shortWords(line.split(/\b(?:than|vs|versus|compared)\b/i)[0], 5), stressed), items: [`Others | ${Math.min(nums[0].value, nums[1].value)}${nums[0].suffix}`, `${b.product} | ${Math.max(nums[0].value, nums[1].value)}${nums[1].suffix || nums[0].suffix}`], ideas: [] };
    }
    if (nums.length) {
      const n = nums[0];
      const label = shortWords(line.replace(/[$€£]?\s?\d+(?:[.,]\d+)?\s?(%|percent)?/i, "").replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|hundred)\b\s?(percent)?/i, ""), 8);
      return { ...base, template: "metric-ring", stat: { value: n.value, prefix: n.prefix || undefined, suffix: n.suffix || undefined, label: label.toLowerCase() }, ideas: ideasIn(line, b.product).slice(0, 1) };
    }
    const steps = stepsIn(line);
    if (steps) return { ...base, template: "process-flow", headline: undefined, items: steps, ideas: steps.map((s) => ideasIn(s, b.product)[0] ?? s) };
    const list = listIn(line);
    if (list) return { ...base, template: "icon-list", headline: i === 0 ? headline : undefined, items: list, ideas: list.map((s) => ideasIn(s, b.product)[0] ?? s) };
    if (!orbitUsed && named(line) && i > 0) {
      orbitUsed = true;
      const world = [...new Set([...ideasIn(b.what), ...b.benefits.flatMap((x) => ideasIn(x, b.product).slice(0, 1))])].slice(0, 5);
      return { ...base, template: "icon-orbit", headline, ideas: [ideasIn(b.what, b.product)[0] ?? "sparkles", ...world] };
    }
    const ideas = ideasIn(line, b.product);
    // A line with several picturable ideas reads better as a list than one icon.
    if (ideas.length >= 3 && i > 0 && line.split(" ").length <= 12) {
      const items = ideas.slice(0, 3).map(cap);
      return { ...base, template: "icon-list", items, ideas: items };
    }
    return { ...base, template: "icon-hero", kicker: i === 0 ? b.product : undefined, headline, ideas: ideas.slice(0, 1).length ? ideas.slice(0, 1) : [b.what] };
  });
  return varied(beats);
}

/** No template three times running: a third icon hero becomes an icon list of its ideas. */
function varied(beats: MotionBeat[]): MotionBeat[] {
  return beats.map((bt, i) => {
    if (i >= 2 && bt.template === "icon-hero" && beats[i - 1].template === "icon-hero" && beats[i - 2].template === "icon-hero") {
      const items = ideasIn(bt.line).slice(0, 3).map(cap);
      if (items.length >= 2) return { ...bt, template: "icon-list", headline: undefined, items, ideas: items };
    }
    return bt;
  });
}

const wordsBetween = (words: Word[], s: number, e: number) => words.filter((w) => w.s >= s - 0.05 && w.s < e).map((w) => w.w).join(" ");

/** Turn the beats into scenes, with the icon names found for their ideas. */
export function motionScenes(beats: MotionBeat[], icons: (string | null)[][], st: MotionStyle, raw: Partial<Brief>): Omit<Scene, "id">[] {
  const b = fill(raw);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return beats.map((bt, i): Omit<Scene, "id"> => {
    const duration = +(r2(bt.e) - r2(bt.s)).toFixed(2);
    const names = (icons[i] ?? []).filter((n): n is string => !!n);
    const common = { duration, background: st.background, motion: st.motion, transition: i === 0 ? ("cut" as const) : ("fade" as const) };
    if (bt.template === "cta-end") return { ...common, template: "cta-end", headline: bt.headline ?? b.product, cta: b.cta, url: b.url || undefined };
    return {
      ...common,
      template: bt.template,
      ...(bt.kicker && { kicker: bt.kicker }),
      ...(bt.headline && { headline: bt.headline }),
      ...(bt.items && { items: bt.items }),
      ...(bt.stat && { stat: bt.stat }),
      ...(names.length && { icons: names }),
    };
  });
}

/** Without a voice-over: a narration from the brief, timed like a measured read (for previews and drafts). */
export function pseudoVoice(raw: Partial<Brief>): VoiceIn {
  const b = fill(raw);
  const lines = [`Meet ${b.product}.`, `${cap(b.what)}.`, ...b.benefits.slice(0, 3).map((x) => `${cap(clean(x))}.`), ...(b.offer ? [`${cap(clean(b.offer))}.`] : []), `${cap(b.cta)}${b.url ? ` at ${b.url}` : ""}.`];
  const words: Word[] = [], pauses: { s: number; e: number }[] = [];
  let t = 0.3;
  lines.forEach((l, i) => {
    for (const w of l.split(" ")) words.push({ w, s: +t.toFixed(2), e: +(t + 0.3).toFixed(2) }), (t += 0.36);
    if (i < lines.length - 1) pauses.push({ s: +t.toFixed(2), e: +(t + 0.6).toFixed(2) }), (t += 0.6);
  });
  return { duration: +(t + 0.4).toFixed(2), pauses, words };
}
