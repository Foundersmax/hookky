// The motion script: what each spoken line becomes in a minimal motion-graphics edit. A line with
// a number becomes a metric ring, a list becomes an icon list, "first… then…" a process, two
// numbers a bar comparison, the product's name its orbit, anything else an icon hero. Every beat
// lists the ideas its icons should show; the studio finds them in one kit. Pure (no DOM).
import type { Aspect, Scene, Word } from "../types";
import type { KitId } from "./icons";
import { voiceSlots, type VoiceIn } from "../soundTemplates";
import { keywords } from "../footage/plan";
import { emSpoken, fill, type Brief } from "../copy";
import { placesIn } from "./places";

export type MotionTemplate = "icon-hero" | "icon-list" | "metric-ring" | "process-flow" | "bar-compare" | "icon-orbit" | "line-chart" | "column-chart" | "donut-chart" | "kpi-grid" | "world-map" | "route-map" | "dashboard" | "dashboard-focus" | "live-metrics" | "hero-type" | "stat-hero" | "bento" | "card-stack" | "cursor-demo" | "phone-screens" | "integrations" | "checklist" | "cta-end";
export const MOTION_TEMPLATES: MotionTemplate[] = ["icon-hero", "icon-list", "metric-ring", "process-flow", "bar-compare", "icon-orbit", "line-chart", "column-chart", "donut-chart", "kpi-grid", "world-map", "route-map", "dashboard", "dashboard-focus", "live-metrics", "hero-type", "stat-hero", "bento", "card-stack", "cursor-demo", "phone-screens", "integrations", "checklist", "cta-end"];

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
  /** where the product is named, show this instead of the icon orbit (a dashboard style leads with its UI) */
  prefer?: "dashboard" | "dashboard-focus" | "live-metrics";
}

