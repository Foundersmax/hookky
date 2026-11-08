// Sound templates: pick a look, bring a voice-over and/or a music track, get a finished cut.
// The planner turns the audio into slots (spoken phrases, or bars of music with the drop marked);
// each template decides what every slot becomes. Pure (no DOM), so it's unit-tested and the
// same cut comes out every time for the same audio.
import type { Aspect, Effect, Grade, Motion, Scene, Word } from "./types";
import { sentences, speechRegions } from "./audio/analyze";
import { beatsInCut } from "./audio/beats";

export interface VoiceIn {
  duration: number;
  pauses: { s: number; e: number }[];
  words?: Word[];
}
export interface MusicIn {
  duration: number;
  bpm?: number;
  beats?: number[];
  downbeats?: number[];
  energy?: number[];
  drop?: number;
}
export interface Copy {
  brand: string;
  line: string;
  points: string[];
  cta: string;
  url: string;
}
export interface SoundInput {
  voice?: VoiceIn;
  music?: MusicIn;
  copy: Copy;
  /** asset refs for product shots and b-roll, used in order */
  images: string[];
  /** music-only cuts: seconds (rounded to whole bars); 0 = as long as the track allows, up to 60 */
  length?: number;
  /** music-only cuts: where the drop should land, as a fraction of the cut (the template's own by default) */
  dropAt?: number;
}

export type Role = "hook" | "build" | "drop" | "body" | "end";
export interface Slot {
  s: number;
  e: number;
  role: Role;
  /** words spoken in this slot (voice-over cuts) */
  text?: string;
  /** music loudness in this slot, 0–1 */
  energy: number;
  /** beats inside the slot, relative to its start */
  beats: number;
}

export interface MusicSettings {
  start: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  duck: number;
}

export interface SoundBuild {
  title: string;
  aspect: Aspect;
  style: string;
  captions: boolean;
  grain: boolean;
  scenes: Omit<Scene, "id">[];
  music?: MusicSettings;
  /** what the planner did, for the confirmation message */
  summary: string;
}

type SceneOut = Omit<Scene, "id" | "duration">;
interface Ctx {
  slot: Slot;
  i: number;
  n: number;
  /** the role of the slot after this one */
  nextRole?: Role;
  copy: Copy;
  voiced: boolean;
  /** the next image, cycling; undefined when there are none */
  image: () => string | undefined;
  /** the next line of copy, cycling through line, points and brand */
  line: () => string;
  /** the slot's own words if spoken, else the next line of copy, with an emphasis word */
  say: (maxWords?: number) => string;
}

export interface SoundTemplate {
  id: string;
  name: string;
  blurb: string;
  /** what it's made for */
  needs: "voice" | "music" | "either";
  aspect: Aspect;
  style: string;
  /** music-only: default length and where the drop lands */
  length: number;
  dropAt: number;
  /** music-only: beats per cut before and after the drop, and bars for the end card */
  cut: { build: number; after: number; endBars: number };
  /** voice-over cuts: shortest and longest slot, seconds */
  phrase: { min: number; max: number };
  captions: boolean;
  scene: (c: Ctx) => SceneOut;
  /** a swatch for the picker card */
  swatch: { bg: string; fg: string; accent: string };
}

// ---------------------------------------------------------------- text helpers
const STOP = new Set("a an and are as at be but by for from has have i in is it its it's of on or our so that the their this to was we were what when with you your yours my me us they them just not no yes will can do does".split(" "));
const tidy = (w: string) => w.replace(/^[^\p{L}\p{N}$€£%]+|[^\p{L}\p{N}%!?.]+$/gu, "");

/** Mark the strongest word (a number, else the longest non-filler word) with *asterisks*. */
export function emphasize(text: string): string {
  if (!text || text.includes("*")) return text;
  const words = text.split(/\s+/).filter(Boolean);
  let best = -1, score = 0;
  words.forEach((w, i) => {
    const t = tidy(w).replace(/[.!?]+$/, "");
    if (!t || STOP.has(t.toLowerCase())) return;
    const sc = /\d/.test(t) ? 100 : t.length + (i === words.length - 1 ? 1.5 : 0);
    if (sc > score) (score = sc), (best = i);
  });
  if (best < 0) return text;
  const w = words[best];
  const m = w.match(/^([^\p{L}\p{N}$€£]*)(.*?)([.,!?;:]*)$/u);
  words[best] = m && m[2] ? `${m[1]}*${m[2]}*${m[3]}` : `*${w}*`;
  return words.join(" ");
}

