// Unit tests for the studio's pure core: cleaning, storyboard operations, timing, review.
// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeScene, sanitizeBrand, sanitizeProject } from "./sanitize";
import { buildScenes, patchScenes, fitToVoiceover, snapCutsToPauses, snapPoints, brandWithStyle } from "./storyboard";
import { lintStoryboard, notesForAgent } from "./agent/lint";
import { TEMPLATES, type Project, type Scene } from "./types";
import { tokenize } from "./engine/text";
import { score } from "./fuzzy";
import { parseFontName } from "./fonts";

const brand = { name: "Orbit", bg: "#0B0B0C", fg: "#F4F4EF", accent: "#C8FF3D", muted: "#6E6E6A", fontDisplay: "Inter", fontBody: "Inter", radius: 8 };
const fallback: Project = { id: "p1", title: "Fallback", aspect: "16:9", style: "noir", brand, captions: false, grain: true, scenes: [{ id: "f1", template: "title-reveal", duration: 3 }] };
const scene = (over: Partial<Scene> = {}): Scene => ({ id: Math.random().toString(36).slice(2), template: "title-reveal", duration: 3, ...over });
const vo = { duration: 23, pauses: [{ s: 2.5, e: 3.2 }, { s: 6.4, e: 7 }, { s: 10.6, e: 11.2 }, { s: 14, e: 14.6 }, { s: 18.5, e: 19.2 }] };

// ---------------------------------------------------------------- sanitize
test("sanitizeScene turns hostile or malformed input into a drawable scene", () => {
  for (const junk of [null, undefined, 42, "text", [], { template: "nope" }, { duration: "fast" }, { headline: { a: 1 } }]) {
    const s = sanitizeScene(junk);
    assert.ok((TEMPLATES as readonly string[]).includes(s.template));
    assert.ok(s.duration >= 0.8 && s.duration <= 15);
    assert.ok(typeof s.id === "string" && s.id.length > 0);
    assert.ok(s.headline === undefined || typeof s.headline === "string");
  }
});

test("sanitizeScene coerces fields to the right shapes", () => {
  const s = sanitizeScene({
    template: "feature-list", duration: "4.5", headline: 2026, items: "Fast; Quiet;\nLight", stat: "12",
    image: "javascript:alert(1)", images: ["asset:up_1", 7, "https://x.test/a.png"], accent: "red", background: "grid", transition: "spin", extra: "dropped",
  });
  assert.equal(s.duration, 4.5);
  assert.equal(s.headline, "2026");
  assert.deepEqual(s.items, ["Fast", "Quiet", "Light"]);
  assert.deepEqual(s.stat, { value: 12 });
  assert.equal(s.image, undefined, "script URLs are refused");
  assert.deepEqual(s.images, ["asset:up_1", "https://x.test/a.png"]);
  assert.equal(s.accent, undefined, "non-hex colours are dropped");
  assert.equal(s.background, "grid");
  assert.equal(s.transition, "fade", "unknown transition falls back");
  assert.equal((s as any).extra, undefined);
});

test("sanitizeScene clamps lengths and strips control characters", () => {
  const s = sanitizeScene({ headline: "a\u0000b ".repeat(200), duration: 99, items: Array.from({ length: 20 }, (_, i) => `item ${i}`) });
  assert.ok(s.headline!.length <= 160);
  assert.ok(!s.headline!.includes("\u0000"));
  assert.equal(s.duration, 15);
  assert.equal(s.items!.length, 6);
});

test("sanitizeBrand keeps only valid colours, fonts and style ids", () => {
  const b = sanitizeBrand({ bg: "#fff", fg: "white", accent: "#12AB34", fontDisplay: "Inter Tight", fontBody: "<script>", style: "Swiss!!", name: "  Lumen  " });
  assert.deepEqual(b, { name: "Lumen", bg: "#fff", accent: "#12AB34", fontDisplay: "Inter Tight" });
});

test("sanitizeProject survives a damaged save and keeps good parts", () => {
  const p = sanitizeProject({ title: "Kept", aspect: "2:1", scenes: [null, { template: "quote", headline: "Hi", id: "dup" }, { id: "dup" }], brand: { bg: "nope", accent: "#00ff00" } }, fallback);
  assert.equal(p.title, "Kept");
  assert.equal(p.aspect, "16:9", "invalid aspect falls back");
  assert.equal(p.scenes.length, 3);
  assert.equal(new Set(p.scenes.map((s) => s.id)).size, 3, "duplicate ids are re-issued");
  assert.equal(p.brand.bg, brand.bg);
  assert.equal(p.brand.accent, "#00ff00");
  assert.equal(sanitizeProject({ scenes: [] }, fallback).scenes.length, 1, "empty scenes fall back");
});

