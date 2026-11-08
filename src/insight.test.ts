import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeVoice, pitchAt, readTranscript, findUrl, findProduct, musicSections, mixLevel, brightness } from "./audio/insight";

const SR = 16000;
/** A "voice": one tone burst per word; the stressed word is louder, higher and held longer. */
function voice(words: string[], stressAt: number) {
  const out: { w: string; s: number; e: number }[] = [];
  let t = 0.3;
  const segs: [number, number, number, number][] = [];
  words.forEach((w, i) => {
    const d = i === stressAt ? 0.42 : 0.26;
    out.push({ w, s: +t.toFixed(3), e: +(t + d).toFixed(3) });
    segs.push([t, d, i === stressAt ? 0.8 : 0.3, i === stressAt ? 240 : 140]);
    t += d + 0.06;
  });
  const x = new Float32Array(Math.ceil((t + 0.3) * SR));
  for (const [s, d, amp, f] of segs) for (let i = 0; i < d * SR; i++) x[Math.floor(s * SR) + i] = amp * Math.sin((2 * Math.PI * f * i) / SR) * Math.sin((Math.PI * i) / (d * SR));
  return { x, words: out, duration: x.length / SR };
}

test("insight: pitch is found on voiced tones and not on silence", () => {
  const { x } = voice(["hello"], 0);
  assert.ok(Math.abs(pitchAt(x, SR, 0.5) - 240) < 12, `${pitchAt(x, SR, 0.5)}`);
  assert.equal(pitchAt(new Float32Array(SR), SR, 0.5), 0);
});

test("insight: the stressed word is the loud, high, held one; pace and mood are read", () => {
  const ws = "Your mornings never felt this incredible before today honestly".split(" ");
  const v = voice(ws, 5);
  const ins = analyzeVoice(v.x, SR, v.words, [], v.duration);
  assert.ok(ins.stressed.includes(5), `stressed ${ins.stressed}`);
  assert.ok(ins.stressedWords.includes("incredible"));
  assert.ok(ins.wpm > 130 && ins.wpm < 170, `${ins.wpm} wpm`);
  assert.ok(["measured", "brisk"].includes(ins.pace));
  assert.ok(ins.energy.length > 5 && Math.max(...ins.energy) === 1);
});

test("insight: the transcript gives the hook, the call to action, the product and the link", () => {
  const w = (t: string) => t.split(" ").map((x, i) => ({ w: x, s: i, e: i + 0.5 }));
  const words = [...w("Okay runners, stop scrolling."), ...w("Meet Orbit, the watch that coaches your sleep.").map((x) => ({ ...x, s: x.s + 10, e: x.e + 10 })), ...w("Ten days on one charge.").map((x) => ({ ...x, s: x.s + 20, e: x.e + 20 })), ...w("Pre-order today at orbit dot watch.").map((x) => ({ ...x, s: x.s + 30, e: x.e + 30 }))];
  const r = readTranscript(words);
  assert.equal(r.hook, "Okay runners, stop scrolling.");
  assert.equal(r.cta, "Pre-order today at orbit dot watch.");
  assert.equal(r.product, "Orbit");
  assert.equal(r.url, "orbit.watch");
  assert.ok(r.benefits.includes("Ten days on one charge"));
  assert.equal(findUrl("visit lumen.co now"), "lumen.co");
  assert.equal(findProduct("We love Lumen. Lumen is great. Try it."), "Lumen");
});

test("insight: a track's shape — intro, build, drop, outro", () => {
  const bpm = 120, bl = 0.5, beats: number[] = [], energy: number[] = [];
  for (let i = 0; i < 64; i++) {
    beats.push(i * bl);
    const bar = Math.floor(i / 4);
    energy.push(bar < 2 ? 0.2 : bar < 6 ? 0.2 + (bar - 2) * 0.12 : bar < 13 ? 0.95 : 0.25);
  }
  const downbeats = beats.filter((_, i) => i % 4 === 0);
  const s = musicSections(downbeats, beats, energy, 32);
  const kinds = s.map((x) => x.kind);
  assert.equal(kinds[0], "intro", kinds.join(","));
  assert.ok(kinds.includes("drop") && kinds.includes("build"), kinds.join(","));
  const drop = s.find((x) => x.kind === "drop")!;
  assert.ok(drop.s >= 10 && drop.s <= 14, `drop at ${drop.s}`);
  assert.ok(["outro", "break"].includes(kinds.at(-1)!), kinds.join(","));
  void bpm;
});

test("insight: music sits about 12 dB under the voice; brightness is bounded", () => {
  assert.equal(mixLevel(0.2, 0.2), 0.25);
  assert.equal(mixLevel(0.01, 0.5), 0.08);
  assert.equal(mixLevel(0, 0.2), 0.3);
  const noise = new Float32Array(SR).map(() => Math.random() * 2 - 1);
  assert.ok(brightness(noise, SR) > 0.5 && brightness(new Float32Array(SR), SR) === 0);
});
