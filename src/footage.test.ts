import { test } from "node:test";
import assert from "node:assert/strict";
import { planShots, keywords, subjectOf, scoreClip, castShot, timeClip, assemble, type Shot } from "./footage/plan";
import { sanitizeScene } from "./sanitize";
import { lintStoryboard } from "./agent/lint";

function voice(lines: string[]) {
  const words: { w: string; s: number; e: number }[] = [], pauses: { s: number; e: number }[] = [];
  let t = 0.3;
  lines.forEach((l, i) => {
    for (const w of l.split(" ")) words.push({ w, s: +t.toFixed(2), e: +(t + 0.3).toFixed(2) }), (t += 0.34);
    if (i < lines.length - 1) pauses.push({ s: +t.toFixed(2), e: +(t + 0.5).toFixed(2) }), (t += 0.5);
  });
  return { duration: +(t + 0.3).toFixed(2), pauses, words };
}
const VO = voice(["Every morning starts too fast.", "Your phone buzzes, your coffee goes cold.", "Meet Orbit, the smartwatch that keeps time for you.", "Sleep better, run further, stress less.", "Orbit. Pre-order today."]);

test("footage: keywords put picturable ideas first and drop filler", () => {
  assert.deepEqual(keywords("Your coffee goes cold every morning").slice(0, 2).sort(), ["coffee", "morning"]);
  assert.ok(!keywords("we are the ones you can").length);
  assert.equal(subjectOf("Orbit, a smartwatch for runners").queries[0], "smartwatch wrist");
  assert.equal(subjectOf("handmade candles").word, "candles");
});

test("footage: one shot per line, cut in the pauses, coverage from wide to close", () => {
  const shots = planShots(VO, "Orbit smartwatch", { text: "subtitles" });
  assert.ok(shots.length >= 4 && shots.length <= 6, `${shots.length} shots`);
  assert.equal(shots[0].type, "establishing");
  assert.ok(shots.some((s) => s.type === "product"), "the line naming the product gets a product shot");
  for (const s of shots.slice(0, -1)) assert.ok(VO.pauses.some((p) => s.e >= p.s && s.e <= p.e), `cut ${s.e} in a pause`);
  assert.ok(shots.every((s) => s.queries.length >= 2), "every shot has fallbacks");
  const firsts = shots.map((s) => s.queries[0]);
  assert.equal(new Set(firsts).size, firsts.length, "no two shots search the same thing first");
  assert.ok(shots.find((s) => /coffee/.test(s.line))!.queries.some((q) => q.includes("coffee")));
});

test("footage: casting prefers the right format, long enough, on topic, and never repeats", () => {
  const shot = { s: 0, e: 3, queries: ["coffee pouring"] };
  const portrait = { id: "a", title: "coffee pouring", w: 1080, h: 1920, duration: 10, source: "pixabay" };
  const land = { id: "b", title: "coffee pouring", w: 1920, h: 1080, duration: 10, source: "pixabay" };
  const short = { id: "c", title: "coffee", w: 1080, h: 1920, duration: 1, source: "coverr" };
  assert.ok(scoreClip(portrait, shot, "9:16", 1) > scoreClip(land, shot, "9:16", 1));
  assert.ok(scoreClip(portrait, shot, "9:16", 1) > scoreClip(short, shot, "9:16", 1));
  const r = castShot([portrait, land, short], { ...shot, line: "", type: "medium", overlay: "" }, "9:16", 1, new Set(["a"]));
  assert.notEqual(r.clip?.id, "a", "an already used clip is skipped");
});

test("footage: clips are timed into their middle, short clips slow down instead of looping", () => {
  assert.deepEqual(timeClip(20, 4, 1), { clipStart: 6.4 });
  const slow = timeClip(3, 4, 1);
  assert.ok(slow.clipSpeed! >= 0.6 && slow.clipSpeed! < 1 && (slow.clipStart ?? 0) <= 0.1);
  assert.deepEqual(timeClip(undefined, 4, 0.85), { clipSpeed: 0.85 });
});