/** At most `max` words; a long line keeps its strongest stretch around the emphasis. */
export function clip(text: string, max: number): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length <= max) return words.join(" ");
  return words.slice(0, max).join(" ").replace(/[,;:]$/, "") + "…";
}

// ---------------------------------------------------------------- planning: voice-over
/** Spoken phrases: sentences from the transcript, else stretches of speech between pauses. */
function phrases(v: VoiceIn, max: number): { s: number; e: number; text?: string }[] {
  if (v.words?.length) {
    const out: { s: number; e: number; text: string }[] = [];
    for (const sen of sentences(v.words)) {
      const ws = v.words.filter((w) => w.s >= sen.s - 1e-3 && w.e <= sen.e + 1e-3);
      // Split long sentences at commas or the widest gap.
      let cur: Word[] = [];
      ws.forEach((w, i) => {
        cur.push(w);
        const len = w.e - cur[0].s;
        const next = ws[i + 1];
        // Only split where the speaker breathes, so every cut lands in a pause.
        const soft = !!next && (next.s - w.e > 0.25 || (/[,;:—]$/.test(w.w) && v.pauses.some((p) => p.s <= next.s && p.e >= w.e)));
        if (!next || (len >= max * 0.6 && soft)) {
          out.push({ s: cur[0].s, e: w.e, text: cur.map((x) => x.w).join(" ") });
          cur = [];
        } else if (len >= max * 2 && cur.length > 2) {
          // A very long run with no breath: split at its widest gap between words.
          let k = 1;
          for (let j = 1; j < cur.length; j++) if (cur[j].s - cur[j - 1].e > cur[k].s - cur[k - 1].e) k = j;
          out.push({ s: cur[0].s, e: cur[k - 1].e, text: cur.slice(0, k).map((x) => x.w).join(" ") });
          cur = cur.slice(k);
        }
      });
    }
    return out;
  }
  return speechRegions(v as never).map((r) => ({ s: r.s, e: r.e }));
}

/** Cut a voice-over into slots that start and end in pauses, at least `min` and ideally at most `max` long. */
export function voiceSlots(v: VoiceIn, min: number, max: number): Slot[] {
  const ph = phrases(v, max);
  if (!ph.length) return [{ s: 0, e: v.duration, role: "hook", energy: 0.5, beats: 0 }];
  // Candidate cuts: the middle of the gap between phrases.
  const groups: { s: number; e: number; text: string[] }[] = [];
  let cur: { s: number; e: number; text: string[] } | null = null;
  ph.forEach((p, i) => {
    const cutAfter = i < ph.length - 1 ? (p.e + ph[i + 1].s) / 2 : v.duration;
    if (!cur) cur = { s: groups.length ? groups[groups.length - 1].e : 0, e: cutAfter, text: [] };
    cur.e = cutAfter;
    if (p.text) cur.text.push(p.text);
    if (cur.e - cur.s >= min || i === ph.length - 1) {
      groups.push(cur);
      cur = null;
    }
  });
  // A short tail joins the slot before it.
  if (groups.length > 1 && groups[groups.length - 1].e - groups[groups.length - 1].s < min * 0.75) {
    const last = groups.pop()!;
    groups[groups.length - 1].e = last.e;
    groups[groups.length - 1].text.push(...last.text);
  }
  groups[0].s = 0;
  groups[groups.length - 1].e = v.duration;
  return groups.map((g, i) => ({ s: +g.s.toFixed(3), e: +g.e.toFixed(3), role: i === 0 ? "hook" : "body", text: g.text.join(" ") || undefined, energy: 0.5, beats: 0 }));
}

