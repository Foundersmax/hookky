// The footage director: turns a voice-over into a shot list, casts stock footage for each shot
// and assembles it like an edit — one grade across every clip, coverage that moves from wide to
// close, subtitles, a title and an end card. Pure (no DOM), so the same plan comes out every time.
import type { Aspect, Asset, Effect, Grade, Scene, Word } from "../types";
import { voiceSlots, emphasize, clip as clipWords, type VoiceIn } from "../soundTemplates";

export const SHOT_TYPES = ["establishing", "wide", "medium", "close-up", "detail", "people", "product", "abstract"] as const;
export type ShotType = (typeof SHOT_TYPES)[number];

export interface Shot {
  /** cut points on the voice-over, seconds */
  s: number;
  e: number;
  /** the words spoken over this shot */
  line: string;
  type: ShotType;
  /** what to search the stock libraries for, best first */
  queries: string[];
  /** words on screen for this shot ("" = clean footage) */
  overlay: string;
  /** the clip cast for it, once found */
  clip?: string;
  /** alternatives to swap in */
  alts?: string[];
  /** where in the clip to start, and its playback speed */
  clipStart?: number;
  clipSpeed?: number;
  /** the user picked this clip; don't recast it */
  locked?: boolean;
}

export const LOOKS_PROD = {
  cinematic: { label: "Cinematic", note: "Teal and orange, letterbox, a touch of slow motion", grade: "teal-orange" as Grade, effects: ["vignette", "letterbox"] as Effect[], speed: 0.85, amount: 0.65, transition: "cut" as const },
  documentary: { label: "Documentary", note: "Natural film colour, handheld, real speed", grade: "warm-film" as Grade, effects: ["vignette", "dust"] as Effect[], speed: 1, amount: 0.5, transition: "cut" as const },
  commercial: { label: "Commercial", note: "Bright and punchy, quick clean cuts", grade: "vivid" as Grade, effects: ["push-in"] as Effect[], speed: 1, amount: 0.55, transition: "cut" as const },
  noir: { label: "Noir", note: "Black and white, hard contrast, closing in", grade: "noir" as Grade, effects: ["vignette", "push-in"] as Effect[], speed: 0.9, amount: 0.75, transition: "cut" as const },
  dreamy: { label: "Dreamy", note: "Soft, faded, floating light, slow motion", grade: "faded" as Grade, effects: ["light-leak", "bokeh"] as Effect[], speed: 0.7, amount: 0.6, transition: "fade" as const },
};
export type ProdLook = keyof typeof LOOKS_PROD;
export type TextMode = "subtitles" | "keywords" | "clean";

// ---------------------------------------------------------------- words → pictures
const STOP = new Set(
  "a an and are as at be been but by can could did do does for from had has have he her here him his how i if in into is it its it's just like make made me more most my no not now of on one or our out over own so some than that the their them then there these they this those to too up us very was we were what when where which while who why will with would you your yours ones thing things way really i'm you're we're it's that's don't can't won't get got let let's every all any each again goes go going gone come comes came keep keeps kept take takes took give gives gave put puts say says said see sees saw know knows want wants need needs feel feels look looks always ever still even also only much many lot lots everything something anything nothing someone everyone yesterday tonight yet already ready meet introducing".split(" "),
);
const stem = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(ies)$/, "y").replace(/(ing|ed|es|s)$/, "");

