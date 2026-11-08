// The audio mix, as plain numbers, shared by the live preview and every export so they always
// sound the same: music volume with fades and a dip under the voice-over, and the voice level.
import type { AudioTrack, MusicTrack, Project } from "../types";
import { speechRegions } from "./analyze";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const DEFAULT_DUCK = 0.6;

/** Clean music settings from any source (old saves had only name, url and volume). */
export function cleanMusic(m: Partial<MusicTrack> & { name?: unknown; url?: unknown }, url: string): MusicTrack {
  const num = (v: unknown, a: number, b: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? clamp(v, a, b) : d);
  return {
    name: String(m.name ?? "music").slice(0, 120),
    url,
    volume: num(m.volume, 0, 1, 0.25),
    ...(typeof m.duration === "number" && m.duration > 0 && { duration: m.duration }),
    start: num(m.start, 0, 3600, 0),
    fadeIn: num(m.fadeIn, 0, 10, 0.5),
    fadeOut: num(m.fadeOut, 0, 10, 1.5),
    duck: num(m.duck, 0, 1, DEFAULT_DUCK),
    ...cleanBeats(m),
    ...(m.insight && typeof m.insight === "object" && Array.isArray((m.insight as any).sections) && { insight: m.insight }),
  };
}

/** Keep a stored beat map only if it looks sane (sorted finite numbers, a believable tempo). */
function cleanBeats(m: Partial<MusicTrack>): Partial<MusicTrack> {
  const times = (v: unknown) => (Array.isArray(v) && v.length <= 4000 && v.every((x, i) => typeof x === "number" && Number.isFinite(x) && x >= 0 && (i === 0 || x >= v[i - 1])) ? (v as number[]) : undefined);
  const beats = times(m.beats);
  if (!beats?.length || typeof m.bpm !== "number" || !(m.bpm >= 40 && m.bpm <= 240)) return {};
  const energy = Array.isArray(m.energy) && m.energy.length === beats.length && m.energy.every((x) => typeof x === "number" && Number.isFinite(x)) ? m.energy.map((x) => clamp(x, 0, 1)) : undefined;
  return {
    bpm: m.bpm,
    beats,
    ...(times(m.downbeats) && { downbeats: times(m.downbeats) }),
    ...(energy && { energy }),
    ...(typeof m.drop === "number" && Number.isFinite(m.drop) && { drop: m.drop }),
  };
}

export const voiceGain = (a?: AudioTrack) => clamp(a?.volume ?? 1, 0, 1.5);

/** How much of the dip applies at time t: eases in and out over ~0.15 s around each spoken phrase. */
function duckAmount(regions: { s: number; e: number }[], t: number) {
  const EASE = 0.15;
  let best = 0;
  for (const r of regions) {
    if (t < r.s - EASE) break;
    if (t > r.e + EASE * 2) continue;
    const into = clamp((t - (r.s - EASE)) / EASE, 0, 1);
    const out = clamp((r.e + EASE * 2 - t) / (EASE * 2), 0, 1);
    best = Math.max(best, Math.min(into, out));
  }
  return best;
}

/** Music gain at time t of a cut lasting `total` seconds. */
export function musicGain(p: Pick<Project, "music" | "audio">, t: number, total: number, regions = p.audio ? speechRegions(p.audio) : []): number {
  const m = p.music;
  if (!m) return 0;
  let g = m.volume;
  const fi = m.fadeIn ?? 0.5, fo = m.fadeOut ?? 1.5;
  if (fi > 0) g *= clamp(t / fi, 0, 1);
  if (fo > 0 && total > 0) g *= clamp((total - t) / fo, 0, 1);
  if (regions.length) g *= 1 - (m.duck ?? DEFAULT_DUCK) * duckAmount(regions, t);
  return clamp(g, 0, 1);
}

/** Where in the music file to be at cut time t (the track loops). */
export function musicTime(m: MusicTrack, t: number, fileDuration = m.duration ?? 0) {
  const at = (m.start ?? 0) + t;
  return fileDuration > 0 ? at % fileDuration : at;
}

/** Gain keyframes for an export (every 40 ms), identical to what the preview plays. */
export function musicEnvelope(p: Pick<Project, "music" | "audio">, total: number, step = 0.04): { t: number; v: number }[] {
  const regions = p.audio ? speechRegions(p.audio) : [];
  const out: { t: number; v: number }[] = [];
  for (let t = 0; t <= total + 1e-9; t += step) out.push({ t: +t.toFixed(3), v: musicGain(p, t, total, regions) });
  return out;
}
