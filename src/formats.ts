// Creative formats: proven attention structures for ads, each a sequence of beats built from the
// studio's templates, effects and transitions. Every format builds a finished draft locally from a
// short brief; with Claude available the server rewrites that draft (copy, emphasis, effects)
// while keeping its structure. Pure (no DOM).
import type { Aspect, Effect, Grade, Scene, TransitionId } from "./types";
import { voiceSlots, clip as clipWords, type VoiceIn } from "./soundTemplates";
import { LOOKS_PROD, assemble, planShots, queriesFor, type ProdLook, type Shot, type ShotType } from "./footage/plan";
import type { VoiceInsight, MusicInsight } from "./audio/insight";

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

export const CATEGORIES = ["Social hooks", "E-commerce", "Apps & SaaS", "Brand & story", "Local & events", "Promos & offers"] as const;

/** The three kinds of format: pure type, footage with type on it, and footage that speaks for itself. */
export const SECTIONS = [
  { id: "text", label: "Text animations", note: "Kinetic type, no footage needed" },
  { id: "mixed", label: "Footage + text", note: "Your images and clips, with animated copy" },
  { id: "footage", label: "Footage", note: "Image and video edits; words only where they count" },
] as const;
export type Section = (typeof SECTIONS)[number]["id"];
export type Category = (typeof CATEGORIES)[number];

type Beat = Omit<Scene, "id">;
export interface Format {
  id: string;
  name: string;
  section: Section;
  category: Category;
  /** the attention device, in a few words */
  hook: string;
  blurb: string;
  aspect: Aspect;
  style: string;
  /** the structure, beat by beat, for Claude */
  beats: string;
  build: (b: Brief, images: string[]) => Beat[];
  /** colour for the gallery card */
  swatch: [string, string];
  /** footage formats: the production look their clips are graded with */
  look?: ProdLook;
}

// ---------------------------------------------------------------- copy helpers
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
const words = (s: string, n: number) => s.split(/\s+/).filter(Boolean).slice(0, n).join(" ");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
/** "30% off this week" → { value: 30, suffix: "%", label: "off this week" }. */
export function offerStat(offer: string): Scene["stat"] | undefined {
  const pct = offer.match(/(\d{1,3})\s?%/);
  if (pct) return { value: +pct[1], suffix: "%", label: offer.replace(pct[0], "").trim().slice(0, 40) || "off" };
  const money = offer.match(/([$€£])\s?(\d+(?:\.\d{1,2})?)/);
  if (money) return { value: +money[2], prefix: money[1], decimals: money[2].includes(".") ? 2 : 0, label: offer.replace(money[0], "").trim().slice(0, 40) };
  return undefined;
}

// ---------------------------------------------------------------- beat helpers
const fx = (grade: Grade, effects: Effect[], fxAmount = 0.7) => ({ grade, effects, fxAmount });
const T = (transition: TransitionId) => ({ transition });
const img = (images: string[], i: number) => (images.length ? images[i % images.length] : undefined);
/** A product shot if there is one, else the same beat without an image. */
const shot = (images: string[], i: number, withImg: Beat, without: Beat): Beat => (img(images, i) ? { ...withImg, image: img(images, i) } : without);
const end = (b: Brief, extra: Partial<Beat> = {}): Beat => ({ template: "cta-end", duration: 3.4, headline: em(b.offer ? words(b.offer, 5) : `Meet ${b.product}`), cta: b.cta, url: b.url || undefined, background: "gradient", ...T("zoom"), ...extra });

// ---------------------------------------------------------------- energetic text formats
type Anim = Scene["template"];
type Bg = Scene["background"];
/**
 * A Pattern Interrupt cousin built around one text animation: a glitchy hook, the product, two
 * benefits and a punchy close, each on its own animated background. Every beat follows the
 * voice-over word by word when there is one.
 */
function energetic(o: { id: string; name: string; category: Category; hook: string; blurb: string; aspect: Aspect; style: string; swatch: [string, string]; anim: Anim; bgs: [Bg, Bg, Bg]; open: (b: Brief) => string; punch?: Anim; transitions?: [TransitionId, TransitionId, TransitionId] }): Format {
  const tr = o.transitions ?? ["glitch", "whip", "spin"];
  return {
    id: o.id, section: "text", name: o.name, category: o.category, hook: o.hook, blurb: o.blurb, aspect: o.aspect, style: o.style, swatch: o.swatch,
    beats: `1 ${o.anim} hook with glitch and zoom-punch · 2 ${o.anim} naming the product · 3-4 ${o.anim} benefits on animated backgrounds · 5 ${o.punch ?? "word-slam"} punch line · 6 end card`,
    build: (b) => [
      { template: o.anim, duration: 2.6, headline: em(o.open(b)), background: o.bgs[0], ...T("cut"), ...fx("vivid", ["zoom-punch", "glitch"], 0.7) },
      { template: o.anim, duration: 2.6, headline: em(`${b.product}: ${words(b.what, 5)}`), background: o.bgs[1], ...T(tr[0]), ...fx("none", ["zoom-punch"], 0.6) },
      ...b.benefits.slice(0, 2).map((x, i): Beat => ({ template: o.anim, duration: 2.4, headline: em(words(x, 6)), background: i ? o.bgs[0] : o.bgs[2], ...T(i ? tr[2] : tr[1]), ...fx("none", i ? ["pulse"] : ["zoom-punch"], 0.6) })),
      { template: o.punch ?? "word-slam", duration: 2.2, headline: em(b.offer ? words(b.offer, 5) : `Only ${b.product}`), background: "accent", ...T("whip"), ...fx("vivid", ["zoom-punch", "flash"], 0.75) },
      end(b, { background: o.bgs[1], ...fx("vivid", ["sparkle"], 0.5) }),
    ],
  };
}

