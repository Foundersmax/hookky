import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import type { AddressInfo } from "node:net";

// One stand-in server plays all six makers (each under its own path prefix), their CDNs and fal.ai.
const CLIP = Buffer.concat([Buffer.from("\x00\x00\x00\x18ftypmp42"), Buffer.alloc(4000, 7)]);
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC";
type Seen = { method: string; path: string; auth?: string; goog?: string; body: any; raw: Buffer; type?: string };
const seen: Seen[] = [];
const polls = new Map<string, number>();
const fails: Record<string, { status: number; body: unknown } | undefined> = {};
let cdnDenyOnce = false;
let mock: http.Server, app: http.Server;
let origin = "", studio = "";
const step = (key: string) => {
  const n = (polls.get(key) ?? 0) + 1;
  polls.set(key, n);
  return n;
};

before(async () => {
  mock = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      const url = new URL(req.url!, "http://x");
      const path = url.pathname;
      const send = (status: number, body: unknown) => (res.writeHead(status, { "Content-Type": "application/json" }), res.end(JSON.stringify(body)));
      const type = req.headers["content-type"];
      let body: any = null;
      try {
        body = type?.includes("json") ? JSON.parse(raw.toString()) : null;
      } catch {}
      if (!path.startsWith("/cdn/")) seen.push({ method: req.method!, path: path + url.search, auth: req.headers.authorization, goog: req.headers["x-goog-api-key"] as string, body, raw, type });
      for (const [prefix, f] of Object.entries(fails)) if (f && path.startsWith(prefix) && req.method === "POST") return (delete fails[prefix], send(f.status, f.body));
      // ---- CDN
      if (path.startsWith("/cdn/")) {
        if (cdnDenyOnce) return ((cdnDenyOnce = false), res.writeHead(403), res.end("expired"));
        const r = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ""));
        if (r) {
          const a = +r[1], b = r[2] ? +r[2] : CLIP.length - 1;
          res.writeHead(206, { "Content-Type": "video/mp4", "Content-Range": `bytes ${a}-${b}/${CLIP.length}`, "Content-Length": b - a + 1, "Accept-Ranges": "bytes" });
          return res.end(CLIP.subarray(a, b + 1));
        }
        res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": CLIP.length });
        return res.end(CLIP);
      }
      // ---- Google Vertex
      let m = /^\/vertex\/publishers\/google\/models\/([\w.-]+):(predictLongRunning|fetchPredictOperation)$/.exec(path);
      if (m) {
        if (req.headers["x-goog-api-key"] !== "g-key") return send(401, { error: { message: "API key not valid" } });
        if (m[2] === "predictLongRunning") return send(200, { name: `publishers/google/models/${m[1]}/operations/op-${seen.length}` });
        const op = body.operationName as string;
        const n = step(op);
        if (/filtered/.test(body.operationName) || seen.some((s) => s.body?.instances?.[0]?.prompt === "blocked" && op.endsWith(`op-${seen.indexOf(s) + 1}`))) return send(200, { name: op, done: true, response: { raiMediaFilteredCount: 1, raiMediaFilteredReasons: ["Unsafe content"] } });
        return send(200, n < 2 ? { name: op, done: false } : { name: op, done: true, response: { videos: [{ bytesBase64Encoded: CLIP.toString("base64"), mimeType: "video/mp4" }] } });
      }
      // ---- OpenAI
      if (path === "/openai/v1/videos" && req.method === "POST") return send(200, { id: `video_${seen.length}abc`, status: "queued" });
      m = /^\/openai\/v1\/videos\/([\w-]+)(\/content)?$/.exec(path);
      if (m) {
        if (req.headers.authorization !== "Bearer o-key") return send(401, { error: { message: "bad key" } });
        if (m[2]) return (res.writeHead(200, { "Content-Type": "video/mp4" }), res.end(CLIP));
        const n = step(m[1]);
        return send(200, { id: m[1], status: n === 1 ? "queued" : n === 2 ? "in_progress" : "completed", progress: n * 30 });
      }
      // ---- Kling
      m = /^\/kling\/(text-to-video|image-to-video)\/([\w.-]+)$/.exec(path);
      if (m) return send(200, { code: 0, message: "SUCCEED", data: { id: `kt-${seen.length}0000`, status: "submitted" } });
      if (path === "/kling/tasks") {
        const id = url.searchParams.get("task_ids")!;
        const n = step(id);
        return send(200, { code: 0, data: [n === 1 ? { id, status: "processing" } : { id, status: "succeed", outputs: [{ type: "video", id: "v1", url: `${origin}/cdn/kling.mp4` }] }] });
      }
      // ---- MiniMax
      if (path === "/minimax/v1/video_generation") return send(200, { task_id: `${seen.length}12345`, base_resp: { status_code: 0, status_msg: "success" } });
      if (path === "/minimax/v1/query/video_generation") {
        const id = url.searchParams.get("task_id")!;
        const n = step(id);
        return send(200, n === 1 ? { task_id: id, status: "Queueing", base_resp: { status_code: 0 } } : { task_id: id, status: "Success", file_id: "f-77", base_resp: { status_code: 0 } });
      }
      if (path === "/minimax/v1/files/retrieve") return send(200, { file: { file_id: "f-77", download_url: `${origin}/cdn/hailuo.mp4` }, base_resp: { status_code: 0 } });
      // ---- BytePlus ModelArk
      if (path === "/ark/api/v3/contents/generations/tasks" && req.method === "POST") return send(200, { id: `cgt-${seen.length}0000` });
      m = /^\/ark\/api\/v3\/contents\/generations\/tasks\/([\w-]+)$/.exec(path);
      if (m) {
        const n = step(m[1]);
        return send(200, n === 1 ? { id: m[1], status: "running" } : { id: m[1], status: "succeeded", content: { video_url: `${origin}/cdn/seedance.mp4` } });
      }
      // ---- Luma
      if (path === "/luma/generations/video") return send(200, { id: `lm-${seen.length}0000`, state: "queued" });
      m = /^\/luma\/generations\/([\w-]+)$/.exec(path);
      if (m) {
        const n = step(m[1]);
        return send(200, n === 1 ? { id: m[1], state: "dreaming" } : { id: m[1], state: "completed", assets: { video: `${origin}/cdn/ray.mp4` } });
      }
      // ---- fal.ai queue
      if (path.startsWith("/fal/") && req.method === "POST") return send(200, { request_id: `fal-req-${String(seen.length).padStart(6, "0")}` });
      send(404, { message: "no route " + path });
    });
  });
  await new Promise<void>((r) => mock.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
  Object.assign(process.env, {
    VERTEX_API_KEY: "g-key", VERTEX_BASE_URL: `${origin}/vertex`,
    OPENAI_API_KEY: "o-key", OPENAI_BASE_URL: `${origin}/openai/v1`,
    KLING_API_KEY: "k-key", KLING_BASE_URL: `${origin}/kling`,
    MINIMAX_API_KEY: "m-key", MINIMAX_BASE_URL: `${origin}/minimax`,
    BYTEPLUS_ARK_API_KEY: "a-key", ARK_BASE_URL: `${origin}/ark/api/v3`,
    LUMA_API_KEY: "l-key", LUMA_BASE_URL: `${origin}/luma`,
    FAL_KEY: "f-key", FAL_QUEUE_URL: `${origin}/fal`,
    AI_VIDEO_DAILY: "100", AIV_ALLOW_HTTP_INPUTS: "1",
  });
  const { serveFile, serveInput } = await import("./aivideo");
  const e = express();
  e.get("/api/aivideo/file", (req, res) => void serveFile(req, res));
  e.get("/api/aivideo/input/:token", serveInput);
  app = e.listen(0, "127.0.0.1");
  await new Promise((r) => app.once("listening", r));
  studio = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
});
after(() => (mock.close(), app.close()));

