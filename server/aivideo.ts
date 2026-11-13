// AI video generation through fal.ai's queue: one key (FAL_KEY) reaches Seedance, Kling, MiniMax
// Hailuo, Veo, Sora, Wan, Luma, PixVerse, Vidu, LTX and Grok. A generation is submitted, then
// polled; the finished clip's URL is handed to the studio and allowed through the video proxy.
import { buildInput, modelById, type GenRequest } from "../src/aivideo/models";
import { rememberVideoUrls } from "./connectors";

const base = () => (process.env.FAL_QUEUE_URL || "https://queue.fal.run").replace(/\/+$/, "");
const key = () => process.env.FAL_KEY?.trim() || process.env.FAL_API_KEY?.trim() || "";
export const aiVideoConfigured = () => !!key();
/** Clips one person can generate a day (each one costs money on the fal account). */
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

// ---------------------------------------------------------------- jobs
type Job = { statusUrl: string; responseUrl: string; who: string; at: number };
const jobs = new Map<string, Job>();
const JOB_ID = /^([a-z0-9-]{2,40})\.(text|image)\.([A-Za-z0-9-]{8,64})$/;

/** Only fal's own queue URLs are ever fetched with the key. */
function ownUrl(u: unknown): u is string {
  if (typeof u !== "string") return false;
  try {
    const url = new URL(u), b = new URL(base());
    return url.protocol === b.protocol && (url.host === b.host || (b.host === "queue.fal.run" && /(^|\.)fal\.run$/.test(url.hostname)));
  } catch {
    return false;
  }
}
async function fal(url: string, init: { method?: string; body?: unknown } = {}) {
  const r = await fetch(url, {
    method: init.method ?? "GET",
    headers: { Authorization: `Key ${key()}`, Accept: "application/json", ...(init.body !== undefined && { "Content-Type": "application/json" }) },
    ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(45_000),
  });
  const text = await r.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { ok: r.ok, status: r.status, json, text };
}
/** fal's error bodies in a sentence a person can act on. */
function explain(status: number, json: any, text: string): string {
  const d = json?.detail;
  const msg = typeof d === "string" ? d : Array.isArray(d) ? d.map((x: any) => x?.msg ?? "").filter(Boolean).join("; ") : typeof json?.error === "string" ? json.error : typeof json?.message === "string" ? json.message : "";
  if (status === 401) return "fal.ai rejected the key. Check FAL_KEY on the server.";
  if (status === 403) return msg || "fal.ai refused the request: the account may be out of credit or locked.";
  if (status === 404) return "fal.ai doesn't have this model any more. Pick another.";
  if (status === 422) return `The model didn't accept these settings${msg ? `: ${msg}` : "."}`;
  if (status === 429) return "fal.ai is rate-limiting this account. Try again in a minute.";
  return msg || `fal.ai answered ${status}${text ? `: ${text.slice(0, 160)}` : ""}`;
}

export class AiVideoError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Queue a generation; returns the job id the studio polls with. */
export async function generate(req: GenRequest, who: string): Promise<{ id: string; model: string }> {
  if (!aiVideoConfigured()) throw new AiVideoError("AI video isn't set up on this server yet (FAL_KEY is missing).", 503);
  let built: ReturnType<typeof buildInput>;
  try {
    built = buildInput(req);
  } catch (e: any) {
    throw new AiVideoError(e?.message ?? "That request can't be run.");
  }
  if (!take(who)) throw new AiVideoError(`You've made today's ${aiVideoDailyLimit()} AI videos. The count resets at midnight UTC.`, 429);
  try {
    const r = await fal(`${base()}/${built.endpoint}`, { method: "POST", body: built.input });
    if (!r.ok) throw new AiVideoError(explain(r.status, r.json, r.text), r.status === 401 || r.status === 403 ? 503 : 502);
    const rid = r.json?.request_id;
    if (typeof rid !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(rid)) throw new AiVideoError("fal.ai didn't return a request id.", 502);
    const app = built.endpoint.split("/").slice(0, 2).join("/");
    const statusUrl = ownUrl(r.json.status_url) ? r.json.status_url : `${base()}/${app}/requests/${rid}/status`;
    const responseUrl = ownUrl(r.json.response_url) ? r.json.response_url : `${base()}/${app}/requests/${rid}`;
    const id = `${built.model.id}.${req.mode === "image" ? "image" : "text"}.${rid}`;
    jobs.set(id, { statusUrl, responseUrl, who, at: Date.now() });
    if (jobs.size > 3000) for (const k of [...jobs.keys()].slice(0, 500)) jobs.delete(k);
    return { id, model: built.model.name };
  } catch (e) {
    giveBack(who); // a request that never queued doesn't count
    if (e instanceof AiVideoError) throw e;
    throw new AiVideoError(`Couldn't reach fal.ai (${(e as Error)?.message ?? e}).`, 502);
  }
}

export type JobState = { state: "queued" | "running" | "done" | "failed"; position?: number; video?: { url: string; width?: number; height?: number }; error?: string };

/** Where a job is; when it's done, its video. */
export async function jobStatus(id: string): Promise<JobState> {
  if (!aiVideoConfigured()) throw new AiVideoError("AI video isn't set up on this server.", 503);
  const m = JOB_ID.exec(id);
  const model = m && modelById(m[1]);
  if (!m || !model) throw new AiVideoError("Unknown job.", 404);
  // after a restart the URLs are rebuilt from the id (fal keeps the request)
  const endpoint = m[2] === "image" ? model.i2v : model.t2v;
  const app = (endpoint ?? "").split("/").slice(0, 2).join("/");
  const job = jobs.get(id) ?? { statusUrl: `${base()}/${app}/requests/${m[3]}/status`, responseUrl: `${base()}/${app}/requests/${m[3]}`, who: "", at: 0 };
  let s;
  try {
    s = await fal(job.statusUrl);
  } catch (e) {
    throw new AiVideoError(`Couldn't reach fal.ai (${(e as Error)?.message ?? e}).`, 502);
  }
  if (!s.ok) return s.status === 404 ? { state: "failed", error: "fal.ai no longer has this request." } : { state: "failed", error: explain(s.status, s.json, s.text) };
  const st = String(s.json?.status ?? "");
  if (st === "IN_QUEUE") return { state: "queued", ...(Number.isFinite(s.json?.queue_position) && { position: s.json.queue_position }) };
  if (st === "IN_PROGRESS") return { state: "running" };
  if (st !== "COMPLETED") return { state: "failed", error: `fal.ai reported "${st || "nothing"}".` };
  const r = await fal(job.responseUrl).catch((e) => ({ ok: false, status: 0, json: null, text: String(e?.message ?? e) }));
  if (!r.ok) return { state: "failed", error: explain(r.status, r.json, r.text) };
  const v = r.json?.video ?? r.json?.videos?.[0];
  const url = typeof v === "string" ? v : v?.url;
  if (typeof url !== "string" || !/^https:\/\/[^\s]+$/.test(url)) return { state: "failed", error: "The model finished without a video (it may have been blocked by its safety filter). Try rewording the prompt." };
  rememberVideoUrls([{ kind: "video", src: url } as never]);
  return { state: "done", video: { url, ...(Number.isFinite(v?.width) && { width: v.width }), ...(Number.isFinite(v?.height) && { height: v.height }) } };
}
