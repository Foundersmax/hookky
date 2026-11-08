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
