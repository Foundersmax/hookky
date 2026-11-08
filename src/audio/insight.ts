// Listening closely: what a voice-over and a music track tell an editor before the first cut.
// Voice: the words the speaker leans on (loudness, pitch, length), pace, energy, pauses, mood,
// the hook, the call to action and what it's selling. Music: its sections (intro, build, drop,
// break, outro), mood and loudness. Mix: how loud the music should sit under the voice.
// The maths is pure (tested in node); `decode` is the only browser part.
import type { Word } from "../types";

export interface VoiceInsight {
  /** words per minute while speaking */
  wpm: number;
  pace: "slow" | "measured" | "brisk" | "fast";
  mood: "energetic" | "warm" | "calm" | "dramatic";
  /** indexes into the transcript of words the speaker stresses */
  stressed: number[];
  /** the stressed words themselves, lower-case, for highlighting */
  stressedWords: string[];
  /** pauses long enough to be a beat (seconds) */
  dramatic: { s: number; e: number }[];
  /** loudness 0–1 every 0.25 s */
  energy: number[];
  /** average loudness (RMS) of speech, for mixing */
  rms: number;
  /** what the words say */
  hook?: string;
  cta?: string;
  url?: string;
  product?: string;
  benefits: string[];
  sentences: { s: number; e: number; text: string }[];
}

export type Section = { s: number; e: number; kind: "intro" | "build" | "drop" | "break" | "outro" };
export interface MusicInsight {
  mood: "upbeat" | "chill" | "cinematic" | "driving" | "dark";
  sections: Section[];
  /** 0–1, how bright the track sounds (more highs) */
  brightness: number;
  /** average loudness (RMS) */
  rms: number;
}

// ---------------------------------------------------------------- signal helpers
function rmsOf(x: Float32Array, a: number, b: number) {
  let s = 0;
  const lo = Math.max(0, a), hi = Math.min(x.length, b);
  for (let i = lo; i < hi; i++) s += x[i] * x[i];
  return hi > lo ? Math.sqrt(s / (hi - lo)) : 0;
}

/** Fundamental frequency (Hz) of a short window by autocorrelation, 70–400 Hz; 0 if unvoiced. */
export function pitchAt(x: Float32Array, sr: number, center: number, win = 0.04): number {
  const n = Math.floor(win * sr), a = Math.max(0, Math.floor(center * sr - n / 2));
  if (a + n * 2 > x.length) return 0;
  const minLag = Math.floor(sr / 400), maxLag = Math.floor(sr / 70);
  let e0 = 0;
  for (let i = 0; i < n; i++) e0 += x[a + i] * x[a + i];
  if (e0 < 1e-6) return 0;
  const ac: number[] = [];
  let best = 0;
  for (let L = minLag; L <= maxLag; L++) {
    let c = 0;
    for (let i = 0; i < n; i++) c += x[a + i] * x[a + i + L];
    ac.push(c);
    if (c > best) best = c;
  }
  if (best / e0 < 0.3) return 0;
  // The first strong peak is the fundamental (later ones are its multiples).
  for (let k = 1; k < ac.length - 1; k++) if (ac[k] >= best * 0.9 && ac[k] >= ac[k - 1] && ac[k] >= ac[k + 1]) return sr / (minLag + k);
  return 0;
}

const z = (v: number[]) => {
  const m = v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, v.length)) || 1;
  return v.map((x) => (x - m) / sd);
};

// ---------------------------------------------------------------- text
const STOP = new Set("a an and are as at be but by for from has have i in is it its of on or our so that the their this to was we with you your it's i'm you're just very really".split(" "));
const CTA = /\b(shop|order|pre-?order|buy|get|try|download|visit|join|sign up|book|claim|start|subscribe|learn more|tap|swipe|link in bio|available)\b/i;
const BENEFIT = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twice|double|half|never|no more|without|faster|easier|better|longer|every|all day|free|instantly|in minutes|helps?|keeps?|lets?|makes?)\b/i;