const ENERGETIC: Format[] = [
  energetic({ id: "slam", name: "Word Slam", category: "Social hooks", hook: "One giant word at a time", aspect: "9:16", style: "noir", swatch: ["#0B0B0C", "#C8FF3D"], anim: "word-slam", bgs: ["rays", "stripes", "solid"],
    blurb: "Every word hits the screen alone, huge, with an impact shake. Brutal with a voice-over.", open: (b) => `${cap(b.audience)}. Stop. Look. This.` }),
  energetic({ id: "decode", name: "Decode", category: "Apps & SaaS", hook: "Text scrambles into place", aspect: "9:16", style: "noir", swatch: ["#0B0B0C", "#2CF5C1"], anim: "scramble", bgs: ["synthwave", "checker", "solid"],
    blurb: "Letters decode from noise as each word is said, techy and addictive to watch.", open: () => "You've never seen this before", punch: "scramble" }),
  energetic({ id: "zoom-tunnel", name: "Zoom Tunnel", category: "Social hooks", hook: "Words fly at the camera", aspect: "9:16", style: "aurora", swatch: ["#0C0D19", "#8B6CFF"], anim: "zoom-through", bgs: ["starfield", "rings", "solid"],
    blurb: "Each word rushes out of the depth and blows past, through a starfield.", open: () => "Faster than you think", transitions: ["spin", "whip", "zoom"] }),
  energetic({ id: "wave-pop", name: "Wave Pop", category: "E-commerce", hook: "Bouncy letter waves", aspect: "4:5", style: "blush", swatch: ["#F6E9E4", "#FF5FA2"], anim: "letter-wave", bgs: ["mesh", "waves", "split"],
    blurb: "Letters bounce in one by one and keep riding a wave. Playful, bright, made for products people love.", open: (b) => `Okay ${b.audience}, you need this`, punch: "letter-wave", transitions: ["whip", "push-up", "spin"] }),
  energetic({ id: "karaoke", name: "Karaoke Fill", category: "Brand & story", hook: "Words fill as they're said", aspect: "9:16", style: "noir", swatch: ["#0B0B0C", "#FF4D1A"], anim: "outline-fill", bgs: ["rings", "waves", "solid"],
    blurb: "The line waits in outline and fills word by word with the voice. Made for voice-overs.", open: () => "Listen to this for a second", punch: "outline-fill", transitions: ["fade", "whip", "glitch"] }),
  energetic({ id: "flip-deck", name: "Flip Deck", category: "Promos & offers", hook: "Cube-flipping words", aspect: "1:1", style: "swiss", swatch: ["#F3F0E9", "#FF4D1A"], anim: "flip-words", bgs: ["split", "stripes", "checker"],
    blurb: "Words flip in like a turning cube; the important ones land on a colour slab.", open: () => "Three words. Zero excuses.", transitions: ["whip", "glitch", "whip"] }),
  energetic({ id: "type-rush", name: "Type Rush", category: "Apps & SaaS", hook: "Rapid-fire typing", aspect: "16:9", style: "mono", swatch: ["#E9E7E1", "#0D0D0D"], anim: "typewriter", bgs: ["checker", "grid", "solid"],
    blurb: "Fast typing with a blinking caret and marker sweeps under the words that matter.", open: (b) => `Dear ${b.audience}, we fixed it.`, transitions: ["cut", "whip", "glitch"] }),
  energetic({ id: "echo-chamber", name: "Echo Chamber", category: "Social hooks", hook: "Echoing outlined words", aspect: "9:16", style: "aurora", swatch: ["#0C0D19", "#2CF5C1"], anim: "echo-stack", bgs: ["aurora", "rays", "solid"],
    blurb: "Each word echoes in outlines above and below. Hypnotic, loud, very social.", open: () => "Louder for the people in the back", punch: "zoom-through", transitions: ["glitch", "spin", "whip"] }),
];

