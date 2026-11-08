import { test } from "node:test";
import assert from "node:assert/strict";
import { SOUND_TEMPLATES, buildSound, soundTemplate, voiceSlots, musicWindow, musicSlots, emphasize, parseOffer, type MusicIn, type VoiceIn } from "./soundTemplates";
import { sanitizeScene } from "./sanitize";
import { lintStoryboard } from "./agent/lint";

const copy = { brand: "Orbit", line: "Time, rethought", points: ["Ten-day battery", "50% off this week"], cta: "Shop now", url: "orbit.watch" };

/** 128 bpm, 64 s, quiet intro, drop at bar 9. */
function music(): MusicIn {
  const bl = 60 / 128, beats: number[] = [], energy: number[] = [];
  for (let i = 0; i * bl < 64; i++) beats.push(+(0.2 + i * bl).toFixed(3)), energy.push(i < 32 ? 0.3 : 0.9);
  return { duration: 64, bpm: 128, beats, downbeats: beats.filter((_, i) => i % 4 === 0), energy, drop: beats[32] };
}

/** "Meet Orbit. The watch that knows you. Ten days on one charge. Shop now." with pauses between. */
function voice(): VoiceIn {
  const lines = ["Meet Orbit.", "The watch that knows you.", "Ten days on one charge, every single time.", "Shop now at orbit dot watch."];
  const words = [], pauses = [];
  let t = 0.3;
  for (const l of lines) {
    for (const w of l.split(" ")) words.push({ w, s: +t.toFixed(2), e: +(t + 0.3).toFixed(2) }), (t += 0.34);
    pauses.push({ s: +t.toFixed(2), e: +(t + 0.5).toFixed(2) });
    t += 0.5;
  }
  return { duration: +(t + 0.2).toFixed(2), pauses: pauses.slice(0, -1), words };
}
const total = (sc: { duration: number }[]) => sc.reduce((a, s) => a + s.duration, 0);

test("sound: every template builds clean scenes from music, voice, both and nothing", () => {
  for (const t of SOUND_TEMPLATES) {
    for (const input of [{ music: music() }, { voice: voice() }, { voice: voice(), music: music() }, {}]) {
      const b = buildSound(t, { ...input, copy, images: ["asset:a", "asset:b", "asset:c"] });
      assert.ok(b.scenes.length >= 1, t.id);
      for (const s of b.scenes) {
        const clean = sanitizeScene(s);
        assert.equal(clean.template, s.template, `${t.id}: ${s.template} survives cleaning`);
        assert.ok(s.duration >= 0.8, `${t.id}: ${s.duration}s scene`);
        assert.equal(clean.duration, s.duration, `${t.id}: duration unchanged by cleaning`);
      }
      if ("voice" in input && input.voice) assert.ok(Math.abs(total(b.scenes) - input.voice.duration) < 0.02, `${t.id} fits the voice-over`);
    }
  }
});

test("sound: music cuts land on beats, the drop lands on a cut, and the end is a whole bar", () => {
  const m = music();
  const t = soundTemplate("drop");
  const b = buildSound(t, { music: m, copy, images: [] });
  assert.ok(b.music, "music settings");
  const beatsInCut = m.beats!.map((x) => x - b.music!.start);
  let at = 0;
  for (const s of b.scenes.slice(0, -1)) {
    at += s.duration;
    assert.ok(beatsInCut.some((x) => Math.abs(x - at) < 0.011), `cut at ${at.toFixed(2)} is on a beat`);
  }
  const dropT = m.drop! - b.music!.start;
  let t2 = 0;
  const cuts = b.scenes.map((s) => ((t2 += s.duration), t2 - s.duration));
  const k = cuts.findIndex((c) => Math.abs(c - dropT) < 0.011);
  assert.ok(k > 0, "a scene starts on the drop");
  assert.ok(["product-hero", "logo-reveal"].includes(b.scenes[k].template));
  assert.equal(b.scenes[k - 1].template, "countdown", "the bar before the drop counts in");
  assert.equal(b.scenes.at(-1)!.template, "cta-end");
  const bar = (60 / 128) * 4;
  assert.ok(Math.abs(total(b.scenes) / bar - Math.round(total(b.scenes) / bar)) < 0.02, "whole bars");
  assert.ok(Math.abs(total(b.scenes) - 15) < bar, "about 15 s");
  assert.ok(Math.abs(dropT / total(b.scenes) - 0.4) < 0.15, "drop about 40% in");
});

