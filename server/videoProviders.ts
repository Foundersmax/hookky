// Direct connections to the video makers' own APIs (no fal.ai in between). Each maker has its own
// way to start a job, check on it and hand back the file; this module hides that behind one shape.
// Request formats are taken from each maker's official SDK or client: Google (@google/genai, Vertex
// AI "express mode" with an API key), OpenAI (openai, /v1/videos), Kling (its 2026 API standard
// with a static key), MiniMax (/v1/video_generation), BytePlus ModelArk (Seedance) and Luma.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Normal, Direct, Provider } from "../src/aivideo/models";
import { ffmpegPath } from "./aac";

export type Poll = { state: "queued" | "running" | "done" | "failed"; position?: number; progress?: number; error?: string };
/** Where a finished clip is fetched from: a URL (with the key if the maker requires it) or a file on this server. */
export type Source = { url: string; headers?: Record<string, string> } | { file: string };
export interface Ctx {
  /** A public https URL serving this image for a while (for makers that only take URLs). */
  publicImage(dataUrl: string): Promise<string>;
}
export interface Maker {
  id: Provider;
  /** the env vars that switch it on, for messages */
  keyName: string;
  configured(): boolean;
  base(): string;
  submit(n: Normal, d: Direct, ctx: Ctx): Promise<string>;
  poll(rid: string): Promise<Poll>;
  source(rid: string): Promise<Source>;
}

/** An answer from a maker; `retry` = another route may well succeed (outage, key, limits). */
export class MakerError extends Error {
  constructor(message: string, readonly status = 502, readonly retry = false) {
    super(message);
  }
}

const env = (...names: string[]) => names.map((n) => process.env[n]?.trim()).find(Boolean) ?? "";
/** The maker's model id, overridable per catalog model (AIV_MODEL_VEO_31=veo-3.1-generate-preview). */
export const makerModel = (catalogId: string, d: Direct) => env(`AIV_MODEL_${catalogId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`) || d.model;

type Answer = { ok: boolean; status: number; json: any; text: string };
async function call(url: string, init: { method?: string; headers?: Record<string, string>; json?: unknown; form?: FormData; timeoutMs?: number } = {}): Promise<Answer> {
  let r: Response;
  try {
    r = await fetch(url, {
      method: init.method ?? (init.json !== undefined || init.form ? "POST" : "GET"),
      headers: { Accept: "application/json", ...(init.json !== undefined && { "Content-Type": "application/json" }), ...init.headers },
      body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
      signal: AbortSignal.timeout(init.timeoutMs ?? 60_000),
    });
  } catch (e) {
    throw new MakerError(`couldn't be reached (${(e as Error)?.message ?? e})`, 502, true);
  }
  const text = await r.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { ok: r.ok, status: r.status, json, text };
}
/** A maker's HTTP error as a sentence, and whether falling back to another route makes sense. */
function fail(a: Answer, detail?: string): never {
  const msg = detail || a.json?.error?.message || a.json?.message || (typeof a.json?.error === "string" ? a.json.error : "") || a.json?.detail || a.json?.base_resp?.status_msg || a.text.slice(0, 200);
  const s = a.status;
  if (s === 401) throw new MakerError(`rejected the API key${msg ? ` (${msg})` : ""}`, 503, true);
  if (s === 403) throw new MakerError(msg || "refused the request (no access or no credit)", 503, true);
  if (s === 404) throw new MakerError(msg || "doesn't know this model or job", 502, true);
  if (s === 429) throw new MakerError(msg || "is rate-limiting this account", 429, true);
  if (s >= 500 || s === 0) throw new MakerError(msg || `had a server error (${s})`, 502, true);
  throw new MakerError(msg || `didn't accept the request (${s})`, 422, false);
}
const dataParts = (dataUrl: string) => {
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/.exec(dataUrl);
  return m ? { mime: m[1], b64: m[2] } : null;
};
const safeId = (s: unknown, re = /^[A-Za-z0-9_.:-]{4,200}$/) => (typeof s === "string" && re.test(s) ? s : null);