const last = (prefix: string) => [...seen].reverse().find((s) => s.path.startsWith(prefix) && s.method === "POST")!;
async function finish(id: string) {
  const { jobStatus } = await import("./aivideo");
  for (let i = 0; i < 6; i++) {
    const s = await jobStatus(id);
    if (s.state === "done" || s.state === "failed") return s;
  }
  throw new Error("never finished");
}
async function play(url: string, range?: string) {
  const r = await fetch(studio + url, { headers: range ? { Range: range } : {} });
  return { status: r.status, type: r.headers.get("content-type"), body: Buffer.from(await r.arrayBuffer()), range: r.headers.get("content-range") };
}

test("every model with a maker of its own goes direct when that maker's key is set", async () => {
  const { aiVideoRoutes, aiVideoProviders } = await import("./aivideo");
  const routes = aiVideoRoutes();
  assert.equal(routes["veo-31"]?.route, "google");
  assert.equal(routes["sora-2"]?.route, "openai");
  assert.equal(routes["kling-3-pro"]?.route, "kling");
  assert.equal(routes["hailuo-02"]?.route, "minimax");
  assert.equal(routes["seedance-15-pro"]?.route, "byteplus");
  assert.equal(routes["luma-ray-2"]?.route, "luma");
  assert.equal(routes["wan-26"]?.route, "fal", "models without a direct maker stay on fal.ai");
  assert.deepEqual(aiVideoProviders().sort(), ["byteplus", "fal", "google", "kling", "luma", "minimax", "openai"]);
});