test("sound: a track with no drop starts after a quiet intro", () => {
  const m = { ...music(), drop: undefined, energy: music().energy!.map((e, i) => (i < 8 ? 0.05 : 0.8)) };
  const w = musicWindow(m, 15, 0.4);
  assert.equal(w.start, m.beats![8]);
  const slots = musicSlots(m, w.start, w.total, { build: 4, after: 2, endBars: 2 });
  assert.ok(!slots.some((s) => s.role === "drop"));
  assert.equal(slots.at(-1)!.role, "end");
});

test("sound: voice slots cut in the pauses and carry their words", () => {
  const v = voice();
  const slots = voiceSlots(v, 1.6, 3.4);
  for (const s of slots.slice(0, -1)) assert.ok(v.pauses.some((p) => s.e >= p.s && s.e <= p.e), `cut at ${s.e} is in a pause`);
  assert.match(slots[0].text!, /Meet Orbit/);
  assert.ok(slots.every((s) => s.e - s.s >= 1.2));
});

test("sound: voice and music together keep cuts in pauses and move them onto beats when one is there", () => {
  const b = buildSound(soundTemplate("words"), { voice: voice(), music: music(), copy, images: [] });
  const m = music(), v = voice();
  let at = 0;
  for (const s of b.scenes.slice(0, -1)) {
    at += s.duration;
    assert.ok(v.pauses.some((p) => at >= p.s - 0.011 && at <= p.e + 0.011), `cut ${at.toFixed(2)} in a pause`);
  }
  assert.ok(b.music!.volume < 0.5 && b.music!.duck > 0, "music sits under the voice");
  assert.ok(m.downbeats!.includes(b.music!.start), "music starts on a bar");
});

test("sound: the podcast clip is one audiogram for the whole voice-over", () => {
  const b = buildSound(soundTemplate("podcast"), { voice: voice(), copy, images: ["asset:me"] });
  assert.equal(b.scenes.length, 1);
  assert.equal(b.scenes[0].template, "audiogram");
  assert.equal(b.scenes[0].image, "asset:me");
});

test("sound: the flash sale counts up the offer it finds in the copy", () => {
  assert.deepEqual(parseOffer("50% off this week"), { value: 50, suffix: "%", label: "off this week" });
  assert.equal(parseOffer("$19.99 today")?.value, 19.99);
  assert.equal(parseOffer("no numbers"), undefined);
  const b = buildSound(soundTemplate("sale"), { music: music(), copy, images: [] });
  const stat = b.scenes.find((s) => s.template === "stat-counter");
  assert.equal(stat?.stat?.value, 50);
});

test("sound: emphasis picks the word that matters", () => {
  assert.equal(emphasize("Ten days on one charge."), "Ten days on one *charge*.");
  assert.equal(emphasize("Save 50% today"), "Save *50%* today");
  assert.equal(emphasize("Already *marked* here"), "Already *marked* here");
  assert.equal(emphasize("of the and"), "of the and");
});

test("sound: built cuts pass the Director's notes without warnings about timing", () => {
  const v = voice();
  for (const t of SOUND_TEMPLATES) {
    const b = buildSound(t, { voice: v, copy, images: ["asset:a"] });
    const notes = lintStoryboard({ scenes: b.scenes.map((s) => sanitizeScene(s)), brand: { bg: "#000", fg: "#fff", accent: "#C8FF3D", name: "Orbit" }, audio: { duration: v.duration, pauses: v.pauses, hasWords: true } });
    assert.deepEqual(notes.filter((n) => n.code === "vo-length" || n.code === "cuts-off-pause").map((n) => n.message), [], t.id);
  }
});
