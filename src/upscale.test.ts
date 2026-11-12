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