test("Google Veo: Vertex request, inline frames, clip saved and served with ranges", async () => {
  const { generate } = await import("./aivideo");
  const out = await generate({ model: "veo-31", mode: "image", prompt: "waves roll in", image: PNG, endImage: PNG, aspect: "9:16", duration: 8, resolution: "1080p", audio: false, negative: "text", seed: 9 }, "u:g");
  assert.equal(out.route, "google");
  assert.equal(out.via, "Google Vertex AI");
  const s = last("/vertex/");
  assert.equal(s.path, "/vertex/publishers/google/models/veo-3.1-generate-001:predictLongRunning");
  assert.equal(s.goog, "g-key");
  assert.deepEqual(s.body, {
    // Veo's catalog entry has no last frame (fal's Veo endpoint lacks one), so it isn't sent
    instances: [{ prompt: "waves roll in", image: { bytesBase64Encoded: PNG.split(",")[1], mimeType: "image/png" } }],
    parameters: { sampleCount: 1, aspectRatio: "9:16", durationSeconds: 8, resolution: "1080p", generateAudio: false, negativePrompt: "text", seed: 9 },
  });
  const done = await finish(out.id);
  assert.equal(done.state, "done");
  assert.equal(done.video!.url, `/api/aivideo/file?id=${encodeURIComponent(out.id)}`);
  const full = await play(done.video!.url);
  assert.equal(full.status, 200);
  assert.equal(full.type, "video/mp4");
  assert.ok(full.body.equals(CLIP));
  const part = await play(done.video!.url, "bytes=10-19");
  assert.equal(part.status, 206);
  assert.ok(part.body.equals(CLIP.subarray(10, 20)));
});

test("Google's safety filter is reported, not swallowed", async () => {
  const { generate } = await import("./aivideo");
  const out = await generate({ model: "veo-31-fast", mode: "text", prompt: "blocked" }, "u:g");
  assert.equal(last("/vertex/").path, "/vertex/publishers/google/models/veo-3.1-fast-generate-001:predictLongRunning");
  const s = await finish(out.id);
  assert.equal(s.state, "failed");
  assert.match(s.error!, /safety filter blocked it: Unsafe content/);
});

test("OpenAI Sora: multipart with a frame resized to the output, content streamed with the key", async () => {
  const { generate } = await import("./aivideo");
  const out = await generate({ model: "sora-2", mode: "image", prompt: "a paper boat", image: PNG, aspect: "9:16", duration: 12 }, "u:o");
  const s = last("/openai/");
  assert.equal(s.auth, "Bearer o-key");
  assert.match(s.type!, /^multipart\/form-data/);
  const text = s.raw.toString("latin1");
  for (const [k, v] of [["model", "sora-2"], ["prompt", "a paper boat"], ["seconds", "12"], ["size", "720x1280"]]) assert.match(text, new RegExp(`name="${k}"\\r\\n\\r\\n${v}\\r\\n`));
  assert.match(text, /name="input_reference"; filename="frame.jpg"\r\nContent-Type: image\/jpeg/);
  // the reference is a 720x1280 JPEG (SOF0 marker carries height then width)
  const sof = s.raw.indexOf(Buffer.from([0xff, 0xc0]));
  assert.ok(sof > 0);
  assert.deepEqual([s.raw.readUInt16BE(sof + 5), s.raw.readUInt16BE(sof + 7)], [1280, 720]);
  const done = await finish(out.id);
  assert.equal(done.state, "done");
  const clip = await play(done.video!.url);
  assert.equal(clip.status, 200);
  assert.ok(clip.body.equals(CLIP));
});

