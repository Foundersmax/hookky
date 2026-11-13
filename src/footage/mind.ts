// The director's understanding (local, no AI): what the whole voice-over is about, what each line
// is talking about, and what the person asked the footage to look like. From that it writes, for
// every shot, searches a stock library can answer ("coffee ceremony ethiopia", "coffee beans close
// up") and the subject a clip must show to be cast. Pure, so the same plan comes out every time.
import type { VoiceIn } from "../soundTemplates";
import { planShots, STOP, stem, lexicon, isAbstract, MODIFIER, type Shot, type ShotType, type TextMode } from "./plan";

// ---------------------------------------------------------------- kinds of film
export type Genre = "ad" | "documentary" | "story";
export const GENRES: Record<Genre, { label: string; note: string; min: number; max: number }> = {
  ad: { label: "Ad", note: "Quick cuts, the product, an end card", min: 2.2, max: 4.2 },
  documentary: { label: "Documentary", note: "Longer shots that show what's said, dissolves between thoughts, photos where they tell it better", min: 3, max: 6.5 },
  story: { label: "Story", note: "Explainers and narration: one clear picture per idea", min: 2.6, max: 5.2 },
};

// ---------------------------------------------------------------- the person's description
export interface Direction {
  raw: string;
  /** camera and style words a stock search understands ("aerial drone", "slow motion") */
  styles: string[];
  /** feel words ("cinematic", "moody"): they rank clips, they don't narrow the search */
  moods: string[];
  /** footage, photos or both, when the description says; otherwise the kind of film decides */
  media?: "video" | "photo" | "any";
  /** things to keep out ("people", "text") */
  avoid: string[];
  /** subjects named in the description ("tokyo", "street food") */
  subjects: string[];
}

