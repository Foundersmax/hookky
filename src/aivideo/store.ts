// The AI video workspace's generations: sent to the server, polled until they finish, and kept in
// this browser so a reload (or a walk to another page) doesn't lose a clip that's still rendering.
import { useSyncExternalStore } from "react";
import { buildInput, normalize, modelById, type GenRequest } from "./models";

export interface Generation {
  /** the server's job id; "local-…" until it's queued */
  id: string;
  model: string;
  modelName: string;
  mode: "text" | "image";
  prompt: string;
  settings: Pick<GenRequest, "aspect" | "duration" | "resolution" | "audio" | "negative" | "seed">;
  state: "sending" | "queued" | "running" | "done" | "failed";
  position?: number;
  url?: string;
  w?: number;
  h?: number;
  error?: string;
  at: number;
  doneAt?: number;
  /** the connection it ran on ("Kling", "fal.ai"…) and why, if it had to fall back */
  via?: string;
  note?: string;
  /** credits charged (given back if it fails) */
  credits?: number;
}
export interface Usage {
  configured: boolean;
  /** today's video credits: the allowance (null: no limit) and what's used */
  limit: number | null;
  used: number;
  /** price list (dollars per second) the server charges by */
  prices?: Record<string, number>;
  /** the connection each model would use now (null: not connected) */
  routes?: Record<string, { route: string; via: string; modes: ("text" | "image")[] } | null>;
  /** finished clips are copied to the server's storage (Cloudflare R2) */
  storage?: boolean;
}

const KEY = "rookker.aivideo.v1";
const MAX = 60;
const GIVE_UP_MS = 25 * 60_000;
let list: Generation[] = load();
let usage: Usage | null = null;
const subs = new Set<() => void>();
let snap: { list: Generation[]; usage: Usage | null } = { list, usage };

function load(): Generation[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((g) => g && typeof g.id === "string" && typeof g.prompt === "string" && typeof g.model === "string")
      .map((g) => (g.state === "sending" ? { ...g, state: "failed", error: "This one was interrupted before it was sent." } : g))
      .slice(0, MAX);
  } catch {
    return [];
  }
}
function emit() {
  snap = { list, usage };
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {}
  subs.forEach((f) => f());
}
const patch = (id: string, p: Partial<Generation>) => {
  list = list.map((g) => (g.id === id ? { ...g, ...p } : g));
  emit();
};
export const useGenerations = () =>
  useSyncExternalStore(
    (f) => (subs.add(f), ensurePolling(), () => subs.delete(f)),
    () => snap,
  );
export const pending = (g: Generation) => g.state === "sending" || g.state === "queued" || g.state === "running";

async function json(url: string, init?: RequestInit) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(body?.error ?? (r.status === 401 ? "Sign in to generate videos." : `The server answered ${r.status}.`));
  return body;
}

export async function refreshUsage() {
  try {
    usage = await json("/api/aivideo/usage");
  } catch {
    usage = usage ?? { configured: false, limit: 0, used: 0 };
  }
  emit();
}

/** What the model will actually use (each snaps to its nearest length, shape and quality). */
function effective(req: GenRequest, onFal = false): Generation["settings"] {
  try {
    const n = normalize(req);
    // fal.ai's endpoint may take less than the maker's own API (Seedance 2.x tops out at 720p there)
    const res = onFal ? (buildInput(req).input.resolution as string | undefined) : n.resolution;
    return { aspect: n.aspect, duration: n.duration, resolution: res, audio: req.audio, negative: req.negative, seed: req.seed };
  } catch {
    return { aspect: req.aspect, duration: req.duration, resolution: req.resolution, audio: req.audio, negative: req.negative, seed: req.seed };
  }
}

/** Send one request to one model. The card appears at once and fills in as the job moves. */
export async function startGeneration(req: GenRequest) {
  const m = modelById(req.model);
  const local = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const g: Generation = {
    id: local,
    model: req.model,
    modelName: m?.name ?? req.model,
    mode: req.mode,
    prompt: req.prompt.trim(),
    settings: effective(req),
    state: "sending",
    at: Date.now(),
  };
  list = [g, ...list].slice(0, MAX);
  emit();
  try {
    const out = await json("/api/aivideo/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) });
    if (usage && Number.isFinite(out.used)) usage = { ...usage, used: out.used, limit: out.limit === undefined ? usage.limit : out.limit };
    patch(local, { id: out.id, state: "queued", via: out.via, credits: out.credits, ...(out.route === "fal" && { settings: effective(req, true) }), ...(out.notes?.length && { note: `${out.notes.join(". ")}, so it ran on ${out.via}.` }) });
    ensurePolling();
  } catch (e) {
    patch(local, { state: "failed", error: (e as Error)?.message ?? "Couldn't send this to the server." });
  }
}

export function removeGeneration(id: string) {
  list = list.filter((g) => g.id !== id);
  emit();
}
export function clearFinished() {
  list = list.filter(pending);
  emit();
}

// ---------------------------------------------------------------- polling
let timer: ReturnType<typeof setTimeout> | undefined;
let polling = false;
function ensurePolling() {
  if (timer || polling || !list.some((g) => g.state === "queued" || g.state === "running")) return;
  timer = setTimeout(poll, 3500);
}
async function poll() {
  timer = undefined;
  polling = true;
  const waiting = list.filter((g) => g.state === "queued" || g.state === "running");
  await Promise.all(
    waiting.map(async (g) => {
      if (Date.now() - g.at > GIVE_UP_MS) return patch(g.id, { state: "failed", error: "This took too long and was given up on." });
      try {
        const s = await json(`/api/aivideo/status?id=${encodeURIComponent(g.id)}`);
        if (s.state === "done" && s.video?.url) patch(g.id, { state: "done", url: s.video.url, w: s.video.width, h: s.video.height, doneAt: Date.now(), position: undefined });
        else if (s.state === "failed") {
          patch(g.id, { state: "failed", error: s.error ?? "The model couldn't make this one." });
          void refreshUsage(); // its credits came back
        }
        else if (s.state !== g.state || s.position !== g.position) patch(g.id, { state: s.state, position: s.position });
      } catch (e) {
        // a network blip or a server restart: keep waiting, unless the server says the job is unknown
        if (/Unknown job/.test((e as Error)?.message ?? "")) patch(g.id, { state: "failed", error: "The server no longer knows this job." });
      }
    }),
  );
  polling = false;
  ensurePolling();
}

/** The clip through the studio's own origin (so it can be drawn, downloaded and captioned). */
export const playable = (url: string) => (url.startsWith("/") ? url : `/api/video?u=${encodeURIComponent(url)}`);
export async function fetchClip(g: Generation): Promise<File> {
  if (!g.url) throw new Error("This clip isn't ready.");
  const r = await fetch(playable(g.url), { signal: AbortSignal.timeout(180_000) });
  if (!r.ok) throw new Error(r.status === 404 || r.status === 410 ? "The model's host no longer has this clip." : `Couldn't fetch the clip (${r.status}).`);
  const blob = await r.blob();
  return new File([blob], `${fileName(g)}.mp4`, { type: blob.type || "video/mp4" });
}
export const fileName = (g: Generation) => `${g.model}-${g.prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "clip"}`;
