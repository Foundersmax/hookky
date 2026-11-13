// AI video generation. Each model can run on its maker's own API (Google, OpenAI, Kling, MiniMax,
// BytePlus, Luma: see videoProviders.ts) or through fal.ai, which reaches every model with one key.
// The maker's own API is used when its key is set (AI_VIDEO_ROUTE=fal flips that); if it is down
// or refuses the key, the request falls back to the other route. A job id carries its route, so
// it can be checked on (and its file fetched) even after a server restart.
import type { Request, Response } from "express";
import { Readable } from "node:stream";
import { randomBytes } from "node:crypto";
import { normalize, buildInput, modelById, onFal, supports, VIDEO_MODELS, PROVIDER_NAMES, type GenMode, type GenRequest, type Normal, type Provider } from "../src/aivideo/models";
import { rememberVideoUrls } from "./connectors";
import { MAKERS, MakerError, type Source } from "./videoProviders";
import { safeFetch } from "./safeFetch";
import { createReadStream, statSync } from "node:fs";
import { storageOn, clipKey, stored, saveClip, readClip } from "./storage";
import { isOff, envOff, switchedOff, ALL_ROUTES } from "./aivideoSwitches";

type Route = Provider | "fal";
const falBase = () => (process.env.FAL_QUEUE_URL || "https://queue.fal.run").replace(/\/+$/, "");
const falKey = () => process.env.FAL_KEY?.trim() || process.env.FAL_API_KEY?.trim() || "";
const falOn = () => !!falKey();

/** A connection that has its key and isn't switched off. */
const live = (r: Route) => !isOff(r) && (r === "fal" ? falOn() : MAKERS[r].configured());
/** The routes a model can run on, best first (for one mode, or for either). */
export function routesFor(modelId: string, mode?: GenMode): Route[] {
  const m = modelById(modelId);
  if (!m) return [];
  const modes: GenMode[] = mode ? [mode] : ["text", "image"];
  const direct: Route[] = m.direct && live(m.direct.provider) && modes.some((md) => supports(m, md)) ? [m.direct.provider] : [];
  const fal: Route[] = live("fal") && modes.some((md) => onFal(m, md)) ? ["fal"] : [];
  return process.env.AI_VIDEO_ROUTE === "fal" ? [...fal, ...direct] : [...direct, ...fal];
}
export const aiVideoConfigured = () => VIDEO_MODELS.some((m) => routesFor(m.id).length > 0);
/** Which connections are switched on (names only, for health and the workspace). */
export const aiVideoProviders = (): Route[] => ALL_ROUTES.filter(live);
/** Every connection, for the admin's switches. */
export function aiVideoConnections() {
  const locked = envOff();
  return ALL_ROUTES.map((r) => ({
    id: r,
    name: PROVIDER_NAMES[r],
    keyName: r === "fal" ? "FAL_KEY" : MAKERS[r].keyName,
    keySet: r === "fal" ? falOn() : MAKERS[r].configured(),
    /** the app's own switch; `locked` = off in the environment regardless */
    on: !switchedOff().includes(r),
    locked: locked.has(r),
    models: VIDEO_MODELS.filter((m) => (r === "fal" ? onFal(m, "text") || onFal(m, "image") : m.direct?.provider === r)).map((m) => m.name),
  }));
}
/** Clips one person can generate a day (each one costs money). */
export const aiVideoDailyLimit = () => {
  const n = Number(process.env.AI_VIDEO_DAILY);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 20;
};

// ---------------------------------------------------------------- daily use, per person
const used = new Map<string, { day: string; n: number }>();
const today = () => new Date().toISOString().slice(0, 10);
export function aiVideoUsed(who: string) {
  const u = used.get(who);
  return u && u.day === today() ? u.n : 0;
}
function take(who: string): boolean {
  const n = aiVideoUsed(who);
  if (n >= aiVideoDailyLimit()) return false;
  used.set(who, { day: today(), n: n + 1 });
  if (used.size > 5000) for (const k of [...used.keys()].slice(0, 1000)) used.delete(k);
  return true;
}
const giveBack = (who: string) => {
  const u = used.get(who);
  if (u && u.day === today() && u.n > 0) u.n--;
};