/** An image cropped to exactly w×h (Sora wants the reference frame at the output size). */
export function fitImage(input: Buffer, w: number, h: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-f", "image2pipe", "-i", "pipe:0", "-vf", `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`, "-frames:v", "1", "-c:v", "mjpeg", "-q:v", "3", "-f", "image2pipe", "pipe:1"], { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => (ff.kill("SIGKILL"), reject(new Error("Resizing the image took too long."))), 20_000);
    ff.stdout.on("data", (d: Buffer) => out.push(d));
    ff.stderr.on("data", (d: Buffer) => (err = (err + d).slice(-500)));
    ff.on("error", (e) => (clearTimeout(timer), reject(new Error(`ffmpeg isn't available (${e.message}).`))));
    ff.on("close", (code) => {
      clearTimeout(timer);
      const buf = Buffer.concat(out);
      code === 0 && buf.length ? resolve(buf) : reject(new Error(`The image couldn't be resized${err ? `: ${err.trim()}` : "."}`));
    });
    ff.stdin.on("error", () => {});
    ff.stdin.end(input);
  });
}

// ---------------------------------------------------------------- Google: Veo on Vertex AI (express mode)
const CACHE = join(tmpdir(), "rookker-aivideo");
const cacheFile = (rid: string) => join(CACHE, createHash("sha256").update(rid).digest("hex").slice(0, 32) + ".mp4");
function prune() {
  try {
    const now = Date.now();
    for (const f of readdirSync(CACHE)) {
      const p = join(CACHE, f);
      if (now - statSync(p).mtimeMs > 48 * 3600_000) unlinkSync(p);
    }
  } catch {}
}
const VEO_OP = /^(projects\/[\w.-]+\/locations\/[\w-]+\/)?publishers\/google\/models\/[\w.-]+\/operations\/[\w-]+$/;
const google: Maker = {
  id: "google",
  keyName: "VERTEX_API_KEY",
  configured: () => !!env("VERTEX_API_KEY", "GOOGLE_VERTEX_API_KEY"),
  base: () => (env("VERTEX_BASE_URL") || "https://aiplatform.googleapis.com/v1beta1").replace(/\/+$/, ""),
  async submit(n, d) {
    const head = { "x-goog-api-key": env("VERTEX_API_KEY", "GOOGLE_VERTEX_API_KEY") };
    const img = (u?: string) => {
      const p = u && dataParts(u);
      return p ? { bytesBase64Encoded: p.b64, mimeType: p.mime } : undefined;
    };
    if (n.image && !dataParts(n.image)) throw new MakerError("needs the image itself, not a link", 422);
    const instance: Record<string, unknown> = { prompt: n.prompt };
    if (n.image) instance.image = img(n.image);
    if (n.endImage && dataParts(n.endImage)) instance.lastFrame = img(n.endImage);
    const parameters: Record<string, unknown> = { sampleCount: 1 };
    if (n.aspect) parameters.aspectRatio = n.aspect;
    if (n.duration) parameters.durationSeconds = n.duration;
    if (n.resolution) parameters.resolution = n.resolution;
    if (n.audio !== undefined) parameters.generateAudio = n.audio;
    if (n.negative) parameters.negativePrompt = n.negative;
    if (n.seed !== undefined) parameters.seed = n.seed;
    const a = await call(`${google.base()}/publishers/google/models/${encodeURIComponent(makerModel(n.model.id, d))}:predictLongRunning`, { headers: head, json: { instances: [instance], parameters } });
    if (!a.ok) fail(a);
    const name = safeId(a.json?.name, VEO_OP);
    if (!name) throw new MakerError("didn't return an operation", 502, true);
    return name;
  },
  async poll(rid) {
    if (!VEO_OP.test(rid)) throw new MakerError("unknown job", 404);
    const file = cacheFile(rid);
    if (existsSync(file)) return { state: "done" };
    const a = await call(`${google.base()}/${rid.split("/operations/")[0]}:fetchPredictOperation`, { headers: { "x-goog-api-key": env("VERTEX_API_KEY", "GOOGLE_VERTEX_API_KEY") }, json: { operationName: rid } });
    if (!a.ok) {
      if (a.status === 404) return { state: "failed", error: "Google no longer has this job." };
      fail(a);
    }
    const op = a.json ?? {};
    if (!op.done) return { state: "running" };
    if (op.error) return { state: "failed", error: op.error.message || "Veo couldn't make this video." };
    const v = op.response?.videos?.[0] ?? op.response?.generateVideoResponse?.generatedSamples?.[0]?.video;
    const b64 = v?.bytesBase64Encoded ?? v?.encodedVideo;
    if (typeof b64 !== "string" || !b64) {
      const why = op.response?.raiMediaFilteredReasons?.[0];
      return { state: "failed", error: why ? `Google's safety filter blocked it: ${why}` : "Veo finished without a video (it may have been blocked by its safety filter)." };
    }
    mkdirSync(CACHE, { recursive: true });
    prune();
    writeFileSync(file, Buffer.from(b64, "base64"));
    return { state: "done" };
  },
  async source(rid) {
    const file = cacheFile(rid);
    if (!existsSync(file)) {
      const p = await google.poll(rid);
      if (p.state !== "done") throw new MakerError(p.error ?? "isn't finished", p.state === "failed" ? 410 : 409);
    }
    return { file };
  },
};