// ---------------------------------------------------------------- planning: music
const beatLen = (m: MusicIn) => 60 / (m.bpm && m.bpm > 0 ? m.bpm : 120);
/** The file's beats, or a steady grid at its tempo (120 bpm if unknown). */
function fileBeats(m: MusicIn): number[] {
  if (m.beats?.length) return m.beats;
  const out: number[] = [];
  for (let t = 0; t < Math.max(m.duration, 4); t += beatLen(m)) out.push(+t.toFixed(3));
  return out;
}

/** Where to start the track and how long the cut runs, so it begins on a bar and the drop lands at `dropAt`. */
export function musicWindow(m: MusicIn, length: number, dropAt: number): { start: number; total: number; startIdx: number } {
  const beats = fileBeats(m);
  const bl = beatLen(m), bar = bl * 4;
  const wanted = length > 0 ? length : Math.min(60, Math.max(8, m.duration));
  const bars = Math.max(2, Math.round(wanted / bar));
  const downIdx = new Set((m.downbeats ?? []).map((d) => beats.indexOf(d)).filter((i) => i >= 0));
  const isBar = (i: number) => (downIdx.size ? downIdx.has(i) : i % 4 === 0);
  let startIdx = 0;
  const dropIdx = m.drop !== undefined ? beats.indexOf(m.drop) : -1;
  if (dropIdx >= 0) {
    const buildBars = Math.max(1, Math.min(bars - 1, Math.round((bars * dropAt))));
    startIdx = Math.max(0, dropIdx - buildBars * 4);
  } else {
    // Skip a quiet intro: the first bar with some energy.
    startIdx = beats.findIndex((_, i) => isBar(i) && (m.energy?.[i] ?? 1) >= 0.25);
    if (startIdx < 0) startIdx = 0;
  }
  const start = beats[startIdx] ?? 0;
  const endIdx = startIdx + bars * 4;
  let total = endIdx < beats.length ? beats[endIdx] - start : bars * bar;
  if (length <= 0) total = Math.min(total, m.duration - start > 4 ? m.duration - start : total);
  return { start: +start.toFixed(3), total: +total.toFixed(3), startIdx };
}

/** Slots on the beat: `build` beats per cut before the drop, `after` beats after it, and `endBars` for the end card. */
export function musicSlots(m: MusicIn, start: number, total: number, cut: SoundTemplate["cut"]): Slot[] {
  const beats = beatsInCut({ beats: fileBeats(m), start, duration: m.duration }, total);
  if (!beats.length || beats[0] > 0.05) beats.unshift(0);
  const bl = beatLen(m);
  const dropT = m.drop !== undefined ? m.drop - start : undefined;
  const dropAt = dropT !== undefined && dropT > 0.5 && dropT < total - 1 ? beats.reduce((a, b) => (Math.abs(b - dropT) < Math.abs(a - dropT) ? b : a), beats[0]) : undefined;
  // Reserve the end card: the last `endBars` bars (at least 1.6 s).
  let endStart = total - Math.max(1.6, cut.endBars * 4 * bl);
  endStart = beats.reduce((a, b) => (Math.abs(b - endStart) < Math.abs(a - endStart) ? b : a), beats[0]);
  if (dropAt !== undefined && endStart <= dropAt + 0.5) endStart = total; // no room: no separate end card
  const energyAt = (s: number, e: number) => {
    const en = m.energy;
    const fb = fileBeats(m);
    if (!en?.length) return 0.6;
    let sum = 0, n = 0;
    fb.forEach((b, i) => {
      const t = b - start;
      if (t >= s && t < e) (sum += en[i] ?? 0.6), n++;
    });
    return n ? sum / n : 0.6;
  };
  const cuts: number[] = [0];
  let i = 0;
  while (i < beats.length) {
    const t = beats[i];
    if (t >= endStart - 1e-3) break;
    const after = dropAt !== undefined ? t >= dropAt - 1e-3 : false;
    let step = Math.max(1, after ? cut.after : cut.build);
    // The drop itself holds for a whole bar: it's the moment the ad lands.
    if (dropAt !== undefined && Math.abs(t - dropAt) < 1e-3) step = Math.max(step, 4);
    while (step * bl < 0.8) step *= 2; // nothing shorter than the studio's shortest scene
    let j = i + step;
    // Land exactly on the drop.
    if (dropAt !== undefined && t < dropAt - 1e-3) {
      const k = beats.findIndex((b) => Math.abs(b - dropAt) < 1e-3);
      if (k > i && k < j) j = k;
    }
    const next = beats[j] ?? total;
    if (next >= endStart - 1e-3) break;
    cuts.push(next);
    i = j;
  }
  cuts.push(endStart < total ? endStart : total);
  if (endStart < total) cuts.push(total);
  const uniq = [...new Set(cuts.map((c) => +c.toFixed(3)))].sort((a, b) => a - b);
  // Merge anything shorter than 0.8 s into its neighbour.
  const merged: number[] = [uniq[0]];
  for (const c of uniq.slice(1)) {
    if (c - merged[merged.length - 1] < 0.8 && c !== total) continue;
    if (c - merged[merged.length - 1] < 0.8) merged.pop();
    merged.push(c);
  }
  const slots: Slot[] = [];
  for (let k = 0; k < merged.length - 1; k++) {
    const s = merged[k], e = merged[k + 1];
    const role: Role = k === 0 ? "hook" : e >= total - 1e-3 && endStart < total ? "end" : dropAt !== undefined && Math.abs(s - dropAt) < 1e-3 ? "drop" : dropAt !== undefined && s < dropAt ? "build" : "body";
    slots.push({ s, e, role, energy: energyAt(s, e), beats: Math.round((e - s) / bl) });
  }
  if (slots.length > 1 && !slots.some((s) => s.role === "end")) slots[slots.length - 1].role = "end";
  return slots;
}