/** "orbit dot watch" / "orbit.watch" → "orbit.watch". */
export function findUrl(text: string): string | undefined {
  const spoken = text.match(/\b([a-z0-9-]+)\s+dot\s+(com|co|io|app|watch|shop|store|net|org|ai)\b/i);
  if (spoken) return `${spoken[1]}.${spoken[2]}`.toLowerCase();
  return text.match(/\b[a-z0-9-]+\.(com|co|io|app|watch|shop|store|net|org|ai)\b/i)?.[0].toLowerCase();
}

/** The product name: a capitalised word after "meet / introducing / with / try", or the most repeated one. */
export function findProduct(text: string): string | undefined {
  for (const m of text.matchAll(/\b(?:meet|introducing|this is|say hello to|try|with)\s+([\w&'-]{2,25}(?:\s[\w&'-]{2,25})?)/gi)) {
    // the name itself is capitalised (sentence starts aside)
    const name = m[1].split(" ").filter((w, i) => i === 0 || /^[A-Z]/.test(w)).join(" ").replace(/[.,!?]$/, "");
    if (/^[A-Z]/.test(name) && !STOP.has(name.toLowerCase())) return name;
  }
  const common = new Set("we okay ok meet try this that there here now today what when why how so but and the you your our my it its yes no hey hi imagine introducing every".split(" "));
  const caps = (text.match(/\b[A-Z][a-z][\w-]{1,20}\b/g) ?? []).filter((w) => !STOP.has(w.toLowerCase()) && !common.has(w.toLowerCase()));
  const count = new Map<string, number>();
  for (const w of caps) count.set(w, (count.get(w) ?? 0) + 1);
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  return top && top[1] >= 2 ? top[0] : undefined;
}

/** Sentences of a transcript with their times. */
export function sentencesOf(words: Word[]) {
  const out: { s: number; e: number; text: string }[] = [];
  let cur: Word[] = [];
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    if (/[.!?]$/.test(w.w) || !next || next.s - w.e > 0.7) {
      out.push({ s: cur[0].s, e: cur[cur.length - 1].e, text: cur.map((x) => x.w).join(" ") });
      cur = [];
    }
  });
  return out;
}

/** What the words say: hook, call to action, link, product and benefit lines. */
export function readTranscript(words: Word[]) {
  const sentences = sentencesOf(words);
  const text = sentences.map((s) => s.text).join(" ");
  const ctaLine = [...sentences].reverse().find((s) => CTA.test(s.text));
  const product = findProduct(text);
  const benefits = sentences
    .filter((s) => s !== sentences[0] && s !== ctaLine && BENEFIT.test(s.text) && s.text.split(" ").length <= 12)
    .map((s) => s.text.replace(/[.!?]+$/, ""))
    .slice(0, 4);
  return { sentences, hook: sentences[0]?.text, cta: ctaLine?.text, url: findUrl(text), product, benefits };
}

// ---------------------------------------------------------------- voice
/**
 * Listen to a voice-over: which words carry the stress (loud, high, held), how fast and how
 * energetic the read is, where the dramatic pauses are, and the mood.
 */