/** Abstract ideas people say in ads, and what a cinematographer would point the camera at. */
const LEXICON: Record<string, string[]> = {
  time: ["clock close up", "time lapse city"], fast: ["city traffic time lapse", "runner sprinting"], speed: ["highway night traffic", "runner sprinting"], quick: ["hands typing fast", "city time lapse"],
  slow: ["slow motion water drop", "calm lake morning"], calm: ["calm lake morning", "woman breathing meditation"], relax: ["woman relaxing sofa", "beach waves sunset"], peace: ["sunrise mountains fog", "calm lake morning"],
  sleep: ["person sleeping bed", "night sky stars"], night: ["city night lights", "night sky stars"], morning: ["sunrise window light", "morning coffee kitchen"], day: ["busy street daytime", "sunlight trees"],
  energy: ["athlete training", "crowd concert lights"], power: ["lightning storm", "athlete lifting weights"], strong: ["athlete lifting weights", "waves crashing rocks"], health: ["healthy breakfast bowl", "woman jogging park"],
  fit: ["woman running park", "gym workout"], run: ["runner city street", "trail running"], move: ["dancer silhouette", "people walking city"], walk: ["people walking city", "walking feet street"],
  love: ["couple laughing", "hands holding"], family: ["family dinner table", "parent child playing"], friend: ["friends laughing together", "friends road trip"], together: ["friends laughing together", "team high five"],
  team: ["team meeting office", "team high five"], work: ["person working laptop", "office desk"], business: ["business meeting", "city office buildings"], office: ["modern office", "person working laptop"],
  money: ["counting money", "credit card payment"], pay: ["contactless payment phone", "credit card payment"], save: ["piggy bank coins", "shopping bags"], price: ["shopping store", "price tag"],
  grow: ["plant growing time lapse", "seedling sunlight"], growth: ["plant growing time lapse", "city skyline sunrise"], future: ["futuristic city", "technology abstract lights"], change: ["seasons changing", "butterfly"],
  new: ["unboxing product", "sunrise"], launch: ["rocket launch", "unboxing product"], start: ["runner starting line", "sunrise"], begin: ["sunrise", "opening door light"],
  idea: ["light bulb", "person writing notebook"], think: ["person thinking window", "notebook sketch"], create: ["artist painting", "designer sketching"], design: ["designer sketching", "architect drawing"],
  build: ["construction site", "hands building"], code: ["code on screen", "developer laptop"], data: ["data visualization screen", "server room"], tech: ["technology circuit board", "smartphone hands"],
  app: ["smartphone hands scrolling", "phone screen app"], phone: ["smartphone hands", "phone call street"], screen: ["phone screen app", "laptop screen"], online: ["laptop browsing", "smartphone hands scrolling"],
  world: ["earth from space", "aerial city"], city: ["aerial city", "city street people"], travel: ["airplane window", "road trip car"], home: ["cozy living room", "front door home"],
  nature: ["forest aerial", "mountain lake"], water: ["ocean waves", "water drop slow motion"], sun: ["sun flare trees", "sunset beach"], sky: ["clouds time lapse", "blue sky clouds"],
  food: ["cooking kitchen", "food plating"], coffee: ["coffee pouring", "latte art"], eat: ["friends eating dinner", "food plating"], taste: ["food close up", "chef tasting"],
  skin: ["skincare routine", "face cream close up"], beauty: ["woman applying makeup", "skincare routine"], glow: ["golden hour portrait", "skincare routine"], care: ["hands applying cream", "caring hands"],
  style: ["fashion model walking", "clothing rack"], fashion: ["fashion model walking", "fashion shoot"], wear: ["getting dressed", "fashion model walking"], shoe: ["sneakers close up", "running shoes"],
  car: ["car driving road", "car interior"], drive: ["car driving road", "highway aerial"], road: ["road aerial", "car driving road"], ride: ["cyclist road", "motorcycle road"],
  music: ["concert crowd", "headphones listening"], sound: ["headphones listening", "speaker vibration"], listen: ["headphones listening", "woman listening music"], dance: ["dancer studio", "people dancing party"],
  learn: ["student studying", "classroom"], school: ["classroom", "students campus"], book: ["reading book", "library books"], read: ["reading book", "person reading tablet"],
  win: ["celebration confetti", "athlete winning"], success: ["celebration confetti", "mountain summit"], goal: ["soccer goal", "mountain summit"], dream: ["dreamy clouds", "person looking at sky"],
  smile: ["woman smiling", "child laughing"], happy: ["people laughing", "child laughing"], fun: ["friends having fun", "kids playing"], joy: ["people laughing", "confetti celebration"],
  problem: ["stressed person desk", "tangled cables"], stress: ["stressed person desk", "traffic jam"], tired: ["tired person yawning", "alarm clock morning"], hard: ["person struggling", "rain window"],
  easy: ["one tap phone", "relaxed person sofa"], simple: ["minimal white room", "one tap phone"], smart: ["smart home device", "smartwatch wrist"], safe: ["lock security", "family home"],
  battery: ["phone charging", "battery charging"], charge: ["phone charging", "electric car charging"], light: ["sunlight window", "light rays forest"], dark: ["dark room light", "night city"],
  watch: ["smartwatch wrist", "watch close up"], wrist: ["smartwatch wrist", "hand wrist"], heart: ["heart rate monitor", "hands heart shape"], track: ["running track", "fitness tracker"],
  sale: ["shopping bags", "store sale"], shop: ["shopping store", "online shopping laptop"], buy: ["shopping bags", "online shopping laptop"], offer: ["shopping bags", "gift box"],
  gift: ["gift box", "unwrapping present"], holiday: ["christmas lights", "holiday family"], summer: ["beach summer", "pool summer"], winter: ["snow forest", "winter city"],
};