/** With a voice-over and music: start the music on a bar, and move cuts onto beats that fall inside the pause. */
function syncToMusic(slots: Slot[], v: VoiceIn, m: MusicIn): { start: number; slots: Slot[] } {
  const beats = fileBeats(m);
  // Start on the first bar with energy, so the first downbeat lands at 0.
  const down = m.downbeats?.length ? m.downbeats : beats.filter((_, i) => i % 4 === 0);
  const start = down.find((d) => (m.energy?.[beats.indexOf(d)] ?? 1) >= 0.25) ?? 0;
  const cut = beatsInCut({ beats, start, duration: m.duration }, v.duration);
  const out = slots.map((s) => ({ ...s }));
  for (let k = 0; k < out.length - 1; k++) {
    const t = out[k].e;
    const pause = v.pauses.find((p) => t >= p.s - 0.02 && t <= p.e + 0.02);
    if (!pause) continue;
    const b = cut.filter((x) => x >= pause.s && x <= pause.e && x - out[k].s >= 0.8 && out[k + 1].e - x >= 0.8).sort((a, c) => Math.abs(a - t) - Math.abs(c - t))[0];
    if (b !== undefined) (out[k].e = b), (out[k + 1].s = b);
  }
  // The drop (if inside the cut) marks the slot it falls in as the reveal.
  if (m.drop !== undefined) {
    const dt = m.drop - start;
    const k = out.findIndex((s) => dt >= s.s && dt < s.e);
    if (k > 0) out[k].role = "drop";
  }
  return { start, slots: out };
}

// ---------------------------------------------------------------- build
const defaultsFor = (copy: Partial<Copy>): Copy => ({
  brand: copy.brand?.trim() || "Your brand",
  line: copy.line?.trim() || "Made to move",
  points: (copy.points ?? []).map((p) => p.trim()).filter(Boolean).slice(0, 6),
  cta: copy.cta?.trim() || "Shop now",
  url: copy.url?.trim() || "",
});

