// The stock video proxy, against a stand-in upstream: Range pass-through, type checks, refusals.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { Response as UResponse } from "undici";
import { proxyVideo } from "./videoProxy";

const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));

async function serve(upstream: (url: string, headers: Record<string, string>) => UResponse) {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const app = express();
  app.get("/api/video", (req, res) => proxyVideo(req, res, async (url, init) => (seen.push({ url, headers: init.headers ?? {} }), { res: upstream(url, init.headers ?? {}) })));
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/video?u=`;
  return { base, seen, close: () => new Promise((r) => server.close(r)) };
}

const ranged = (_url: string, h: Record<string, string>) => {
  const m = /bytes=(\d+)-(\d*)/.exec(h.Range ?? "");
  if (!m) return new UResponse(bytes, { status: 200, headers: { "content-type": "video/mp4", "content-length": "1000", "accept-ranges": "bytes" } });
  const s = +m[1], e = m[2] ? +m[2] : 999;
  return new UResponse(bytes.subarray(s, e + 1), { status: 206, headers: { "content-type": "video/mp4", "content-length": String(e - s + 1), "content-range": `bytes ${s}-${e}/1000`, "accept-ranges": "bytes" } });
};

test("streams a clip and passes Range requests through for seeking", async () => {
  const s = await serve(ranged);
  try {
    const u = s.base + encodeURIComponent("https://videos.pexels.com/video-files/1/a.mp4");
    const full = await fetch(u);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("content-type"), "video/mp4");
    assert.equal(full.headers.get("accept-ranges"), "bytes");
    assert.equal((await full.arrayBuffer()).byteLength, 1000);
    const part = await fetch(u, { headers: { Range: "bytes=100-199" } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get("content-range"), "bytes 100-199/1000");
    assert.deepEqual(Buffer.from(await part.arrayBuffer()), bytes.subarray(100, 200));
    assert.equal(s.seen[1].headers.Range, "bytes=100-199");
    // a malformed Range header is dropped, not forwarded
    await (await fetch(u, { headers: { Range: "bytes=0-1, 5-9" } })).arrayBuffer();
    assert.equal(s.seen[2].headers.Range, undefined);
  } finally {
    await s.close();
  }
});

test("refuses hosts outside the stock CDNs and responses that aren't video", async () => {
  const s = await serve((url) => (url.includes("html") ? new UResponse("<html>", { headers: { "content-type": "text/html" } }) : new UResponse(bytes, { headers: { "content-type": "application/octet-stream" } })));
  try {
    const off = await fetch(s.base + encodeURIComponent("https://example.com/a.mp4"));
    assert.equal(off.status, 400);
    assert.equal(s.seen.length, 0, "never contacted");
    assert.equal((await fetch(s.base + encodeURIComponent("https://cdn.pixabay.com/page.html"))).status, 502);
    const octet = await fetch(s.base + encodeURIComponent("https://cdn.pixabay.com/video/a.webm"));
    assert.equal(octet.headers.get("content-type"), "video/webm", "octet-stream gets a playable type");
  } finally {
    await s.close();
  }
});