export function analyzeVoice(x: Float32Array, sr: number, words: Word[], pauses: { s: number; e: number }[], duration: number): VoiceInsight {
  // energy every 0.25 s, normalised to the read's own peak
  const step = 0.25;
  const raw: number[] = [];
  for (let t = 0; t < duration; t += step) raw.push(rmsOf(x, Math.floor(t * sr), Math.floor((t + step) * sr)));
  const peak = Math.max(...raw, 1e-6);
  const energy = raw.map((v) => +(v / peak).toFixed(2));
  const speechTime = Math.max(1, duration - pauses.reduce((a, p) => a + (p.e - p.s), 0));
  const wpm = words.length ? Math.round((words.length / speechTime) * 60) : 0;
  const pace = wpm >= 185 ? "fast" : wpm >= 155 ? "brisk" : wpm >= 120 ? "measured" : "slow";

  // per word: loudness, pitch, how long it's held for its length
  const feats = words.map((w) => {
    const loud = rmsOf(x, Math.floor(w.s * sr), Math.floor(w.e * sr));
    const pitch = pitchAt(x, sr, (w.s + w.e) / 2);
    const letters = Math.max(1, w.w.replace(/[^\p{L}\p{N}]/gu, "").length);
    return { loud, pitch, hold: (w.e - w.s) / letters };
  });
  const voiced = feats.map((f) => f.pitch).filter((p) => p > 0);
  const meanPitch = voiced.reduce((a, b) => a + b, 0) / Math.max(1, voiced.length);
  const zl = z(feats.map((f) => f.loud)), zp = z(feats.map((f) => f.pitch || meanPitch)), zh = z(feats.map((f) => f.hold));
  const score = words.map((w, i) => {
    const plain = w.w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
    if (!plain || STOP.has(plain) || plain.length < 3) return -9;
    return zl[i] * 1 + zp[i] * 0.8 + zh[i] * 0.5 + (/\d/.test(plain) ? 0.8 : 0);
  });
  const ranked = score.map((s, i) => ({ s, i })).filter((r) => r.s > -9).sort((a, b) => b.s - a.s);
  const keep = Math.max(1, Math.round(words.length * 0.12));
  const stressed = ranked.slice(0, keep).filter((r) => r.s > 0.35).map((r) => r.i).sort((a, b) => a - b);

  // mood from pace, energy spread and pitch movement
  const pitchVar = voiced.length > 3 ? Math.sqrt(voiced.reduce((a, p) => a + (p - meanPitch) ** 2, 0) / voiced.length) / Math.max(1, meanPitch) : 0;
  const avgEnergy = energy.reduce((a, b) => a + b, 0) / Math.max(1, energy.length);
  const dramatic = pauses.filter((p) => p.e - p.s >= 0.65);
  const mood: VoiceInsight["mood"] =
    pace === "fast" || pace === "brisk" ? (pitchVar > 0.12 || avgEnergy > 0.45 ? "energetic" : "warm") : dramatic.length >= 2 && pace === "slow" ? "dramatic" : pitchVar < 0.08 && avgEnergy < 0.4 ? "calm" : "warm";

  const t = readTranscript(words);
  return {
    wpm, pace, mood, stressed,
    stressedWords: [...new Set(stressed.map((i) => words[i].w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "")))],
    dramatic, energy, rms: +(rmsOf(x, 0, x.length) / Math.max(1e-6, speechTime / duration)).toFixed(4),
    hook: t.hook, cta: t.cta, url: t.url, product: t.product, benefits: t.benefits, sentences: t.sentences,
  };
}

// ---------------------------------------------------------------- music
/**
 * The shape of a track, bar by bar: quiet intro, rising build, the drop, breakdowns, the outro.
 */
export function musicSections(downbeats: number[], beats: number[], energy: number[], duration: number): Section[] {
  if (downbeats.length < 3 || !energy.length) return [{ s: 0, e: duration, kind: "drop" }];
  const barE = downbeats.map((d, i) => {
    const end = downbeats[i + 1] ?? duration;
    const es = beats.map((b, k) => (b >= d && b < end ? energy[k] ?? 0 : -1)).filter((v) => v >= 0);
    return es.length ? es.reduce((a, b) => a + b, 0) / es.length : 0;
  });
  // smooth over 2 bars
  const sm = barE.map((_, i) => (barE[Math.max(0, i - 1)] + barE[i] + (barE[i + 1] ?? barE[i])) / 3);
  const hi = Math.max(...sm), lo = Math.min(...sm);
  const level = (v: number) => (hi - lo < 0.08 ? 1 : (v - lo) / (hi - lo));
  const raw: Section["kind"][] = sm.map((v, i) => {
    const l = level(v), prev = level(sm[i - 1] ?? v);
    if (l >= 0.66) return "drop";
    if (l - prev > 0.08 && l > 0.3) return "build";
    if (i >= sm.length - 2 && l < 0.5) return "outro";
    if (i < 2 && l < 0.5) return "intro";
    return l < 0.33 ? "break" : "build";
  });
  const out: Section[] = [];
  raw.forEach((k, i) => {
    const s = downbeats[i], e = downbeats[i + 1] ?? duration;
    const last = out[out.length - 1];
    if (last && last.kind === k) last.e = e;
    else out.push({ s: +s.toFixed(2), e: +e.toFixed(2), kind: k });
  });
  if (out[0] && out[0].s > 0) out[0].s = 0;
  return out;
}

