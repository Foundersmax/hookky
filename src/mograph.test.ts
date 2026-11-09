import { test } from "node:test";
import assert from "node:assert/strict";
import { planMotion, numbersIn, listIn, stepsIn, ideasIn, motionScenes, MOTION_STYLES } from "./mograph/plan";
import { sanitizeScene } from "./sanitize";
import { lintStoryboard } from "./agent/lint";

function voice(lines: string[]) {
  const words: { w: string; s: number; e: number }[] = [], pauses: { s: number; e: number }[] = [];
  let t = 0.3;
  lines.forEach((l, i) => {
    for (const w of l.split(" ")) words.push({ w, s: +t.toFixed(2), e: +(t + 0.3).toFixed(2) }), (t += 0.34);
    if (i < lines.length - 1) pauses.push({ s: +t.toFixed(2), e: +(t + 0.55).toFixed(2) }), (t += 0.55);
  });
  return { duration: +(t + 0.3).toFixed(2), pauses, words };
}
const brief = { product: "Orbit", what: "a smartwatch that coaches your sleep", audience: "runners", benefits: ["Ten-day battery", "Sleep coaching"], cta: "Pre-order", url: "orbit.watch" };

test("mograph: reading lines — numbers, lists, steps, ideas", () => {
  assert.deepEqual(numbersIn("87% of runners sleep better").map((n) => [n.value, n.suffix]), [[87, "%"]]);
  assert.deepEqual(numbersIn("ten days on one charge").map((n) => n.value), [10, 1]);
  assert.deepEqual(listIn("It's fast, simple and secure."), ["Fast", "Simple", "Secure"]);
  assert.equal(listIn("The watch that knows you when you sleep at night"), null);
  assert.deepEqual(stepsIn("First you wear it, then you sleep, finally you wake up rested."), ["You wear it", "You sleep", "You wake up rested"]);
  assert.ok(ideasIn("Your coffee goes cold every morning").includes("coffee"));
});

test("mograph: a voice-over becomes a varied motion script, cut in its pauses", () => {
  const v = voice([
    "Your mornings feel slow and heavy.",
    "Meet Orbit, the watch that coaches your sleep.",
    "It's quiet, light and smart.",
    "First you wear it, then you sleep, finally you wake up rested.",
    "Eighty seven percent of runners sleep better in two weeks.",
    "Ten days on one charge, while others need two.",
    "Pre-order Orbit today.",
  ]);
  const beats = planMotion(v, brief);
  const t = beats.map((b) => b.template);
  assert.equal(t[0], "icon-hero");
  assert.ok(t.includes("icon-orbit"), t.join());
  assert.ok(t.includes("icon-list"), t.join());
  assert.ok(t.includes("process-flow"), t.join());
  assert.ok(t.includes("metric-ring") || t.includes("bar-compare"), t.join());
  assert.equal(t.at(-1), "cta-end");
  for (let i = 0; i < beats.length - 1; i++) assert.ok(v.pauses.some((p) => beats[i].e >= p.s - 0.02 && beats[i].e <= p.e + 0.02), `cut ${beats[i].e} in a pause`);
  for (const b of beats.filter((x) => x.template !== "cta-end")) assert.ok(b.ideas.length || b.template === "bar-compare", `${b.template} has icon ideas`);
  const metric = beats.find((b) => b.template === "metric-ring");
  if (metric) assert.ok(metric.stat!.value > 0);
});

test("mograph: scenes come out clean, as long as the voice-over, and pass the notes", () => {
  const v = voice(["Your mornings feel slow.", "Meet Orbit, the watch that coaches your sleep.", "It's quiet, light and smart.", "Pre-order Orbit today."]);
  const beats = planMotion(v, brief);
  const icons = beats.map((b) => b.ideas.map((_, k) => (k % 2 ? "lucide:moon" : "lucide:watch")));
  for (const st of MOTION_STYLES) {
    const scenes = motionScenes(beats, icons, st, brief).map((s) => sanitizeScene(s));
    assert.ok(Math.abs(scenes.reduce((a, s) => a + s.duration, 0) - v.duration) < 0.03);
    assert.ok(scenes.filter((s) => s.template !== "cta-end").every((s) => s.background === st.background && s.motion === st.motion));
    assert.ok(scenes.some((s) => s.icons?.length));
    const notes = lintStoryboard({ scenes, brand: { bg: "#000", fg: "#fff", accent: "#C8FF3D", name: "Orbit" }, audio: { duration: v.duration, pauses: v.pauses, hasWords: true } });
    assert.deepEqual(notes.filter((n) => n.level === "warn").map((n) => n.message), [], st.id);
  }
});