export const MOTION_STYLES: MotionStyle[] = [
  { id: "aurora-glass", name: "Aurora Glass", blurb: "Glass cards over drifting violet light: bento grids, card stacks, a kinetic hero line. The product-film look.", kit: "lucide", style: "aurora", background: "orbs", aspect: "16:9", motion: "smooth", swatch: ["#0C0D19", "#8B6CFF"] },
  { id: "spotlight", name: "Spotlight", blurb: "Near-black, a lit grid from above, electric lime. Sharp, technical, launch-day.", kit: "lucide", style: "noir", background: "spotlight", aspect: "16:9", motion: "snappy", swatch: ["#0B0B0C", "#C8FF3D"] },
  { id: "horizon", name: "Horizon", blurb: "A glowing planet edge on midnight blue; UI floating above it. Big, calm, cinematic.", kit: "tabler", style: "midnight", background: "horizon", aspect: "16:9", motion: "smooth", swatch: ["#070B14", "#38BDF8"], prefer: "dashboard" },
  { id: "light-studio", name: "Light Studio", blurb: "White studio, soft blue light, crisp glass cards. Clean and premium for SaaS.", kit: "lucide", style: "clean", background: "orbs", aspect: "16:9", motion: "smooth", swatch: ["#FFFFFF", "#0A66FF"] },
  { id: "sunset-beams", name: "Sunset Beams", blurb: "Warm beams of light across plum; friendly, vertical, made for Reels.", kit: "ph", style: "sunset", background: "beams", aspect: "9:16", motion: "bouncy", swatch: ["#1A0F1F", "#FF7A45"] },
  { id: "glass-reel", name: "Glass Reel", blurb: "The glass look, vertical: one idea per screen, cards and phone demos.", kit: "lucide", style: "aurora", background: "orbs", aspect: "9:16", motion: "smooth", swatch: ["#0C0D19", "#8B6CFF"] },
  { id: "line-explainer", name: "Line Explainer", blurb: "Lime line icons drawing on over a fine grid on near-black. The classic product explainer.", kit: "lucide", style: "noir", background: "grid", aspect: "16:9", motion: "smooth", swatch: ["#0B0B0C", "#C8FF3D"] },
  { id: "clean-product", name: "Clean Product", blurb: "White space, crisp blue, even geometric icons. Calm, premium, SaaS-ready.", kit: "tabler", style: "clean", background: "solid", aspect: "16:9", motion: "smooth", swatch: ["#FFFFFF", "#0A66FF"] },
  { id: "data-story", name: "Data Story", blurb: "Numbers lead: rings, bars and counters on deep navy, glowing violet.", kit: "lucide", style: "aurora", background: "beams", aspect: "1:1", motion: "smooth", swatch: ["#0C0D19", "#8B6CFF"] },
  { id: "swiss-mono", name: "Swiss Mono", blurb: "Fine 1.5 px icons on warm paper, signal orange, strict grid.", kit: "iconoir", style: "swiss", background: "grid", aspect: "4:5", motion: "snappy", swatch: ["#F3F0E9", "#FF4D1A"] },
  { id: "soft-light", name: "Soft Light", blurb: "Light outlined icons, rosy neutrals and a gentle gradient. Beauty and lifestyle.", kit: "ph", style: "blush", background: "gradient", aspect: "9:16", motion: "calm", swatch: ["#F6E9E4", "#C8553D"] },
  { id: "editorial-line", name: "Editorial Line", blurb: "Serif headlines, cobalt line icons on stone. Considered, magazine-quiet.", kit: "iconoir", style: "editorial", background: "solid", aspect: "4:5", motion: "calm", swatch: ["#EEEAE3", "#2F55FF"] },
  { id: "terminal-mono", name: "Terminal Mono", blurb: "Monospace, ink-black icons on paper, dotted grid. For dev tools and fintech.", kit: "tabler", style: "mono", background: "dots", aspect: "1:1", motion: "snappy", swatch: ["#E9E7E1", "#0D0D0D"] },
  { id: "midnight-dashboard", name: "Midnight Dashboard", blurb: "Your product's dashboard assembling itself on deep blue: KPI cards, a live chart, breakdowns.", kit: "tabler", style: "midnight", background: "spotlight", aspect: "16:9", motion: "smooth", swatch: ["#070B14", "#38BDF8"], prefer: "dashboard" },
  { id: "product-tour", name: "Product Tour", blurb: "A clean dashboard, then the camera flies to each feature as it's said. SaaS walkthroughs.", kit: "lucide", style: "clean", background: "solid", aspect: "16:9", motion: "smooth", swatch: ["#FFFFFF", "#0A66FF"], prefer: "dashboard-focus" },
  { id: "live-ops", name: "Live Ops", blurb: "Phosphor green on black: live counters, a streaming chart and an event feed.", kit: "lucide", style: "terminal", background: "grid", aspect: "16:9", motion: "snappy", swatch: ["#050805", "#39FF88"], prefer: "live-metrics" },
  { id: "sunset-glow", name: "Sunset Glow", blurb: "Warm plum and tangerine, soft gradient, friendly type. Consumer apps and DTC.", kit: "ph", style: "sunset", background: "gradient", aspect: "9:16", motion: "smooth", swatch: ["#1A0F1F", "#FF7A45"] },
  { id: "pastel-pop", name: "Pastel Pop", blurb: "Lilac, violet and bouncy timing; rounded and playful. Lifestyle and creator tools.", kit: "lucide", style: "pastel", background: "orbs", aspect: "1:1", motion: "bouncy", swatch: ["#F4F1FF", "#7C5CFF"] },
  { id: "field-notes", name: "Field Notes", blurb: "Deep green, amber icons, a considered serif. Sustainability, food, outdoors.", kit: "iconoir", style: "forest", background: "dots", aspect: "4:5", motion: "calm", swatch: ["#0E1A14", "#F2B544"] },
  { id: "fintech-night", name: "Fintech Night", blurb: "Midnight blue with a live-metrics lead: money moving, in real time. Vertical.", kit: "tabler", style: "midnight", background: "solid", aspect: "9:16", motion: "snappy", swatch: ["#070B14", "#38BDF8"], prefer: "live-metrics" },
  { id: "vertical-explainer", name: "Vertical Explainer", blurb: "The line-icon explainer built for Reels and Shorts: one idea per screen.", kit: "lucide", style: "noir", background: "spotlight", aspect: "9:16", motion: "smooth", swatch: ["#0B0B0C", "#2CF5C1"] },
];
export const motionStyle = (id: string) => MOTION_STYLES.find((m) => m.id === id) ?? MOTION_STYLES[0];