/** How bright a track sounds: the zero-crossing rate, scaled to 0–1. */
export function brightness(x: Float32Array, sr: number) {
  let zc = 0;
  const n = Math.min(x.length, sr * 60);
  for (let i = 1; i < n; i++) if ((x[i - 1] >= 0) !== (x[i] >= 0)) zc++;
  const rate = zc / Math.max(1, n / sr); // crossings per second
  return Math.max(0, Math.min(1, (rate - 800) / 4000));
}

export function analyzeMusic(x: Float32Array, sr: number, map: { bpm: number; beats: number[]; downbeats: number[]; energy: number[] }, duration: number): MusicInsight {
  const sections = musicSections(map.downbeats, map.beats, map.energy, duration);
  const br = brightness(x, sr);
  const avgE = map.energy.reduce((a, b) => a + b, 0) / Math.max(1, map.energy.length);
  const mood: MusicInsight["mood"] =
    map.bpm >= 118 && avgE > 0.5 ? (br > 0.45 ? "upbeat" : "driving") : map.bpm < 92 ? (br < 0.3 ? "cinematic" : "chill") : br < 0.25 ? "dark" : avgE > 0.55 ? "driving" : "chill";
  return { mood, sections, brightness: +br.toFixed(2), rms: +rmsOf(x, 0, Math.min(x.length, sr * 120)).toFixed(4) };
}

/** Music level under a voice: about 12 dB below the voice while it speaks, never above 0.9. */
export function mixLevel(voiceRms: number, musicRms: number): number {
  if (!voiceRms || !musicRms) return 0.3;
  const target = voiceRms * 0.25; // ≈ -12 dB
  return +Math.max(0.08, Math.min(0.9, target / musicRms)).toFixed(2);
}

/** Decode any audio file to mono samples (browser). */
export async function decode(file: Blob): Promise<{ x: Float32Array; sr: number; duration: number }> {
  const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
  try {
    const a = await ac.decodeAudioData(await file.arrayBuffer());
    const len = Math.min(a.length, a.sampleRate * 240);
    const x = new Float32Array(len);
    for (let c = 0; c < a.numberOfChannels; c++) {
      const ch = a.getChannelData(c);
      for (let i = 0; i < len; i++) x[i] += ch[i] / a.numberOfChannels;
    }
    return { x, sr: a.sampleRate, duration: a.duration };
  } finally {
    ac.close();
  }
}

/** A brief read off the voice-over: product, what it is, benefits, the ask and the link. */
export function briefFrom(ins: VoiceInsight): { product?: string; what?: string; benefits: string[]; cta?: string; url?: string; offer?: string } {
  const named = ins.product ? ins.sentences.find((s) => s.text.includes(ins.product!)) : undefined;
  // "Meet Orbit, the smartwatch that coaches your sleep." → "the smartwatch that coaches your sleep"
  const what = named?.text.split(ins.product!)[1]?.replace(/^[\s,:—-]+/, "").replace(/[.!?]+$/, "").trim();
  const offer = ins.sentences.map((s) => s.text).find((t) => /\d+\s?%|\b(off|free|discount|deal)\b/i.test(t))?.replace(/[.!?]+$/, "");
  const cta = ins.cta?.replace(/\s+at\s+\S+.*$/i, "").replace(/[.!?]+$/, "").split(/[,.]/)[0].trim();
  return { product: ins.product, what: what && what.split(" ").length >= 2 ? what : undefined, benefits: ins.benefits, cta: cta && cta.split(" ").length <= 4 ? cta : undefined, url: ins.url, offer };
}