// ---------------------------------------------------------------- OpenAI: Sora
const openai: Maker = {
  id: "openai",
  keyName: "OPENAI_API_KEY",
  configured: () => !!env("OPENAI_API_KEY"),
  base: () => (env("OPENAI_BASE_URL") || "https://api.openai.com/v1").replace(/\/+$/, ""),
  async submit(n, d) {
    const size = n.aspect === "9:16" ? "720x1280" : "1280x720";
    const form = new FormData();
    form.set("model", makerModel(n.model.id, d));
    form.set("prompt", n.prompt);
    if (n.duration) form.set("seconds", String(n.duration));
    form.set("size", size);
    if (n.image) {
      const p = dataParts(n.image);
      if (!p) throw new MakerError("needs the image itself, not a link", 422);
      const [w, h] = size.split("x").map(Number);
      const jpg = await fitImage(Buffer.from(p.b64, "base64"), w, h).catch((e) => {
        throw new MakerError(e.message, 422);
      });
      form.set("input_reference", new Blob([new Uint8Array(jpg)], { type: "image/jpeg" }), "frame.jpg");
    }
    const a = await call(`${openai.base()}/videos`, { headers: { Authorization: `Bearer ${env("OPENAI_API_KEY")}` }, form });
    if (!a.ok) fail(a);
    const id = safeId(a.json?.id);
    if (!id) throw new MakerError("didn't return a job id", 502, true);
    return id;
  },
  async poll(rid) {
    const a = await call(`${openai.base()}/videos/${encodeURIComponent(rid)}`, { headers: { Authorization: `Bearer ${env("OPENAI_API_KEY")}` } });
    if (!a.ok) {
      if (a.status === 404) return { state: "failed", error: "OpenAI no longer has this job." };
      fail(a);
    }
    const v = a.json ?? {};
    if (v.status === "completed") return { state: "done" };
    if (v.status === "failed") return { state: "failed", error: v.error?.message || "Sora couldn't make this video." };
    return { state: v.status === "queued" ? "queued" : "running", ...(Number.isFinite(v.progress) && { progress: v.progress }) };
  },
  async source(rid) {
    return { url: `${openai.base()}/videos/${encodeURIComponent(rid)}/content`, headers: { Authorization: `Bearer ${env("OPENAI_API_KEY")}` } };
  },
};

// ---------------------------------------------------------------- Kling (2026 API standard, static key)
async function klingTask(rid: string) {
  const a = await call(`${kling.base()}/tasks?task_ids=${encodeURIComponent(rid)}`, { headers: { Authorization: `Bearer ${env("KLING_API_KEY")}` } });
  if (!a.ok) fail(a);
  if (a.json?.code !== undefined && a.json.code !== 0) fail({ ...a, status: a.json.code === 1102 ? 403 : 422 }, a.json.message);
  const list = Array.isArray(a.json?.data) ? a.json.data : Array.isArray(a.json?.data?.result) ? a.json.data.result : [];
  return list.find((t: any) => t?.id === rid) ?? null;
}
const kling: Maker = {
  id: "kling",
  keyName: "KLING_API_KEY",
  configured: () => !!env("KLING_API_KEY"),
  base: () => (env("KLING_BASE_URL") || "https://api-singapore.klingai.com").replace(/\/+$/, ""),
  async submit(n, d) {
    const settings: Record<string, unknown> = {};
    if (d.resolution) settings.resolution = d.resolution;
    if (n.duration) settings.duration = n.duration;
    if (n.audio !== undefined) settings.audio = n.audio ? "native" : "off";
    const raw = (u: string) => dataParts(u)?.b64 ?? u; // Kling takes bare Base64 or a URL
    let path: string, body: Record<string, unknown>;
    if (n.mode === "image") {
      const contents: Record<string, unknown>[] = [{ type: "prompt", text: n.prompt }, { type: "first_frame", url: raw(n.image!) }];
      if (n.endImage) contents.push({ type: "last_frame", url: raw(n.endImage) });
      path = "image-to-video";
      body = { contents, settings };
    } else {
      if (n.aspect) settings.aspect_ratio = n.aspect;
      path = "text-to-video";
      body = { prompt: n.prompt, settings };
    }
    body.options = { watermark_info: { enabled: false } };
    const a = await call(`${kling.base()}/${path}/${encodeURIComponent(makerModel(n.model.id, d))}`, { headers: { Authorization: `Bearer ${env("KLING_API_KEY")}` }, json: body });
    if (!a.ok) fail(a);
    if (a.json?.code !== 0) fail({ ...a, status: a.json?.code === 1102 || a.json?.code === 1101 ? 403 : a.json?.code >= 5000 ? 502 : 422 }, a.json?.message);
    const id = safeId(a.json?.data?.id ?? a.json?.data?.task_id);
    if (!id) throw new MakerError("didn't return a job id", 502, true);
    return id;
  },
  async poll(rid) {
    const t = await klingTask(rid);
    if (!t) return { state: "failed", error: "Kling no longer has this job." };
    if (t.status === "succeed" || t.status === "succeeded") return { state: "done" };
    if (t.status === "failed") return { state: "failed", error: t.message || t.status_msg || "Kling couldn't make this video." };
    return { state: t.status === "submitted" ? "queued" : "running" };
  },
  async source(rid) {
    const t = await klingTask(rid);
    const v = (t?.outputs ?? []).find((o: any) => o?.type === "video" && typeof o.url === "string") ?? t?.task_result?.videos?.[0];
    if (!v?.url) throw new MakerError("has no video for this job", 410);
    return { url: v.url };
  },
};