test("footage: the edit is footage scenes with one look, a title and an end card over the last shot", () => {
  const shots: Shot[] = planShots(VO, "Orbit smartwatch", { text: "subtitles" }).map((s, i) => ({ ...s, clip: `asset:v${i}`, ...timeClip(12, s.e - s.s, 0.85) }));
  const scenes = assemble(shots, { look: "cinematic", text: "subtitles", brand: "Orbit", title: "Time, rethought", cta: "Pre-order", url: "orbit.watch" }).map((s) => sanitizeScene(s));
  assert.equal(scenes[0].template, "fullbleed");
  assert.match(scenes[0].headline!, /\*/);
  assert.equal(scenes.at(-1)!.template, "cta-end");
  assert.deepEqual(scenes.at(-1)!.backdrop, [shots.at(-1)!.clip]);
  assert.ok(scenes.slice(0, -1).every((s) => s.grade === "teal-orange" && s.effects?.includes("letterbox")));
  assert.ok(scenes.every((s) => s.shot?.query), "each scene remembers its shot");
  assert.ok(Math.abs(scenes.reduce((a, s) => a + s.duration, 0) - VO.duration) < 0.02, "the edit runs as long as the voice-over");
  const notes = lintStoryboard({ scenes, brand: { bg: "#000", fg: "#fff", accent: "#C8FF3D", name: "Orbit" }, audio: { duration: VO.duration, pauses: VO.pauses, hasWords: true } });
  assert.deepEqual(notes.filter((n) => n.level === "warn").map((n) => n.message), []);
});

test("footage: a shot with no footage falls back to type, not a blank frame", () => {
  const shots = planShots(VO, "", { text: "clean" });
  const scenes = assemble(shots, { look: "documentary", text: "clean", brand: "", title: "", cta: "", url: "" });
  assert.ok(scenes.every((s) => s.template === "kinetic-words" && s.headline));
});

test("footage: what a line wants gone isn't pictured, and the brand name isn't searched", () => {
  assert.deepEqual(keywords("Sleep better, run further, stress less."), ["sleep", "run"]);
  assert.ok(!keywords("No more waiting in line").includes("waiting"));
  assert.ok(!keywords("Orbit. Pre-order today.", ["Orbit"]).length);
  const shots = planShots(VO, "Orbit smartwatch", { text: "subtitles", brand: "Orbit" });
  assert.ok(!shots.some((s) => s.queries.some((q) => /orbit|pre-order|stress/.test(q))), JSON.stringify(shots.map((s) => s.queries)));
  assert.ok(shots[0].queries[0].includes("morning") || shots[0].queries[0].includes("sunrise"), shots[0].queries[0]);
});

import { wordCuts, personaOf, cast } from "./footage/plan";

test("footage: a long line cuts to its second idea as the word is spoken", () => {
  const v = voice(["Your phone buzzes all morning and your coffee goes cold again."]);
  const parts = wordCuts({ s: 0, e: v.duration }, v.words);
  assert.equal(parts.length, 2, JSON.stringify(parts));
  const coffee = v.words.find((w) => w.w === "coffee")!;
  assert.ok(Math.abs(parts[1].s - (coffee.s - 0.12)) < 0.01, "cut lands just before 'coffee'");
  assert.equal(parts[1].key, "coffee");
  assert.ok(parts.every((p) => p.e - p.s >= 1.4));
  // a short line stays one shot
  assert.equal(wordCuts({ s: 0, e: 2 }, voice(["Coffee and phone."]).words).length, 1);
});

test("footage: the audience from the brief is cast in the people shots", () => {
  assert.equal(personaOf("Orbit, a smartwatch for runners"), "runner");
  assert.equal(personaOf("an app for busy professionals"), "young professional");
  assert.equal(personaOf("handmade candles"), undefined);
  assert.equal(cast("person sleeping bed", "runner"), "runner sleeping bed");
  assert.equal(cast("coffee pouring", "runner"), "coffee pouring");
  const shots = planShots(VO, "Orbit, a smartwatch for runners", { text: "subtitles", brand: "Orbit" });
  assert.ok(shots.some((s) => s.queries.some((q) => q.startsWith("runner"))), JSON.stringify(shots.map((s) => s.queries)));
});

test("footage: realism — graphics and AI renders sink below real footage; Freepik is preferred", () => {
  const shot = { s: 0, e: 3, queries: ["coffee pouring"] };
  const real = { id: "a", title: "Barista pouring coffee into cup", w: 1920, h: 1080, duration: 12, source: "pixabay" };
  const anim = { id: "b", title: "Coffee pouring animation loop", w: 1920, h: 1080, duration: 12, source: "pixabay" };
  const fp = { ...real, id: "c", source: "freepik" };
  assert.ok(scoreClip(real, shot, "16:9", 1) > scoreClip(anim, shot, "16:9", 1) + 3);
  assert.ok(scoreClip(fp, shot, "16:9", 1) > scoreClip(real, shot, "16:9", 1));
});

test("footage: filler verbs never become searches", () => {
  const shots = planShots(voice(["Your coffee goes cold again and again."]), "", { text: "clean" });
  assert.ok(!shots.some((s) => s.queries.some((q) => /\b(again|goes)\b/.test(q))), JSON.stringify(shots.map((s) => s.queries)));
});
