import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for every maker's free account call; each test sets what a maker answers.
type Reply = { status: number; body: unknown };
const replies: Record<string, Reply> = {};
const seen: { path: string; auth?: string; goog?: string; method: string }[] = [];
let server: http.Server;
let origin = "";

before(async () => {
  server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const path = req.url ?? "";
      seen.push({ path, auth: req.headers.authorization, goog: req.headers["x-goog-api-key"] as string, method: req.method! });
      const key = Object.keys(replies).filter((k) => path.startsWith(k)).sort((a, b) => b.length - a.length)[0]; // the most specific reply
      const r = key ? replies[key] : { status: 404, body: { message: "no route" } };
      res.writeHead(r.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(r.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  Object.assign(process.env, {
    OPENAI_API_KEY: "o-key", OPENAI_BASE_URL: `${origin}/openai/v1`,
    VERTEX_API_KEY: "g-key", VERTEX_BASE_URL: `${origin}/vertex`,
    KLING_API_KEY: "k-key", KLING_BASE_URL: `${origin}/kling`,
    MINIMAX_API_KEY: "m-key", MINIMAX_BASE_URL: `${origin}/minimax`,
    BYTEPLUS_ARK_API_KEY: "a-key", ARK_BASE_URL: `${origin}/ark/api/v3`,
    LUMA_API_KEY: "l-key", LUMA_BASE_URL: `${origin}/luma`,
    FAL_KEY: "f-key", FAL_QUEUE_URL: `${origin}/fal`,
    AI_VIDEO_DAILY_CREDITS: "100000",
  });
  delete process.env.DATABASE_URL;
});
after(() => server.close());
const set = (path: string, status: number, body: unknown = {}) => (replies[path] = { status, body });

test("a good key on every maker reads as ok, with the balance where the maker gives one", async () => {
  const { checkConnection } = await import("./videoChecks");
  set("/openai/v1/models/sora-2", 200, { id: "sora-2" });
  set("/vertex/publishers/google/models/veo-3.1-generate-001", 200, { name: "veo" });
  set("/kling/account/billing/balance", 200, { code: 0, data: { balance: 420 } });
  set("/minimax/v1/query/video_generation", 200, { base_resp: { status_code: 2013, status_msg: "task not found" } });
  set("/ark/api/v3/contents/generations/tasks", 200, { items: [] });
  set("/luma/credits", 200, { credit_balance: 1500 });
  set("/fal/", 404, { detail: "Request not found" });
  const all = Object.fromEntries(await Promise.all((["openai", "google", "kling", "minimax", "byteplus", "luma", "fal"] as const).map(async (r) => [r, await checkConnection(r)])));
  for (const [r, c] of Object.entries(all)) assert.equal((c as any).state, "ok", `${r}: ${(c as any).message}`);
  assert.equal(all.kling.balance, "420");
  assert.equal(all.luma.balance, "1500 credits");
  assert.match(all.openai.message, /can see sora-2/);
  assert.match(all.byteplus.message, /activated in the ModelArk console/);
  // each key went only to its own maker, in that maker's own header
  const by = (p: string) => seen.find((s) => s.path.startsWith(p))!;
  assert.equal(by("/openai/").auth, "Bearer o-key");
  assert.equal(by("/vertex/").goog, "g-key");
  assert.equal(by("/kling/").auth, "Bearer k-key");
  assert.equal(by("/fal/").auth, "Key f-key");
  assert.ok(seen.every((s) => s.method === "GET"), "checks only read: nothing is generated");
});

test("bad keys, empty accounts and missing models are told apart, in plain words", async () => {
  const { checkConnection } = await import("./videoChecks");
  set("/openai/v1/models/sora-2", 401, { error: { message: "Incorrect API key provided" } });
  let c = await checkConnection("openai");
  assert.equal(c.state, "key-rejected");
  assert.match(c.message, /Incorrect API key.*OPENAI_API_KEY/);
  set("/openai/v1/models/sora-2", 404, { error: { message: "The model does not exist or you do not have access" } });
  c = await checkConnection("openai");
  assert.equal(c.state, "model-missing");
  assert.match(c.message, /organization to be verified/);
  set("/kling/account/billing/balance", 200, { code: 0, data: { balance: 0 } });
  assert.equal((await checkConnection("kling")).state, "no-credit");
  set("/kling/account/billing/balance", 200, { code: 1002, message: "Authorization is invalid" });
  assert.equal((await checkConnection("kling")).state, "key-rejected");
  set("/minimax/v1/query/video_generation", 200, { base_resp: { status_code: 1004, status_msg: "login fail" } });
  assert.equal((await checkConnection("minimax")).state, "key-rejected");
  set("/minimax/v1/query/video_generation", 200, { base_resp: { status_code: 1008, status_msg: "insufficient balance" } });
  assert.equal((await checkConnection("minimax")).state, "no-credit");
  set("/vertex/publishers/google/models/veo-3.1-generate-001", 404, { error: { message: "Publisher Model not found" } });
  c = await checkConnection("google");
  assert.equal(c.state, "model-missing");
  assert.match(c.message, /AIV_MODEL_VEO_31/);
  set("/vertex/publishers/google/models/veo-3.1-generate-001", 403, { error: { message: "Vertex AI API has not been used in project" } });
  assert.match((await checkConnection("google")).message, /billing and the Vertex AI API switched on/);
  set("/luma/credits", 200, { credit_balance: 0 });
  assert.equal((await checkConnection("luma")).state, "no-credit");
  set("/fal/", 401, { detail: "Invalid key" });
  assert.equal((await checkConnection("fal")).state, "key-rejected");
  set("/ark/api/v3/contents/generations/tasks", 500, { error: { message: "boom" } });
  c = await checkConnection("byteplus");
  assert.equal(c.state, "unclear");
  assert.match(c.message, /make a test clip to be sure/);
});

test("no key, and a maker that can't be reached, are answers too", async () => {
  const { checkConnection } = await import("./videoChecks");
  const k = process.env.LUMA_API_KEY;
  delete process.env.LUMA_API_KEY;
  const c = await checkConnection("luma");
  assert.equal(c.state, "no-key");
  assert.match(c.message, /LUMA_API_KEY/);
  process.env.LUMA_API_KEY = k;
  const url = process.env.KLING_BASE_URL;
  process.env.KLING_BASE_URL = "http://127.0.0.1:9"; // nothing listens there
  assert.equal((await checkConnection("kling")).state, "unreachable");
  process.env.KLING_BASE_URL = url;
});

test("the health check reports states without waiting on the makers", async () => {
  const { checkStates, rememberCheck } = await import("./videoChecks");
  rememberCheck("openai", { state: "key-rejected", message: "x" });
  const t0 = Date.now();
  const s = checkStates(["openai", "luma"]);
  assert.ok(Date.now() - t0 < 50);
  assert.equal(s.openai, "key-rejected");
  assert.ok(["unchecked", "ok", "no-credit"].includes(s.luma));
});

test("the test clip is the cheapest one a connection can make, on that connection only", async () => {
  const { cheapestOn, testClip } = await import("./aivideo");
  const { setSwitch, _resetSwitches } = await import("./aivideoSwitches");
  const { recentFailures, _resetLedger } = await import("./videoLedger");
  _resetLedger();
  const k = cheapestOn("kling")!;
  assert.equal(k.name, "Kling 3 Standard", "3 s at 720p, silent");
  assert.deepEqual([k.req.duration, k.req.audio, k.credits], [3, false, 19]);
  assert.equal(cheapestOn("byteplus")!.name, "Seedance 1 Pro Fast");
  assert.deepEqual([cheapestOn("byteplus")!.req.duration, cheapestOn("byteplus")!.req.resolution], [3, "480p"]);
  assert.ok(cheapestOn("fal")!.usd <= 0.2, "a fal.ai test costs cents");
  // it runs on the asked connection even when that one is switched off, and never falls back
  await setSwitch("kling", false);
  set("/kling/text-to-video/", 200, { code: 0, data: { id: "kt-12345678" } });
  const ok = await testClip("kling", { who: "u:1", role: "admin" });
  assert.equal(ok.route, "kling");
  set("/kling/text-to-video/", 200, { code: 1102, message: "Account balance not enough" });
  const calls = seen.length;
  await assert.rejects(testClip("kling", { who: "u:1", role: "admin" }), /Kling Account balance not enough/);
  assert.ok(!seen.slice(calls).some((s) => s.path.startsWith("/fal/")), "a test never falls back to fal.ai");
  _resetSwitches();
  const f = await recentFailures();
  assert.deepEqual([f[0].route, f[0].stage, f[0].model, f[0].who], ["kling", "test", "kling-3-standard", "u:1"]);
  assert.match(f[0].message, /balance not enough/);
});

test("failures are logged once with the maker's own words: sending, and a clip that fails to render", async () => {
  const { generate, jobStatus } = await import("./aivideo");
  const { recentFailures, _resetLedger } = await import("./videoLedger");
  _resetLedger();
  // Luma is down: the request falls back to fal.ai, and the fallback is still noted
  set("/fal/", 404, {});
  set("/luma/generations/video", 503, { detail: "Service unavailable" });
  set("/fal/fal-ai/luma-dream-machine/ray-2", 200, { request_id: "fal-req-000001" });
  const out = await generate({ model: "luma-ray-2", mode: "text", prompt: "x" }, { who: "u:7", role: "user" });
  assert.equal(out.route, "fal");
  let f = await recentFailures();
  assert.deepEqual([f.length, f[0].route, f[0].stage], [1, "luma", "send"]);
  // the clip then fails while rendering
  set("/fal/fal-ai/luma-dream-machine/requests/fal-req-000001/status", 200, { status: "COMPLETED" });
  set("/fal/fal-ai/luma-dream-machine/requests/fal-req-000001", 200, { video: null });
  assert.equal((await jobStatus(out.id)).state, "failed");
  assert.equal((await jobStatus(out.id)).state, "failed");
  await new Promise((r) => setTimeout(r, 20));
  f = await recentFailures();
  assert.equal(f.length, 2, "asking again doesn't log it twice");
  assert.deepEqual([f[0].route, f[0].stage, f[0].who, f[0].model], ["fal", "render", "u:7", "luma-ray-2"]);
  assert.match(f[0].message, /safety filter/);
});

test("alerts: each budget step once, the highest one reached; one person's heavy day once", async () => {
  const L = await import("./videoLedger");
  const { alertMail } = await import("./videoAlerts");
  L._resetLedger();
  await L.setLimits({ monthlyBudgetUsd: 100, dailyCredits: null });
  const spend = async (who: string, usd: number, n: string) => {
    const t = await L.reserve({ who, role: "admin" }, Math.round(usd * 100), usd);
    await L.commit(t, { id: `al-${n}`, actor: { who }, model: "sora-2", route: "openai" });
    return L.dueAlerts(who);
  };
  assert.deepEqual(await spend("u:1", 5, "a"), [], "5% and $5: nothing to say");
  let a = await spend("u:1", 50, "b");
  assert.deepEqual(a.map((x) => x.kind).sort(), ["budget", "person"]);
  assert.equal(a.find((x) => x.kind === "budget")!.step, 50);
  assert.deepEqual(await spend("u:1", 5, "c"), [], "neither is repeated");
  a = await spend("u:2", 35, "d");
  assert.deepEqual(a.map((x) => (x.kind === "budget" ? x.step : x.who)).sort(), [80, "u:2"]);
  a = await spend("u:3", 5, "e");
  assert.deepEqual(a.map((x) => (x.kind === "budget" ? x.step : x.kind)), [100]);
  assert.deepEqual(await L.dueAlerts("u:3"), []);
  const full = alertMail({ kind: "budget", step: 100, spent: 100, budget: 100 });
  assert.match(full.subject, /budget is used up/);
  assert.match(full.lines.join(" "), /Nobody can generate more clips/);
  const half = alertMail({ kind: "budget", step: 50, spent: 55, budget: 100 });
  assert.match(half.subject, /50%/);
  assert.match(half.lines[0], /\$55\.00 of this month's \$100\.00 budget.*\$45\.00 is left/);
  assert.match(alertMail({ kind: "person", who: "u:2", spent: 35 }, "Ana (ana@x.co)").lines[0], /Ana \(ana@x\.co\) has used about \$35\.00/);
  // no budget set: only the per-person warning remains
  L._resetLedger();
  assert.deepEqual((await spend("u:9", 12, "f")).map((x) => x.kind), ["person"]);
});
