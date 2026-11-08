import { test } from "node:test";
import assert from "node:assert/strict";
import { FORMATS, CATEGORIES, buildFormat, fill, offerStat, em } from "./formats";
import { sanitizeScene } from "./sanitize";
import { lintStoryboard } from "./agent/lint";
import { TEMPLATES } from "./types";

const brief = { product: "Orbit", what: "a smartwatch that coaches your sleep", audience: "runners", benefits: ["Ten-day battery", "Sleep coaching that works", "Titanium light"], offer: "30% off launch week", cta: "Pre-order", url: "orbit.watch" };

test("formats: a broad catalogue across every category, unique ids", () => {
  assert.ok(FORMATS.length >= 20, `${FORMATS.length}`);
  for (const c of CATEGORIES) assert.ok(FORMATS.some((f) => f.category === c), c);
  assert.equal(new Set(FORMATS.map((f) => f.id)).size, FORMATS.length);
});

test("formats: every format builds clean scenes, with and without images, from full or empty briefs", () => {
  for (const f of FORMATS) {
    for (const [b, imgs] of [[brief, ["asset:a", "asset:b", "asset:c"]], [{}, []]] as const) {
      const scenes = buildFormat(f, b, [...imgs]);
      assert.ok(scenes.length >= 3, f.id);
      assert.equal(scenes[0].transition, "cut");
      for (const s of scenes) {
        assert.ok((TEMPLATES as readonly string[]).includes(s.template), `${f.id}: ${s.template}`);
        const clean = sanitizeScene(s);
        assert.equal(clean.template, s.template, `${f.id}: ${s.template}`);
        assert.ok(clean.duration >= 0.8);
        assert.ok(!(s.image && !imgs.length), `${f.id}: no image refs without images`);
      }
      assert.equal(scenes.at(-1)!.template, "cta-end", `${f.id} ends on a call to action`);
      const total = scenes.reduce((a, s) => a + s.duration, 0);
      assert.ok(total >= 8 && total <= 30, `${f.id}: ${total}s`);
      const notes = lintStoryboard({ scenes: scenes.map((s) => sanitizeScene(s)), brand: { bg: "#0B0B0C", fg: "#F4F4EF", accent: "#C8FF3D", name: "Orbit" }, assetIds: new Set(imgs) });
      assert.deepEqual(notes.filter((n) => n.level === "warn").map((n) => n.message), [], f.id);
    }
  }
});

test("formats: briefs fill sensibly and offers become counters", () => {
  const b = fill({ product: "Lumen", offer: "50% off today" });
  assert.equal(b.product, "Lumen");
  assert.ok(b.benefits.length >= 3);
  assert.equal(b.cta, "Claim the offer");
  assert.deepEqual(offerStat("50% off today"), { value: 50, suffix: "%", label: "off today" });
  assert.equal(offerStat("$19.99 for a year")?.prefix, "$");
  assert.equal(offerStat("free shipping"), undefined);
  assert.equal(em("Ten-day battery life"), "Ten-day *battery* life");
});

import { SECTIONS, buildWithVoice, snapToBeats, scriptFor, stockRef, isStockRef } from "./formats";

function voice(lines: string[]) {
  const words: { w: string; s: number; e: number }[] = [], pauses: { s: number; e: number }[] = [];
  let t = 0.3;
  lines.forEach((l, i) => {
    for (const w of l.split(" ")) words.push({ w, s: +t.toFixed(2), e: +(t + 0.3).toFixed(2) }), (t += 0.34);
    if (i < lines.length - 1) pauses.push({ s: +t.toFixed(2), e: +(t + 0.5).toFixed(2) }), (t += 0.5);
  });
  return { duration: +(t + 0.3).toFixed(2), pauses, words };
}
const VO = voice(["Okay runners, stop scrolling for a second.", "Meet Orbit, the smartwatch that coaches your sleep.", "Ten days on one charge.", "Sleep coaching that actually works.", "Thirty percent off this week.", "Pre-order at orbit dot watch."]);

test("formats: three sections, each with plenty of formats; text formats never need footage", () => {
  for (const s of SECTIONS) assert.ok(FORMATS.filter((f) => f.section === s.id).length >= 8, s.id);
  for (const f of FORMATS.filter((f) => f.section === "text")) {
    const scenes = buildFormat(f, brief, []);
    assert.ok(!scenes.some((s) => s.image || s.images?.length || s.backdrop?.length), f.id);
  }
  for (const f of FORMATS.filter((f) => f.section === "footage")) {
    const scenes = buildFormat(f, brief, ["asset:a", "asset:b", "asset:c", "asset:d", "asset:e", "asset:f", "asset:g", "asset:h", "asset:i"]);
    assert.ok(scenes.filter((s) => s.template === "fullbleed").length >= 3, f.id);
    assert.ok(scenes.filter((s) => s.template === "fullbleed").every((s) => s.shot?.query), `${f.id}: every shot says what to cast`);
  }
});