test("motion plan: charts and maps come from what's said", async () => {
  const { planMotion, labelAfter } = await import("./mograph/plan");
  const { placesIn } = await import("./mograph/places");
  const lines = ["Revenue grew from 12k to 48k in six months.", "Now shipping to London, Lagos and New York.", "Hot meals delivered to your door in 18 minutes.", "64% shop on mobile and 28% on desktop.", "120k users, 40 countries and a 4.9 rating.", "We had 1,200 customers in 2023 and 9,800 in 2025.", "Sleep better, run further.", "Orbit. Pre-order today."];
  const words: { w: string; s: number; e: number }[] = [], pauses: { s: number; e: number }[] = [];
  let t = 0.3;
  lines.forEach((l) => {
    for (const w of l.split(" ")) words.push({ w, s: t, e: t + 0.3 }), (t += 0.36);
    pauses.push({ s: t, e: t + 0.6 });
    t += 0.6;
  });
  const beats = planMotion({ duration: t, pauses, words }, { product: "Orbit" });
  assert.deepEqual(beats.slice(0, 6).map((b) => b.template), ["line-chart", "world-map", "route-map", "donut-chart", "kpi-grid", "column-chart"]);
  assert.equal(beats[0].items![5], "Now | 48k");
  assert.deepEqual(beats[1].items, ["London", "Lagos", "New York"]);
  assert.equal(beats[2].stat?.value, 18);
  assert.deepEqual(beats[4].items, ["Users | 120k", "Countries | 40", "Rating | 4.9"]);
  assert.deepEqual(beats[5].items, ["2023 | 1200", "2025 | 9800"]);
  assert.equal(labelAfter("64% shop on mobile", 0), "Shop mobile");
  assert.deepEqual(placesIn("We cooked a turkey for us"), []);
});

test("world mask: land where land is", async () => {
  const { landAt, placeAt } = await import("./mograph/places");
  const { WORLD } = await import("./mograph/world");
  const cell = (lon: number, lat: number) => landAt(Math.floor((lon + 180) / WORLD.step), Math.floor((WORLD.lat0 - lat) / WORLD.step));
  for (const p of ["lagos", "paris", "brazil", "japan", "australia", "kenya"]) assert.ok(cell(...placeAt(p)!), p);
  for (const [lon, lat] of [[-30, 30], [-150, 10], [80, -20], [-150, 71]]) assert.ok(!cell(lon, lat), `${lon},${lat} is sea`);
});

test("motion plan: dashboards where the line calls for them, and where a dashboard style names the product", async () => {
  const { planMotion, MOTION_STYLES } = await import("./mograph/plan");
  const lines = ["Running a store is chaos.", "See every sale in one dashboard.", "Track orders in real time.", "Meet Orbit, your command centre.", "Orbit. Start free."];
  const words: { w: string; s: number; e: number }[] = [], pauses: { s: number; e: number }[] = [];
  let t = 0.3;
  lines.forEach((l) => {
    for (const w of l.split(" ")) words.push({ w, s: t, e: t + 0.3 }), (t += 0.36);
    pauses.push({ s: t, e: t + 0.6 });
    t += 0.6;
  });
  const brief = { product: "Orbit", benefits: ["Live revenue tracking", "Smart inventory alerts", "One-click reports"] };
  const beats = planMotion({ duration: t, pauses, words }, brief, { prefer: "dashboard" });
  assert.deepEqual(beats.map((b) => b.template), ["icon-hero", "dashboard-focus", "live-metrics", "dashboard", "cta-end"]);
  assert.ok(beats[3].items!.every((x) => !x.includes("|")), "no invented KPI values");
  assert.equal(planMotion({ duration: t, pauses, words }, brief)[3].template, "icon-orbit");
  assert.ok(MOTION_STYLES.length >= 15 && MOTION_STYLES.filter((s) => s.prefer).length >= 3);
});

test("motion scenes: icons stay paired with their items when one isn't found", async () => {
  const { motionScenes, MOTION_STYLES } = await import("./mograph/plan");
  const beat = { s: 0, e: 3, line: "Fast, quirky and secure", template: "icon-list" as const, items: ["Fast", "Quirky", "Secure"], ideas: ["fast", "quirky", "secure"] };
  const [sc] = motionScenes([beat, { ...beat, s: 3, e: 5, template: "cta-end" as const }], [["lucide:zap", null, "lucide:shield-check"], []], MOTION_STYLES[0], { product: "Orbit" });
  assert.deepEqual(sc.icons, ["lucide:zap", "lucide:check-circle", "lucide:shield-check"]);
  const [hero] = motionScenes([{ ...beat, template: "icon-hero" as const }, { ...beat, template: "cta-end" as const }], [[null], []], MOTION_STYLES[0], {});
  assert.deepEqual(hero.icons, ["lucide:sparkles"], "a hero is never empty");
});