const STYLES: [RegExp, string][] = [
  [/\b(aerial|drone|bird'?s[- ]eye|from above)\b/, "aerial drone"],
  [/\bslow[- ]?mo(tion)?\b/, "slow motion"],
  [/\btime[- ]?lapse\b|\bhyperlapse\b/, "time lapse"],
  [/\bmacro\b|\bextreme close[- ]?ups?\b/, "macro"],
  [/\bclose[- ]?ups?\b/, "close up"],
  [/\bblack[- ]and[- ]white\b|\bb&w\b|\bmonochrome\b/, "black and white"],
  [/\b(archiv\w+|vintage|historic(al)?|old footage|retro|newsreel)\b/, "vintage archival"],
  [/\bnight(time)?\b|\bafter dark\b/, "night"],
  [/\bgolden hour\b|\bsunset\b|\bsunrise\b/, "golden hour"],
  [/\bunderwater\b/, "underwater"],
  [/\bpov\b|\bfirst[- ]person\b/, "pov"],
  [/\bhand[- ]?held\b/, "handheld"],
  [/\bwide( shots?| angle)?\b|\blandscapes?\b/, "wide"],
  [/\bsilhouettes?\b/, "silhouette"],
  [/\bneon\b/, "neon"],
  [/\bfog(gy)?\b|\bmist(y)?\b/, "fog"],
];
const MOODS = /\b(cinematic|moody|dramatic|epic|dark|gritty|warm|cozy|calm|peaceful|serene|minimal(ist)?|clean|bright|colou?rful|vibrant|luxur(y|ious)|elegant|raw|authentic|natural|realistic|emotional|nostalgic|energetic|dreamy|mysterious|professional|premium|modern|futuristic)\b/g;
/** Words in a description that are about footage itself, not a subject to search for. */
const META = new Set(
  "want wants wanted need like use using show shows showing shot shots footage video videos clip clips film films filmed movie image images photo photos photograph photographs picture pictures still stills stock style styled look looks looking feel feels feeling vibe mood tone type kind sort lots plenty mostly mainly only just some more less very really high quality resolution real true great good nice beautiful stunning amazing please prefer preferably should must make made keep give standard level grade whole entire every each mix mixed both also plus scene scenes voice over voiceover narration documentary history historical part parts section sections moment moments subject subjects topic theme themes anything everything whatever related relevant matching fits fitting works working right proper dynamic creative intelligent".split(" "),
);

/** Read a free-text description of the footage wanted. */
export function parseDirection(text: string): Direction {
  const raw = (text ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
  let t = ` ${raw.toLowerCase()} `;
  // what to keep out: "no people", "without text or logos", "avoid faces"
  const avoid: string[] = [];
  t = t.replace(/\b(?:no|without|avoid|never show|don'?t (?:show|use|include)|not? any|exclude)\s+([a-z][a-z' -]{1,40}?)(?=[,.;!]|\s+(?:and|but|just|only|with)\b|\s*$)/g, (_, what: string) => {
    for (const part of what.split(/\s+or\s+|\s*\/\s*/)) {
      const w = part.trim().split(/\s+/).filter((x) => !STOP.has(x) && !META.has(x)).slice(0, 2).join(" ");
      if (w) avoid.push(w.replace(/s$/, "").replace(/^peopl$/, "people"));
    }
    return " ";
  });
  const styles: string[] = [];
  for (const [re, s] of STYLES) if (re.test(t)) styles.push(s), (t = t.replace(new RegExp(re.source, "g"), " "));
  const moods = [...new Set(t.match(MOODS) ?? [])];
  t = t.replace(MOODS, " ");
  const wantsPhoto = /\b(photos?|photographs?|images?|pictures?|stills?)\b/.test(t);
  // "shots" alone doesn't rule photographs out; next to "photos" it means both
  const wantsVideo = /\b(videos?|footage|clips?|b-?roll|film(ed|s)?)\b/.test(t) || (wantsPhoto && /\bshots?\b/.test(t));
  t = t.replace(/\bfor (the|some|any) [a-z ]{2,30}? (parts?|sections?|bits?|moments?)\b/g, " ");
  const media: Direction["media"] = wantsPhoto && !wantsVideo ? "photo" : wantsPhoto && wantsVideo ? "any" : wantsVideo ? "video" : undefined;
  // what's left that names a subject
  const subjects: string[] = [];
  let run: string[] = [];
  const flush = () => (run.length && subjects.push(run.slice(-3).join(" ")), (run = []));
  for (const tok of t.split(/\s+/)) {
    const w = tok.replace(/[^a-z0-9'-]/g, "");
    if (!w || w.length < 3 || STOP.has(w) || META.has(w) || /ly$/.test(w)) flush();
    else run.push(w);
    if (/[,.;!?]$/.test(tok)) flush();
  }
  flush();
  return { raw, styles: [...new Set(styles)].slice(0, 4), moods: moods.slice(0, 4), ...(media && { media }), avoid: [...new Set(avoid)].slice(0, 5), subjects: [...new Set(subjects)].slice(0, 5) };
}

// ---------------------------------------------------------------- what the film is about
/** Words that carry no picture: verbs of narration, vague nouns, measures of time. */
const VAGUE = new Set(
  "became become becomes began begin begins known called named use used uses using find finds found since across around during later early earlier often many several few couple year years century centuries decade decades ago almost nearly start started starts turned turn turns brought bring brings led lead leads helped help helps allow allowed allows remain remained remains continue continued continues exist exists existed happen happened happens include includes including spread grew grown rise rose risen fall fell fallen moved live lived believe believed thought show showed shown tell told ask asked seem seemed seems appear appeared appears created built produce produced reach reached arrive arrived carry carried hold held leave left follow followed number part parts kind type sort form forms example fact case point result reason question answer matter history story stories able about above actually after against along among another away back because before behind below between beyond both down enough far first second third last next little long longer most must near never new old once other others own same should such sure than through together under until upon whether whose within without yes today's become different important simply truly quite rather perhaps maybe however therefore instead thing things something anything everything nothing everyone someone anyone people's world's it's there's that's here's what's let's hundred thousand million billion percent half quarter dozen much more less least best better worse worst great greater greatest big bigger biggest small smaller smallest high higher highest low lower lowest full whole entire real true main major common simple single nearly mostly mainly truly around per each every stretch stretches says say said makes takes gives shows tells keeps goes comes covers contains holds lies sits stands rises falls grows lives ends moves means needs wants looks feels provides offers creates produces reaches spans flows buzzes thousands millions billions hundreds species home legend century sixteenth seventeenth eighteenth nineteenth twentieth racing save saving one two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty sixty seventy eighty ninety dozen single double triple".split(" "),
);
const clean = (w: string) => w.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "").replace(/'s$/, "");
/** Nouns that happen to end like a past tense. */
const ED_NOUNS = new Set("red bed seed weed shed speed breed feed reed sled hundred bread".split(" "));
// "travelled", "filled", "noticed": what happened, not what to point a camera at
const pastTense = (w: string) => /[a-z]{3,}ed$/.test(w) && !ED_NOUNS.has(w);
const picturable = (w: string) => w.length > 2 && !STOP.has(w) && !VAGUE.has(w) && !/ly$/.test(w) && !/^\d+$/.test(w) && !pastTense(w);

export interface Topic {
  /** names of real things: places, people, brands ("ethiopia", "great barrier reef") */
  entities: string[];
  /** what's talked about most ("coffee", "reef") */
  terms: string[];
  /** a decade or year that dates the film ("1969") */
  era?: string;
  /** the one thing the film is about: what the brief names, else what's said most */
  main?: string;
}

/** What a voice-over is about: named things, and the words it keeps coming back to. */
export function topicOf(transcript: string, hints: string[] = [], exclude: string[] = []): Topic {
  const skip = new Set(exclude.map((w) => stem(w.toLowerCase())));
  const toks = transcript.split(/\s+/).filter(Boolean);
  const names = new Map<string, number>();
  const counts = new Map<string, { n: number; form: string }>();
  let start = true;
  let run: string[] = [];
  const flush = () => {
    if (run.length) {
      const k = run.join(" ").toLowerCase();
      names.set(k, (names.get(k) ?? 0) + 1);
    }
    run = [];
  };
  let era: string | undefined;
  for (const tok of toks) {
    const bare = tok.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "").replace(/'s$/, "");
    const w = bare.toLowerCase();
    if (/^(1[5-9]\d\d|20\d\d)s?$/.test(bare) && !era) era = bare.replace(/s$/, "");
    const cap = /^[A-Z][a-z]{2,}$/.test(bare) || /^[A-Z]{2,6}$/.test(bare);
    // a capital mid-sentence is a name; so is one that continues a name ("New | York")
    if (cap && (!start || run.length) && !STOP.has(w) && !skip.has(stem(w))) run.push(bare);
    else flush();
    if (picturable(w) && w.length > 3 && !skip.has(stem(w))) {
      const s = stem(w);
      const c = counts.get(s) ?? { n: 0, form: w };
      c.n++;
      counts.set(s, c);
    }
    start = /[.!?]["')\]]?$/.test(tok);
    if (start) flush();
  }
  flush();
  const hinted = hints.map((h) => h.toLowerCase().trim()).filter(Boolean);
  const entities = [...names.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).map(([k]) => k);
  const nameStems = new Set(entities.flatMap((e) => e.split(" ").map(stem)));
  const said = [...counts.entries()].filter(([s, c]) => c.n >= 2 && !nameStems.has(s)).sort((a, b) => b[1].n - a[1].n);
  const terms = said.map(([, c]) => c.form);
  // what it's about: the brief's subject; else a name said more than once; else the word said most; else the first name
  const topName = [...names.entries()].sort((a, b) => b[1] - a[1])[0];
  let main = hinted[0] ?? (topName && topName[1] >= 2 && topName[1] >= (said[0]?.[1].n ?? 0) ? topName[0] : terms[0] ?? entities[0]);
  // "barrier reef" is the Great Barrier Reef when that's what the voice-over calls it
  if (main) main = entities.find((e) => e !== main && e.includes(main!)) ?? main;
  return { entities: [...new Set(entities)].slice(0, 6), terms: [...new Set([...hinted, ...terms])].slice(0, 8), ...(era && { era }), ...(main && { main }) };
}

// ---------------------------------------------------------------- what a line is talking about
export interface Phrase {
  text: string;
  /** how filmable it is: names and concrete things score high, ideas low */
  score: number;
  /** it names a real place, person or thing */
  name?: boolean;
}

/** The filmable phrases of a line, best first ("the ancient coffee ceremony of Ethiopia" → "ancient coffee ceremony", "ethiopia"). */
export function phrasesOf(line: string, topic: Topic, exclude: string[] = []): Phrase[] {
  const skip = new Set(exclude.map((w) => stem(w.toLowerCase())));
  const topicStems = new Set(topic.terms.flatMap((t) => t.split(" ").map(stem)));
  const nameStems = new Set(topic.entities.flatMap((t) => t.split(" ").map(stem)));
  const out: Phrase[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length) {
      const words = run.slice(-3);
      let score = 0;
      for (const w of words) {
        const s = stem(w);
        // names are the most filmable, ideas the least; longer words tend to be more specific
        score += nameStems.has(s) ? 2 : isAbstract(w) ? 0.2 : 1 + Math.min(0.6, Math.max(0, w.length - 4) * 0.15);
        if (topicStems.has(s)) score += 0.3;
      }
      // a phrase of only ideas ("new future") can't carry a shot by itself
      if (words.every((w) => isAbstract(w))) score = Math.min(score, 0.6);
      // part of a name is the whole name ("barrier reef" → "great barrier reef")
      const text = words.join(" ");
      const named = topic.entities.find((e) => e !== text && e.split(" ").length > words.length && e.includes(text));
      out.push({ text: named ?? text, score: +score.toFixed(2), ...(words.some((w) => nameStems.has(stem(w))) && { name: true }) });
    }
    run = [];
  };
  const toks = line.split(/\s+/).filter(Boolean);
  toks.forEach((tok, i) => {
    const w = clean(tok);
    // things the line wants gone aren't pictured ("no more waiting", "stress less")
    const neg = (k: number) => /^(no|without|never|zero|stop|forget|not)$/.test(clean(toks[k] ?? ""));
    const negated = neg(i - 1) || neg(i - 2) || /^(less|free)$/.test(clean(toks[i + 1] ?? ""));
    if (!picturable(w) || skip.has(stem(w)) || negated || /^(less|free|more|better|further|faster|today|tomorrow)$/.test(w)) flush();
    else run.push(w);
    if (/[,.;:!?—–]$/.test(tok)) flush();
  });
  flush();
  const seen = new Set<string>();
  return out.filter((p) => !seen.has(p.text) && seen.add(p.text)).sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------- the plan
export interface FilmOptions {
  genre: Genre;
  /** the person's description of the footage they want */
  direction?: string;
  text: TextMode;
  brand?: string;
}

const uniq = (qs: string[]) => [...new Set(qs.map((q) => q.replace(/\s+/g, " ").trim().toLowerCase()).filter((q) => q.length > 2))];
const short = (q: string, n = 6) => q.split(" ").slice(0, n).join(" ");
const transcriptOf = (v: VoiceIn) => (v.words ?? []).map((w) => w.w).join(" ");
/** Coverage for films that aren't selling something: no product shots, no abstract filler. */
const filmType = (t: ShotType, noPeople: boolean): ShotType => (t === "product" || t === "abstract" ? "detail" : t === "people" && noPeople ? "medium" : t);

/**
 * Plan a film from a voice-over: cut points and coverage from the shot planner, then, for every
 * shot, what it should show and how to search for it, in the world of the whole voice-over.
 */
export function planFilm(v: VoiceIn, brief: string, opts: FilmOptions): { shots: Shot[]; topic: Topic; direction: Direction } {
  const g = GENRES[opts.genre] ?? GENRES.ad;
  const ad = opts.genre === "ad" || !GENRES[opts.genre];
  const direction = parseDirection(opts.direction ?? "");
  const base = planShots(v, brief, { text: opts.text, brand: opts.brand, min: g.min, max: g.max });
  const exclude = opts.brand ? opts.brand.split(/\s+/) : [];
  const none: Topic = { entities: [], terms: [] };
  const briefWords = phrasesOf(brief, none, exclude).filter((p) => p.score >= 1).map((p) => p.text);
  const topic = topicOf(transcriptOf(v) || base.map((s) => s.line).join(". "), [...briefWords, ...direction.subjects], exclude);
  const world = topic.main ?? "";
  const nameStems = new Set(topic.entities.flatMap((e) => e.split(" ").map(stem)));
  const noPeople = direction.avoid.some((a) => /people|person|face/.test(a));
  const archival = !!topic.era && Number(topic.era) < 1995 && !ad;
  const styles = [...direction.styles, ...(archival && !direction.styles.includes("vintage archival") ? ["vintage archival"] : [])];
  const used = new Map<string, number>();
  let carried = world;
  /** Two phrases as one search, no word twice. */
  const join = (...parts: string[]) => [...new Set(parts.join(" ").split(/\s+/).filter(Boolean))].join(" ");
  /** A named place or thing stands by itself; anything else is searched in the film's world ("turtles" → "turtles great barrier reef"). */
  const inWorld = (p: string) => (!world || p.split(" ").some((w) => nameStems.has(stem(w))) || world.split(" ").some((w) => p.split(" ").map(stem).includes(stem(w))) ? p : join(p, world));

  const shots = base.map((sh, i): Shot => {
    const type = ad ? sh.type : filmType(sh.type, noPeople);
    const phrases = phrasesOf(sh.line, topic, exclude);
    const top = phrases[0];
    const concrete = !!top && top.score >= 1;
    const mod = MODIFIER[type];
    const style = styles.length ? styles[i % styles.length] : "";
    const pool: string[] = [];
    let subject = "";
    if (ad) {
      // An ad's lines are often figures of speech: the crafted pictures lead, the line's own words back them up.
      subject = concrete ? top.text : "";
      pool.push(...sh.queries.slice(0, 2));
      if (style) pool.splice(1, 0, join(sh.queries[0] ?? subject, style));
      if (subject && subject.includes(" ")) pool.push(subject);
      pool.push(...sh.queries.slice(2));
    } else {
      // a line with nothing to film ("and that changed everything") stays on what was being shown
      subject = concrete ? top.text : carried;
      if (concrete) carried = top.text;
      const second = phrases[1] && phrases[1].score >= 1 ? phrases[1].text : "";
      // where the line itself places its subject ("coffee houses … of Istanbul") beats the film's general world
      const place = concrete && !top.name ? phrases.find((p) => p !== top && p.name)?.text : undefined;
      const placed = (p: string) => (place && p === subject ? join(p, place) : inWorld(p));
      if (subject) {
        // a subject searched before is seen a new way: by framing first, then in its context
        const again = used.get(subject) ?? 0;
        const framed = mod ? join(subject, mod) : subject;
        pool.push(...(again % 2 ? [framed, placed(subject)] : [placed(subject), framed]));
        if (style) pool.splice(1, 0, join(subject, style));
        if (second) pool.push(inWorld(second));
        pool.push(subject);
        used.set(subject, again + 1);
      }
      // ideas ("growth", "time") get the pictures that stand for them
      for (const p of phrases.slice(0, 3)) for (const w of p.text.split(" ")) if (isAbstract(w) && lexicon(w)) pool.push(lexicon(w)![0]);
      // a film falls back to its own world, never to filler
      if (world) pool.push(mod ? join(world, mod) : world, ...(direction.moods[0] ? [join(world, direction.moods[0])] : []));
      if (!pool.length) pool.push(...sh.queries);
    }
    const queries = uniq(pool.map((q) => short(q))).slice(0, 5);
    const lead = new Set((queries[0] ?? "").split(" ").map(stem));
    // the words a clip must show: the subject, when the first search is about it
    const real = (p: string) => p.split(" ").filter((w) => w && !isAbstract(w));
    const other = !ad && phrases[1] && phrases[1].score >= 1 && phrases[1].text !== subject ? real(phrases[1].text).slice(-2) : [];
    const must = [...new Set([...real(subject).filter((w) => !ad || lead.has(stem(w))).slice(-2), ...other])];
    // the speaker stopped before this shot: a new thought
    const breath = i > 0 && v.pauses.some((p) => p.e - p.s >= 0.7 && sh.s >= p.s - 0.05 && sh.s <= p.e + 0.05);
    return {
      ...sh,
      type,
      queries: queries.length ? queries : sh.queries,
      visual: [subject || queries[0] || sh.queries[0], mod && !/people/.test(mod) ? mod : "", style].filter(Boolean).join(" · "),
      ...(must.length && { must }),
      ...(direction.avoid.length && { avoid: direction.avoid }),
      ...(styles.length || direction.moods.length ? { style: [...styles, ...direction.moods] } : {}),
      media: direction.media ?? (opts.genre === "documentary" ? "any" : "video"),
      ...(breath && !ad && { breath }),
    };
  });
  return { shots, topic, direction };
}
