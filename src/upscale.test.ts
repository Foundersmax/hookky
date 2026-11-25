// Upscale targets: the short edge becomes 1080 / 2160 / 4320, the shape is kept, sizes are even.
import test from "node:test";
import assert from "node:assert/strict";
import { targetSize, upscaleBitrate, TARGETS } from "./upscale/size";

test("upscale: target sizes keep the shape and land on even numbers", () => {
  assert.deepEqual(targetSize({ w: 640, h: 360 }, "1080p"), [1920, 1080]);
  assert.deepEqual(targetSize({ w: 640, h: 360 }, "4k"), [3840, 2160]);
  assert.deepEqual(targetSize({ w: 640, h: 360 }, "8k"), [7680, 4320]);
  assert.deepEqual(targetSize({ w: 360, h: 640 }, "4k"), [2160, 3840], "vertical video stays vertical");
  assert.deepEqual(targetSize({ w: 320, h: 240 }, "1080p"), [1440, 1080], "4:3 stays 4:3");
  assert.deepEqual(targetSize({ w: 480, h: 480 }, "1080p"), [1080, 1080]);
  for (const t of TARGETS) for (const [w, h] of [[853, 480], [427, 240], [1279, 719]]) {
    const [W, H] = targetSize({ w, h }, t.id);
    assert.ok(W % 2 === 0 && H % 2 === 0, `${t.id} ${w}x${h} → ${W}x${H}`);
    assert.ok(Math.abs(W / H - w / h) < 0.01, "shape kept");
    assert.ok(Math.abs(Math.min(W, H) - t.short) <= 2);
  }
});

test("upscale: bitrate grows with size and frame rate", () => {
  const a = upscaleBitrate(1920, 1080, 30), b = upscaleBitrate(3840, 2160, 30), c = upscaleBitrate(7680, 4320, 30);
  assert.ok(a < b && b < c);
  assert.ok(upscaleBitrate(1920, 1080, 60) > a);
});

import { frameRange, timeLeft, formatDuration, PRESETS, presetOf, DEFAULT_LOOK, outputBytes, MEMORY_LIMIT } from "./upscale/size";

test("upscale: 1440p sits between 1080p and 4K", () => {
  assert.deepEqual(targetSize({ w: 1280, h: 720 }, "1440p"), [2560, 1440]);
  assert.deepEqual(TARGETS.map((t) => t.id), ["1080p", "1440p", "4k", "8k"]);
  assert.ok(upscaleBitrate(1920, 1080, 30) < upscaleBitrate(2560, 1440, 30) && upscaleBitrate(2560, 1440, 30) < upscaleBitrate(3840, 2160, 30));
});

test("upscale: a part of the video is whole frames, never empty, never past the end", () => {
  assert.deepEqual(frameRange(10, 30), { first: 0, count: 300, start: 0, end: 10 });
  const p = frameRange(10, 30, 2.5, 4);
  assert.deepEqual([p.first, p.count], [75, 45]);
  assert.ok(Math.abs(p.start - 2.5) < 1e-9 && Math.abs(p.end - 4) < 1e-9);
  assert.equal(frameRange(10, 30, 9.99, 50).count, 1, "a sliver at the end is one frame");
  assert.equal(frameRange(10, 30, 7, 3).count, 1, "an end before the start is one frame");
  assert.equal(frameRange(0.01, 30).count, 1, "a tiny clip is one frame");
  const q = frameRange(10, 30, -5, 100);
  assert.deepEqual([q.first, q.count], [0, 300]);
  assert.equal(frameRange(5, 29.97, 1, 2).count, 30);
});

test("upscale: time left, in words", () => {
  assert.equal(timeLeft(0.01, 10_000), undefined, "too early to tell");
  assert.equal(timeLeft(0.5, 2000), undefined);
  assert.equal(timeLeft(0.25, 60_000), 180);
  assert.equal(timeLeft(1, 60_000), undefined);
  assert.equal(formatDuration(20), "under a minute");
  assert.equal(formatDuration(70), "about a minute");
  assert.equal(formatDuration(600), "about 10 minutes");
  assert.equal(formatDuration(5400), "about 1 h 30 min");
  assert.equal(formatDuration(7200), "about 2 h");
});

test("upscale: looks are ready-made settings, and the recommended one is the default", () => {
  assert.equal(presetOf(DEFAULT_LOOK), "natural");
  for (const p of PRESETS) {
    assert.equal(presetOf({ ...p.look }), p.id);
    for (const v of Object.values(p.look)) assert.ok(v >= 0 && v <= 1);
  }
  assert.equal(presetOf({ clean: 0.3, sharp: 0.3, rich: 0.3, grain: 0.3 }), undefined);
  assert.ok(PRESETS.find((p) => p.id === "screen")!.look.grain === 0, "no grain on screen recordings");
});

test("upscale: a long 4K job needs saving to disk; a short one fits in memory", () => {
  assert.ok(outputBytes(3840, 2160, 30, 60) < MEMORY_LIMIT);
  assert.ok(outputBytes(3840, 2160, 30, 600) > MEMORY_LIMIT);
  assert.ok(outputBytes(7680, 4320, 30, 120) < MEMORY_LIMIT && outputBytes(7680, 4320, 30, 240) > MEMORY_LIMIT, "8K: two minutes fit, four don't");
});