export class AiVideoError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

// ---------------------------------------------------------------- job ids: model.mode.route.<request id>
const b64u = (s: string) => Buffer.from(s).toString("base64url");
const unb64u = (s: string) => Buffer.from(s, "base64url").toString();
const ROUTES = new Set<string>(["fal", ...Object.keys(MAKERS)]);
function parseId(id: string): { model: NonNullable<ReturnType<typeof modelById>>; mode: "text" | "image"; route: Route; rid: string } {
  const m = /^([a-z0-9-]{2,40})\.(text|image)\.(?:([a-z]{2,12})\.([A-Za-z0-9_-]{4,400})|([A-Za-z0-9-]{8,64}))$/.exec(id);
  const model = m && modelById(m[1]);
  if (!m || !model) throw new AiVideoError("Unknown job.", 404);
  if (m[5]) return { model, mode: m[2] as "text" | "image", route: "fal", rid: m[5] }; // ids from before routes existed
  if (!ROUTES.has(m[3])) throw new AiVideoError("Unknown job.", 404);
  const rid = m[3] === "fal" ? m[4] : unb64u(m[4]);
  if (!rid || /[\s\0]/.test(rid)) throw new AiVideoError("Unknown job.", 404);
  return { model, mode: m[2] as "text" | "image", route: m[3] as Route, rid };
}
const makeId = (n: Normal, route: Route, rid: string) => `${n.model.id}.${n.mode}.${route}.${route === "fal" ? rid : b64u(rid)}`;

