// Fuzz: the motion planner, its readers and the scene cleaner, fed random and hostile transcripts.
// Invariants: never throws; beats tile the voice-over in order; every scene survives the cleaner
// unchanged in template; no NaN reaches a scene; numbers on screen were said.
import test from "node:test";
import assert from "node:assert/strict";
import { planMotion, motionScenes, numbersIn, listIn, stepsIn, labelAfter, MOTION_TEMPLATES, MOTION_STYLES, pseudoVoice } from "./mograph/plan";
import { placesIn, placeAt } from "./mograph/places";
import { builtinIcon } from "./mograph/ideas";
import { sanitizeScene } from "./sanitize";

let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const VOCAB = ["Orbit", "sleep", "better", "grew", "from", "12k", "to", "48k", "64%", "28%", "London", "Lagos", "New", "York", "delivered", "door", "18", "minutes", "dashboard", "real", "time", "first", "then", "finally", "and", ",", ".", "!", "?", "us", "turkey", "2023", "2025", "1,200", "$19", "€5", "x", "half", "ten", "🚀", "日本", "—", "", " ", "a".repeat(80), "NaN", "Infinity", "-3", "0", "0%", "100%", "150%", "$", "%", "|", "*", "**", "<script>", "Meet", "your", "the"];

function transcript(n: number) {
  const words: { w: string; s: number; e: number }[] = [];
  let t = rnd() * 0.5;
  for (let i = 0; i < n; i++) {
    const d = 0.1 + rnd() * 0.5;
    words.push({ w: pick(VOCAB), s: +t.toFixed(2), e: +(t + d).toFixed(2) });
    t += d + (rnd() < 0.15 ? 0.5 + rnd() : 0.02);
  }
  const pauses = [];
  for (let i = 1; i < words.length; i++) if (words[i].s - words[i - 1].e > 0.3) pauses.push({ s: words[i - 1].e, e: words[i].s });
  return { duration: +(t + rnd()).toFixed(2), pauses, words };
}

test("fuzz: planner holds its invariants on 2,000 random transcripts", () => {
  for (let k = 0; k < 2000; k++) {
    const v = transcript(Math.floor(rnd() * 70));
    const brief = rnd() < 0.5 ? { product: "Orbit", benefits: ["Fast", "Live revenue tracking"] } : {};
    const st = pick(MOTION_STYLES);
    const beats = planMotion(v, brief, { prefer: st.prefer });
    assert.ok(beats.length >= 1, `case ${k}: no beats`);
    let t = 0;
    for (const b of beats) {
      assert.ok(MOTION_TEMPLATES.includes(b.template), `case ${k}: ${b.template}`);
      assert.ok(Number.isFinite(b.s) && Number.isFinite(b.e) && b.e > b.s, `case ${k}: bad span ${b.s}-${b.e}`);
      assert.ok(Math.abs(b.s - t) < 0.02, `case ${k}: gap at ${t} → ${b.s}`);
      t = b.e;
      if (b.stat) assert.ok(Number.isFinite(b.stat.value), `case ${k}: NaN stat`);
      assert.ok((b.items ?? []).length <= 12);
    }
    assert.ok(Math.abs(t - v.duration) < 0.05, `case ${k}: ends at ${t}, voice ${v.duration}`);
    const scenes = motionScenes(beats, beats.map((b) => b.ideas.map((i) => builtinIcon(i) ?? null)), st, brief);
    for (const sc of scenes) {
      const clean = sanitizeScene(sc);
      assert.equal(clean.template, sc.template, `case ${k}: cleaner changed ${sc.template}`);
      assert.ok(Number.isFinite(sc.duration) && sc.duration > 0, `case ${k}: duration ${sc.duration}`);
      if (sc.stat) assert.ok(Number.isFinite(sc.stat.value), `case ${k}: stat ${sc.stat.value}`);
      assert.ok(!(sc.icons ?? []).some((x) => !x), `case ${k}: empty icon name`);
    }
  }
});

test("fuzz: readers never throw on hostile strings", () => {
  const nasty = ["", " ", "|||", "1,2,3,4,5,6,7,8,9", "$$$$", "%%%", "1e400", "-0", "\u0000", "🚀".repeat(50), "a ".repeat(2000), "first then first then", "London London London", "in in in in"];
  for (let k = 0; k < 500; k++) nasty.push(Array.from({ length: Math.floor(rnd() * 30) }, () => pick(VOCAB)).join(pick([" ", ", ", " and ", ""])));
  for (const s of nasty) {
    numbersIn(s).forEach((n) => assert.ok(Number.isFinite(n.value), s));
    listIn(s);
    stepsIn(s);
    placesIn(s).forEach((p) => assert.ok(placeAt(p), p));
    labelAfter(s, Math.floor(rnd() * (s.length + 1)));
    builtinIcon(s);
  }
});

test("fuzz: the preview narration works for empty and huge briefs", () => {
  for (const b of [{}, { product: "" }, { product: "x".repeat(500), benefits: Array(50).fill("y".repeat(200)) }, { benefits: [] as string[], offer: "", cta: "" }]) {
    const v = pseudoVoice(b);
    assert.ok(v.duration > 0 && v.words!.length > 0);
    assert.ok(planMotion(v, b).length >= 1);
  }
});