test("Kling: new API standard, bare Base64 frames, its CDN link streamed", async () => {
  const { generate } = await import("./aivideo");
  const t = await generate({ model: "kling-3-pro", mode: "text", prompt: "a fox runs", aspect: "1:1", duration: 9, audio: true }, "u:k");
  let s = last("/kling/");
  assert.equal(s.path, "/kling/text-to-video/kling-3.0");
  assert.equal(s.auth, "Bearer k-key");
  assert.deepEqual(s.body, { prompt: "a fox runs", settings: { resolution: "1080p", duration: 8, audio: "native", aspect_ratio: "1:1" }, options: { watermark_info: { enabled: false } } });
  await generate({ model: "kling-25-turbo", mode: "image", prompt: "turns", image: PNG, endImage: PNG }, "u:k");
  s = last("/kling/");
  assert.equal(s.path, "/kling/image-to-video/kling-2.5-turbo");
  assert.deepEqual(s.body.contents, [{ type: "prompt", text: "turns" }, { type: "first_frame", url: PNG.split(",")[1] }, { type: "last_frame", url: PNG.split(",")[1] }]);
  assert.deepEqual(s.body.settings, { resolution: "1080p", duration: 5 });
  const done = await finish(t.id);
  assert.equal(done.state, "done");
  const clip = await play(done.video!.url);
  assert.ok(clip.body.equals(CLIP));
  // an expired link is fetched afresh from Kling
  cdnDenyOnce = true;
  const again = await play(done.video!.url);
  assert.equal(again.status, 200);
});

test("MiniMax Hailuo: tier and length, data-URL frame, file id resolved to a download", async () => {
  const { generate } = await import("./aivideo");
  const out = await generate({ model: "hailuo-23-pro", mode: "image", prompt: "smiles", image: PNG }, "u:m");
  const s = last("/minimax/");
  assert.equal(s.auth, "Bearer m-key");
  assert.deepEqual(s.body, { model: "MiniMax-Hailuo-2.3", prompt: "smiles", duration: 6, resolution: "1080P", first_frame_image: PNG });
  await generate({ model: "hailuo-02", mode: "text", prompt: "rain", duration: 10 }, "u:m");
  assert.deepEqual(last("/minimax/").body, { model: "MiniMax-Hailuo-02", prompt: "rain", duration: 10, resolution: "768P" });
  const done = await finish(out.id);
  assert.equal(done.state, "done");
  assert.ok((await play(done.video!.url)).body.equals(CLIP));
});

test("BytePlus Seedance: content list with frame roles, adaptive shape for images", async () => {
  const { generate } = await import("./aivideo");
  const out = await generate({ model: "seedance-15-pro", mode: "image", prompt: "spins", image: PNG, endImage: PNG, duration: 10, resolution: "1080p", audio: true, seed: 4 }, "u:b");
  const s = last("/ark/");
  assert.equal(s.auth, "Bearer a-key");
  assert.deepEqual(s.body, {
    model: "seedance-1-5-pro-251215",
    content: [{ type: "text", text: "spins" }, { type: "image_url", image_url: { url: PNG }, role: "first_frame" }, { type: "image_url", image_url: { url: PNG }, role: "last_frame" }],
    ratio: "adaptive", watermark: false, duration: 10, resolution: "1080p", generate_audio: true, seed: 4,
  });
  await generate({ model: "seedance-1-fast", mode: "text", prompt: "city", aspect: "21:9" }, "u:b");
  const t = last("/ark/").body;
  assert.equal(t.model, "seedance-1-0-pro-fast-251015");
  assert.equal(t.ratio, "21:9");
  assert.ok(!("generate_audio" in t), "Seedance 1 has no sound switch");
  const done = await finish(out.id);
  assert.ok((await play(done.video!.url)).body.equals(CLIP));
});