/** Categories a brief can belong to, and the b-roll that suits them. */
const SUBJECTS: Record<string, string[]> = {
  watch: ["smartwatch wrist", "watch close up"], skincare: ["skincare routine", "face cream close up"], coffee: ["coffee pouring", "coffee shop"], app: ["smartphone hands scrolling", "phone screen app"],
  software: ["person working laptop", "laptop screen"], fitness: ["gym workout", "woman running park"], shoe: ["sneakers close up", "running shoes"], fashion: ["fashion model walking", "clothing rack"],
  food: ["cooking kitchen", "food plating"], restaurant: ["restaurant dinner", "chef cooking"], car: ["car driving road", "car interior"], travel: ["airplane window", "road trip car"],
  home: ["cozy living room", "modern house exterior"], bank: ["contactless payment phone", "city office buildings"], finance: ["stock market screen", "credit card payment"], game: ["gamer playing", "game controller"],
  music: ["headphones listening", "concert crowd"], beauty: ["woman applying makeup", "skincare routine"], pet: ["dog playing", "cat home"], kid: ["kids playing", "parent child playing"],
  drink: ["drink pouring glass", "friends drinking"], education: ["student studying", "online class laptop"], health: ["doctor patient", "healthy breakfast bowl"], hotel: ["hotel room", "resort pool"],
};

/** The visual subject of a brief ("Orbit, a smartwatch for runners" → watch b-roll and "smartwatch"). */
export function subjectOf(brief: string): { word?: string; queries: string[] } {
  const words = brief.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (const w of words) {
    const s = stem(w);
    const key = Object.keys(SUBJECTS).find((k) => s === k || s.endsWith(k) || (k.length > 3 && s.startsWith(k)));
    if (key) return { word: w, queries: SUBJECTS[key] };
  }
  const noun = words.filter((w) => w.length > 3 && !STOP.has(w)).pop();
  return { word: noun, queries: noun ? [noun, `${noun} close up`] : [] };
}

/** Who the ad is for, as someone a stock library can show ("for runners" → "runner"), so the same kind of person carries the edit. */
const PERSONAS: [RegExp, string][] = [
  [/\brunn(er|ers|ing)\b/, "runner"], [/\b(athlete|athletes)\b/, "athlete"], [/\b(busy|working) (people|professionals|adults)|\bprofessionals?\b|\bworkers?\b/, "young professional"],
  [/\b(moms?|mothers?|mums?)\b/, "mother"], [/\b(dads?|fathers?)\b/, "father"], [/\bparents?\b/, "parent"], [/\bfamil(y|ies)\b/, "family"], [/\bstudents?\b/, "student"],
  [/\bgamers?\b/, "gamer"], [/\btravel+ers?\b/, "traveler"], [/\bteams?\b/, "office team"], [/\b(women|woman|her)\b/, "woman"], [/\b(men|man|him)\b/, "man"],
  [/\b(founders?|entrepreneurs?|startups?)\b/, "entrepreneur"], [/\b(seniors?|elderly|retirees?)\b/, "senior"], [/\b(kids?|children)\b/, "child"], [/\b(creators?|designers?)\b/, "creative professional"],
];
export function personaOf(brief: string): string | undefined {
  const b = brief.toLowerCase();
  return PERSONAS.find(([re]) => re.test(b))?.[1];
}
/** Put the persona into a picture that has a person in it ("person sleeping in bed" → "runner sleeping in bed"). */
export function cast(q: string, persona?: string): string {
  if (!persona) return q;
  return q.replace(/\b(a |an )?(person|woman|man|people)\b/, persona);
}