// ---------------------------------------------------------------- the formats
export const FORMATS: Format[] = [
  // ---- social hooks
  {
    id: "pov-hook", section: "mixed", name: "POV Hook", category: "Social hooks", hook: "Native POV caption", aspect: "9:16", style: "noir", swatch: ["#0B0B0C", "#C8FF3D"],
    blurb: "Opens like a creator's post: a POV caption over footage, then the product lands.",
    beats: "1 pov-caption hook naming the audience's moment (POV: …) · 2 word-stack of the core promise · 3 spotlight or product reveal · 4 one proof/benefit · 5 end card",
    build: (b, im) => [
      { template: "pov-caption", duration: 3, kicker: "POV:", headline: em(`you finally found ${words(b.what, 7)}`), image: img(im, 0), ...T("cut"), ...fx("vivid", ["zoom-punch"], 0.6) },
      { template: "word-stack", duration: 2.4, headline: em(words(b.benefits[0], 5)), background: "solid", ...T("whip"), ...fx("none", ["zoom-punch"], 0.7) },
      shot(im, 1, { template: "spotlight", duration: 3.2, headline: em(`Meet ${b.product}`), subline: words(b.what, 10), ...T("spin") }, { template: "logo-reveal", duration: 3, headline: b.product, subline: words(b.what, 8), ...T("spin") }),
      { template: "kinetic-words", duration: 2.6, headline: em(words(b.benefits[1] ?? b.benefits[0], 6)), background: "accent", ...T("whip"), ...fx("vivid", ["pulse"], 0.6) },
      end(b, fx("vivid", ["sparkle"], 0.6)),
    ],
  },
  {
    id: "stop-scroll", section: "text", name: "Pattern Interrupt", category: "Social hooks", hook: "Glitch + slam text", aspect: "9:16", style: "noir", swatch: ["#000000", "#FF3D6E"],
    blurb: "A glitch and a wall of type break the scroll in the first second.",
    beats: "1 word-stack pattern interrupt (2-4 punchy words) with glitch · 2 glitch transition into text-mask product name · 3-4 fast kinetic benefits with zoom-punch · 5 end card",
    build: (b, im) => [
      { template: "word-stack", duration: 1.8, headline: em("Wait. Stop scrolling."), background: "solid", ...T("cut"), ...fx("vivid", ["glitch", "rgb-split", "zoom-punch"], 0.8) },
      { template: "text-mask", duration: 2.6, headline: b.product, subline: words(b.what, 9), image: img(im, 0), ...T("glitch"), ...fx("none", ["zoom-punch"], 0.6) },
      ...b.benefits.slice(0, 2).map((x, i): Beat => ({ template: "kinetic-words", duration: 2.2, headline: em(words(x, 6)), background: i ? "invert" : "solid", ...T("whip"), ...fx("vivid", ["zoom-punch"], 0.7) })),
      end(b, { ...T("glitch"), ...fx("vivid", ["rgb-split"], 0.5) }),
    ],
  },
  {
    id: "group-chat", section: "text", name: "Group Chat", category: "Social hooks", hook: "A chat thread", aspect: "9:16", style: "clean", swatch: ["#FFFFFF", "#0A66FF"],
    blurb: "Friends talk the product up in a chat; the viewer reads along before they know it's an ad.",
    beats: "1 chat: 4-6 short casual messages between friends discovering the product (lowercase, emoji ok), the brand's side marked with > · 2 product reveal · 3 rating or benefit · 4 end card",
    build: (b, im) => [
      { template: "chat", duration: 7.2, kicker: "the group 💬", items: [`has anyone tried ${b.product}?`, `> yes!! ${words(b.benefits[0], 6).toLowerCase()}`, "wait is it actually good", `> ${words(b.benefits[1] ?? "honestly obsessed", 6).toLowerCase()} 😭`, "ok ordering now"], headline: em(`Everyone's on ${b.product}`), ...T("cut") },
      shot(im, 0, { template: "product-hero", duration: 3, headline: em(b.product), ...T("zoom"), ...fx("none", ["zoom-punch"], 0.5) }, { template: "logo-reveal", duration: 2.8, headline: b.product, subline: words(b.what, 8), ...T("zoom") }),
      { template: "rating", duration: 3.6, stat: { value: 4.9, label: `loved by ${b.audience}` }, headline: words(b.benefits[2] ?? b.benefits[0], 10), ...T("push-up") },
      end(b),
    ],
  },
  {
    id: "notifications", section: "text", name: "Notification Storm", category: "Social hooks", hook: "Lock screen pinging", aspect: "9:16", style: "aurora", swatch: ["#0C0D19", "#8B6CFF"],
    blurb: "A lock screen filling with orders and messages: instant FOMO.",
    beats: "1 notification: 3-4 notifications (orders, friends asking, low stock) then a headline · 2 word-stack of why · 3 spotlight product · 4 end card",
    build: (b, im) => [
      { template: "notification", duration: 5, kicker: "9:41", items: [`${b.product}: Your order is on its way 📦`, "Messages: wait, where did you get that??", `${b.product}: Only a few left in stock`], headline: em("Everyone's asking"), image: img(im, 2), ...T("cut") },
      { template: "word-stack", duration: 2.4, headline: em(words(b.benefits[0], 5)), background: "solid", ...T("whip"), ...fx("none", ["zoom-punch"], 0.6) },
      shot(im, 0, { template: "spotlight", duration: 3.2, headline: em(b.product), subline: words(b.what, 9), ...T("spin") }, { template: "text-mask", duration: 3, headline: b.product, subline: words(b.what, 9), ...T("spin") }),
      end(b, fx("vivid", ["sparkle"], 0.6)),
    ],
  },
  {
    id: "myth-fact", section: "text", name: "Myth vs Fact", category: "Social hooks", hook: "Busting a myth", aspect: "4:5", style: "swiss", swatch: ["#F3F0E9", "#FF4D1A"],
    blurb: "Name the belief that stops people buying, then flip it. Contrarian hooks hold attention.",
    beats: "1 title-reveal kicker 'Myth' on invert: a common belief in the category · 2 title-reveal kicker 'Fact' with the truth · (repeat once) · 3 product reveal · 4 end card",
    build: (b) => [
      { template: "title-reveal", duration: 3, kicker: "Myth", headline: em("It's too good to be true"), background: "invert", ...T("cut"), ...fx("mono", ["zoom-punch"], 0.6) },
      { template: "title-reveal", duration: 3, kicker: "Fact", headline: em(words(b.benefits[0], 7)), background: "accent", ...T("glitch"), ...fx("none", ["zoom-punch"], 0.6) },
      { template: "title-reveal", duration: 2.8, kicker: "Myth", headline: em("Good things take forever"), background: "invert", ...T("whip"), ...fx("mono", [], 0.6) },
      { template: "title-reveal", duration: 2.8, kicker: "Fact", headline: em(words(b.benefits[1] ?? b.benefits[0], 7)), background: "accent", ...T("glitch") },
      end(b, { headline: em(`${b.product}: ${words(b.what, 5)}`) }),
    ],
  },
  {
    id: "three-reasons", section: "text", name: "3 Reasons", category: "Social hooks", hook: "Numbered listicle", aspect: "9:16", style: "swiss", swatch: ["#F3F0E9", "#111111"],
    blurb: "\"3 reasons …\" promises a payoff, so people watch to the end.",
    beats: "1 word-stack title '3 reasons {audience} switch to {product}' · 2-4 each reason: stat-counter or title-reveal with kicker 'Reason N' and zoom-punch · 5 end card",
    build: (b) => [
      { template: "word-stack", duration: 2.6, headline: em(`3 reasons ${b.audience} love ${b.product}`), background: "solid", ...T("cut"), ...fx("none", ["zoom-punch"], 0.6) },
      ...b.benefits.slice(0, 3).map((x, i): Beat => ({ template: "title-reveal", duration: 2.8, kicker: `Reason ${i + 1}`, headline: em(words(x, 6)), background: i === 1 ? "invert" : "solid", ...T(i % 2 ? "whip" : "push-up"), ...fx("none", ["zoom-punch"], 0.6) })),
      end(b),
    ],
  },
  // ---- e-commerce
  {
    id: "product-drop", section: "mixed", name: "Product Drop", category: "E-commerce", hook: "Countdown to reveal", aspect: "9:16", style: "noir", swatch: ["#0B0B0C", "#C8FF3D"],
    blurb: "3-2-1, a spotlight sweeps and lands on the product, then the confetti.",
    beats: "1 countdown 3 → 'Now live' · 2 spotlight on the product · 3 text-mask product name · 4 feature-list of 3 benefits · 5 end card with confetti",
    build: (b, im) => [
      { template: "countdown", duration: 3.2, kicker: "Dropping in", stat: { value: 3 }, headline: em("Now live"), background: "solid", ...T("cut"), ...fx("vivid", ["pulse"], 0.6) },
      shot(im, 0, { template: "spotlight", duration: 3.4, headline: em(`Meet ${b.product}`), subline: words(b.what, 9), ...T("zoom"), ...fx("none", ["film-burn"], 0.6) }, { template: "logo-reveal", duration: 3, headline: b.product, subline: words(b.what, 8), ...T("zoom"), ...fx("none", ["film-burn"], 0.6) }),
      { template: "text-mask", duration: 2.8, headline: words(b.product, 2), subline: words(b.benefits[0], 8), image: img(im, 1), ...T("whip") },
      { template: "feature-list", duration: 4.4, kicker: "Why it's different", headline: em(words(b.what, 5)), items: b.benefits.slice(0, 3), ...T("push-up") },
      end(b, fx("vivid", ["confetti"], 0.7)),
    ],
  },
  {
    id: "unboxing", section: "mixed", name: "Unboxing Reveal", category: "E-commerce", hook: "Light-burn reveal", aspect: "4:5", style: "blush", swatch: ["#F6E9E4", "#C8553D"],
    blurb: "The anticipation of opening the box: warm film light, a slow reveal, then proof.",
    beats: "1 shape-burst with 'Open me' energy · 2 product-hero with film-burn and roll · 3 two fullbleed detail shots with benefits · 4 rating · 5 end card",
    build: (b, im) => [
      { template: "shape-burst", duration: 1.8, headline: em("Unboxing"), background: "gradient", ...T("cut") },
      shot(im, 0, { template: "product-hero", duration: 3.4, headline: em(b.product), ...T("spin"), ...fx("warm-film", ["film-burn", "roll"], 0.65) }, { template: "logo-reveal", duration: 3, headline: b.product, subline: words(b.what, 8), ...T("spin"), ...fx("warm-film", ["film-burn"], 0.6) }),
      ...[0, 1].map((i): Beat => shot(im, i + 1, { template: "fullbleed", duration: 2.6, headline: em(words(b.benefits[i] ?? b.benefits[0], 5)), ...T("whip"), ...fx("warm-film", ["push-in", "dust"], 0.55) }, { template: "kinetic-words", duration: 2.4, headline: em(words(b.benefits[i] ?? b.benefits[0], 5)), background: "gradient", ...T("whip") })),
      { template: "rating", duration: 3.4, stat: { value: 4.9, label: "from verified buyers" }, headline: words(b.benefits[2] ?? b.what, 10), ...T("fade") },
      end(b, fx("warm-film", ["sparkle"], 0.5)),
    ],
  },
  {
    id: "social-proof", section: "text", name: "Social Proof Wall", category: "E-commerce", hook: "Stars + reviews", aspect: "1:1", style: "clean", swatch: ["#FFFFFF", "#0A66FF"],
    blurb: "Stars fill, reviews pile up, orders ping. Let customers sell it.",
    beats: "1 rating with a strong review quote · 2 testimonials (2-3 short quotes) · 3 notification of orders · 4 end card",
    build: (b) => [
      { template: "rating", duration: 3.6, stat: { value: 4.9, label: `from ${b.audience}` }, headline: `${words(b.benefits[0], 6)}. Didn't expect it to be this good.`, author: "Verified buyer", ...T("cut") },
      { template: "testimonials", duration: 5.5, headline: em("Real people. Real results."), items: [`${words(b.benefits[0], 6)}. — Maya R.`, `Worth every penny. — Jon K.`, `Use it every day. — Priya S.`], ...T("push-up") },
      { template: "notification", duration: 4, kicker: "Today", items: [`${b.product}: New order from Austin`, `${b.product}: New order from London`, `${b.product}: 50 sold in the last hour`], headline: em("Join them"), ...T("whip") },
      end(b),
    ],
  },
  {
    id: "transformation", section: "mixed", name: "Transformation", category: "E-commerce", hook: "Before → after", aspect: "9:16", style: "blush", swatch: ["#F6E9E4", "#C8553D"],
    blurb: "The before, the after, and the proof. The oldest format in advertising because it works.",
    beats: "1 pov-caption 'POV: day 1' · 2 before-after (images[0] before, images[1] after) · 3 word-stack result · 4 rating · 5 end card",
    build: (b, im) => [
      { template: "pov-caption", duration: 2.8, kicker: "POV:", headline: em(`day 1 vs day 30 with ${b.product}`), image: img(im, 0), ...T("cut"), ...fx("none", ["zoom-punch"], 0.5) },
      im.length >= 2 ? { template: "before-after", duration: 4.4, images: [im[0], im[1]], items: ["Before", "After"], headline: em("See the difference"), ...T("whip") } : { template: "word-stack", duration: 2.6, headline: em("Before. After."), background: "solid", ...T("whip") },
      { template: "kinetic-words", duration: 2.6, headline: em(words(b.benefits[0], 6)), background: "accent", ...T("spin"), ...fx("none", ["zoom-punch"], 0.6) },
      { template: "rating", duration: 3.4, stat: { value: 4.8, label: "average rating" }, headline: words(b.benefits[1] ?? b.what, 10), ...T("fade") },
      end(b, fx("none", ["sparkle"], 0.5)),
    ],
  },
  // ---- apps & SaaS
  {
    id: "app-demo", section: "mixed", name: "App Walkthrough", category: "Apps & SaaS", hook: "Phone demo", aspect: "9:16", style: "clean", swatch: ["#FFFFFF", "#0A66FF"],
    blurb: "Show, don't tell: the app in a phone, step by step, with the outcome in big type.",
    beats: "1 word-stack outcome promise · 2-4 device-mockup steps (kicker 'Step N', headline the action) with screenshots · 5 stat-counter result · 6 end card",
    build: (b, im) => [
      { template: "word-stack", duration: 2.2, headline: em(words(b.benefits[0], 5)), background: "solid", ...T("cut"), ...fx("none", ["zoom-punch"], 0.6) },
      ...b.benefits.slice(0, 3).map((x, i): Beat => shot(im, i, { template: "device-mockup", duration: 3, kicker: `Step ${i + 1}`, headline: em(words(x, 5)), align: "left", ...T(i ? "slide" : "zoom") }, { template: i === 1 ? "kinetic-words" : "title-reveal", duration: 2.8, kicker: `Step ${i + 1}`, headline: em(words(x, 5)), background: i === 1 ? "accent" : "solid", align: "left", ...T(i ? "whip" : "zoom"), ...fx("none", ["zoom-punch"], 0.6) })),
      { template: "stat-counter", duration: 3, kicker: "On average", stat: { value: 10, suffix: "x", label: "faster than before" }, background: "invert", ...T("whip"), ...fx("none", ["zoom-punch"], 0.6) },
      end(b),
    ],
  },
  {
    id: "switch", section: "text", name: "Switch & Save", category: "Apps & SaaS", hook: "Them vs us table", aspect: "1:1", style: "clean", swatch: ["#FFFFFF", "#0A66FF"],
    blurb: "A side-by-side that makes the choice obvious: crosses for them, ticks for you.",
    beats: "1 kinetic hook 'Still using X?' · 2 versus table, 4 rows (feature or 'feature | them | us') · 3 stat-counter of the saving · 4 end card",
    build: (b) => [
      { template: "kinetic-words", duration: 2.4, headline: em("Still doing it the old way?"), background: "invert", ...T("cut"), ...fx("mono", ["zoom-punch"], 0.6) },
      { template: "versus", duration: 5.4, headline: em(`Why teams switch to ${b.product}`), items: b.benefits.slice(0, 4), kicker: "Others", cta: b.product, ...T("glitch") },
      offerStat(b.offer) ? { template: "stat-counter", duration: 3, kicker: b.product, stat: offerStat(b.offer), ...T("whip") } : { template: "title-reveal", duration: 2.8, kicker: "The result", headline: em(words(b.benefits[0], 6)), ...T("whip") },
      end(b),
    ],
  },
  {
    id: "problem-solution", section: "text", name: "Problem → Solution", category: "Apps & SaaS", hook: "Mono to colour", aspect: "16:9", style: "noir", swatch: ["#0B0B0C", "#C8FF3D"],
    blurb: "The problem in grey, a glitch, then the world turns to colour with your product.",
    beats: "1-2 kinetic/title in mono grade naming the pain (frustration, wasted time) · 3 glitch transition into logo-reveal in full colour · 4 feature-list · 5 end card",
    build: (b) => [
      { template: "kinetic-words", duration: 2.8, headline: em(`Tired of ${words(b.benefits[0].toLowerCase().replace(/^(no|zero) /, ""), 4)} problems?`), background: "solid", ...T("cut"), ...fx("mono", ["vignette", "dust"], 0.7) },
      { template: "title-reveal", duration: 2.8, headline: em("There's a better way"), background: "solid", ...T("fade"), ...fx("mono", ["vignette"], 0.7) },
      { template: "logo-reveal", duration: 3, headline: b.product, subline: words(b.what, 8), ...T("glitch"), ...fx("vivid", ["zoom-punch", "flash"], 0.7) },
      { template: "feature-list", duration: 4.6, kicker: b.product, headline: em(words(b.what, 5)), items: b.benefits.slice(0, 3), ...T("push-up") },
      end(b),
    ],
  },
  {
    id: "launch-trailer", section: "mixed", name: "Launch Trailer", category: "Apps & SaaS", hook: "Cinematic trailer", aspect: "16:9", style: "noir", swatch: ["#0B0B0C", "#E08A3C"],
    blurb: "Letterbox, slow titles, a film-burn reveal. Launches that feel like premieres.",
    beats: "1-2 slow title-reveals (dramatic motion, letterbox) building tension · 3 text-mask product name with film-burn · 4 fullbleed shot · 5 logo-reveal · 6 end card with launch date",
    build: (b, im) => [
      { template: "title-reveal", duration: 3.2, headline: em("Some things change everything"), background: "solid", motion: "dramatic", ...T("cut"), ...fx("teal-orange", ["letterbox", "vignette"], 0.7) },
      { template: "title-reveal", duration: 3, headline: em(`For ${b.audience}`), background: "solid", motion: "dramatic", ...T("fade"), ...fx("teal-orange", ["letterbox", "vignette"], 0.7) },
      { template: "text-mask", duration: 3.2, headline: words(b.product, 2), subline: words(b.what, 9), image: img(im, 0), motion: "dramatic", ...T("spin"), ...fx("teal-orange", ["film-burn", "letterbox"], 0.7) },
      shot(im, 1, { template: "fullbleed", duration: 3, headline: em(words(b.benefits[0], 5)), motion: "dramatic", ...T("whip"), ...fx("teal-orange", ["letterbox", "push-in"], 0.65) }, { template: "kinetic-words", duration: 2.8, headline: em(words(b.benefits[0], 6)), background: "solid", ...T("whip"), ...fx("teal-orange", ["letterbox"], 0.6) }),
      end(b, { ...T("fade"), motion: "dramatic", ...fx("teal-orange", ["vignette"], 0.6) }),
    ],
  },
  // ---- brand & story
  {
    id: "founder", section: "mixed", name: "Founder Story", category: "Brand & story", hook: "A personal why", aspect: "4:5", style: "editorial", swatch: ["#EEEAE3", "#2F55FF"],
    blurb: "Why it exists, in the founder's voice. Trust beats features.",
    beats: "1 quote 'I started X because…' · 2 fullbleed/photo with the moment · 3 quote of the belief · 4 title-reveal of the mission · 5 end card",
    build: (b, im) => [
      { template: "quote", duration: 4.6, headline: `I started ${b.product} because ${b.audience} deserved better.`, author: `Founder, ${b.product}`, ...T("cut"), ...fx("warm-film", ["dust", "vignette"], 0.5) },
      shot(im, 0, { template: "fullbleed", duration: 3, headline: em(words(b.what, 6)), ...T("fade"), ...fx("warm-film", ["push-in", "vignette"], 0.55) }, { template: "title-reveal", duration: 3, headline: em(words(b.what, 6)), ...T("fade") }),
      { template: "quote", duration: 4.2, headline: `${cap(words(b.benefits[0], 10))}. That's the whole point.`, author: b.product, ...T("fade"), ...fx("warm-film", ["dust"], 0.45) },
      end(b, { ...T("fade"), ...fx("warm-film", ["vignette"], 0.45) }),
    ],
  },
  {
    id: "manifesto", section: "text", name: "Manifesto", category: "Brand & story", hook: "Kinetic poster type", aspect: "9:16", style: "swiss", swatch: ["#F3F0E9", "#FF4D1A"],
    blurb: "A rhythm of bold statements, each slamming in. Brand films for social.",
    beats: "4-5 word-stack statements (3-5 words each, 'We believe…', 'No more…'), alternating backgrounds, whip transitions, zoom-punch · logo-reveal · end card",
    build: (b) => [
      ...[`Made for ${b.audience}`, "No shortcuts", b.benefits[0], "This is our promise"].map((x, i): Beat => ({ template: "word-stack", duration: 2, headline: em(words(x, 5)), background: i % 2 ? "invert" : "solid", ...T(i ? "whip" : "cut"), ...fx("none", ["zoom-punch"], 0.65) })),
      { template: "logo-reveal", duration: 2.8, headline: b.product, subline: words(b.what, 8), ...T("spin") },
      end(b),
    ],
  },
  {
    id: "podcast", section: "mixed", name: "Podcast Teaser", category: "Brand & story", hook: "Audiogram + POV", aspect: "1:1", style: "aurora", swatch: ["#0C0D19", "#8B6CFF"],
    blurb: "A breathing audiogram with live captions. Add a voice-over clip in the Voice tab.",
    beats: "1 pov-caption hook from the episode · 2 audiogram (kicker show, headline episode) · 3 end card 'Listen now'",
    build: (b, im) => [
      { template: "word-stack", duration: 2, headline: em(words(b.benefits[0], 5)), background: "solid", ...T("cut"), ...fx("none", ["zoom-punch"], 0.6) },
      { template: "audiogram", duration: 10, kicker: b.product, headline: em(words(b.what, 6)), subline: b.benefits[1], image: img(im, 0), background: "blobs", ...T("spin") },
      end(b, { cta: b.cta || "Listen now" }),
    ],
  },
  // ---- local & events
  {
    id: "event", section: "mixed", name: "Event Countdown", category: "Local & events", hook: "Countdown + date", aspect: "9:16", style: "aurora", swatch: ["#0C0D19", "#8B6CFF"],
    blurb: "Build the night: countdown, the name in giant footage letters, the details, the tickets.",
    beats: "1 countdown to the event · 2 text-mask event name · 3 feature-list date/time/place (benefits) · 4 pov-caption 'POV: you got tickets' · 5 end card 'Get tickets'",
    build: (b, im) => [
      { template: "countdown", duration: 3, kicker: "Coming up", stat: { value: 3 }, headline: em(b.product), background: "solid", ...T("cut"), ...fx("vivid", ["pulse"], 0.6) },
      { template: "text-mask", duration: 3, headline: words(b.product, 2), subline: words(b.what, 9), image: img(im, 0), ...T("spin"), ...fx("none", ["zoom-punch"], 0.6) },
      { template: "feature-list", duration: 4.4, kicker: "Save the date", headline: em(words(b.what, 5)), items: b.benefits.slice(0, 3), ...T("whip") },
      { template: "pov-caption", duration: 2.8, kicker: "POV:", headline: em("you got tickets before they sold out"), image: img(im, 1), ...T("whip"), ...fx("vivid", ["zoom-punch"], 0.6) },
      end(b, { cta: b.cta || "Get tickets", ...fx("vivid", ["confetti"], 0.7) }),
    ],
  },
  {
    id: "menu", section: "mixed", name: "Menu Hero", category: "Local & events", hook: "Spotlight on the dish", aspect: "4:5", style: "blush", swatch: ["#F6E9E4", "#C8553D"],
    blurb: "One dish in the spotlight, words you can taste, the rating, and where to find you.",
    beats: "1 spotlight on the signature dish · 2 word-stack of taste words · 3 rating from diners · 4 end card with address/booking",
    build: (b, im) => [
      shot(im, 0, { template: "spotlight", duration: 3.4, headline: em(words(b.what, 5)), subline: b.product, ...T("cut"), ...fx("warm-film", ["film-burn"], 0.6) }, { template: "title-reveal", duration: 3, headline: em(words(b.what, 5)), kicker: b.product, ...T("cut"), ...fx("warm-film", [], 0.5) }),
      { template: "word-stack", duration: 2.4, headline: em(words(b.benefits.join(" "), 5)), background: "accent", ...T("whip"), ...fx("none", ["zoom-punch"], 0.6) },
      { template: "rating", duration: 3.4, stat: { value: 4.8, label: "from local diners" }, headline: "The best thing I've eaten all year.", author: "A regular", ...T("fade") },
      end(b, { cta: b.cta || "Book a table" }),
    ],
  },
  {
    id: "hiring", section: "text", name: "We're Hiring", category: "Local & events", hook: "Recruiting slam", aspect: "1:1", style: "swiss", swatch: ["#F3F0E9", "#111111"],
    blurb: "Recruiting that doesn't look like a job board: a slam title, the perks, a chat from the team.",
    beats: "1 word-stack 'We're hiring' · 2 chat from a teammate · 3 feature-list perks · 4 end card 'Apply'",
    build: (b) => [
      { template: "word-stack", duration: 2.2, headline: em("We're hiring"), background: "accent", ...T("cut"), ...fx("none", ["zoom-punch"], 0.65) },
      { template: "chat", duration: 5.6, kicker: `${b.product} team`, items: ["hey! are you the one we've been looking for?", "> depends, what's it like?", `${words(b.benefits[0], 6).toLowerCase()} for a start`, "> I'm listening 👀"], ...T("whip") },
      { template: "feature-list", duration: 4.4, kicker: "Why join", headline: em(`Life at ${b.product}`), items: b.benefits.slice(0, 3), ...T("push-up") },
      end(b, { cta: b.cta || "Apply now" }),
    ],
  },
  // ---- promos & offers
  {
    id: "flash-sale", section: "mixed", name: "Flash Sale", category: "Promos & offers", hook: "Offer explosion", aspect: "9:16", style: "aurora", swatch: ["#0C0D19", "#FF3D6E"],
    blurb: "SALE slams in, the discount counts up with confetti, a countdown creates urgency.",
    beats: "1 word-stack 'SALE' with glitch · 2 stat-counter of the discount with confetti and zoom-punch · 3 product shot · 4 countdown 'ends in' · 5 end card",
    build: (b, im) => [
      { template: "word-stack", duration: 1.8, headline: em("Flash sale"), background: "accent", ...T("cut"), ...fx("vivid", ["glitch", "zoom-punch"], 0.8) },
      { template: "stat-counter", duration: 3, kicker: b.product, stat: offerStat(b.offer) ?? { value: 30, suffix: "%", label: "off everything" }, background: "solid", ...T("spin"), ...fx("vivid", ["confetti", "zoom-punch"], 0.8) },
      shot(im, 0, { template: "product-hero", duration: 2.8, headline: em(words(b.what, 5)), ...T("whip"), ...fx("vivid", ["pulse"], 0.6) }, { template: "kinetic-words", duration: 2.4, headline: em(words(b.benefits[0], 6)), background: "gradient", ...T("whip") }),
      { template: "countdown", duration: 3, kicker: "Ends in", stat: { value: 3 }, headline: em("Don't miss it"), background: "invert", ...T("glitch"), ...fx("vivid", ["pulse"], 0.6) },
      end(b, fx("vivid", ["confetti"], 0.7)),
    ],
  },
  {
    id: "last-chance", section: "text", name: "Last Chance", category: "Promos & offers", hook: "Urgency notifications", aspect: "9:16", style: "noir", swatch: ["#0B0B0C", "#FF4D1A"],
    blurb: "Low-stock alerts and a ticking clock: urgency that converts.",
    beats: "1 notification low-stock alerts · 2 word-stack 'Last chance' · 3 stat-counter offer · 4 end card",
    build: (b) => [
      { template: "notification", duration: 4.4, kicker: "11:58", items: [`${b.product}: Only 12 left`, `${b.product}: Offer ends at midnight`, "Messages: did you get one yet??"], headline: em("Last chance"), ...T("cut") },
      { template: "word-stack", duration: 2, headline: em("Ends tonight"), background: "accent", ...T("glitch"), ...fx("vivid", ["zoom-punch", "rgb-split"], 0.7) },
      { template: "stat-counter", duration: 3, kicker: b.product, stat: offerStat(b.offer) ?? { value: 25, suffix: "%", label: "off, today only" }, ...T("whip"), ...fx("vivid", ["zoom-punch"], 0.6) },
      end(b),
    ],
  },
];