// ---------------------------------------------------------------- reading a line
const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100, twice: 2, double: 2, half: 50 };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const clean = (s: string) => s.replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();
/** The first `n` words, never ending on a word that leaves the thought hanging ("…Lagos and", "…door in"). */
const shortWords = (s: string, n: number) => {
  const w = clean(s).replace(/[,;:]+$/, "").split(" ").slice(0, n);
  while (w.length > 2 && /^(and|or|to|in|on|at|of|for|the|a|an|with|from|your|our|by|is|are|than|across|into|over|via|around|throughout|worldwide)$/i.test(w[w.length - 1].replace(/[,;:]$/, ""))) w.pop();
  return w.join(" ").replace(/[,;:]+$/, "");
};

/** Numbers said in a line: digits ("87%", "$19") or words ("ten days", "fifty percent"). */
export function numbersIn(line: string): { value: number; suffix: string; prefix: string; at: number }[] {
  const out: { value: number; suffix: string; prefix: string; at: number }[] = [];
  for (const m of line.matchAll(/([$€£])?\s?(\d+(?:[.,]\d+)?)\s?(%|percent|x|times|days?|hours?|minutes?|k|m)?/gi)) {
    const unit = (m[3] ?? "").toLowerCase();
    out.push({ value: parseFloat(/^\d{1,3}(,\d{3})+$/.test(m[2]) ? m[2].replace(/,/g, "") : m[2].replace(",", ".")), prefix: m[1] ?? "", suffix: unit === "percent" || unit === "%" ? "%" : unit ? ` ${unit}` : "", at: m.index ?? 0 });
  }
  for (const m of line.matchAll(/\b(one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|hundred|twice|double|half)\b\s?(percent|days?|hours?|times|x)?/gi)) {
    const unit = (m[2] ?? "").toLowerCase();
    // a bare number word is usually just a word ("ten tools", "one place"); it counts with a unit
    if (!unit && !/^(twice|double|half)$/i.test(m[1])) continue;
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

/** What a number in a line counts: the words after it ("120k happy users" → "Happy users"). */
export function labelAfter(line: string, at: number): string {
  const rest = line.slice(at).replace(/^[$€£]?\s?[\d.,]*\d\s?(%|percent\b|x\b|k\b|m\b)?/i, "").split(/[,.;:!?]|\band\b/)[0].replace(/^\s*(of|in|for|more|less|faster|happy)?\s*/i, (m) => (/(more|less|faster|happy)/i.test(m) ? m : ""));
  const words = rest.split(/[\s,.;:!?]+/).filter((w) => w && !/^(and|or|the|a|an|our|your|with|to|in|on|at|by)$/i.test(w)).slice(0, 2);
  return cap(words.join(" ").toLowerCase());
}
const GROWTH = /\b(grew|grow|grown|growth|from\b.+\bto|rose|up from|doubled|tripled|increase[ds]?|jumped|climbed|went from)\b/i;
const ROUTE = /\b(deliver(?:y|ed|s)?|door|doorstep|arrives?|arriving|pick[- ]?up|courier|ride|rides|driver|on (?:its|the) way|minutes away)\b/i;
const fmtNum = (n: { value: number; prefix: string; suffix: string }) => `${n.prefix}${n.value}${n.suffix.trim() === "%" ? "%" : n.suffix.trim().length === 1 ? n.suffix.trim() : n.suffix ? ` ${n.suffix.trim()}` : ""}`;

// ---------------------------------------------------------------- the local planner
/**
 * Plan a motion-graphics edit for a voice-over: one beat per spoken phrase (cut in its pauses),
 * the template each line calls for, the words on screen and the ideas to find icons for.
 */
export function planMotion(v: VoiceIn & { insight?: { stressedWords?: string[] } }, raw: Partial<Brief>, opts: { prefer?: MotionStyle["prefer"] } = {}): MotionBeat[] {
  const b = fill(raw);
  // Motion beats can be short (an icon reads in ~1.4 s); a longer minimum folds lines into the end card.
  const slots = voiceSlots(v, 1.4, 4.2);
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
    const places = placesIn(line);
    // A delivery, a ride, an arrival: the route across town, the minutes counting down.
    if (ROUTE.test(line) && !/\b(what|why)\b/i.test(line)) {
      const mins = nums.find((n) => /min|hour/.test(n.suffix) || n.value <= 90);
      const vehicle = /\b(ride|driver|car)\b/i.test(line) ? "car" : /\b(truck|freight|ship)\b/i.test(line) ? "truck" : "bike";
      return { ...base, template: "route-map", headline: emSpoken(shortWords(line, 5), stressed), items: [places[0] ?? "Pickup", places[1] ?? "Your door"], ...(mins && { stat: { value: mins.value, suffix: /hour/.test(mins.suffix) ? "h" : "min", label: "Arriving in" } }), ideas: [vehicle] };
    }
    // The product's UI: a dashboard tour, a live panel, or the dashboard itself.
    const short = (x: string) => cap(shortWords(x, 4));
    const feats = b.benefits.slice(0, 4).map(short);
    const ui = (template: "dashboard" | "dashboard-focus" | "live-metrics"): MotionBeat => {
      const n = nums[0];
      const stat = n ? { value: n.value, ...(n.prefix && { prefix: n.prefix }), ...(n.suffix && { suffix: n.suffix.trim() }), label: labelAfter(line, n.at) || undefined } : undefined;
      if (template === "dashboard-focus") return { ...base, template, headline: emSpoken(shortWords(line, 6), stressed), items: (listIn(line) ?? feats).slice(0, 4), ideas: [] };
      if (template === "live-metrics") return { ...base, template, headline: emSpoken(shortWords(line, 5), stressed), items: feats.slice(0, 3), ...(stat && { stat }), ideas: ["bell"] };
      return { ...base, template, kicker: "Overview", headline: emSpoken(shortWords(line, 6), stressed), items: feats.slice(0, 3), ...(stat && { stat }), ideas: ["layout grid", "chart", "users", "wallet", "bell"] };
    };
    if (/\b(real[- ]?time|live|as it happens|instantly|every second)\b/i.test(line) && i > 0) return ui("live-metrics");
    if (/\b(dashboards?|analytics|insights|reporting|reports|at a glance|one view|one place|all in one)\b/i.test(line) && i > 0) return ui(feats.length >= 2 ? "dashboard-focus" : "dashboard");
    // Places said: the world map, pins in the order they're said.
    if (places.length) {
      // the pins name the places; the headline says the rest ("Now shipping to London and Lagos" → "Now shipping")
      let rest = line;
      for (const p of places) rest = rest.replace(new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), "");
      rest = rest.replace(/\s*,\s*(,\s*|and\s*)*/g, " ").replace(/\s+/g, " ");
      const head = shortWords(rest, 6);
      return { ...base, template: "world-map", headline: emSpoken(head.split(" ").length >= 2 ? head : shortWords(line, 6), stressed), items: places, ideas: [] };
    }
    // From one number to another: a line that climbs (or falls) between them.
    const plain = nums.filter((n) => !(n.value >= 1900 && n.value <= 2100 && !n.suffix));
    if (plain.length >= 2 && GROWTH.test(line)) {
      const [a, z] = [plain[0], plain[1]];
      const pts = Array.from({ length: 6 }, (_, k) => {
        const f = k / 5;
        const v = a.value * Math.pow(Math.max(z.value, 0.01) / Math.max(a.value, 0.01), f) + Math.sin(k * 2.1) * 0.04 * (z.value - a.value) * (k > 0 && k < 5 ? 1 : 0);
        return `${k === 0 ? "Then" : k === 5 ? "Now" : ""} | ${a.prefix}${+v.toFixed(a.value % 1 || z.value % 1 ? 1 : 0)}${(z.suffix || a.suffix).trim()}`;
      });
      return { ...base, template: "line-chart", headline: emSpoken(shortWords(line, 6), stressed), items: pts, ideas: [] };
    }
    // Shares of a whole: a donut.
    const pcts = nums.filter((n) => n.suffix === "%");
    if (pcts.length >= 2 && pcts.reduce((x, n) => x + n.value, 0) <= 100.5) {
      return { ...base, template: "donut-chart", headline: undefined, items: pcts.slice(0, 4).map((n) => `${labelAfter(line, n.at) || "Share"} | ${n.value}%`), ideas: [] };
    }
    // Years with numbers: columns by year.
    const years = nums.filter((n) => n.value >= 1900 && n.value <= 2100 && !n.suffix);
    if (years.length >= 2 && plain.length >= years.length) {
      return { ...base, template: "column-chart", headline: emSpoken(shortWords(line, 5), stressed), items: years.slice(0, 6).map((y, k) => `${y.value} | ${fmtNum(plain[k])}`), ideas: [] };
    }
    // Three or more numbers: a KPI grid, each counting up as it's said.
    if (plain.length >= 3) {
      const items = plain.slice(0, 4).map((n) => `${labelAfter(line, n.at) || "Total"} | ${fmtNum(n)}`);
      return { ...base, template: "kpi-grid", items, ideas: items.map((it) => it.split("|")[0].trim()) };
    }
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
    if (!orbitUsed && named(line) && i > 0) {
      orbitUsed = true;
      if (opts.prefer) return ui(opts.prefer);
      const world = [...new Set([...ideasIn(b.what), ...b.benefits.flatMap((x) => ideasIn(x, b.product).slice(0, 1))])].slice(0, 5);
      return { ...base, template: "icon-orbit", headline, ideas: [ideasIn(b.what, b.product)[0] ?? "sparkles", ...world] };
    }
    // (after the product reveal: "Meet Orbit, your command centre" is a reveal, not a list)
    const list = listIn(line);
    if (list) return { ...base, template: "icon-list", headline: i === 0 ? headline : undefined, items: list, ideas: list.map((s) => ideasIn(s, b.product)[0] ?? s) };
    const ideas = ideasIn(line, b.product);
    // A line with several picturable ideas reads better as a list than one icon.
    if (ideas.length >= 3 && i > 0 && line.split(" ").length <= 12) {
      const items = ideas.slice(0, 3).map(cap);
      return { ...base, template: "icon-list", items, ideas: items };
    }
    return { ...base, template: "icon-hero", kicker: i === 0 ? b.product : undefined, headline, ideas: ideas.slice(0, 1).length ? ideas.slice(0, 1) : [b.what] };
  });
  return upgrade(varied(beats), b);
}