test("formats: every format rebuilds around a voice-over, cut in its pauses, as long as it", () => {
  for (const f of FORMATS) {
    const { scenes, captions } = buildWithVoice(f, brief, VO, [stockRef(0), stockRef(1), stockRef(2), stockRef(3), stockRef(4), stockRef(5), stockRef(6), stockRef(7)]);
    const total = scenes.reduce((a, s) => a + s.duration, 0);
    assert.ok(Math.abs(total - VO.duration) < 0.03, `${f.id}: ${total} vs ${VO.duration}`);
    let t = 0;
    for (const s of scenes.slice(0, -1)) {
      t += s.duration;
      assert.ok(f.section === "footage" || VO.pauses.some((p) => t >= p.s - 0.02 && t <= p.e + 0.02), `${f.id}: cut at ${t.toFixed(2)} in a pause`);
    }
    for (const s of scenes) assert.equal(sanitizeScene(s).template, s.template);
    assert.equal(captions, f.section === "footage", `${f.id}: subtitles only where nothing else says the words`);
    if (f.section !== "footage") {
      // the words on screen are what's being said
      const spoken = scenes.filter((s) => s.headline && /stop|sleep|charge|coaching|percent|orbit/i.test(s.headline));
      assert.ok(spoken.length >= 2, `${f.id}: ${scenes.map((s) => s.headline).join(" | ")}`);
    }
    assert.equal(scenes.at(-1)!.template, "cta-end", f.id);
  }
});

test("formats: cuts snap to the beat, scripts read like an ad, stock refs survive cleaning", () => {
  const snapped = snapToBeats([{ duration: 2.1 }, { duration: 1.9 }, { duration: 2 }], [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6]);
  assert.deepEqual(snapped.map((s) => s.duration), [2, 2, 2]);
  const sc = scriptFor(FORMATS[0], brief);
  assert.match(sc, /Meet Orbit/);
  assert.match(sc, /30% off launch week/i);
  assert.match(sc, /orbit\.watch/);
  assert.equal(sanitizeScene({ template: "fullbleed", duration: 2, image: stockRef(3) }).image, "asset:stock_3");
  assert.ok(isStockRef("asset:stock_3") && !isStockRef("asset:up_1"));
});

import { emSpoken, paced, recommend } from "./formats";

test("formats: the stressed word is the highlighted one; pace sets the cutting; audio picks formats", () => {
  assert.equal(emSpoken("Ten days on one charge.", ["charge"]), "Ten days on one *charge*.");
  assert.equal(emSpoken("Ten days on one charge.", ["ten"]), "*Ten* days on one charge.");
  assert.equal(emSpoken("Ten days on one charge.", []), "Ten days on one *charge*.");
  const sc = [{ template: "title-reveal", duration: 2, transition: "cut" }, { template: "title-reveal", duration: 2, transition: "fade" }, { template: "kinetic-words", duration: 2, transition: "whip" }, { template: "cta-end", duration: 2, transition: "zoom" }] as any[];
  const fast = paced(sc, { pace: "fast", mood: "energetic" });
  assert.deepEqual(fast.map((s) => s.transition), ["cut", "whip", "whip", "zoom"]);
  assert.equal(fast[1].motion, "snappy");
  const slow = paced(sc, { pace: "slow", mood: "dramatic" });
  assert.deepEqual(slow.map((s) => s.transition), ["cut", "fade", "fade", "zoom"]);
  assert.equal(slow[2].motion, "dramatic");
  const r = recommend({ mood: "dramatic", pace: "slow", text: "some things change everything" });
  assert.ok(r[0] && ["launch-trailer", "cinematic-montage", "manifesto", "problem-solution"].includes(r[0].id), JSON.stringify(r));
  assert.ok(recommend(undefined, { mood: "upbeat" }).some((x) => x.id === "beat-montage"));
  assert.ok(recommend({ mood: "warm", pace: "measured", cta: "Get 30% off today" }).some((x) => x.id === "flash-sale"));
  for (const x of [...r, ...recommend(undefined, { mood: "chill" })]) assert.ok(FORMATS.some((f) => f.id === x.id), x.id);
});

test("formats: with a voice's insight, headlines highlight the stressed words", () => {
  const v = { ...VO, insight: { pace: "fast", mood: "energetic", stressedWords: ["second", "charge"] } as any };
  const { scenes } = buildWithVoice(FORMATS.find((f) => f.id === "three-reasons")!, brief, v, []);
  assert.ok(scenes.some((s) => s.headline?.includes("*second*") || s.headline?.includes("*charge*")), scenes.map((s) => s.headline).join(" | "));
});