export function buildSound(t: SoundTemplate, input: SoundInput): SoundBuild {
  const copy = defaultsFor(input.copy);
  const v = input.voice && input.voice.duration > 0.8 ? input.voice : undefined;
  const m = input.music && input.music.duration > 1 ? input.music : undefined;
  let slots: Slot[];
  let music: MusicSettings | undefined;
  let summary: string;
  if (v) {
    slots = voiceSlots(v, t.phrase.min, t.phrase.max);
    if (m) {
      const synced = syncToMusic(slots, v, m);
      slots = synced.slots;
      music = { start: synced.start, volume: 0.35, fadeIn: 0.3, fadeOut: 1.2, duck: 0.65 };
    }
    // The last slot closes the ad when there's time for it.
    if (slots.length > 2) slots[slots.length - 1].role = "end";
    if (!slots.some((s) => s.role === "drop") && slots.length > 3) slots[Math.floor(slots.length * 0.4)].role = "drop";
    summary = `${slots.length} scenes cut on the voice-over's pauses${m ? ", music starting on a bar" : ""}`;
  } else if (m) {
    const win = musicWindow(m, input.length ?? t.length, input.dropAt ?? t.dropAt);
    slots = musicSlots(m, win.start, win.total, t.cut);
    music = { start: win.start, volume: 0.9, fadeIn: 0, fadeOut: 0.6, duck: 0 };
    const drop = slots.find((s) => s.role === "drop");
    summary = `${slots.length} cuts on the beat at ${Math.round(m.bpm ?? 120)} BPM${drop ? `, the drop at ${drop.s.toFixed(1)}s` : ""}`;
  } else {
    // No audio yet: a 15 s demo at 120 bpm, so the template still previews.
    const demo: MusicIn = { duration: 32, bpm: 120, drop: 6 };
    const win = musicWindow(demo, t.length || 15, t.dropAt);
    slots = musicSlots(demo, win.start, win.total, t.cut);
    summary = "a demo timing (add audio to sync it)";
  }

  let img = 0, line = 0;
  const pool = [copy.line, ...copy.points, copy.brand];
  const ctxFor = (slot: Slot, i: number): Ctx => ({
    slot,
    i,
    n: slots.length,
    nextRole: slots[i + 1]?.role,
    copy,
    voiced: !!v?.words?.length,
    image: () => (input.images.length ? input.images[img++ % input.images.length] : undefined),
    line: () => pool[line++ % pool.length],
    say(max = 8) {
      const text = slot.text ? clip(slot.text, max) : pool[line++ % pool.length];
      return emphasize(text);
    },
  });
  const scenes = slots.map((slot, i) => {
    const sc = t.scene(ctxFor(slot, i));
    // Round the cut points, not the lengths, so rounding never drifts the cut off the beat.
    const r2 = (x: number) => Math.round(x * 100) / 100;
    return { ...sc, duration: +(r2(slot.e) - r2(slot.s)).toFixed(2), ...(i === 0 && { transition: "cut" as const }) };
  });
  return { title: `${copy.brand} · ${t.name}`, aspect: t.aspect, style: t.style, captions: t.captions && !!v?.words?.length, grain: true, scenes, music, summary };
}

// ---------------------------------------------------------------- the templates
const fx = (grade: Grade, effects: Effect[], amount = 0.7) => ({ grade, effects, fxAmount: amount });
const motion = (m: Motion) => ({ motion: m });