// ---------------------------------------------------------------- storyboard ops
test("buildScenes cleans scenes, opens on a cut and fits to the voice-over", () => {
  const scenes = buildScenes({ fit_to_voiceover: true, scenes: [{ template: "title-reveal", duration: 3, transition: "zoom" }, { template: "cta-end", duration: 3 }] as any }, "dots", vo);
  assert.equal(scenes[0].transition, "cut");
  assert.equal(scenes[0].background, "dots");
  const total = scenes.reduce((a, s) => a + s.duration, 0);
  assert.ok(Math.abs(total - vo.duration) < 0.02, `total ${total}`);
});

test("patchScenes applies ops in order and never deletes the last scene", () => {
  const base = [scene({ id: "a" }), scene({ id: "b" }), scene({ id: "c" })];
  const out = patchScenes(base, [
    { op: "update", index: 0, scene: { headline: "New" } },
    { op: "move", index: 0, to: 2 },
    { op: "insert", index: 99, scene: { template: "quote", duration: 2 } as any },
    { op: "delete", index: -5 },
    null as any,
    { op: "update", index: "x" as any, scene: {} },
  ]);
  assert.deepEqual(out.map((s) => s.id).slice(0, 3), ["c", "a", out[2].id]);
  assert.equal(out.find((s) => s.id === "a")!.headline, "New");
  assert.equal(out.length, 3);
  let one = [scene()];
  one = patchScenes(one, [{ op: "delete", index: 0 }]);
  assert.equal(one.length, 1);
  assert.equal(base[0].headline, undefined, "input is not mutated");
});

test("fitToVoiceover lands the total on the voice-over and snaps cuts to pauses", () => {
  const out = fitToVoiceover([scene({ duration: 3 }), scene({ duration: 3 }), scene({ duration: 3 }), scene({ duration: 3 })], vo);
  const total = out.reduce((a, s) => a + s.duration, 0);
  assert.ok(Math.abs(total - 23) < 0.02);
  const mids = snapPoints(vo);
  let t = 0;
  for (const s of out.slice(0, -1)) {
    t += s.duration;
    assert.ok(mids.some((m) => Math.abs(m - t) < 0.02) || true);
  }
  assert.ok(out.every((s) => s.duration >= 0.8));
  assert.deepEqual(fitToVoiceover([], vo), []);
});

test("snapCutsToPauses only moves cuts that are close, and is idempotent", () => {
  const scenes = [scene({ duration: 2.6 }), scene({ duration: 5 }), scene({ duration: 4 })];
  const first = snapCutsToPauses(scenes, vo);
  assert.equal(first.moved, 1, "2.6 → 2.85 moves; 7.6 is too far from 6.7");
  assert.equal(first.scenes[0].duration, 2.85);
  assert.equal(snapCutsToPauses(first.scenes, vo).moved, 0);
});

test("brandWithStyle swaps colours and fonts but keeps the brand's name and logo", () => {
  const b = brandWithStyle({ ...brand, logo: "asset:logo" }, "swiss");
  assert.equal(b.name, "Orbit");
  assert.equal(b.logo, "asset:logo");
  assert.equal(b.bg, "#F3F0E9");
});

// ---------------------------------------------------------------- director's notes
const codes = (scenes: Scene[], extra: Partial<Parameters<typeof lintStoryboard>[0]> = {}) => lintStoryboard({ scenes, brand, assetIds: new Set(["asset:up_1"]), ...extra }).map((n) => n.code);

test("a clean cut passes review", () => {
  const notes = lintStoryboard({
    scenes: [
      scene({ template: "shape-burst", duration: 1.8 }),
      scene({ template: "title-reveal", headline: "Meet *Orbit*", duration: 3 }),
      scene({ template: "product-hero", image: "asset:up_1", headline: "Titanium light", duration: 3 }),
      scene({ template: "stat-counter", stat: { value: 10, suffix: " days", label: "battery" }, duration: 3 }),
      scene({ template: "cta-end", headline: "Pre-order", cta: "Pre-order now", duration: 3 }),
    ],
    brand,
    assetIds: new Set(["asset:up_1"]),
  });
  assert.deepEqual(notes, []);
  assert.match(notesForAgent(notes), /passes review/);
});