// ---------------------------------------------------------------- footage formats
const briefText = (b: Brief) => `${b.product}, ${b.what}, for ${b.audience}`;
interface Take {
  type: ShotType;
  /** what the shot shows (turned into stock searches in the brief's world) */
  idea: string;
  d: number;
  /** words on the shot, if any */
  text?: string;
  kicker?: string;
}
/** A footage edit: full-bleed shots in one look, a title on the opener, the end card over the last shot. */
function reel(b: Brief, im: string[], look: ProdLook, takes: Take[], o: { title?: string; transitions?: TransitionId[]; extra?: Effect[] } = {}): Beat[] {
  const L = LOOKS_PROD[look];
  const effects = [...new Set([...L.effects, ...(o.extra ?? [])])].slice(0, 4);
  const beats: Beat[] = takes.map((t, i) => {
    const query = queriesFor(t.idea, briefText(b), t.type, b.product)[0] ?? t.idea;
    const image = img(im, i);
    const tr = o.transitions?.[i % (o.transitions?.length || 1)] ?? L.transition;
    if (!image) return { template: "title-reveal", duration: t.d, headline: em(words(t.text ?? t.idea, 5)), kicker: t.kicker, background: "gradient", ...T(i ? tr : "cut"), ...fx(L.grade, [], L.amount) };
    return {
      template: "fullbleed", duration: t.d, image, ...(t.text && { headline: em(words(t.text, 5)) }), ...(t.kicker && { kicker: t.kicker }),
      ...T(i ? tr : "cut"), ...fx(L.grade, effects, L.amount), ...(L.speed !== 1 && { clipSpeed: L.speed }), shot: { type: t.type, query },
    };
  });
  if (o.title && beats[0]) beats[0] = { ...beats[0], kicker: b.product, headline: em(words(o.title, 6)) };
  const last = img(im, takes.length);
  beats.push(end(b, { ...(last && { backdrop: [last] }), ...fx(L.grade, L.effects.filter((e) => e !== "letterbox").slice(0, 2), L.amount), shot: { type: "wide", query: queriesFor(b.what, briefText(b), "product", b.product)[0] ?? b.what } }));
  return beats;
}