const USES = /\b(click|clicks|tap|taps|type|prompt|just ask|generate[sd]?|automatic(?:ally)?|autopilot|in seconds|does it for you)\b/i;
const PHONE = /\b(app|phone|mobile|pocket|iphone|android)\b/i;
/**
 * The plan in the product-film templates: hooks become kinetic hero lines, numbers a giant
 * gradient figure, lists a bento grid, a card stack or a checklist (in turn), the product's world
 * an integrations hub; "one click" lines show the pointer doing it, app lines a phone.
 */
function upgrade(beats: MotionBeat[], b: ReturnType<typeof fill>): MotionBeat[] {
  let lists = 0;
  // A hero line shows the whole thought when it's short (up to 9 words), keeping its accent word.
  const heroLine = (bt: MotionBeat) => {
    const full = clean(bt.line);
    if (!bt.headline || !full || full.split(" ").length > 9) return bt.headline;
    const acc = bt.headline.match(/\*([^*]+)\*/)?.[1];
    return acc && full.includes(acc) ? full.replace(acc, `*${acc}*`) : full;
  };
  return beats.map((bt, i): MotionBeat => {
    if (bt.template === "icon-hero" || bt.template === "icon-orbit") {
      if (i > 0 && USES.test(bt.line)) return { ...bt, template: "cursor-demo", kicker: undefined, items: [cap(shortWords(b.what, 7)), "Ready", "Done in seconds"], ideas: [] };
      if (i > 0 && PHONE.test(bt.line) && b.benefits.length >= 2) {
        const rows = b.benefits.slice(0, 3).map((x) => cap(shortWords(x, 4)));
        return { ...bt, template: "phone-screens", kicker: undefined, items: rows, ideas: rows.map((r) => ideasIn(r, b.product)[0] ?? r) };
      }
      // the product's world needs at least three things around it; otherwise the line itself is the picture
      if (bt.template === "icon-orbit" && bt.ideas.length >= 4) return { ...bt, template: "integrations", items: bt.ideas.slice(1, 7).map((x) => cap(x)) };
      return { ...bt, template: "hero-type", headline: heroLine(bt), kicker: bt.kicker ?? (bt.template === "icon-orbit" ? undefined : bt.kicker), ideas: ideasIn(bt.line, b.product).slice(0, i === 0 ? 4 : 2) };
    }
    if (bt.template === "metric-ring") return { ...bt, template: "stat-hero" };
    if (bt.template === "icon-list") {
      const n = bt.items?.length ?? 0;
      const template = n <= 2 ? "card-stack" : (["bento", "card-stack", "checklist"] as const)[lists++ % 3];
      return { ...bt, template };
    }
    return bt;
  });
}

