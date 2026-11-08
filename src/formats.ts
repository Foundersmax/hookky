// Creative formats: proven attention structures for ads, each a sequence of beats built from the
// studio's templates, effects and transitions. Every format builds a finished draft locally from a
// short brief; with Claude available the server rewrites that draft (copy, emphasis, effects)
// while keeping its structure. Pure (no DOM).
import type { Aspect, Effect, Grade, Scene, TransitionId } from "./types";

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
export type Category = (typeof CATEGORIES)[number];

type Beat = Omit<Scene, "id">;
export interface Format {
  id: string;
  name: string;
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

// ---------------------------------------------------------------- the formats
export const FORMATS: Format[] = [
  // ---- social hooks
  {
    id: "pov-hook", name: "POV Hook", category: "Social hooks", hook: "Native POV caption", aspect: "9:16", style: "noir", swatch: ["#0B0B0C", "#C8FF3D"],
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
    id: "stop-scroll", name: "Pattern Interrupt", category: "Social hooks", hook: "Glitch + slam text", aspect: "9:16", style: "noir", swatch: ["#000000", "#FF3D6E"],
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
    id: "group-chat", name: "Group Chat", category: "Social hooks", hook: "A chat thread", aspect: "9:16", style: "clean", swatch: ["#FFFFFF", "#0A66FF"],
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
    id: "notifications", name: "Notification Storm", category: "Social hooks", hook: "Lock screen pinging", aspect: "9:16", style: "aurora", swatch: ["#0C0D19", "#8B6CFF"],
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
    id: "myth-fact", name: "Myth vs Fact", category: "Social hooks", hook: "Busting a myth", aspect: "4:5", style: "swiss", swatch: ["#F3F0E9", "#FF4D1A"],
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
    id: "three-reasons", name: "3 Reasons", category: "Social hooks", hook: "Numbered listicle", aspect: "9:16", style: "swiss", swatch: ["#F3F0E9", "#111111"],
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
    id: "product-drop", name: "Product Drop", category: "E-commerce", hook: "Countdown to reveal", aspect: "9:16", style: "noir", swatch: ["#0B0B0C", "#C8FF3D"],
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
    id: "unboxing", name: "Unboxing Reveal", category: "E-commerce", hook: "Light-burn reveal", aspect: "4:5", style: "blush", swatch: ["#F6E9E4", "#C8553D"],
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
    id: "social-proof", name: "Social Proof Wall", category: "E-commerce", hook: "Stars + reviews", aspect: "1:1", style: "clean", swatch: ["#FFFFFF", "#0A66FF"],
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
    id: "transformation", name: "Transformation", category: "E-commerce", hook: "Before → after", aspect: "9:16", style: "blush", swatch: ["#F6E9E4", "#C8553D"],
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
    id: "app-demo", name: "App Walkthrough", category: "Apps & SaaS", hook: "Phone demo", aspect: "9:16", style: "clean", swatch: ["#FFFFFF", "#0A66FF"],
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
    id: "switch", name: "Switch & Save", category: "Apps & SaaS", hook: "Them vs us table", aspect: "1:1", style: "clean", swatch: ["#FFFFFF", "#0A66FF"],
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
    id: "problem-solution", name: "Problem → Solution", category: "Apps & SaaS", hook: "Mono to colour", aspect: "16:9", style: "noir", swatch: ["#0B0B0C", "#C8FF3D"],
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
    id: "launch-trailer", name: "Launch Trailer", category: "Apps & SaaS", hook: "Cinematic trailer", aspect: "16:9", style: "noir", swatch: ["#0B0B0C", "#E08A3C"],
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
    id: "founder", name: "Founder Story", category: "Brand & story", hook: "A personal why", aspect: "4:5", style: "editorial", swatch: ["#EEEAE3", "#2F55FF"],
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
    id: "manifesto", name: "Manifesto", category: "Brand & story", hook: "Kinetic poster type", aspect: "9:16", style: "swiss", swatch: ["#F3F0E9", "#FF4D1A"],
    blurb: "A rhythm of bold statements, each slamming in. Brand films for social.",
    beats: "4-5 word-stack statements (3-5 words each, 'We believe…', 'No more…'), alternating backgrounds, whip transitions, zoom-punch · logo-reveal · end card",
    build: (b) => [
      ...[`Made for ${b.audience}`, "No shortcuts", b.benefits[0], "This is our promise"].map((x, i): Beat => ({ template: "word-stack", duration: 2, headline: em(words(x, 5)), background: i % 2 ? "invert" : "solid", ...T(i ? "whip" : "cut"), ...fx("none", ["zoom-punch"], 0.65) })),
      { template: "logo-reveal", duration: 2.8, headline: b.product, subline: words(b.what, 8), ...T("spin") },
      end(b),
    ],
  },
  {
    id: "podcast", name: "Podcast Teaser", category: "Brand & story", hook: "Audiogram + POV", aspect: "1:1", style: "aurora", swatch: ["#0C0D19", "#8B6CFF"],
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
    id: "event", name: "Event Countdown", category: "Local & events", hook: "Countdown + date", aspect: "9:16", style: "aurora", swatch: ["#0C0D19", "#8B6CFF"],
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
    id: "menu", name: "Menu Hero", category: "Local & events", hook: "Spotlight on the dish", aspect: "4:5", style: "blush", swatch: ["#F6E9E4", "#C8553D"],
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
    id: "hiring", name: "We're Hiring", category: "Local & events", hook: "Recruiting slam", aspect: "1:1", style: "swiss", swatch: ["#F3F0E9", "#111111"],
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
    id: "flash-sale", name: "Flash Sale", category: "Promos & offers", hook: "Offer explosion", aspect: "9:16", style: "aurora", swatch: ["#0C0D19", "#FF3D6E"],
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
    id: "last-chance", name: "Last Chance", category: "Promos & offers", hook: "Urgency notifications", aspect: "9:16", style: "noir", swatch: ["#0B0B0C", "#FF4D1A"],
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

export const formatById = (id: string) => FORMATS.find((f) => f.id === id);

/** Build a format's draft from a (partial) brief and the library's images. */
export function buildFormat(f: Format, brief: Partial<Brief>, images: string[]): Beat[] {
  const b = fill(brief);
  // Long copy gets the time it needs to be read (the same pace the Director's notes check).
  const n = (t?: string) => (t ? t.replace(/\*/g, "").trim().split(/\s+/).filter(Boolean).length : 0);
  const scenes = f.build(b, images).map((s) => {
    // These reveal their text over time (words, messages, alerts), so their designed pace stands.
    if (s.template === "kinetic-words" || s.template === "audiogram" || s.template === "chat" || s.template === "notification") return s;
    const wordsOn = n(s.headline) + n(s.subline) + (s.items ?? []).reduce((a, it) => a + n(it), 0) + n(s.stat?.label);
    return { ...s, duration: +Math.min(15, Math.max(s.duration, wordsOn / 3.2 + 0.85)).toFixed(2) };
  });
  if (scenes[0]) scenes[0] = { ...scenes[0], transition: "cut" };
  return scenes;
}
