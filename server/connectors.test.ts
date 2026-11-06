// Stock video connectors: response mapping, rendition choice, and the proxy's host allowlist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapPexelsVideos, mapPixabayVideos, pickVideoFile, videoHostAllowed } from "./connectors";
import { clipTime } from "../src/engine/videos";

test("pickVideoFile takes the largest MP4 that fits 1920px, else the smallest", () => {
  const files = [
    { width: 3840, height: 2160, link: "uhd.mp4", file_type: "video/mp4" },
    { width: 1920, height: 1080, link: "fhd.mp4", file_type: "video/mp4" },
    { width: 1280, height: 720, link: "hd.mp4", file_type: "video/mp4" },
    { width: 1920, height: 1080, link: "x.m3u8", file_type: "application/x-mpegURL" },
  ];
  assert.equal(pickVideoFile(files)?.link, "fhd.mp4");
  assert.equal(pickVideoFile([{ width: 4096, height: 2160, link: "a" }, { width: 2560, height: 1440, link: "b" }])?.link, "b");
  assert.equal(pickVideoFile([]), undefined);
});

test("Pexels and Pixabay results become playable video assets", () => {
  const px = mapPexelsVideos(
    {
      videos: [
        { id: 1, url: "https://www.pexels.com/video/1/", image: "https://images.pexels.com/1.jpg", duration: 12, user: { name: "Ana" }, video_files: [{ width: 1080, height: 1920, file_type: "video/mp4", link: "https://videos.pexels.com/video-files/1/1-hd.mp4" }] },
        { id: 2, video_files: [] },
      ],
    },
    "coffee pour",
  );
  assert.equal(px.length, 1);
  assert.deepEqual([px[0].kind, px[0].src, px[0].thumb, px[0].w, px[0].h, px[0].duration, px[0].author, px[0].source], ["video", "https://videos.pexels.com/video-files/1/1-hd.mp4", "https://images.pexels.com/1.jpg", 1080, 1920, 12, "Ana", "pexels"]);
  const pb = mapPixabayVideos(
    { hits: [{ id: 5, pageURL: "https://pixabay.com/videos/id-5/", tags: "ocean, waves", duration: 20, user: "kim", videos: { large: { url: "https://cdn.pixabay.com/video/l.mp4", width: 3840, height: 2160, thumbnail: "https://cdn.pixabay.com/video/l.jpg" }, medium: { url: "https://cdn.pixabay.com/video/m.mp4", width: 1920, height: 1080 }, tiny: { url: "", width: 640, height: 360 } } }] },
    "ocean",
  );
  assert.deepEqual([pb[0].src, pb[0].thumb, pb[0].title, pb[0].w], ["https://cdn.pixabay.com/video/m.mp4", "https://cdn.pixabay.com/video/l.jpg", "ocean, waves", 1920]);
  assert.deepEqual(mapPexelsVideos(null, "x"), []);
});

test("the video proxy only streams from the stock sources' CDNs over https", () => {
  for (const ok of ["https://videos.pexels.com/video-files/1/a.mp4", "https://cdn.pixabay.com/video/a.mp4", "https://player.vimeo.com/external/1.hd.mp4", "https://vod-progressive.vimeocdn.com/x.mp4"]) assert.ok(videoHostAllowed(ok), ok);
  for (const bad of ["http://videos.pexels.com/a.mp4", "https://evilpexels.com/a.mp4", "https://pexels.com.evil.net/a.mp4", "https://127.0.0.1/a.mp4", "file:///etc/passwd", "not a url"]) assert.ok(!videoHostAllowed(bad), bad);
});

test("clips shorter than their scene loop", () => {
  assert.equal(clipTime(2.5, 2), 0.5);
  assert.equal(clipTime(1, 4), 1);
  assert.equal(clipTime(3, NaN), 3);
});