test("Luma Ray: frames handed over as short-lived links on this server", async () => {
  const { generate } = await import("./aivideo");
  const out = await generate({ model: "luma-ray-2", mode: "image", prompt: "dolly in", image: PNG, aspect: "4:3", duration: 9 }, "u:l", studio);
  const s = last("/luma/");
  assert.equal(s.auth, "Bearer l-key");
  assert.equal(s.body.model, "ray-2");
  assert.equal(s.body.duration, "9s");
  assert.equal(s.body.aspect_ratio, "4:3");
  const link: string = s.body.keyframes.frame0.url;
  assert.match(link, new RegExp(`^${studio}/api/aivideo/input/[A-Za-z0-9_-]{24}\\.png$`));
  const img = await fetch(link);
  assert.equal(img.headers.get("content-type"), "image/png");
  assert.ok(Buffer.from(await img.arrayBuffer()).equals(Buffer.from(PNG.split(",")[1], "base64")));
  assert.equal((await fetch(`${studio}/api/aivideo/input/not-a-token.png`)).status, 404);
  const done = await finish(out.id);
  assert.ok((await play(done.video!.url)).body.equals(CLIP));
});

test("a maker that is down or refuses the key falls back to fal.ai; bad settings don't", async () => {
  const { generate, aiVideoUsed } = await import("./aivideo");
  fails["/kling/"] = { status: 200, body: { code: 1102, message: "Account balance not enough" } };
  const out = await generate({ model: "kling-3-standard", mode: "text", prompt: "x" }, "u:f");
  assert.equal(out.route, "fal");
  assert.match(out.id, /^kling-3-standard\.text\.fal\.fal-req-\d+$/);
  assert.match(out.notes![0], /Kling Account balance not enough/);
  assert.equal(last("/fal/").path, "/fal/fal-ai/kling-video/v3/standard/text-to-video");
  fails["/vertex/"] = { status: 503, body: { error: { message: "Service unavailable" } } };
  assert.equal((await generate({ model: "veo-31", mode: "text", prompt: "x" }, "u:f")).route, "fal");
  const before = aiVideoUsed("u:f");
  fails["/openai/"] = { status: 400, body: { error: { message: "Your prompt was flagged" } } };
  await assert.rejects(generate({ model: "sora-2", mode: "text", prompt: "x" }, "u:f"), /OpenAI Your prompt was flagged/);
  assert.equal(aiVideoUsed("u:f"), before, "a refused request doesn't count");
});

test("both routes failing says what each said", async () => {
  const { generate } = await import("./aivideo");
  fails["/minimax/"] = { status: 502, body: {} };
  fails["/fal/"] = { status: 500, body: { detail: "fal is down" } };
  await assert.rejects(generate({ model: "hailuo-02", mode: "text", prompt: "x" }, "u:f"), (e: Error) => /MiniMax/.test(e.message) && /fal\.ai fal is down/.test(e.message));
});

test("AI_VIDEO_ROUTE=fal prefers fal.ai; AIV_MODEL_* swaps a maker's model id", async () => {
  const { generate } = await import("./aivideo");
  process.env.AI_VIDEO_ROUTE = "fal";
  assert.equal((await generate({ model: "sora-2", mode: "text", prompt: "x" }, "u:p")).route, "fal");
  delete process.env.AI_VIDEO_ROUTE;
  process.env.AIV_MODEL_VEO_31 = "veo-3.1-generate-preview";
  await generate({ model: "veo-31", mode: "text", prompt: "x" }, "u:p");
  assert.equal(last("/vertex/").path, "/vertex/publishers/google/models/veo-3.1-generate-preview:predictLongRunning");
  delete process.env.AIV_MODEL_VEO_31;
});