export const SOUND_TEMPLATES: SoundTemplate[] = [
  {
    id: "drop",
    name: "Beat Drop",
    blurb: "Words punch in on every bar, a 3-2-1 into the drop, then your product hits with a flash.",
    needs: "music",
    aspect: "9:16",
    style: "noir",
    length: 15,
    dropAt: 0.4,
    cut: { build: 4, after: 2, endBars: 2 },
    phrase: { min: 1.2, max: 2.6 },
    captions: false,
    swatch: { bg: "#0B0B0C", fg: "#F4F4EF", accent: "#C8FF3D" },
    scene(c) {
      const { slot } = c;
      if (slot.role === "end") return { template: "cta-end", headline: emphasize(c.copy.line), cta: c.copy.cta, url: c.copy.url, background: "gradient", transition: "zoom", ...fx("vivid", ["beat-flash", "pulse"], 0.6) };
      if (slot.role === "drop") {
        const im = c.image();
        return im
          ? { template: "product-hero", image: im, headline: emphasize(c.copy.brand), transition: "cut", ...motion("snappy"), ...fx("vivid", ["flash", "shake", "beat-flash"], 0.85) }
          : { template: "logo-reveal", headline: c.copy.brand, subline: c.copy.line, transition: "cut", ...fx("vivid", ["flash", "shake", "beat-flash"], 0.85) };
      }
      // The bar before the drop counts it in.
      if (slot.role === "build" && slot.beats >= 3 && c.i > 0 && isLastBuild(c)) return { template: "countdown", kicker: "Ready", stat: { value: 3 }, headline: "*Now*", background: "invert", transition: "cut", ...fx("vivid", ["pulse"], 0.7) };
      if (slot.role === "body") {
        const im = c.image();
        if (im && c.i % 2 === 0) return { template: "fullbleed", image: im, headline: c.say(4), transition: "cut", ...fx("vivid", ["pulse", "rgb-split"], 0.6) };
        return { template: "kinetic-words", headline: c.say(4), background: c.i % 3 === 0 ? "accent" : "solid", transition: "cut", ...fx("vivid", ["pulse"], 0.7) };
      }
      return { template: "kinetic-words", headline: c.say(3), background: "solid", transition: "cut", ...fx("noir", ["pulse"], 0.6) };
    },
  },
  {
    id: "rhythm",
    name: "Rhythm Cut",
    blurb: "Product shots cut on every bar with a push on the beat; a mosaic on the drop.",
    needs: "music",
    aspect: "1:1",
    style: "clean",
    length: 20,
    dropAt: 0.35,
    cut: { build: 4, after: 4, endBars: 2 },
    phrase: { min: 1.6, max: 3.2 },
    captions: false,
    swatch: { bg: "#FFFFFF", fg: "#0A0A0A", accent: "#0A66FF" },
    scene(c) {
      const { slot } = c;
      if (slot.role === "hook") return { template: "title-reveal", kicker: c.copy.brand, headline: emphasize(clip(c.copy.line, 6)), background: "solid", transition: "cut", ...fx("none", ["pulse"], 0.6) };
      if (slot.role === "end") return { template: "cta-end", headline: emphasize(c.copy.line), cta: c.copy.cta, url: c.copy.url, background: "gradient", transition: "push-up" };
      if (slot.role === "drop") {
        const ims = [c.image(), c.image(), c.image(), c.image()].filter(Boolean) as string[];
        return ims.length >= 3 ? { template: "image-mosaic", images: [...new Set(ims)], headline: emphasize(c.copy.brand), transition: "cut", ...fx("vivid", ["beat-flash"], 0.6) } : { template: "shape-burst", headline: emphasize(c.copy.brand), background: "accent", transition: "cut", ...fx("vivid", ["beat-flash"], 0.6) };
      }
      const im = c.image();
      if (im) return { template: c.i % 3 === 1 ? "split-feature" : "fullbleed", image: im, headline: c.say(5), transition: "cut", ...fx("none", ["push-in", "pulse"], 0.6) };
      return { template: c.i % 2 ? "title-reveal" : "kinetic-words", headline: c.say(5), background: c.i % 2 ? "grid" : "solid", transition: "cut", ...fx("none", ["pulse"], 0.6) };
    },
  },
  {
    id: "words",
    name: "Word by Word",
    blurb: "Every word appears as it's spoken, the key word in your accent colour.",
    needs: "voice",
    aspect: "9:16",
    style: "swiss",
    length: 15,
    dropAt: 0.4,
    cut: { build: 4, after: 4, endBars: 2 },
    phrase: { min: 1.6, max: 3.4 },
    captions: false,
    swatch: { bg: "#F3F0E9", fg: "#111111", accent: "#FF4D1A" },
    scene(c) {
      const { slot } = c;
      if (slot.role === "end" && c.n > 2) return { template: "cta-end", headline: c.say(6), cta: c.copy.cta, url: c.copy.url, background: "accent", transition: "push-up" };
      const bg: Scene["background"] = slot.role === "drop" ? "invert" : c.i % 4 === 2 ? "grid" : "solid";
      return { template: "kinetic-words", headline: c.say(10), background: bg, transition: c.i % 2 ? "push-up" : "cut", ...fx("none", slot.role === "drop" ? ["pulse", "flash"] : ["pulse"], 0.6) };
    },
  },
  {
    id: "podcast",
    name: "Podcast Clip",
    blurb: "A breathing portrait, a live waveform and captions word by word. Made for audiograms.",
    needs: "voice",
    aspect: "1:1",
    style: "aurora",
    length: 20,
    dropAt: 0.5,
    cut: { build: 8, after: 8, endBars: 2 },
    phrase: { min: 60, max: 90 },
    captions: false,
    swatch: { bg: "#0C0D19", fg: "#FFFFFF", accent: "#8B6CFF" },
    scene(c) {
      return { template: "audiogram", image: c.image(), kicker: c.copy.brand, headline: emphasize(clip(c.copy.line, 7)), subline: c.copy.points[0], background: "blobs", transition: "cut", ...fx("none", ["vignette"], 0.5) };
    },
  },
  {
    id: "story",
    name: "Testimonial Story",
    blurb: "A spoken story as warm, filmic quote cards between your photos.",
    needs: "voice",
    aspect: "4:5",
    style: "blush",
    length: 20,
    dropAt: 0.5,
    cut: { build: 8, after: 8, endBars: 2 },
    phrase: { min: 2.6, max: 5 },
    captions: true,
    swatch: { bg: "#F6E9E4", fg: "#2A1E1B", accent: "#C8553D" },
    scene(c) {
      const { slot } = c;
      const look = fx("warm-film", ["dust", "vignette"], 0.55);
      if (slot.role === "end") return { template: "logo-reveal", headline: c.copy.brand, subline: c.copy.cta, transition: "fade", ...motion("calm"), ...look };
      const im = c.i % 2 === 1 ? c.image() : undefined;
      if (im) return { template: "fullbleed", image: im, headline: c.say(6), transition: "fade", ...motion("calm"), ...fx("warm-film", ["push-in", "dust", "vignette"], 0.55) };
      return { template: "quote", headline: (slot.text ? clip(slot.text, 16) : c.line()).replace(/\*/g, ""), author: c.copy.brand, transition: "fade", ...motion("calm"), ...look };
    },
  },
  {
    id: "explainer",
    name: "Explainer Steps",
    blurb: "A clear how-it-works: numbered steps that follow the narration.",
    needs: "voice",
    aspect: "16:9",
    style: "clean",
    length: 30,
    dropAt: 0.5,
    cut: { build: 8, after: 8, endBars: 2 },
    phrase: { min: 3, max: 6 },
    captions: true,
    swatch: { bg: "#FFFFFF", fg: "#0A0A0A", accent: "#0A66FF" },
    scene(c) {
      const { slot } = c;
      if (slot.role === "hook") return { template: "title-reveal", kicker: c.copy.brand, headline: c.say(7), background: "grid", transition: "cut" };
      if (slot.role === "end") return { template: "cta-end", headline: c.say(6), cta: c.copy.cta, url: c.copy.url, background: "gradient", transition: "zoom" };
      const step = c.i;
      const im = c.image();
      if (im) return { template: step % 2 ? "split-feature" : "device-mockup", image: im, kicker: `Step ${step}`, headline: c.say(7), align: "left", transition: "slide", ...motion("smooth") };
      return { template: "title-reveal", kicker: `Step ${step}`, headline: c.say(7), align: "left", background: step % 2 ? "solid" : "dots", transition: "push-up", ...motion("smooth") };
    },
  },
  {
    id: "trailer",
    name: "Cinematic Trailer",
    blurb: "Slow, dramatic titles that build to a reveal. Best with a voice-over and a score.",
    needs: "either",
    aspect: "16:9",
    style: "noir",
    length: 30,
    dropAt: 0.55,
    cut: { build: 8, after: 4, endBars: 3 },
    phrase: { min: 2.4, max: 4.5 },
    captions: false,
    swatch: { bg: "#0B0B0C", fg: "#F4F4EF", accent: "#C8FF3D" },
    scene(c) {
      const { slot } = c;
      const film = fx("noir", ["push-in", "vignette", "light-leak"], 0.75);
      if (slot.role === "end") return { template: "cta-end", headline: c.say(5), cta: c.copy.cta, url: c.copy.url, background: "solid", transition: "fade", ...motion("dramatic"), ...fx("noir", ["vignette"], 0.6) };
      if (slot.role === "drop") return { template: "logo-reveal", headline: c.copy.brand, subline: c.copy.line, transition: "cut", ...motion("dramatic"), ...fx("noir", ["flash", "shake", "vignette"], 0.85) };
      const im = slot.role === "body" || c.i % 2 === 1 ? c.image() : undefined;
      if (im) return { template: "fullbleed", image: im, headline: c.say(5), transition: slot.role === "body" ? "cut" : "fade", ...motion("dramatic"), ...film };
      return { template: "title-reveal", headline: c.say(6), background: "solid", transition: "fade", ...motion("dramatic"), ...fx("noir", ["vignette", "dust"], 0.7) };
    },
  },
  {
    id: "sale",
    name: "Flash Sale",
    blurb: "Countdown to the drop, then the offer bursts in with confetti on the beat.",
    needs: "music",
    aspect: "9:16",
    style: "aurora",
    length: 15,
    dropAt: 0.45,
    cut: { build: 4, after: 4, endBars: 2 },
    phrase: { min: 1.6, max: 3 },
    captions: false,
    swatch: { bg: "#0C0D19", fg: "#FFFFFF", accent: "#8B6CFF" },
    scene(c) {
      const { slot } = c;
      if (slot.role === "end") return { template: "cta-end", headline: emphasize(c.copy.line), cta: c.copy.cta, url: c.copy.url, background: "accent", transition: "zoom", ...fx("vivid", ["confetti", "beat-flash"], 0.8) };
      if (slot.role === "drop") {
        const offer = [c.copy.line, ...c.copy.points].map(parseOffer).find(Boolean);
        return offer
          ? { template: "stat-counter", kicker: c.copy.brand, stat: offer, background: "accent", transition: "cut", ...fx("vivid", ["confetti", "flash", "shake"], 0.85) }
          : { template: "shape-burst", headline: emphasize(c.copy.line), background: "accent", transition: "cut", ...fx("vivid", ["confetti", "flash"], 0.85) };
      }
      if (slot.role === "build" && isLastBuild(c)) return { template: "countdown", kicker: "Starts in", stat: { value: 3 }, headline: "*Go*", background: "solid", transition: "cut", ...fx("vivid", ["pulse"], 0.7) };
      const im = slot.role === "body" ? c.image() : undefined;
      if (im) return { template: "product-hero", image: im, headline: c.say(4), transition: "cut", ...fx("vivid", ["pulse", "beat-flash"], 0.7) };
      return { template: "kinetic-words", headline: c.say(4), background: c.i % 2 ? "gradient" : "solid", transition: "cut", ...fx("vivid", ["pulse"], 0.7) };
    },
  },
];

/** The build-up slot right before the drop. */
function isLastBuild(c: Ctx): boolean {
  return c.slot.role === "build" && !!c.nextRole && c.nextRole === "drop";
}

/** "50% off", "-30%", "$19" → a stat to count up to. */
export function parseOffer(text: string): Scene["stat"] | undefined {
  const pct = text.match(/(\d{1,3})\s?%/);
  if (pct) return { value: +pct[1], suffix: "%", label: text.replace(/\*/g, "").replace(pct[0], "").replace(/^\s*[-–—:]\s*/, "").trim().slice(0, 40) || "off" };
  const money = text.match(/([$€£])\s?(\d+(?:\.\d{1,2})?)/);
  if (money) return { value: +money[2], prefix: money[1], decimals: money[2].includes(".") ? 2 : 0, label: text.replace(/\*/g, "").replace(money[0], "").trim().slice(0, 40) };
  return undefined;
}

export const soundTemplate = (id: string) => SOUND_TEMPLATES.find((t) => t.id === id) ?? SOUND_TEMPLATES[0];
