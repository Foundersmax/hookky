import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import type { AddressInfo } from "node:net";

// A stand-in R2 (S3 API, path style), a stand-in Kling and fal.ai, and the clips they hand out.
const SMALL = Buffer.concat([Buffer.from("\x00\x00\x00\x18ftypmp42"), Buffer.alloc(3000, 3)]);
const BIG = Buffer.alloc(9 * 1024 * 1024 + 123, 5); // over one 8 MB part: a multipart upload
const objects = new Map<string, { body: Buffer; type: string }>();
const uploads = new Map<string, Buffer[]>();
const s3log: string[] = [];
let s3Down = false;
let cdnDown = false;
let clipFor: Record<string, Buffer> = {};
let s3: http.Server, maker: http.Server, app: http.Server;
let s3o = "", mo = "", studio = "";

function serveBytes(req: http.IncomingMessage, res: http.ServerResponse, body: Buffer, type: string) {
  const r = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ""));
  if (r) {
    const a = +r[1], b = r[2] ? Math.min(+r[2], body.length - 1) : body.length - 1;
    if (a >= body.length) return (res.writeHead(416, { "Content-Range": `bytes */${body.length}` }), res.end());
    res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${a}-${b}/${body.length}`, "Content-Length": b - a + 1, "Accept-Ranges": "bytes" });
    return res.end(req.method === "HEAD" ? undefined : body.subarray(a, b + 1));
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": body.length, ETag: '"e"' });
  res.end(req.method === "HEAD" ? undefined : body);
}

before(async () => {
  s3 = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => {
      const u = new URL(req.url!, "http://x");
      const key = decodeURIComponent(u.pathname.replace(/^\/bucket-1\//, ""));
      s3log.push(`${req.method} ${u.pathname}${u.search} auth=${/^AWS4-HMAC-SHA256 Credential=AK-TEST\//.test(String(req.headers.authorization))}`);
      if (s3Down) return (res.writeHead(500, { "Content-Type": "application/xml" }), res.end("<Error><Code>InternalError</Code><Message>down</Message></Error>"));
      const xml = (status: number, body: string, headers: Record<string, string> = {}) => (res.writeHead(status, { "Content-Type": "application/xml", ...headers }), res.end(body));
      if (req.method === "POST" && u.searchParams.has("uploads")) {
        const id = `up-${uploads.size + 1}`;
        uploads.set(id, []);
        return xml(200, `<InitiateMultipartUploadResult><Bucket>bucket-1</Bucket><Key>${key}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
      }
      if (req.method === "PUT" && u.searchParams.has("uploadId")) {
        uploads.get(u.searchParams.get("uploadId")!)![+u.searchParams.get("partNumber")! - 1] = Buffer.concat(chunks);
        return xml(200, "", { ETag: `"p${u.searchParams.get("partNumber")}"` });
      }
      if (req.method === "POST" && u.searchParams.has("uploadId")) {
        objects.set(key, { body: Buffer.concat(uploads.get(u.searchParams.get("uploadId")!)!), type: "video/mp4" });
        return xml(200, `<CompleteMultipartUploadResult><Bucket>bucket-1</Bucket><Key>${key}</Key><ETag>"done"</ETag></CompleteMultipartUploadResult>`);
      }
      if (req.method === "PUT") {
        objects.set(key, { body: Buffer.concat(chunks), type: String(req.headers["content-type"] ?? "") });
        return xml(200, "", { ETag: '"x"' });
      }
      const o = objects.get(key);
      if (!o) return req.method === "HEAD" ? (res.writeHead(404), res.end()) : xml(404, "<Error><Code>NoSuchKey</Code></Error>");
      serveBytes(req, res, o.body, o.type);
    });
  });
  maker = http.createServer((req, res) => {
    const u = new URL(req.url!, "http://x");
    const send = (s: number, b: unknown) => (res.writeHead(s, { "Content-Type": "application/json" }), res.end(JSON.stringify(b)));
    req.resume();
    req.on("end", () => {
      if (u.pathname.startsWith("/cdn/")) return cdnDown ? (res.writeHead(404), res.end()) : serveBytes(req, res, clipFor[u.pathname] ?? SMALL, "video/mp4");
      let m = /^\/kling\/text-to-video\//.exec(u.pathname);
      if (m) return send(200, { code: 0, data: { id: `kt-${Math.random().toString(36).slice(2, 10)}` } });
      if (u.pathname === "/kling/tasks") {
        const id = u.searchParams.get("task_ids")!;
        return send(200, { code: 0, data: [{ id, status: "succeed", outputs: [{ type: "video", id: "v", url: `${mo}/cdn/${id}.mp4` }] }] });
      }
      if (u.pathname.startsWith("/fal/") && req.method === "POST") return send(200, { request_id: `fal-${Math.random().toString(36).slice(2, 12)}` });
      m = /^\/fal\/[\w-]+\/[\w.-]+\/requests\/([\w-]+)(\/status)?$/.exec(u.pathname);
      if (m) return send(200, m[2] ? { status: "COMPLETED" } : { video: { url: `${mo}/cdn/${m[1]}.mp4` } });
      send(404, {});
    });
  });
  for (const s of [s3, maker]) await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  s3o = `http://127.0.0.1:${(s3.address() as AddressInfo).port}`;
  mo = `http://127.0.0.1:${(maker.address() as AddressInfo).port}`;
  Object.assign(process.env, {
    R2_ENDPOINT: s3o, R2_ACCESS_KEY_ID: "AK-TEST", R2_SECRET_ACCESS_KEY: "secret", R2_BUCKET: "bucket-1",
    KLING_API_KEY: "k", KLING_BASE_URL: `${mo}/kling`,
    FAL_KEY: "f", FAL_QUEUE_URL: `${mo}/fal`,
    AI_VIDEO_DAILY: "100",
  });
  const { serveFile } = await import("./aivideo");
  const e = express();
  e.get("/api/aivideo/file", (req, res) => void serveFile(req, res));
  app = e.listen(0, "127.0.0.1");
  await new Promise((r) => app.once("listening", r));
  studio = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
});
after(() => (s3.close(), maker.close(), app.close()));

async function play(url: string, range?: string) {
  const r = await fetch(studio + url, { headers: range ? { Range: range } : {} });
  return { status: r.status, body: Buffer.from(await r.arrayBuffer()), range: r.headers.get("content-range"), type: r.headers.get("content-type") };
}
async function made(model: string) {
  const { generate, jobStatus } = await import("./aivideo");
  const { id } = await generate({ model, mode: "text", prompt: "x" }, "u:1");
  const s = await jobStatus(id);
  assert.equal(s.state, "done");
  return { id, url: s.video!.url };
}

test("a finished clip is copied to R2 and then plays from there, even after the maker drops it", async () => {
  const { archive } = await import("./aivideo");
  const { clipKey } = await import("./storage");
  const { id, url } = await made("kling-3-pro");
  assert.equal(await archive(id), true);
  const o = objects.get(clipKey(id))!;
  assert.ok(o.body.equals(SMALL));
  assert.equal(o.type, "video/mp4");
  assert.match(clipKey(id), /^aivideo\/[0-9a-f]{40}\.mp4$/);
  assert.ok(s3log.every((l) => l.endsWith("auth=true")), "every request to R2 is signed with the R2 key");
  cdnDown = true;
  const full = await play(url);
  assert.equal(full.status, 200);
  assert.ok(full.body.equals(SMALL));
  const part = await play(url, "bytes=100-199");
  assert.equal(part.status, 206);
  assert.equal(part.range, `bytes 100-199/${SMALL.length}`);
  assert.ok(part.body.equals(SMALL.subarray(100, 200)));
  assert.equal((await play(url, `bytes=${SMALL.length + 10}-`)).status, 416);
  cdnDown = false;
});

test("big clips go up in parts", async () => {
  const { archive } = await import("./aivideo");
  const { clipKey } = await import("./storage");
  const { generate } = await import("./aivideo");
  const { id } = await generate({ model: "kling-3-pro", mode: "text", prompt: "big" }, "u:1");
  clipFor[`/cdn/${Buffer.from(id.split(".").pop()!, "base64url").toString()}.mp4`] = BIG;
  assert.equal(await archive(id), true);
  assert.ok(objects.get(clipKey(id))!.body.equals(BIG));
  assert.ok(s3log.some((l) => l.startsWith("POST") && l.includes("uploads")), "multipart upload used");
  clipFor = {};
});

test("fal.ai clips are saved too", async () => {
  const { archive } = await import("./aivideo");
  const { clipKey } = await import("./storage");
  const { id, url } = await made("wan-26");
  assert.match(id, /\.fal\./);
  assert.equal(url, `/api/aivideo/file?id=${encodeURIComponent(id)}`);
  assert.equal(await archive(id), true);
  assert.ok(objects.get(clipKey(id))!.body.equals(SMALL));
  cdnDown = true;
  assert.ok((await play(url)).body.equals(SMALL), "plays from R2 after fal.ai's link is gone");
  cdnDown = false;
});

test("playing a clip that isn't saved yet streams the maker's copy and saves it", async () => {
  const { clipKey } = await import("./storage");
  const { generate } = await import("./aivideo");
  const { id } = await generate({ model: "kling-3-standard", mode: "text", prompt: "late" }, "u:1");
  const url = `/api/aivideo/file?id=${encodeURIComponent(id)}`;
  const r = await play(url);
  assert.equal(r.status, 200);
  assert.ok(r.body.equals(SMALL));
  for (let i = 0; i < 50 && !objects.has(clipKey(id)); i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(objects.has(clipKey(id)), "saved in the background");
});

test("if R2 is down, clips still play from the maker and saving is retried later", async () => {
  const { archive } = await import("./aivideo");
  const { id, url } = await made("kling-25-turbo");
  s3Down = true;
  const errs: string[] = [];
  const keep = console.error;
  console.error = (m: string) => errs.push(m);
  try {
    assert.equal(await archive(id), false);
    const r = await play(url);
    assert.equal(r.status, 200);
    assert.ok(r.body.equals(SMALL));
  } finally {
    console.error = keep;
    s3Down = false;
  }
  assert.ok(errs.some((e) => /Couldn't save clip/.test(e)));
  assert.equal(await archive(id), false, "not hammered: waits before trying again");
});

test("without R2 settings nothing is saved", async () => {
  const { archive } = await import("./aivideo");
  const { storageOn } = await import("./storage");
  const b = process.env.R2_BUCKET;
  delete process.env.R2_BUCKET;
  assert.equal(storageOn(), false);
  const { id } = await made("kling-3-pro");
  const n = objects.size;
  assert.equal(await archive(id), false);
  assert.equal(objects.size, n);
  process.env.R2_BUCKET = b;
});