const FOOTAGE: Format[] = [
  {
    id: "cinematic-montage", section: "footage", name: "Cinematic Montage", category: "Brand & story", hook: "Trailer-grade edit", aspect: "16:9", style: "noir", look: "cinematic", swatch: ["#12606a", "#e08a3c"],
    blurb: "Wide, close, detail, people: a graded, letterboxed montage of your world, titled once.",
    beats: "establishing wide → people moment → product close-up → detail → wide payoff → end card over footage",
    build: (b, im) => reel(b, im, "cinematic", [
      { type: "establishing", idea: "city sunrise aerial", d: 3 },
      { type: "people", idea: b.audience, d: 2.6 },
      { type: "product", idea: b.what, d: 2.8 },
      { type: "detail", idea: b.benefits[0], d: 2.4 },
      { type: "wide", idea: b.benefits[1] ?? b.what, d: 2.8 },
    ], { title: b.what, transitions: ["cut", "fade", "cut", "spin"] }),
  },
  {
    id: "beat-montage", section: "footage", name: "Beat Montage", category: "Social hooks", hook: "Fast cuts on the beat", aspect: "9:16", style: "noir", look: "commercial", swatch: ["#0B0B0C", "#FF3D6E"],
    blurb: "Eight quick shots punched in on the beat. Add a music track and every cut lands on it.",
    beats: "8 shots of about a second each, whip transitions and zoom punches, snapped to the music's beats → end card",
    build: (b, im) => reel(b, im, "commercial", [b.what, b.audience, ...b.benefits, b.product, "city night lights", "people laughing", "running feet"].slice(0, 8).map((idea, i): Take => ({ type: (["product", "people", "close-up", "detail", "wide", "medium", "people", "close-up"] as ShotType[])[i], idea, d: 1.2 })), { transitions: ["whip", "cut", "glitch", "cut"], extra: ["zoom-punch"] }),
  },
  {
    id: "lookbook", section: "footage", name: "Lookbook", category: "E-commerce", hook: "Editorial product reel", aspect: "4:5", style: "editorial", look: "commercial", swatch: ["#EEEAE3", "#2F55FF"],
    blurb: "An editorial sequence of product looks, one small label each, slow pushes.",
    beats: "4-6 product/lifestyle shots, each with a 1-2 word label (kicker) → end card",
    build: (b, im) => reel(b, im, "commercial", [b.what, ...b.benefits, b.product].slice(0, 5).map((idea, i): Take => ({ type: i % 2 ? "detail" : "product", idea, d: 2.4, kicker: words(i ? b.benefits[i - 1] ?? b.product : b.product, 3) })), { transitions: ["fade", "slide"] }),
  },
  {
    id: "day-in-life", section: "footage", name: "Day in the Life", category: "Brand & story", hook: "Morning to night", aspect: "9:16", style: "clean", look: "documentary", swatch: ["#d8c39a", "#8a6a45"],
    blurb: "A real day with your audience, time-stamped from sunrise to night, the product in it.",
    beats: "7:00 morning → 9:00 out → 12:30 midday with the product → 18:00 moving → 22:00 night → end card",
    build: (b, im) => reel(b, im, "documentary", [
      { type: "establishing", idea: "sunrise window light", d: 2.4, text: "7:00 am" },
      { type: "people", idea: `${b.audience} morning coffee`, d: 2.4, text: "9:00 am" },
      { type: "product", idea: b.what, d: 2.6, text: "12:30 pm" },
      { type: "people", idea: `${b.audience} ${b.benefits[0]}`, d: 2.4, text: "6:00 pm" },
      { type: "wide", idea: "city night lights", d: 2.4, text: "10:00 pm" },
    ], { transitions: ["cut", "whip"] }),
  },
  {
    id: "detail-reel", section: "footage", name: "Detail Reel", category: "E-commerce", hook: "Macro craftsmanship", aspect: "1:1", style: "noir", look: "noir", swatch: ["#000000", "#dddddd"],
    blurb: "Close-ups and macro detail in hard black and white. Craft you can almost touch.",
    beats: "5 macro/close-up shots of the product and materials, slow motion, one word each → end card",
    build: (b, im) => reel(b, im, "noir", [b.what, ...b.benefits, "hands holding product"].slice(0, 5).map((idea, i): Take => ({ type: i % 2 ? "detail" : "close-up", idea: `${idea} close up`, d: 2.2, ...(i === 2 && { text: words(b.benefits[0], 3) }) })), { transitions: ["cut", "fade"] }),
  },
  {
    id: "place-tour", section: "footage", name: "Place Tour", category: "Local & events", hook: "Aerial to inside", aspect: "16:9", style: "aurora", look: "cinematic", swatch: ["#0C0D19", "#8B6CFF"],
    blurb: "For venues, stays, homes and cities: from the air, through the door, to the people enjoying it.",
    beats: "aerial establishing → exterior → interior → people enjoying → night → end card",
    build: (b, im) => reel(b, im, "cinematic", [
      { type: "establishing", idea: `${b.what} aerial`, d: 3 },
      { type: "wide", idea: `${b.what} exterior`, d: 2.6 },
      { type: "medium", idea: `${b.what} interior`, d: 2.6 },
      { type: "people", idea: `people enjoying ${b.what}`, d: 2.6 },
      { type: "wide", idea: "city night lights", d: 2.6 },
    ], { title: b.product, transitions: ["fade", "cut"] }),
  },
  {
    id: "mood-film", section: "footage", name: "Mood Film", category: "Brand & story", hook: "Dreamy slow motion", aspect: "4:5", style: "blush", look: "dreamy", swatch: ["#f3c6d8", "#c8d8ff"],
    blurb: "Soft light, slow motion, floating textures. A feeling first, the product second.",
    beats: "light/nature textures → the audience in a calm moment → product in soft light → one line → end card",
    build: (b, im) => reel(b, im, "dreamy", [
      { type: "abstract", idea: "sunlight through leaves", d: 2.8 },
      { type: "people", idea: `${b.audience} calm moment`, d: 2.8 },
      { type: "product", idea: b.what, d: 3, text: b.benefits[0] },
      { type: "abstract", idea: "water slow motion", d: 2.6 },
    ], { transitions: ["fade"] }),
  },
  {
    id: "photo-story", section: "footage", name: "Photo Story", category: "Brand & story", hook: "Your photos, moving", aspect: "9:16", style: "editorial", look: "documentary", swatch: ["#EEEAE3", "#1B1A18"],
    blurb: "Your own photos and clips with slow pushes and film colour. Perfect over a voice-over.",
    beats: "your library images in order, Ken Burns moves, a title on the first, end card",
    build: (b, im) => reel(b, im, "documentary", [b.what, ...b.benefits, b.product].slice(0, 5).map((idea, i): Take => ({ type: i ? "medium" : "establishing", idea, d: 2.6 })), { title: b.product, transitions: ["fade"] }),
  },
];
FORMATS.push(...FOOTAGE);
FORMATS.unshift(...ENERGETIC);