test("job ids are checked; keys never go to links the makers hand out", async () => {
  const { jobStatus, generate } = await import("./aivideo");
  await assert.rejects(jobStatus("veo-31.text.google.!!!"), /Unknown job/);
  await assert.rejects(jobStatus("veo-31.text.evil.YWJjZGVm"), /Unknown job/);
  const bad = Buffer.from("publishers/google/models/x/../../secrets").toString("base64url");
  assert.equal((await jobStatus(`veo-31.text.google.${bad}`)).state, "failed");
  assert.equal((await play("/api/aivideo/file?id=nope")).status, 404);
  // a CDN link on another host goes through the SSRF guard (here: localhost is private, so refused)
  const out = await generate({ model: "kling-3-pro", mode: "text", prompt: "x" }, "u:s");
  await finish(out.id);
  const realOrigin = origin;
  origin = origin.replace("127.0.0.1", "localhost");
  const id2 = (await generate({ model: "kling-3-pro", mode: "text", prompt: "y" }, "u:s")).id;
  await finish(id2);
  const r = await play(`/api/aivideo/file?id=${encodeURIComponent(id2)}`);
  origin = realOrigin;
  assert.ok(r.status >= 400, `refused (${r.status})`);
  assert.ok(!seen.some((s) => s.path.startsWith("/cdn/") && s.auth), "no key sent to a CDN");
});

test("Seedance 2.x run only on BytePlus, with their own ids (overridable)", async () => {
  const { generate, routesFor } = await import("./aivideo");
  assert.deepEqual(routesFor("seedance-25"), ["byteplus"], "no fal.ai route for 2.x");
  await generate({ model: "seedance-25", mode: "text", prompt: "a parade", duration: 15, resolution: "1080p", aspect: "9:16" }, "u:s2");
  let b = last("/ark/").body;
  assert.equal(b.model, "dreamina-seedance-2-5-260628");
  assert.equal(b.duration, 15);
  assert.equal(b.ratio, "9:16");
  assert.equal(b.generate_audio, true);
  await generate({ model: "seedance-20", mode: "image", prompt: "turns", image: PNG }, "u:s2");
  b = last("/ark/").body;
  assert.equal(b.model, "dreamina-seedance-2-0-260128");
  assert.equal(b.ratio, "adaptive");
  process.env.AIV_MODEL_SEEDANCE_20_FAST = "dreamina-seedance-2-0-fast-261001";
  await generate({ model: "seedance-20-fast", mode: "text", prompt: "x" }, "u:s2");
  assert.equal(last("/ark/").body.model, "dreamina-seedance-2-0-fast-261001");
  delete process.env.AIV_MODEL_SEEDANCE_20_FAST;
});

test("switches: a maker switched off stops taking new videos; fal.ai takes over where it can", async () => {
  const { generate, routesFor, aiVideoConnections, aiVideoProviders, jobStatus } = await import("./aivideo");
  const { setSwitch, _resetSwitches } = await import("./aivideoSwitches");
  const running = await generate({ model: "sora-2", mode: "text", prompt: "before" }, "u:sw");
  await setSwitch("openai", false);
  assert.deepEqual(routesFor("sora-2"), ["fal"]);
  assert.ok(!aiVideoProviders().includes("openai"));
  const c = aiVideoConnections().find((x) => x.id === "openai")!;
  assert.deepEqual([c.on, c.keySet, c.locked, c.keyName], [false, true, false, "OPENAI_API_KEY"]);
  assert.deepEqual(c.models, ["Sora 2"]);
  assert.equal((await generate({ model: "sora-2", mode: "text", prompt: "x" }, "u:sw")).route, "fal");
  assert.ok((await jobStatus(running.id)).state !== "failed", "a clip already rendering still finishes");
  await setSwitch("byteplus", false);
  await assert.rejects(generate({ model: "seedance-25", mode: "text", prompt: "x" }, "u:sw"), /BytePlus ModelArk is switched off/);
  await setSwitch("fal", false);
  await assert.rejects(generate({ model: "sora-2", mode: "text", prompt: "x" }, "u:sw"), /OpenAI and fal\.ai are switched off/);
  _resetSwitches();
  assert.deepEqual(routesFor("sora-2"), ["openai", "fal"]);
});

test("AI_VIDEO_OFF locks makers off from the environment", async () => {
  const { routesFor, aiVideoConnections } = await import("./aivideo");
  process.env.AI_VIDEO_OFF = "kling, luma";
  assert.deepEqual(routesFor("kling-3-pro"), ["fal"]);
  const k = aiVideoConnections().find((x) => x.id === "kling")!;
  assert.deepEqual([k.on, k.locked], [true, true]);
  delete process.env.AI_VIDEO_OFF;
  assert.deepEqual(routesFor("kling-3-pro"), ["kling", "fal"]);
});