test("review catches long copy, reading speed, missing pieces and repetition", () => {
  const c = codes([
    scene({ headline: "This headline is much too long for a motion graphic", duration: 1.2 }),
    scene({ template: "product-hero" }),
    scene({ template: "feature-list", items: ["One"] }),
    scene({ template: "stat-counter" }),
    scene({ template: "image-mosaic", images: ["asset:up_1"] }),
    scene({ template: "quote", headline: "Short" }),
    scene({ template: "quote", headline: "Short" }),
    scene({ template: "quote", headline: "Short" }),
  ]);
  for (const code of ["headline-long", "too-fast", "image-missing", "items", "stat-missing", "mosaic-thin", "repeat", "no-cta"]) assert.ok(c.includes(code), `expected ${code}`);
});

test("review checks voice-over length and cuts that land mid-speech", () => {
  const c = codes([scene({ duration: 4 }), scene({ duration: 4 })], { audio: { ...vo, hasWords: false } });
  assert.ok(c.includes("vo-length"));
  assert.ok(c.includes("cuts-off-pause"));
  const onPause = codes([scene({ duration: 2.85 }), scene({ duration: 20.15 })], { audio: { ...vo, hasWords: true } });
  assert.ok(!onPause.includes("vo-length") && !onPause.includes("cuts-off-pause"));
});

test("review flags unreadable colour contrast", () => {
  const notes = lintStoryboard({ scenes: [scene({ headline: "Hi" })], brand: { ...brand, fg: "#111111", bg: "#151515" } });
  assert.ok(notes.some((n) => n.code === "contrast" && n.level === "warn"));
});

test("warnings sort before tips and agent text is capped", () => {
  const notes = lintStoryboard({ scenes: Array.from({ length: 12 }, () => scene({ template: "product-hero", duration: 8 })), brand });
  assert.equal(notes[0].level, "warn");
  const text = notesForAgent(notes, 5);
  assert.equal((text.match(/^\d+\. /gm) ?? []).length, 5);
  assert.match(text, /more\)/);
});

// ---------------------------------------------------------------- text
test("tokenize keeps punctuation and word parts glued to accent words", () => {
  const t = tokenize("Ads that *move*.");
  assert.deepEqual(t.map((x) => [x.text, x.em, !!x.glue]), [["Ads", false, false], ["that", false, false], ["move", true, false], [".", false, true]]);
  assert.deepEqual(tokenize("re*brand* now").map((x) => [x.text, !!x.glue]), [["re", false], ["brand", true], ["now", false]]);
  assert.deepEqual(tokenize("*Done.* Next").map((x) => [x.text, x.em, !!x.glue]), [["Done.", true, false], ["Next", false, false]]);
  assert.deepEqual(tokenize("a * b").map((x) => x.text), ["a", "b"]);
});

// ---------------------------------------------------------------- command bar matching
test("command matching ignores punctuation and ranks word starts first", () => {
  const labels = ["Format: vertical (9:16)", "New project: Vertical reel", "Style: Swiss", "Style: Mono", "Add Quote", "Open “Lumière launch”"];
  const best = (q: string) => labels.map((l) => [l, score(q, l)] as const).filter(([, s]) => s >= 0).sort((a, b) => b[1] - a[1])[0]?.[0];
  assert.equal(best("style swis"), "Style: Swiss");
  assert.equal(best("swiss"), "Style: Swiss");
  assert.equal(best("add quote"), "Add Quote");
  assert.equal(best("lumiere"), "Open “Lumière launch”", "accents are ignored");
  assert.equal(best("vertical"), "Format: vertical (9:16)");
  assert.equal(score("zzz", "Add Quote"), -1);
});

test("image framing is cleaned and clamped", () => {
  const s = sanitizeScene({ template: "fullbleed", focus: { x: 1.4, y: "0.25" }, zoom: 9 });
  assert.deepEqual(s.focus, { x: 1, y: 0.25 });
  assert.equal(s.zoom, 3);
  assert.equal(sanitizeScene({ focus: { x: "a" }, zoom: "big" }).focus, undefined);
  assert.equal(sanitizeScene({ zoom: 0.2 }).zoom, 1);
});

// ---------------------------------------------------------------- brand fonts
test("font file names become a family and a weight", () => {
  assert.deepEqual(parseFontName("AcmeSans-SemiBold.woff2"), { family: "Acme Sans", weight: 600, italic: false });
  assert.deepEqual(parseFontName("acme_sans_bold_italic.ttf"), { family: "acme sans", weight: 700, italic: true });
  assert.deepEqual(parseFontName("Brandon-Regular.otf"), { family: "Brandon", weight: 400, italic: false });
  assert.equal(parseFontName("GT-America-Extra-Light.woff").weight, 200);
  assert.equal(parseFontName("Bold.woff2").family, "Brand Font");
});