// ---------------------------------------------------------------- voice-over
/** Templates whose headline can carry the spoken words, and how many words each holds. */
const CARRY: Partial<Record<Scene["template"], number>> = { "word-slam": 12, scramble: 12, "zoom-through": 12, "letter-wave": 12, "outline-fill": 14, "flip-words": 12, typewriter: 16, "echo-stack": 12, "title-reveal": 6, "kinetic-words": 10, "word-stack": 6, "pov-caption": 10, fullbleed: 6, spotlight: 4, quote: 16, "split-feature": 6, "product-hero": 4, "device-mockup": 5, marquee: 4 };

/**
 * Build a format around a voice-over: one beat per spoken phrase (cut in the pauses), the
 * format's beats as the palette, and the words on screen taken from what's said. Footage
 * formats become a shot per line with subtitles.
 */
export function buildWithVoice(f: Format, raw: Partial<Brief>, voice: VoiceIn & { insight?: VoiceInsight }, images: string[]): { scenes: Beat[]; captions: boolean } {
  const b = fill(raw);
  const hasWords = !!voice.words?.length;
  if (f.section === "footage") {
    const shots: Shot[] = planShots(voice, briefText(b), { text: "clean", brand: b.product, min: 2, max: 3.8 }).map((sh, i) => ({ ...sh, clip: img(images, i) }));
    const L = LOOKS_PROD[f.look ?? "cinematic"];
    const scenes = assemble(shots, { look: f.look ?? "cinematic", text: "subtitles", brand: b.product, title: "", cta: b.cta, url: b.url }).map((s) => (s.template === "fullbleed" && L.speed !== 1 && !s.clipSpeed ? { ...s, clipSpeed: L.speed } : s));
    return { scenes, captions: hasWords };
  }
  const slots = voiceSlots(voice, 1.8, 3.8);
  const palette = f.build(b, images);
  const n = slots.length;
  // The brand's reveal beat goes where the product is named, wherever that is in the read.
  const named = (t?: string) => !!t && new RegExp(`\\b${b.product.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t);
  const isReveal = (x: Beat) => x.template === "logo-reveal" || (["text-mask", "spotlight", "product-hero"].includes(x.template) && named(x.headline));
  const reveal = palette.slice(1, -1).find(isReveal);
  const mention = reveal ? slots.findIndex((sl, i) => i > 0 && !(i === n - 1 && n > 2) && named(sl.text)) : -1;
  const rest = palette.slice(1, -1).filter((x) => !(reveal && mention >= 0 && x === reveal));
  const body = rest.length ? rest : palette.slice(1, -1).length ? palette.slice(1, -1) : palette;
  let bi = 0;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const usedOnce = new Set<number>();
  const scenes = slots.map((slot, i): Beat => {
    let beat = i === 0 ? palette[0] : i === n - 1 && n > 2 ? palette[palette.length - 1] : i === mention && reveal ? reveal : body[bi++ % body.length];
    // Proof beats (a rating, a chat, a table) play once; after that the narration carries on as type.
    const k = body.indexOf(beat);
    if (i > 0 && !(i === n - 1 && n > 2) && !CARRY[beat.template] && hasWords) {
      if (usedOnce.has(k)) beat = { template: "kinetic-words", duration: beat.duration, background: i % 2 ? "invert" : "solid", transition: "whip", grade: beat.grade, effects: beat.effects?.filter((e) => e !== "confetti"), fxAmount: beat.fxAmount };
      else usedOnce.add(k);
    }
    const max = beat === reveal ? undefined : CARRY[beat.template];
    const spoken = hasWords && slot.text ? slot.text : "";
    const duration = +(r2(slot.e) - r2(slot.s)).toFixed(2);
    // Giant-letter beats show the line's key word instead of the whole line.
    const key = beat.template === "text-mask" && beat !== reveal && spoken ? keyWord(spoken, b.product) : undefined;
    return { ...beat, duration, ...(spoken && max && { headline: emSpoken(clipWords(spoken, max).replace(/…$/, ""), voice.insight?.stressedWords) }), ...(key && { headline: key }), ...(i === 0 && { transition: "cut" as const }) };
  });
  return { scenes: paced(scenes, voice.insight), captions: false };
}

/**
 * Cut to the read: a fast, energetic voice gets hard cuts and whips with snappy motion; a slow
 * or dramatic one gets dissolves and unhurried motion. The opening cut and end card stay.
 */
export function paced<S extends Beat>(scenes: S[], ins?: Pick<VoiceInsight, "pace" | "mood">): S[] {
  if (!ins) return scenes;
  const fast = ins.pace === "fast" || ins.pace === "brisk" || ins.mood === "energetic";
  const slow = ins.pace === "slow" || ins.mood === "dramatic" || ins.mood === "calm";
  if (!fast && !slow) return scenes;
  return scenes.map((s, i) => {
    if (i === 0 || s.template === "cta-end") return s;
    if (fast) return { ...s, motion: s.motion === "dramatic" ? s.motion : "snappy", transition: s.transition === "fade" || s.transition === "slide" || s.transition === "push-up" ? (i % 2 ? "whip" : "cut") : s.transition };
    return { ...s, motion: ins.mood === "dramatic" ? "dramatic" : "calm", transition: s.transition === "whip" || s.transition === "glitch" || s.transition === "cut" ? "fade" : s.transition };
  });
}

/** The strongest single word of a line (a number, else the longest meaningful word, not the brand). */
function keyWord(line: string, brand: string): string | undefined {
  const ws = line.replace(/[^\p{L}\p{N}%' -]/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w.toLowerCase()) && w.toLowerCase() !== brand.toLowerCase());
  return ws.sort((a, c) => Number(/\d/.test(c)) - Number(/\d/.test(a)) || c.length - a.length)[0];
}

/** Move cuts onto the music's beats (within 0.35 s), keeping every scene at least 0.8 s. */
export function snapToBeats<S extends { duration: number }>(scenes: S[], beats: number[]): S[] {
  if (!beats.length || scenes.length < 2) return scenes;
  let t = 0, prev = 0;
  return scenes.map((s, i) => {
    t += s.duration;
    let end = t;
    if (i < scenes.length - 1) {
      const near = beats.filter((x) => Math.abs(x - t) <= 0.35 && x - prev >= 0.8).sort((a, c) => Math.abs(a - t) - Math.abs(c - t))[0];
      if (near !== undefined) end = near;
    }
    const d = +(end - prev).toFixed(3);
    prev = end;
    return { ...s, duration: d };
  });
}

/** A narration for generating a voice-over: a hook, what it is, the benefits, the offer, the ask. */
export function scriptFor(f: Format, raw: Partial<Brief>): string {
  const b = fill(raw);
  const hook: Record<Category, string> = {
    "Social hooks": `Okay, ${b.audience}, stop scrolling for a second.`,
    "E-commerce": `This is the one everyone's been asking about.`,
    "Apps & SaaS": `What if the hard part just… took care of itself?`,
    "Brand & story": `Some things are made with a little more care.`,
    "Local & events": `Here's where you want to be.`,
    "Promos & offers": `Quick, this won't last.`,
  };
  const lines = [hook[f.category], `Meet ${b.product}: ${b.what}.`, ...b.benefits.slice(0, 3).map((x) => `${cap(x.replace(/\.$/, ""))}.`), ...(b.offer ? [`${cap(b.offer.replace(/\.$/, ""))}.`] : []), `${cap(b.cta)}${b.url ? ` at ${b.url}` : ""}.`];
  return lines.join(" ");
}