// ---------------------------------------------------------------- fal.ai
type FalJob = { statusUrl: string; responseUrl: string };
const falJobs = new Map<string, FalJob>();
function falOwnUrl(u: unknown): u is string {
  if (typeof u !== "string") return false;
  try {
    const url = new URL(u), b = new URL(falBase());
    return url.protocol === b.protocol && (url.host === b.host || (b.host === "queue.fal.run" && /(^|\.)fal\.run$/.test(url.hostname)));
  } catch {
    return false;
  }
}
async function fal(url: string, body?: unknown) {
  let r: globalThis.Response;
  try {
    r = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Key ${falKey()}`, Accept: "application/json", ...(body !== undefined && { "Content-Type": "application/json" }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(45_000),
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
function falExplain(status: number, json: any, text: string): MakerError {
  const d = json?.detail;
  const msg = typeof d === "string" ? d : Array.isArray(d) ? d.map((x: any) => x?.msg ?? "").filter(Boolean).join("; ") : typeof json?.error === "string" ? json.error : typeof json?.message === "string" ? json.message : "";
  if (status === 401) return new MakerError("rejected the key. Check FAL_KEY on the server", 503, true);
  if (status === 403) return new MakerError(msg || "refused the request: the account may be out of credit or locked", 503, true);
  if (status === 404) return new MakerError("doesn't have this model any more", 502, true);
  if (status === 422) return new MakerError(`didn't accept these settings${msg ? `: ${msg}` : ""}`, 422, false);
  if (status === 429) return new MakerError("is rate-limiting this account. Try again in a minute", 429, true);
  return new MakerError(msg || `answered ${status}${text ? `: ${text.slice(0, 160)}` : ""}`, 502, status >= 500);
}
async function falSubmit(req: GenRequest): Promise<string> {
  const built = buildInput(req);
  const r = await fal(`${falBase()}/${built.endpoint}`, built.input);
  if (!r.ok) throw falExplain(r.status, r.json, r.text);
  const rid = r.json?.request_id;
  if (typeof rid !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(rid)) throw new MakerError("didn't return a request id", 502, true);
  const app = built.endpoint.split("/").slice(0, 2).join("/");
  falJobs.set(rid, {
    statusUrl: falOwnUrl(r.json.status_url) ? r.json.status_url : `${falBase()}/${app}/requests/${rid}/status`,
    responseUrl: falOwnUrl(r.json.response_url) ? r.json.response_url : `${falBase()}/${app}/requests/${rid}`,
  });
  if (falJobs.size > 3000) for (const k of [...falJobs.keys()].slice(0, 500)) falJobs.delete(k);
  return rid;
}
async function falStatus(model: NonNullable<ReturnType<typeof modelById>>, mode: "text" | "image", rid: string): Promise<JobState> {
  if (!falOn()) throw new AiVideoError("fal.ai isn't set up on this server any more (FAL_KEY is missing).", 503);
  const app = ((mode === "image" ? model.i2v : model.t2v) ?? "").split("/").slice(0, 2).join("/");
  const job = falJobs.get(rid) ?? { statusUrl: `${falBase()}/${app}/requests/${rid}/status`, responseUrl: `${falBase()}/${app}/requests/${rid}` };
  const s = await fal(job.statusUrl).catch((e: MakerError) => {
    throw new AiVideoError(`Couldn't reach fal.ai (${e.message}).`, 502);
  });
  if (!s.ok) return s.status === 404 ? { state: "failed", error: "fal.ai no longer has this request." } : { state: "failed", error: `fal.ai ${falExplain(s.status, s.json, s.text).message}.` };
  const st = String(s.json?.status ?? "");
  if (st === "IN_QUEUE") return { state: "queued", ...(Number.isFinite(s.json?.queue_position) && { position: s.json.queue_position }) };
  if (st === "IN_PROGRESS") return { state: "running" };
  if (st !== "COMPLETED") return { state: "failed", error: `fal.ai reported "${st || "nothing"}".` };
  const r = await fal(job.responseUrl).catch((e) => ({ ok: false, status: 0, json: null, text: String(e?.message ?? e) }));
  if (!r.ok) return { state: "failed", error: `fal.ai ${falExplain(r.status, r.json, r.text).message}.` };
  const v = r.json?.video ?? r.json?.videos?.[0];
  const url = typeof v === "string" ? v : v?.url;
  const fromFal = typeof url === "string" && url.startsWith(`${new URL(falBase()).origin}/`); // (a self-hosted or test queue)
  if (typeof url !== "string" || !(/^https:\/\/[^\s]+$/.test(url) || fromFal)) return { state: "failed", error: "The model finished without a video (it may have been blocked by its safety filter). Try rewording the prompt." };
  rememberVideoUrls([{ kind: "video", src: url } as never]);
  return { state: "done", video: { url, ...(Number.isFinite(v?.width) && { width: v.width }), ...(Number.isFinite(v?.height) && { height: v.height }) } };
}

// ---------------------------------------------------------------- images some makers need as links
const inputs = new Map<string, { buf: Buffer; type: string; at: number }>();
const INPUT_TTL = 2 * 3600_000;
function hostImage(dataUrl: string, origin: string): string {
  const m = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/.exec(dataUrl);
  if (!m) throw new MakerError("needs an image", 422);
  if (!/^https:\/\//.test(origin) && !process.env.AIV_ALLOW_HTTP_INPUTS) throw new MakerError("needs this server's public https address to read your image (set APP_URL)", 422, true);
  const now = Date.now();
  for (const [k, v] of inputs) if (now - v.at > INPUT_TTL) inputs.delete(k);
  const token = randomBytes(18).toString("base64url");
  inputs.set(token, { buf: Buffer.from(m[2], "base64"), type: m[1], at: now });
  return `${origin}/api/aivideo/input/${token}.${m[1].split("/")[1].replace("jpeg", "jpg")}`;
}
/** GET /api/aivideo/input/:token — public on purpose (the maker's servers fetch it), unguessable, short-lived. */
export function serveInput(req: Request, res: Response) {
  const token = String(req.params.token ?? "").replace(/\.(png|jpe?g|webp)$/, "");
  const hit = inputs.get(token);
  if (!hit || Date.now() - hit.at > INPUT_TTL) return void res.status(404).send("Gone.");
  res.setHeader("Content-Type", hit.type);
  res.setHeader("Cache-Control", "private, max-age=600");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(hit.buf);
}

// ---------------------------------------------------------------- generate
const routeName = (r: Route) => PROVIDER_NAMES[r];
/** Queue a generation on the first route that takes it; returns the job id the studio polls with. */
export async function generate(req: GenRequest, who: string, origin = ""): Promise<{ id: string; model: string; route: Route; via: string; notes?: string[] }> {
  let n: Normal;
  try {
    n = normalize(req);
  } catch (e: any) {
    throw new AiVideoError(e?.message ?? "That request can't be run.");
  }
  const routes = routesFor(n.model.id, n.mode);
  if (!routes.length) {
    if (!aiVideoConfigured()) throw new AiVideoError("AI video isn't set up on this server yet: add a video maker's API key (or FAL_KEY) in the server's environment.", 503);
    const d = n.model.direct;
    const offNow = [d?.provider, "fal"].filter((r) => r && isOff(r as Route)).map((r) => PROVIDER_NAMES[r as Route]);
    if (offNow.length) throw new AiVideoError(`${n.model.name} isn't available: ${offNow.join(" and ")} ${offNow.length > 1 ? "are" : "is"} switched off.`, 503);
    throw new AiVideoError(`${n.model.name} isn't connected: add ${d ? MAKERS[d.provider].keyName : ""}${d && onFal(n.model, n.mode) ? " or " : ""}${onFal(n.model, n.mode) ? "FAL_KEY" : ""} on the server.`, 503);
  }
  if (!take(who)) throw new AiVideoError(`You've made today's ${aiVideoDailyLimit()} AI videos. The count resets at midnight UTC.`, 429);
  const notes: string[] = [];
  for (const [i, route] of routes.entries()) {
    try {
      const rid = route === "fal" ? await falSubmit(req) : await MAKERS[route].submit(n, n.model.direct!, { publicImage: async (u) => hostImage(u, origin) });
      return { id: makeId(n, route, rid), model: n.model.name, route, via: routeName(route), ...(notes.length && { notes }) };
    } catch (e) {
      const err = e instanceof MakerError ? e : new MakerError(String((e as Error)?.message ?? e), 502, true);
      notes.push(`${routeName(route)} ${err.message}`);
      if (err.retry && i < routes.length - 1) continue;
      giveBack(who); // a request that never queued doesn't count
      throw new AiVideoError(notes.length > 1 ? `${notes.join(". Then ")}.` : `${routeName(route)} ${err.message}.`, err.status);
    }
  }
  throw new AiVideoError("No route took this request.", 502); // unreachable
}

// ---------------------------------------------------------------- status
export type JobState = { state: "queued" | "running" | "done" | "failed"; position?: number; progress?: number; video?: { url: string; width?: number; height?: number }; error?: string };
export const fileUrl = (id: string) => `/api/aivideo/file?id=${encodeURIComponent(id)}`;

/** Where a job is; when it's done, where its video plays from. */
export async function jobStatus(id: string): Promise<JobState> {
  const j = parseId(id);
  if (j.route === "fal") {
    const s = await falStatus(j.model, j.mode, j.rid);
    if (s.state !== "done" || !s.video) return s;
    // fal.ai's link is kept for streaming and saving; the studio plays it from this server
    sources.set(id, { src: { url: s.video.url }, at: Date.now() });
    void archive(id);
    return { ...s, video: { ...s.video, url: fileUrl(id) } };
  }
  const maker = MAKERS[j.route];
  if (!maker.configured()) throw new AiVideoError(`${routeName(j.route)} isn't connected on this server any more.`, 503);
  try {
    const p = await maker.poll(j.rid);
    if (p.state === "done") {
      void archive(id);
      return { state: "done", video: { url: fileUrl(id) } };
    }
    return p;
  } catch (e) {
    if (e instanceof MakerError && !e.retry) return { state: "failed", error: `${routeName(j.route)} ${e.message}.` };
    throw new AiVideoError(`Couldn't check with ${routeName(j.route)} (${(e as Error).message}).`, 502);
  }
}

// ---------------------------------------------------------------- files: finished clips from the makers, same-origin
const sources = new Map<string, { src: Source; at: number }>();
const SOURCE_TTL = 20 * 60_000;
async function sourceFor(id: string, fresh = false): Promise<{ src: Source; trusted: string }> {
  const j = parseId(id);
  if (j.route === "fal") {
    const hit = sources.get(id);
    if (hit && !fresh && Date.now() - hit.at < SOURCE_TTL) return { src: hit.src, trusted: falBase() };
    const s = await falStatus(j.model, j.mode, j.rid);
    if (s.state !== "done" || !s.video) throw new AiVideoError(s.error ?? "This clip isn't finished.", s.state === "failed" ? 410 : 409);
    const src = { url: s.video.url };
    sources.set(id, { src, at: Date.now() });
    return { src, trusted: falBase() };
  }
  const maker = MAKERS[j.route];
  if (!maker.configured()) throw new AiVideoError(`${routeName(j.route)} isn't connected on this server any more.`, 503);
  const hit = sources.get(id);
  if (hit && !fresh && Date.now() - hit.at < SOURCE_TTL) return { src: hit.src, trusted: maker.base() };
  let src: Source;
  try {
    src = await maker.source(j.rid);
  } catch (e) {
    throw new AiVideoError(`${routeName(j.route)} ${(e as Error).message}.`, e instanceof MakerError ? e.status : 502);
  }
  sources.set(id, { src, at: Date.now() });
  if (sources.size > 2000) for (const k of [...sources.keys()].slice(0, 400)) sources.delete(k);
  return { src, trusted: maker.base() };
}
/** Fetch a clip from where its maker keeps it. Keys only go to the maker's own API host; other links pass the SSRF guard. */
async function openSource(src: { url: string; headers?: Record<string, string> }, trusted: string, range?: string) {
  const headers = { "User-Agent": "Mozilla/5.0 (compatible; Rookker/0.1)", ...src.headers, ...(range && { Range: range }) };
  let sameHost = false;
  try {
    sameHost = new URL(src.url).origin === new URL(trusted).origin;
  } catch {}
  if (src.headers && !sameHost) throw new AiVideoError("Refusing to send a key to another host.", 502);
  return sameHost ? fetch(src.url, { headers, signal: AbortSignal.timeout(300_000) }) : (await safeFetch(src.url, { headers, timeoutMs: 300_000 })).res;
}

// ---------------------------------------------------------------- saving finished clips to R2
const MAX_SAVE_BYTES = 2 * 1024 ** 3;
const saving = new Map<string, Promise<boolean>>();
const saveFailedAt = new Map<string, number>();
/** Copy a finished clip into storage (once; quietly retried later if it fails). */
export function archive(id: string): Promise<boolean> {
  if (!storageOn()) return Promise.resolve(false);
  const running = saving.get(id);
  if (running) return running;
  if (Date.now() - (saveFailedAt.get(id) ?? 0) < 5 * 60_000) return Promise.resolve(false);
  const job = (async () => {
    const key = clipKey(id);
    if ((await stored(key)) !== null) return true;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { src, trusted } = await sourceFor(id, attempt > 0);
      if ("file" in src) {
        await saveClip(key, createReadStream(src.file), "video/mp4", statSync(src.file).size);
        return true;
      }
      const r = await openSource(src, trusted);
      if ((r.status === 403 || r.status === 404 || r.status === 410) && attempt === 0) {
        await r.body?.cancel().catch(() => {});
        continue;
      }
      const type = (r.headers.get("content-type") || "video/mp4").toLowerCase();
      const len = Number(r.headers.get("content-length")) || undefined;
      if (r.status !== 200 || !r.body || !(/^video\//.test(type) || /octet-stream/.test(type)) || (len ?? 0) > MAX_SAVE_BYTES) {
        await r.body?.cancel().catch(() => {});
        throw new Error(`the clip couldn't be fetched (${r.status} ${type})`);
      }
      await saveClip(key, Readable.fromWeb(r.body as any), /^video\//.test(type) ? type : "video/mp4", len);
      return true;
    }
    throw new Error("the clip's link had expired");
  })()
    .catch((e) => {
      saveFailedAt.set(id, Date.now());
      console.error(`Couldn't save clip ${id} to storage: ${e?.message ?? e}`);
      return false;
    })
    .finally(() => saving.delete(id));
  saving.set(id, job);
  return job;
}

/** GET /api/aivideo/file?id= — the finished clip, with Range support so it can be scrubbed and exported. */
export async function serveFile(req: Request, res: Response) {
  const id = String(req.query.id ?? "");
  const range = typeof req.headers.range === "string" && /^bytes=\d*-\d*$/.test(req.headers.range) ? req.headers.range : undefined;
  try {
    parseId(id);
    // from storage when it's there: it outlives the makers' links
    if (storageOn()) {
      const key = clipKey(id);
      const size = await stored(key).catch(() => null);
      if (size !== null) {
        try {
          const c = await readClip(key, range);
          res.status(c.status);
          res.setHeader("Content-Type", c.type);
          if (c.length !== undefined) res.setHeader("Content-Length", String(c.length));
          if (c.range) res.setHeader("Content-Range", c.range);
          res.setHeader("Accept-Ranges", "bytes");
          res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
          res.setHeader("X-Content-Type-Options", "nosniff");
          res.on("close", () => c.body.destroy());
          c.body.on("error", () => res.destroy());
          return void c.body.pipe(res);
        } catch (e: any) {
          if (e?.name === "InvalidRange" || e?.$metadata?.httpStatusCode === 416) return void res.status(416).setHeader("Content-Range", `bytes */${size}`).end();
          console.error(`Couldn't read clip ${id} from storage: ${e?.message ?? e}`); // fall through to the maker's copy
        }
      } else void archive(id);
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const { src, trusted } = await sourceFor(id, attempt > 0);
      if ("file" in src) {
        res.setHeader("Cache-Control", "private, max-age=86400");
        return void res.sendFile(src.file, { headers: { "Content-Type": "video/mp4", "X-Content-Type-Options": "nosniff" } }, (err) => {
          if (err && !res.headersSent) res.status(404).send("This clip is no longer on the server.");
        });
      }
      const r = await openSource(src, trusted, range);
      if ((r.status === 403 || r.status === 404 || r.status === 410) && attempt === 0) {
        await r.body?.cancel().catch(() => {});
        continue; // the link expired: ask the maker again
      }
      let type = (r.headers.get("content-type") || "").toLowerCase();
      if (!type || type.startsWith("application/octet-stream") || type.startsWith("binary/octet-stream")) type = "video/mp4";
      if (!(r.status === 200 || r.status === 206) || !/^video\//.test(type) || !r.body) {
        await r.body?.cancel().catch(() => {});
        return void res.status(r.status === 404 || r.status === 410 ? 410 : 502).send(`The clip couldn't be fetched (${r.status}).`);
      }
      res.status(r.status);
      res.setHeader("Content-Type", type);
      for (const h of ["content-length", "content-range", "accept-ranges", "last-modified", "etag"]) {
        const v = r.headers.get(h);
        if (v) res.setHeader(h, v);
      }
      if (!r.headers.get("accept-ranges")) res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.setHeader("X-Content-Type-Options", "nosniff");
      const body = Readable.fromWeb(r.body as any);
      res.on("close", () => body.destroy());
      body.on("error", () => res.destroy());
      return void body.pipe(res);
    }
    res.status(410).send("This clip is no longer available.");
  } catch (e: any) {
    if (!res.headersSent) res.status(e instanceof AiVideoError ? e.status : 502).send(e?.message ?? String(e));
  }
}

/** For the workspace: which route each model would take right now. */
export function aiVideoRoutes(): Record<string, { route: Route; via: string; modes: GenMode[] } | null> {
  return Object.fromEntries(VIDEO_MODELS.map((m) => {
    const r = routesFor(m.id)[0];
    const modes = (["text", "image"] as GenMode[]).filter((md) => routesFor(m.id, md).length > 0);
    return [m.id, r ? { route: r, via: routeName(r), modes } : null];
  }));
}
