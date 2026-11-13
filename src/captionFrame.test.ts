import { test } from "node:test";
import assert from "node:assert/strict";
import { outputSize, place, panFocus, keptShare, frameSuffix, FRAMES, DEFAULT_FRAMING } from "./captionFrame";

const near = (a: number, b: number, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("output sizes: each shape at each quality, never past what browsers encode", () => {
  assert.deepEqual(outputSize(1920, 1080, "original", "source"), { w: 1920, h: 1080 });
  assert.deepEqual(outputSize(1920, 1080, "9:16", "source"), { w: 1080, h: 1920 }, "phone, at the source's sharpness");
  assert.deepEqual(outputSize(1920, 1080, "4:5", "source"), { w: 1080, h: 1350 });
  assert.deepEqual(outputSize(1920, 1080, "1:1", "720"), { w: 720, h: 720 });
  assert.deepEqual(outputSize(1280, 720, "9:16", "source"), { w: 720, h: 1280 }, "a 720p source stays 720p unless asked");
  assert.deepEqual(outputSize(1280, 720, "9:16", "1080"), { w: 1080, h: 1920 });
  assert.deepEqual(outputSize(1920, 1080, "16:9", "2160"), { w: 3840, h: 2160 });
  assert.deepEqual(outputSize(1920, 1080, "9:16", "2160"), { w: 2160, h: 3840 });
  const wide = outputSize(1920, 1080, "21:9", "2160");
  assert.equal(wide.w, 4096, "capped at 4096 wide");
  assert.equal(wide.h % 2, 0);
  assert.deepEqual(outputSize(1080, 1920, "original", "720"), { w: 720, h: 1280 }, "original shape, smaller");
  assert.deepEqual(outputSize(1081, 721, "original", "source"), { w: 1082, h: 722 }, "even sizes for the encoder");
  for (const f of FRAMES) for (const q of ["source", "720", "1080", "2160"] as const) {
    const o = outputSize(3840, 2160, f.id, q);
    assert.ok(o.w <= 4096 && o.h <= 4096 && o.w % 2 === 0 && o.h % 2 === 0, `${f.id} ${q}: ${o.w}×${o.h}`);
  }
});

test("fill: a centred crop of the frame's shape; focus and zoom move it", () => {
  const p = place(1920, 1080, 1080, 1920, DEFAULT_FRAMING);
  near(p.sh, 1080);
  near(p.sw, 607.5);
  near(p.sx, (1920 - 607.5) / 2);
  assert.deepEqual([p.dx, p.dy, p.dw, p.dh], [0, 0, 1080, 1920]);
  near(place(1920, 1080, 1080, 1920, { ...DEFAULT_FRAMING, focusX: 0 }).sx, 0);
  near(place(1920, 1080, 1080, 1920, { ...DEFAULT_FRAMING, focusX: 1 }).sx, 1920 - 607.5);
  const z = place(1920, 1080, 1080, 1920, { ...DEFAULT_FRAMING, zoom: 2 });
  near(z.sw, 303.75);
  near(z.sh, 540);
  near(z.sy, 270, 0.01);
  assert.equal(place(1920, 1080, 1080, 1920, { ...DEFAULT_FRAMING, zoom: 99 }).sw, 1080 / ((1920 / 1080) * 4), "zoom capped at 4×");
});

test("fit: the whole video, centred, with a cover-cropped copy behind it for the blur", () => {
  const p = place(1920, 1080, 1080, 1920, { ...DEFAULT_FRAMING, fit: "fit" });
  assert.deepEqual([p.sx, p.sy, p.sw, p.sh], [0, 0, 1920, 1080]);
  near(p.dw, 1080);
  near(p.dh, 607.5);
  near(p.dy, (1920 - 607.5) / 2);
  assert.ok(p.bg);
  near(p.bg!.sw / p.bg!.sh, 1080 / 1920);
  assert.equal(place(1920, 1080, 1080, 1920, { ...DEFAULT_FRAMING, fit: "fit", backdrop: "black" }).bg, undefined);
});

test("dragging the video moves the crop the same way, and stops at the edges", () => {
  const f = DEFAULT_FRAMING;
  const right = panFocus(1920, 1080, 1080, 1920, f, 100, 0);
  assert.ok(right.focusX < 0.5, "dragging right shows more of the left");
  assert.equal(right.focusY, 0.5, "no vertical room in a 16:9 → 9:16 crop");
  assert.equal(panFocus(1920, 1080, 1080, 1920, f, -1e6, 0).focusX, 1);
  assert.equal(panFocus(1920, 1080, 1080, 1920, f, 1e6, 0).focusX, 0);
  const zoomed = panFocus(1920, 1080, 1080, 1920, { ...f, zoom: 2 }, 0, -50);
  assert.ok(zoomed.focusY > 0.5, "zoomed in there's room to move up and down");
});

test("how much a crop keeps, and file name suffixes", () => {
  near(keptShare(1920, 1080, 1080, 1920, DEFAULT_FRAMING), 0.3164, 0.001);
  assert.equal(keptShare(1920, 1080, 1080, 1920, { ...DEFAULT_FRAMING, fit: "fit" }), 1);
  near(keptShare(1920, 1080, 1920, 1080, DEFAULT_FRAMING), 1);
  assert.equal(frameSuffix("9:16"), "-9x16");
  assert.equal(frameSuffix("original"), "");
});
