import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for fal's queue: POST /<endpoint> queues; status goes IN_QUEUE → IN_PROGRESS → COMPLETED.
type Req = { path: string; auth?: string; body: any };
const seen: Req[] = [];
const polls = new Map<string, number>();
let nextFailure: { status: number; body: unknown } | null = null;
let result: unknown = { video: { url: "https://v3.fal.media/files/abc/out.mp4", width: 1280, height: 720 } };
let server: http.Server;
let origin = "";

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const path = req.url ?? "";
      const send = (status: number, body: unknown) => (res.writeHead(status, { "Content-Type": "application/json" }), res.end(JSON.stringify(body)));
      if (req.headers.authorization !== "Key test-key") return send(401, { detail: "bad key" });
      if (req.method === "POST") {
        seen.push({ path, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : null });
        if (nextFailure) {
          const f = nextFailure;
          nextFailure = null;
          return send(f.status, f.body);
        }
        const id = `req-${String(seen.length).padStart(6, "0")}`;
        const app = path.split("/").slice(1, 3).join("/");
        return send(200, { request_id: id, status_url: `${origin}/${app}/requests/${id}/status`, response_url: `${origin}/${app}/requests/${id}`, cancel_url: "https://evil.example/cancel" });
      }
      const m = /\/requests\/([\w-]+)(\/status)?$/.exec(path);
      if (!m) return send(404, {});
      if (m[1].startsWith("gone")) return send(404, {});
      if (!m[2]) return send(200, result);
      const n = (polls.get(m[1]) ?? 0) + 1;
      polls.set(m[1], n);
      send(200, n === 1 ? { status: "IN_QUEUE", queue_position: 2 } : n === 2 ? { status: "IN_PROGRESS" } : { status: "COMPLETED" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.FAL_QUEUE_URL = origin;
  process.env.FAL_KEY = "test-key";
  process.env.AI_VIDEO_DAILY = "3";
});
after(() => server.close());

test("a generation is queued, polled and finishes with a playable clip", async () => {
  const { generate, jobStatus, aiVideoUsed } = await import("./aivideo");
  const { videoHostAllowed } = await import("./connectors");
  const { id, model } = await generate({ model: "kling-3-pro", mode: "text", prompt: "a fox runs", duration: 5, aspect: "9:16" }, "u:1");
  assert.equal(model, "Kling 3 Pro");
  assert.match(id, /^kling-3-pro\.text\.req-\d+$/);
  const sent = seen.at(-1)!;
  assert.equal(sent.path, "/fal-ai/kling-video/v3/pro/text-to-video");
  assert.deepEqual(sent.body, { prompt: "a fox runs", aspect_ratio: "9:16", duration: "5", generate_audio: true });
  assert.equal(aiVideoUsed("u:1"), 1);
  assert.deepEqual(await jobStatus(id), { state: "queued", position: 2 });
  assert.deepEqual(await jobStatus(id), { state: "running" });
  const done = await jobStatus(id);
  assert.deepEqual(done, { state: "done", video: { url: "https://v3.fal.media/files/abc/out.mp4", width: 1280, height: 720 } });
  assert.ok(videoHostAllowed(done.video!.url), "the clip can stream through the video proxy");
});

test("a job survives a server restart: the id alone finds it", async () => {
  const { jobStatus } = await import("./aivideo");
  polls.set("restarted-0001", 2);
  assert.equal((await jobStatus("veo-31.image.restarted-0001")).state, "done");
  assert.deepEqual(await jobStatus("veo-31.text.gone-000001"), { state: "failed", error: "fal.ai no longer has this request." });
  await assert.rejects(jobStatus("../../etc/passwd"), /Unknown job/);
  await assert.rejects(jobStatus("nope.text.abcdefgh"), /Unknown job/);
});

test("a finished job with no video says why", async () => {
  const { jobStatus } = await import("./aivideo");
  const keep = result;
  result = { video: null };
  polls.set("empty-000001", 2);
  const s = await jobStatus("sora-2.text.empty-000001");
  assert.equal(s.state, "failed");
  assert.match(s.error!, /safety filter/);
  result = { video: { url: "javascript:alert(1)" } };
  polls.set("empty-000002", 2);
  assert.equal((await jobStatus("sora-2.text.empty-000002")).state, "failed");
  result = keep;
});

test("failures are explained and don't use up the day's count", async () => {
  const { generate, aiVideoUsed, AiVideoError } = await import("./aivideo");
  const before = aiVideoUsed("u:2");
  nextFailure = { status: 422, body: { detail: [{ msg: "duration must be 5 or 10" }] } };
  await assert.rejects(generate({ model: "sora-2", mode: "text", prompt: "x" }, "u:2"), /didn't accept these settings: duration must be 5 or 10/);
  nextFailure = { status: 403, body: { detail: "User is locked. Exhausted balance." } };
  await assert.rejects(generate({ model: "sora-2", mode: "text", prompt: "x" }, "u:2"), /Exhausted balance/);
  await assert.rejects(generate({ model: "sora-2", mode: "image", prompt: "x" }, "u:2"), (e: unknown) => e instanceof AiVideoError && e.status === 400 && /Add an image/.test(e.message));
  assert.equal(aiVideoUsed("u:2"), before);
});

test("the daily cap holds per person", async () => {
  const { generate, aiVideoUsed, AiVideoError } = await import("./aivideo");
  for (let i = 0; i < 3; i++) await generate({ model: "hailuo-02", mode: "text", prompt: "x" }, "u:3");
  await assert.rejects(generate({ model: "hailuo-02", mode: "text", prompt: "x" }, "u:3"), (e: unknown) => e instanceof AiVideoError && e.status === 429);
  assert.equal(aiVideoUsed("u:3"), 3);
  await generate({ model: "hailuo-02", mode: "text", prompt: "x" }, "u:4"); // someone else is unaffected
});

test("without a key nothing is sent", async () => {
  const { generate, aiVideoConfigured } = await import("./aivideo");
  const k = process.env.FAL_KEY;
  delete process.env.FAL_KEY;
  const n = seen.length;
  assert.equal(aiVideoConfigured(), false);
  await assert.rejects(generate({ model: "sora-2", mode: "text", prompt: "x" }, "u:5"), /isn't set up/);
  assert.equal(seen.length, n);
  process.env.FAL_KEY = k;
});

test("the key only ever goes to fal's queue", async () => {
  // the mock answered with a cancel_url on another host; status/response URLs on other hosts are ignored too
  const { generate, jobStatus } = await import("./aivideo");
  const real = globalThis.fetch;
  const hosts: string[] = [];
  globalThis.fetch = ((u: any, i: any) => (hosts.push(new URL(String(u)).host), real(u, i))) as typeof fetch;
  try {
    const { id } = await generate({ model: "wan-26", mode: "text", prompt: "x" }, "u:6");
    await jobStatus(id);
  } finally {
    globalThis.fetch = real;
  }
  assert.ok(hosts.length >= 2 && hosts.every((h) => h === new URL(origin).host), hosts.join(","));
});