/**
 * Formats that suit the audio: the voice's mood and pace, the music's mood, what's on offer.
 * Returns format ids, best first, with a short reason each.
 */
export function recommend(voice?: Pick<VoiceInsight, "mood" | "pace" | "cta"> & { text?: string }, music?: Pick<MusicInsight, "mood">, offer?: string): { id: string; why: string }[] {
  const score = new Map<string, { n: number; why: string }>();
  const add = (ids: string[], n: number, why: string) => ids.forEach((id) => { const cur = score.get(id); if (!cur || cur.n < n) score.set(id, { n: (cur?.n ?? 0) + n, why: cur && cur.n >= n ? cur.why : why }); else cur.n += n; });
  if (voice) {
    if (voice.mood === "energetic" || voice.pace === "fast" || voice.pace === "brisk") add(["stop-scroll", "pov-hook", "three-reasons", "product-drop", "flash-sale", "manifesto"], 3, "an energetic, quick read");
    if (voice.mood === "dramatic") add(["launch-trailer", "cinematic-montage", "manifesto", "problem-solution"], 3, "a dramatic read with real pauses");
    if (voice.mood === "calm") add(["founder", "mood-film", "photo-story", "detail-reel"], 3, "a calm, unhurried voice");
    if (voice.mood === "warm") add(["founder", "social-proof", "day-in-life", "group-chat", "transformation"], 3, "a warm, personal voice");
    const t = voice.text?.toLowerCase() ?? "";
    if (/(app|download|screen|tap)/.test(t)) add(["app-demo", "switch"], 2, "it talks about an app");
    if (/(review|stars|customers|loved|rated)/.test(t)) add(["social-proof"], 2, "it mentions reviews");
    if (/(event|tickets|tonight|join us|live)/.test(t)) add(["event"], 2, "it promotes an event");
    if (/(menu|taste|dish|table|restaurant)/.test(t)) add(["menu"], 2, "it's about food");
    if (/(hiring|join our team|careers)/.test(t)) add(["hiring"], 3, "it's recruiting");
  }
  if (music) {
    if (music.mood === "upbeat" || music.mood === "driving") add(["beat-montage", "flash-sale", "stop-scroll"], voice ? 1 : 3, `${music.mood} music`);
    if (music.mood === "cinematic" || music.mood === "dark") add(["cinematic-montage", "launch-trailer", "detail-reel"], voice ? 1 : 3, `${music.mood} music`);
    if (music.mood === "chill") add(["mood-film", "lookbook", "photo-story"], voice ? 1 : 3, "chill music");
  }
  if (offer || /(\d+\s?%|\b(off|sale|discount)\b)/i.test(voice?.cta ?? "")) add(["flash-sale", "last-chance"], 4, "there's an offer");
  return [...score.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 4).map(([id, v]) => ({ id, why: v.why }));
}