/** No template three times running: a third icon hero becomes an icon list of its ideas. */
function varied(beats: MotionBeat[]): MotionBeat[] {
  return beats.map((bt, i) => {
    if (i >= 2 && bt.template === "icon-hero" && beats[i - 1].template === "icon-hero" && beats[i - 2].template === "icon-hero") {
      const items = ideasIn(bt.line).slice(0, 3).map(cap);
      if (items.length >= 3) return { ...bt, template: "icon-list", headline: undefined, items, ideas: items };
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
    // Lists and flows pair icons with items by position; only the orbit can drop a repeat.
    const found = icons[i] ?? [];
    let names = bt.template === "icon-orbit" || bt.template === "integrations" || bt.template === "hero-type" ? [...new Set(found.filter((n): n is string => !!n))] : found.some(Boolean) ? found.map((n) => n ?? "lucide:check-circle") : [];
    // An icon template never goes out empty: the hero, orbit and metric fall back to a neutral mark.
    if (!names.length && (bt.template === "icon-hero" || bt.template === "icon-orbit" || bt.template === "integrations")) names = ["lucide:sparkles"];
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
  // hook first, then the reveal, like a real read
  const lines = [`${cap(b.what)}.`, `Meet ${b.product}.`, ...b.benefits.slice(0, 3).map((x) => `${cap(clean(x))}.`), ...(b.offer ? [`${cap(clean(b.offer))}.`] : []), `${cap(b.cta)}${b.url ? ` at ${b.url}` : ""}.`];
  const words: Word[] = [], pauses: { s: number; e: number }[] = [];
  let t = 0.3;
  lines.forEach((l, i) => {
    for (const w of l.split(" ")) words.push({ w, s: +t.toFixed(2), e: +(t + 0.3).toFixed(2) }), (t += 0.36);
    if (i < lines.length - 1) pauses.push({ s: +t.toFixed(2), e: +(t + 0.6).toFixed(2) }), (t += 0.6);
  });
  return { duration: +(t + 0.4).toFixed(2), pauses, words };
}