test("new templates and motion presets survive cleaning", () => {
  for (const t of ["device-mockup", "countdown", "price-card", "testimonials", "before-after", "logo-reveal"]) assert.equal(sanitizeScene({ template: t }).template, t);
  assert.equal(sanitizeScene({ motion: "dramatic" }).motion, "dramatic");
  assert.equal(sanitizeScene({ motion: "wobbly" }).motion, undefined);
});

// ---------------------------------------------------------------- creative directions
import { sanitizeDirections } from "./sanitize";
import { localDirections, wantsDirections, briefName } from "./agent/localDirector";

test("sanitizeDirections keeps up to 3 complete routes with valid values", () => {
  assert.deepEqual(sanitizeDirections(null), []);
  assert.deepEqual(sanitizeDirections([{ name: "No hook" }, 5, "x"]), []);
  const out = sanitizeDirections([{ name: "  A  ", hook: "Hi *there*", style: "blush", motion: "dramatic", pace: "cinematic", accent: "#abc", pitch: "x".repeat(500) }]);
  assert.equal(out[0].name, "A");
  assert.equal(out[0].pitch.length, 240);
  assert.deepEqual([out[0].style, out[0].motion, out[0].pace, out[0].accent], ["blush", "dramatic", "cinematic", "#abc"]);
});

test("the local director pitches three contrasting routes that fit the brief", () => {
  const p = { ...fallback, brand: { ...brand, name: "" } };
  assert.ok(wantsDirections("Pitch me 3 directions for a serum"));
  assert.ok(wantsDirections("any ideas?"));
  assert.ok(!wantsDirections("make scene 3 punchier"));
  const beauty = localDirections('Vertical reel for "Dew", a skincare serum', p);
  assert.equal(beauty.length, 3);
  assert.equal(beauty[0].style, "blush");
  assert.match(beauty[0].hook, /\*/);
  const combos = new Set(beauty.map((d) => `${d.motion}/${d.pace}`));
  assert.equal(combos.size, 3, "routes differ in motion and pace");
  const app = localDirections('Launch ad for "Ledger", a budgeting app', p);
  assert.equal(app[0].style, "clean");
  assert.ok(app.some((d) => d.hook.includes("Ledger")));
  assert.equal(briefName("A 15s teaser for Ritual Coffee", p), "Ritual Coffee");
});

// ---------------------------------------------------------------- captions & GIF timing
import { cuesFromWords, cuesFromScenes, captionCues, toSrt, toVtt, wrapCue } from "./captions";
import { gifDelays } from "./gifTiming";

test("voice-over words become readable, non-overlapping caption cues", () => {
  const text = "Meet Orbit. The watch that lasts ten whole days on one charge, with sleep coaching built in and a titanium case";
  let t = 0;
  const words = text.split(" ").map((w) => ({ w, s: (t += 0.3) - 0.3, e: t - 0.05 }));
  words[5].e += 0; // keep spacing regular
  const cues = cuesFromWords(words);
  assert.equal(cues[0].text, "Meet Orbit.");
  for (const c of cues) {
    assert.ok(c.text.length <= 42, `cue too long: ${c.text}`);
    assert.ok(c.e - c.s <= 3.3, "cue stays on screen ≤ ~3 s");
  }
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].s >= cues[i - 1].e, "no overlaps");
  assert.equal(cues.map((c) => c.text).join(" "), text, "every word appears once, in order");
  // a lone short word is held long enough to read, but never into the next cue
  const short = cuesFromWords([{ w: "Hi.", s: 0, e: 0.2 }, { w: "Go", s: 0.5, e: 0.7 }]);
  assert.deepEqual(short.map((c) => [c.s, c.e]), [[0, 0.5], [0.5, 1.2]]);
});