/** Placeholder refs the studio swaps for stock footage it casts (valid asset refs, so they survive cleaning). */
export const stockRef = (i: number) => `asset:stock_${i}`;
export const isStockRef = (r?: string) => !!r && /^asset:stock_\d+$/.test(r);

export const formatById = (id: string) => FORMATS.find((f) => f.id === id);

/** Build a format's draft from a (partial) brief and the library's images. */
export function buildFormat(f: Format, brief: Partial<Brief>, images: string[]): Beat[] {
  const b = fill(brief);
  // Long copy gets the time it needs to be read (the same pace the Director's notes check).
  const n = (t?: string) => (t ? t.replace(/\*/g, "").trim().split(/\s+/).filter(Boolean).length : 0);
  const scenes = f.build(b, images).map((s) => {
    // These reveal their text over time (words, messages, alerts), so their designed pace stands.
    if (["kinetic-words", "audiogram", "chat", "notification", "word-slam", "scramble", "zoom-through", "letter-wave", "outline-fill", "flip-words", "typewriter", "echo-stack"].includes(s.template)) return s;
    const wordsOn = n(s.headline) + n(s.subline) + (s.items ?? []).reduce((a, it) => a + n(it), 0) + n(s.stat?.label);
    return { ...s, duration: +Math.min(15, Math.max(s.duration, wordsOn / 3.2 + 0.85)).toFixed(2) };
  });
  if (scenes[0]) scenes[0] = { ...scenes[0], transition: "cut" };
  return scenes;
}
