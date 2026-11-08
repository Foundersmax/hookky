// Freepik / Magnific video: mapping search hits (shapes from docs.magnific.com) and picking the file to license.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapFreepikVideos, parseDuration, sizeOf, pickOption } from "./freepikVideo";

const hit = (over: Record<string, unknown> = {}) => ({
  id: 70000,
  url: "https://www.freepik.com/free-video/cat_15667335",
  name: "Cute cat looking at the camera",
  "aspect-ratio": "16:9",
  quality: "1080p",
  premium: true,
  duration: "00:25",
  author: { name: "Magnific" },
  thumbnails: [
    { width: 468, height: 264, url: "https://v4.cdnpk.net/thumbs/small.jpg", "aspect-ratio": "16:9" },
    { width: 1280, height: 720, url: "https://v4.cdnpk.net/thumbs/large.jpg", "aspect-ratio": "16:9" },
  ],
  previews: [{ width: 640, height: 360, url: "https://v1.cdnpk.net/videvo_files/video/premium/watermarked/cat_FPpreview.mp4" }],
  is_ai_generated: false,
  item_subtype: "footage",
  ...over,
});

test("freepik: search hits become watermarked preview clips with size and length", () => {
  const [a] = mapFreepikVideos({ data: [hit()] }, "cat");
  assert.equal(a.id, "fpv_70000");
  assert.equal(a.sourceId, "70000");
  assert.match(a.src, /FPpreview\.mp4$/);
  assert.equal(a.thumb, "https://v4.cdnpk.net/thumbs/small.jpg");
  assert.deepEqual([a.w, a.h, a.duration, a.kind, a.watermarked, a.source], [1920, 1080, 25, "video", true, "freepik"]);
});

test("freepik: AI-generated clips, motion graphics and items without a playable preview are left out", () => {
  const out = mapFreepikVideos({ data: [hit({ is_ai_generated: true }), hit({ item_subtype: "motion_graphics" }), hit({ previews: [{ url: "https://www.freepik.com/page.htm" }] }), hit({ id: 2 })] }, "q");
  assert.deepEqual(out.map((a) => a.sourceId), ["2"]);
  assert.deepEqual(mapFreepikVideos({}, "q"), []);
});

test("freepik: durations, sizes and the option to download", () => {
  assert.equal(parseDuration("00:00:28"), 28);
  assert.equal(parseDuration("01:05"), 65);
  assert.equal(parseDuration("x"), undefined);
  assert.deepEqual(sizeOf("4k", "9:16"), { w: 2160, h: 3840 });
  const opts = [
    { id: 1, width: 4096, height: 2304, quality: "4k", container: "mp4" },
    { id: 2, width: 1920, height: 1080, quality: "1080p", container: "mp4" },
    { id: 3, width: 1920, height: 1080, container: "mov" },
    { id: 4, width: 1280, height: 720, container: "mp4", active: false },
  ];
  assert.equal(pickOption(opts, 1920).id, 2, "the largest MP4 that fits");
  assert.equal(pickOption(opts, 1000).id, 2, "else the smallest MP4 above");
  assert.equal(pickOption([], 1920), undefined);
});