// ---------------------------------------------------------------- MiniMax: Hailuo
const mmHead = () => ({ Authorization: `Bearer ${env("MINIMAX_API_KEY")}` });
const mmCheck = (a: Answer) => {
  if (!a.ok) fail(a);
  const c = a.json?.base_resp?.status_code;
  if (c !== undefined && c !== 0) fail({ ...a, status: c === 1004 ? 401 : c === 1008 ? 403 : c === 1002 ? 429 : c === 1000 || c === 1013 ? 502 : 422 }, a.json.base_resp.status_msg);
  return a.json;
};
const minimax: Maker = {
  id: "minimax",
  keyName: "MINIMAX_API_KEY",
  configured: () => !!env("MINIMAX_API_KEY"),
  base: () => (env("MINIMAX_BASE_URL") || "https://api.minimax.io").replace(/\/+$/, ""),
  async submit(n, d) {
    const body: Record<string, unknown> = { model: makerModel(n.model.id, d), prompt: n.prompt, duration: n.duration ?? 6 };
    if (d.resolution) body.resolution = d.resolution;
    if (n.image) body.first_frame_image = n.image;
    const j = mmCheck(await call(`${minimax.base()}/v1/video_generation`, { headers: mmHead(), json: body }));
    const id = safeId(String(j?.task_id ?? ""));
    if (!id) throw new MakerError("didn't return a job id", 502, true);
    return id;
  },
  async poll(rid) {
    const j = mmCheck(await call(`${minimax.base()}/v1/query/video_generation?task_id=${encodeURIComponent(rid)}`, { headers: mmHead() }));
    const s = j?.status;
    if (s === "Success") return { state: "done" };
    if (s === "Fail") return { state: "failed", error: j?.base_resp?.status_msg || "Hailuo couldn't make this video." };
    return { state: s === "Processing" ? "running" : "queued" };
  },
  async source(rid) {
    const j = mmCheck(await call(`${minimax.base()}/v1/query/video_generation?task_id=${encodeURIComponent(rid)}`, { headers: mmHead() }));
    if (!j?.file_id) throw new MakerError("has no video for this job", 410);
    const f = mmCheck(await call(`${minimax.base()}/v1/files/retrieve?file_id=${encodeURIComponent(String(j.file_id))}`, { headers: mmHead() }));
    const url = f?.file?.download_url;
    if (typeof url !== "string") throw new MakerError("has no download for this job", 410);
    return { url };
  },
};