/** The words of a line worth picturing, strongest first. Things the line wants gone ("stress less", "no more waiting") aren't pictured. */
export function keywords(line: string, exclude: string[] = []): string[] {
  const toks = line.split(/\s+/).map((w) => w.toLowerCase().replace(/[^a-z0-9'-]/g, ""));
  const skip = new Set(exclude.map((w) => stem(w)));
  const seen = new Set<string>();
  const out: { w: string; i: number }[] = [];
  toks.forEach((w, i) => {
    if (w.length <= 2 || STOP.has(w) || /^\d+$/.test(w) || w.includes("-") || skip.has(stem(w))) return;
    if (/^(less|free)$/.test(toks[i + 1] ?? "") || /^(no|without|never|zero|stop|forget)$/.test(toks[i - 1] ?? "") || /^(no|without|never|zero|stop|forget)$/.test(toks[i - 2] ?? "")) return;
    if (/^(less|free|more|better|further|faster|today|tomorrow)$/.test(w)) return;
    if (seen.has(stem(w))) return;
    seen.add(stem(w));
    out.push({ w, i });
  });
  // Picturable ideas first, in the order they're said; then the longest other words.
  const pic = (w: string) => Number(!!(LEXICON[w] ?? LEXICON[stem(w)]));
  return out.sort((a, b) => pic(b.w) - pic(a.w) || (pic(a.w) ? a.i - b.i : b.w.length - a.w.length)).map((x) => x.w);
}

const lexicon = (w: string) => LEXICON[w] ?? LEXICON[stem(w)];

/** Coverage like an editor would cut it: open wide, then medium and close, a detail now and then. */
const COVERAGE: ShotType[] = ["medium", "close-up", "wide", "detail", "people", "medium", "close-up", "abstract"];
const MODIFIER: Partial<Record<ShotType, string>> = { establishing: "aerial", wide: "wide", "close-up": "close up", detail: "macro", people: "people" };

/** A picturable word and when it's said. */
interface Beat {
  w: string;
  t: number;
}

/**
 * Split a long line where its second idea is spoken, so the picture changes on the word
 * ("your phone buzzes, | your coffee goes cold" cuts to coffee as "coffee" is said).
 */
export function wordCuts(slot: { s: number; e: number }, words: Word[] | undefined, exclude: string[] = [], min = 1.4): { s: number; e: number; key?: string }[] {
  const ws = (words ?? []).filter((w) => w.s >= slot.s - 0.02 && w.s < slot.e);
  const kws = new Set(keywords(ws.map((w) => w.w).join(" "), exclude).filter((k) => lexicon(k)));
  const beats: Beat[] = [];
  const seen = new Set<string>();
  for (const w of ws) {
    const k = w.w.toLowerCase().replace(/[^a-z0-9'-]/g, "");
    if (kws.has(k) && !seen.has(stem(k))) seen.add(stem(k)), beats.push({ w: k, t: w.s });
  }
  if (slot.e - slot.s < min * 2 + 0.4 || beats.length < 2) return [{ s: slot.s, e: slot.e, key: best(beats)?.w }];
  // Cut on the most filmable ideas first (coffee before morning), keeping every part long enough to read.
  const cuts: Beat[] = [];
  for (const b of [...beats.slice(1)].sort((x, y) => concrete(y.w) - concrete(x.w))) {
    const at = +(b.t - 0.12).toFixed(2); // a beat before the word lands
    const pts = [slot.s, ...cuts.map((c) => +(c.t - 0.12).toFixed(2)), at, slot.e].sort((x, y) => x - y);
    if (cuts.length < 2 && pts.every((p, k) => k === 0 || p - pts[k - 1] >= min)) cuts.push(b);
  }
  cuts.sort((x, y) => x.t - y.t);
  const edges = [slot.s, ...cuts.map((c) => +(c.t - 0.12).toFixed(2)), slot.e];
  return edges.slice(0, -1).map((from, k) => {
    const to = edges[k + 1];
    // Each part shows the strongest idea spoken in it.
    return { s: from, e: to, key: best(beats.filter((b) => b.t >= from - 0.02 && b.t < to))?.w };
  });
}

/** Ideas a camera can't point at directly rank below things it can. */
const ABSTRACT = new Set("time fast speed quick slow calm peace morning night day energy power strong health new launch start begin idea think change future grow growth easy simple smart safe hard problem success win dream fun joy happy love world tired stress".split(" ").map(stem));
const concrete = (w: string) => (ABSTRACT.has(stem(w)) ? 0 : 1) + Math.min(w.length, 8) / 20;
const best = (bs: Beat[]) => [...bs].sort((a, b) => concrete(b.w) - concrete(a.w))[0];

/** Plan the shots for a voice-over locally (no AI): coverage grammar, a picture dictionary, cuts on the words. */
export function planShots(v: VoiceIn, brief: string, opts: { min?: number; max?: number; text: TextMode; brand?: string } = { text: "subtitles" }): Shot[] {
  const slots = voiceSlots(v, opts.min ?? 2.2, opts.max ?? 4.2);
  const subject = subjectOf(brief);
  const persona = personaOf(brief);
  const exclude = opts.brand ? opts.brand.split(/\s+/) : [];
  const used = new Set<string>();
  // Every line, split on its spoken ideas.
  const parts = slots.flatMap((slot, li) => wordCuts(slot, v.words, exclude).map((p, k) => ({ ...p, li, first: k === 0, line: v.words?.length ? wordsIn(v.words, p.s, p.e) : slot.text ?? "" })));
  return parts.map((part, i) => {
    const line = part.line;
    const kw = keywords(line, exclude);
    if (part.key) kw.sort((a, b) => Number(b === part.key) - Number(a === part.key));
    const mentionsSubject = !!subject.word && kw.some((k) => stem(k) === stem(subject.word!) || (lexicon(k) ?? []).some((q) => subject.queries.includes(q)));
    const last = i === parts.length - 1 && parts.length > 2;
    const type: ShotType = i === 0 ? "establishing" : last ? "wide" : mentionsSubject ? "product" : COVERAGE[(i - 1) % COVERAGE.length];
    const pool: string[] = [];
    // The product shot and the closing shot (behind the end card) show the product category.
    if (type === "product" || last) pool.push(...subject.queries.map((q) => cast(q, persona)));
    for (const k of kw.slice(0, 3)) {
      const lx = lexicon(k);
      if (lx) pool.push(...lx.map((q) => cast(q, persona)));
      else pool.push(MODIFIER[type] ? `${k} ${MODIFIER[type]}` : k);
    }
    // The opener sets the world: what the line says, seen wide.
    if (i === 0) pool.push("city sunrise aerial");
    pool.push(...subject.queries.map((q) => cast(q, persona)), type === "abstract" ? "abstract light bokeh" : persona ? `${persona} lifestyle` : "people lifestyle");
    // Fresh queries first, so neighbouring shots don't look alike.
    const queries = [...new Set(pool.map((q) => q.trim().toLowerCase()).filter(Boolean))].sort((a, b) => Number(used.has(a)) - Number(used.has(b))).slice(0, 4);
    used.add(queries[0]);
    const overlay = opts.text === "keywords" && part.first && (i === 0 || part.li % 3 === 2) ? emphasize(clipWords(slots[part.li].text ?? line, 5)) : "";
    return { s: part.s, e: part.e, line, type, queries, overlay };
  });
}

// ---------------------------------------------------------------- casting
export interface Candidate {
  id: string;
  title: string;
  w?: number;
  h?: number;
  duration?: number;
  source: string;
}

const orient = (w?: number, h?: number) => (!w || !h ? "landscape" : h > w * 1.1 ? "portrait" : w > h * 1.1 ? "landscape" : "square");
export const orientationFor = (a: Aspect) => (a === "9:16" || a === "4:5" ? "portrait" : a === "1:1" ? "square" : "landscape");

const FAKE = /\b(animat\w*|cartoon|illustrat\w*|3d|render\w*|cgi|loop(ed|able)?|motion graphics?|template|green ?screen|chroma|hologra\w*|icons?|infographic|ai[- ]generated|generative|particles?|seamless)\b/i;

/** How well a clip suits a shot: format, long enough to hold the shot, on topic, real, sharp. */
export function scoreClip(c: Candidate, shot: Pick<Shot, "s" | "e" | "queries">, aspect: Aspect, speed: number): number {
  let sc = 0;
  const want = orientationFor(aspect), got = orient(c.w, c.h);
  if (got === want) sc += 5;
  else if (want === "square" || got === "square") sc += 2;
  else if (want === "portrait" && got === "landscape") sc += 0.5; // crops to a sliver: last resort
  const need = (shot.e - shot.s) * speed + 0.3;
  if (c.duration) sc += c.duration >= need ? 3 : c.duration >= need * 0.6 ? 1 : -2;
  // On topic: the first search counts most, matching by word stem ("pouring" ~ "pour").
  const title = new Set(c.title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2).map(stem));
  shot.queries.forEach((q, qi) => {
    const ws = q.toLowerCase().split(/\W+/).filter((w) => w.length > 2 && !STOP.has(w)).map(stem);
    const hit = ws.filter((w) => title.has(w)).length;
    sc += hit * (qi === 0 ? 1.2 : 0.5) + (ws.length > 1 && hit === ws.length ? 1.5 : 0);
  });
  // Real footage, not graphics: titles that read like animation, templates or AI renders sink.
  if (!/abstract/.test(shot.queries[0] ?? "") && FAKE.test(c.title)) sc -= 4;
  if ((c.w ?? 0) >= 1280 || (c.h ?? 0) >= 1280) sc += 1;
  if (c.source === "freepik") sc += 1.5; // the preferred library
  return sc;
}

/** Pick the best unused clip for a shot; returns it and the next best as alternatives. */
export function castShot(cands: Candidate[], shot: Shot, aspect: Aspect, speed: number, used: Set<string>): { clip?: Candidate; alts: Candidate[] } {
  const ranked = cands.map((c) => ({ c, sc: scoreClip(c, shot, aspect, speed) - (used.has(c.id) ? 20 : 0) })).sort((a, b) => b.sc - a.sc);
  return { clip: ranked[0]?.c, alts: ranked.slice(1, 7).map((r) => r.c) };
}

/** Where to start the clip and how fast to play it, so the shot sits in the middle of the clip. */
export function timeClip(clipDur: number | undefined, shotLen: number, speed: number): { clipStart?: number; clipSpeed?: number } {
  if (!clipDur || clipDur <= 0) return speed !== 1 ? { clipSpeed: speed } : {};
  let sp = speed;
  // A short clip is slowed (down to 0.6x) rather than looped, which reads as an intentional slow-mo.
  if (clipDur < shotLen * sp + 0.2) sp = Math.max(0.6, Math.min(sp, (clipDur - 0.2) / shotLen));
  const span = shotLen * sp;
  const start = Math.max(0, Math.min(clipDur - span - 0.1, (clipDur - span) * 0.4));
  return { ...(start > 0.05 && { clipStart: +start.toFixed(2) }), ...(Math.abs(sp - 1) > 0.01 && { clipSpeed: +sp.toFixed(2) }) };
}

// ---------------------------------------------------------------- the edit
export interface EditOptions {
  look: ProdLook;
  text: TextMode;
  brand: string;
  title: string;
  cta: string;
  url: string;
}

/** Assemble the cast shots into scenes: footage full-bleed, one look, a title over the opener and an end card over the last shot. */
export function assemble(shots: Shot[], o: EditOptions): Omit<Scene, "id">[] {
  const look = LOOKS_PROD[o.look];
  const scenes: Omit<Scene, "id">[] = shots.map((sh, i) => {
    const d = +(Math.round(sh.e * 100) / 100 - Math.round(sh.s * 100) / 100).toFixed(2);
    const effects: Effect[] = [...look.effects];
    // Punctuate: an impact at the product reveal in punchy looks.
    if (sh.type === "product" && o.look === "commercial") effects.push("flash");
    const base: Omit<Scene, "id"> = {
      template: "fullbleed",
      duration: d,
      image: sh.clip,
      ...(sh.clipStart && { clipStart: sh.clipStart }),
      ...(sh.clipSpeed && { clipSpeed: sh.clipSpeed }),
      headline: sh.overlay || undefined,
      transition: i === 0 ? "cut" : look.transition === "fade" && i % 2 ? "fade" : sh.type === "product" ? "zoom" : look.transition,
      grade: look.grade,
      effects: [...new Set(effects)].slice(0, 4),
      fxAmount: look.amount,
      shot: { type: sh.type, query: sh.queries[0] ?? "" },
    };
    if (!sh.clip) return { ...base, template: "kinetic-words", headline: emphasize(clipWords(sh.line || o.title, 8)), background: "gradient" };
    return base;
  });
  // The opener carries the title; the last shot becomes the end card, the footage still running behind it.
  if (scenes[0] && o.title && scenes[0].template === "fullbleed") Object.assign(scenes[0], { kicker: o.brand || undefined, headline: emphasize(clipWords(o.title, 6)) });
  const last = scenes[scenes.length - 1];
  if (last && scenes.length > 2 && (o.cta || o.url || o.brand)) {
    const clip = last.image;
    scenes[scenes.length - 1] = { ...last, template: "cta-end", headline: emphasize(clipWords(o.brand || o.title || "Get started", 4)), cta: o.cta || "Learn more", url: o.url || undefined, ...(clip && { backdrop: [clip] }), image: undefined, effects: look.effects.filter((e) => e !== "letterbox").slice(0, 2) };
  }
  return scenes;
}

/** Words spoken over a stretch of the voice-over (for re-planning one shot). */
export const wordsIn = (words: Word[] | undefined, s: number, e: number) => (words ?? []).filter((w) => w.s >= s - 0.05 && w.s < e).map((w) => w.w).join(" ");

export const isVideo = (a?: Asset) => a?.kind === "video";

/** Stock searches for one line of copy (or narration) in a brief's world: what's said, the product, the audience. */
export function queriesFor(line: string, brief: string, type: ShotType = "medium", brand?: string): string[] {
  const subject = subjectOf(brief);
  const persona = personaOf(brief);
  const kw = keywords(line, brand ? brand.split(/\s+/) : []);
  const pool: string[] = [];
  if (type === "product") pool.push(...subject.queries.map((q) => cast(q, persona)));
  for (const k of kw.slice(0, 3)) {
    const lx = lexicon(k);
    if (lx) pool.push(...lx.map((q) => cast(q, persona)));
    else pool.push(MODIFIER[type] ? `${k} ${MODIFIER[type]}` : k);
  }
  pool.push(...subject.queries.map((q) => cast(q, persona)), persona ? `${persona} lifestyle` : "people lifestyle");
  return [...new Set(pool.map((q) => q.trim().toLowerCase()).filter(Boolean))].slice(0, 4);
}