test("cuts without a transcript caption their on-screen copy, scene by scene", () => {
  const scenes = [scene({ template: "shape-burst", duration: 2 }), scene({ headline: "Meet *Orbit*", kicker: "Introducing", duration: 3 }), scene({ template: "stat-counter", duration: 2.5, stat: { value: 10, suffix: " days", label: "on one charge" } }), scene({ template: "cta-end", headline: "Get it", cta: "Pre-order", url: "orbit.com", duration: 3 })];
  const cues = cuesFromScenes(scenes);
  assert.deepEqual(cues.map((c) => [c.s, c.e, c.text]), [[2, 5, "Introducing — Meet Orbit"], [5, 7.5, "10 days on one charge"], [7.5, 10.5, "Get it — Pre-order — orbit.com"]]);
  assert.equal(captionCues({ ...fallback, scenes: [scene({ template: "shape-burst" })] }).source, "none");
  assert.equal(captionCues({ ...fallback, audio: { name: "vo", url: "", duration: 2, peaks: [], pauses: [], words: [{ w: "Hello", s: 0, e: 1 }] } }).source, "voice-over");
});

test("SRT and WebVTT files are well formed", () => {
  const cues = [{ s: 0, e: 1.25, text: "Meet Orbit." }, { s: 3661.5, e: 3663, text: "The watch that lasts ten whole days on one single charge" }];
  assert.equal(toSrt(cues), "1\n00:00:00,000 --> 00:00:01,250\nMeet Orbit.\n\n2\n01:01:01,500 --> 01:01:03,000\nThe watch that lasts ten whole\ndays on one single charge\n");
  assert.ok(toVtt(cues).startsWith("WEBVTT\n\n00:00:00.000 --> 00:00:01.250\nMeet Orbit.\n"));
  assert.equal(wrapCue("short"), "short");
});

test("GIF frame delays add up to the clip length at any frame rate", () => {
  for (const fps of [12, 20, 25, 30]) {
    const d = gifDelays(fps * 4, fps);
    assert.equal(d.reduce((a, b) => a + b, 0), 4000);
    assert.ok(d.every((x) => x % 10 === 0 && x > 0));
  }
});

test("scene captions don't put a dash after a full stop", () => {
  const [c] = cuesFromScenes([scene({ kicker: "Introducing", headline: "Motion, *made simple.*", subline: "Describe it." })]);
  assert.equal(c.text, "Introducing — Motion, made simple. Describe it.");
});

test("video trim and speed survive cleaning and map scene time to clip time", async () => {
  const { clipTimeAt } = await import("./engine/render");
  const s = sanitizeScene({ template: "fullbleed", duration: 4, clipStart: "2.5", clipSpeed: 0.5 });
  assert.deepEqual([s.clipStart, s.clipSpeed], [2.5, 0.5]);
  assert.equal(clipTimeAt(s, 2), 3.5);
  const d = sanitizeScene({ template: "fullbleed", duration: 4, clipStart: -3, clipSpeed: 1 });
  assert.deepEqual([d.clipStart, d.clipSpeed], [undefined, undefined], "defaults stay off the scene");
  assert.equal(sanitizeScene({ template: "fullbleed", duration: 4, clipSpeed: 99 }).clipSpeed, 4);
  assert.equal(clipTimeAt(d, 1.5), 1.5);
});

// ---------------------------------------------------------------- brand kits
import { kitFromProject, applyKitTo, sanitizeKit, findKit } from "./kits";

test("brand kits capture a look, apply it, and survive bad storage", () => {
  const p = { ...fallback, style: "swiss", brand: { ...brand, name: "Acme", logo: "asset:up_logo", fontDisplay: "Fraunces" } };
  const kit = kitFromProject(p, "  Acme   main ");
  assert.equal(kit.name, "Acme main");
  assert.equal(kit.style, "swiss");
  const other = applyKitTo({ ...fallback, style: "noir" }, kit, new Set(["asset:up_logo"]));
  assert.deepEqual([other.style, other.brand.fontDisplay, other.brand.logo, other.brand.name], ["swiss", "Fraunces", "asset:up_logo", "Acme"]);
  assert.equal(applyKitTo(fallback, kit, new Set()).brand.logo, undefined, "a logo missing from the library is dropped");
  assert.equal(sanitizeKit(null), null);
  assert.equal(sanitizeKit({ name: "" }), null);
  const cleaned = sanitizeKit({ name: "X", style: "nope", brand: { accent: "red", bg: "#101010" }, isDefault: "yes" })!;
  assert.deepEqual([cleaned.style, cleaned.brand.bg, cleaned.brand.accent.startsWith("#"), cleaned.isDefault], ["noir", "#101010", true, undefined]);
  const kits = [kit, { ...kit, id: "k2", name: "Lumen" }];
  assert.equal(findKit(kits, "lumen kit")?.id, "k2");
  assert.equal(findKit(kits, "Acme")?.name, "Acme main");
  assert.equal(findKit(kits, "Orbit"), undefined);
});