// ---------------------------------------------------------------- BytePlus ModelArk: Seedance
const arkHead = () => ({ Authorization: `Bearer ${env("BYTEPLUS_ARK_API_KEY", "ARK_API_KEY")}` });
async function arkTask(rid: string) {
  const a = await call(`${byteplus.base()}/contents/generations/tasks/${encodeURIComponent(rid)}`, { headers: arkHead() });
  if (!a.ok) {
    if (a.status === 404) return null;
    fail(a);
  }
  return a.json;
}
const byteplus: Maker = {
  id: "byteplus",
  keyName: "BYTEPLUS_ARK_API_KEY",
  configured: () => !!env("BYTEPLUS_ARK_API_KEY", "ARK_API_KEY"),
  base: () => (env("ARK_BASE_URL") || "https://ark.ap-southeast.bytepluses.com/api/v3").replace(/\/+$/, ""),
  async submit(n, d) {
    const content: Record<string, unknown>[] = [{ type: "text", text: n.prompt }];
    if (n.image) content.push({ type: "image_url", image_url: { url: n.image }, role: "first_frame" });
    if (n.endImage) content.push({ type: "image_url", image_url: { url: n.endImage }, role: "last_frame" });
    const body: Record<string, unknown> = { model: makerModel(n.model.id, d), content, ratio: n.aspect ?? (n.image ? "adaptive" : "16:9"), watermark: false };
    if (n.duration) body.duration = n.duration;
    if (n.resolution) body.resolution = n.resolution;
    if (n.audio !== undefined) body.generate_audio = n.audio;
    if (n.seed !== undefined) body.seed = n.seed;
    const a = await call(`${byteplus.base()}/contents/generations/tasks`, { headers: arkHead(), json: body });
    if (!a.ok) {
      // ModelArk doesn't switch Seedance models on by itself, and dated ids get replaced over time
      const code = String(a.json?.error?.code ?? "");
      if (/NotOpen|NotActivated|ModelNotFound|InvalidEndpointOrModel|NotFound/i.test(code))
        throw new MakerError(`can't run ${body.model} (${code}): activate it in the ModelArk console, or set its current id with AIV_MODEL_${n.model.id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`, 503, true);
      fail(a);
    }
    const id = safeId(a.json?.id);
    if (!id) throw new MakerError("didn't return a job id", 502, true);
    return id;
  },
  async poll(rid) {
    const t = await arkTask(rid);
    if (!t) return { state: "failed", error: "BytePlus no longer has this job." };
    if (t.status === "succeeded") return { state: "done" };
    if (t.status === "failed" || t.status === "cancelled" || t.status === "expired") return { state: "failed", error: t.error?.message || `Seedance reported "${t.status}".` };
    return { state: t.status === "running" ? "running" : "queued" };
  },
  async source(rid) {
    const url = (await arkTask(rid))?.content?.video_url;
    if (typeof url !== "string") throw new MakerError("has no video for this job", 410);
    return { url };
  },
};

// ---------------------------------------------------------------- Luma: Ray
const lumaHead = () => ({ Authorization: `Bearer ${env("LUMA_API_KEY", "LUMAAI_API_KEY")}` });
async function lumaGen(rid: string) {
  const a = await call(`${luma.base()}/generations/${encodeURIComponent(rid)}`, { headers: lumaHead() });
  if (!a.ok) {
    if (a.status === 404) return null;
    fail(a);
  }
  return a.json;
}
const luma: Maker = {
  id: "luma",
  keyName: "LUMA_API_KEY",
  configured: () => !!env("LUMA_API_KEY", "LUMAAI_API_KEY"),
  base: () => (env("LUMA_BASE_URL") || "https://api.lumalabs.ai/dream-machine/v1").replace(/\/+$/, ""),
  async submit(n, d, ctx) {
    const body: Record<string, unknown> = { model: makerModel(n.model.id, d), prompt: n.prompt };
    if (n.aspect) body.aspect_ratio = n.aspect;
    if (n.duration) body.duration = `${n.duration}s`;
    if (n.resolution) body.resolution = n.resolution;
    if (n.image) {
      const url = async (u: string) => (/^https:/.test(u) ? u : ctx.publicImage(u));
      body.keyframes = { frame0: { type: "image", url: await url(n.image) }, ...(n.endImage && { frame1: { type: "image", url: await url(n.endImage) } }) };
    }
    const a = await call(`${luma.base()}/generations/video`, { headers: lumaHead(), json: body });
    if (!a.ok) fail(a);
    const id = safeId(a.json?.id);
    if (!id) throw new MakerError("didn't return a job id", 502, true);
    return id;
  },
  async poll(rid) {
    const g = await lumaGen(rid);
    if (!g) return { state: "failed", error: "Luma no longer has this job." };
    if (g.state === "completed") return { state: "done" };
    if (g.state === "failed") return { state: "failed", error: g.failure_reason || "Ray couldn't make this video." };
    return { state: g.state === "dreaming" ? "running" : "queued" };
  },
  async source(rid) {
    const url = (await lumaGen(rid))?.assets?.video;
    if (typeof url !== "string") throw new MakerError("has no video for this job", 410);
    return { url };
  },
};

export const MAKERS: Record<Provider, Maker> = { google, openai, kling, minimax, byteplus, luma };
