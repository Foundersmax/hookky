// Casting footage in the studio: search the stock libraries for each shot (a few at a time), pick
// the best unused clip, fall back to photos, and ask Claude to sharpen the shot list when it can.
import type { Aspect, Asset } from "../types";
import { castShot, orientationFor, subjectMatch, timeClip, type ProdLook, type Shot, type TextMode, LOOKS_PROD } from "./plan";

const cache = new Map<string, Promise<Asset[]>>();

/** Which stock libraries to search (ids from the server's connector list); empty = the server's default order. */
export interface Sources {
  video?: string[];
  image?: string[];
}

export async function search(q: string, kind: "video" | "image", aspect: Aspect, min = 0, sources: string[] = [], count?: number): Promise<Asset[]> {
  const o = orientationFor(aspect);
  // Ask for clips long enough to hold the shot (rounded, so nearby shots share a search).
  const m = min > 0 ? Math.min(20, Math.ceil(min)) : 0;
  const n = count ?? (kind === "video" ? (sources.length > 1 ? 24 : 14) : 12);
  const key = `${kind}|${o}|${m}|${n}|${sources.join(",")}|${q}`;
  if (!cache.has(key)) {
    const url = `/api/search?q=${encodeURIComponent(q)}&count=${n}${sources.length ? `&sources=${sources.join(",")}` : ""}${kind === "video" ? `&type=video&orientation=${o}${m ? `&min=${m}` : ""}` : ""}`;
    cache.set(
      key,
      fetch(url)
        .then((r) => (r.ok ? r.json() : { assets: [] }))
        .then((r) => (Array.isArray(r.assets) ? (r.assets as Asset[]) : []).filter((a) => a?.src).map((a) => (a.id.startsWith("asset:") ? a : { ...a, id: `asset:${a.id}` })))
        .catch(() => {
          cache.delete(key);
          return [];
        }),
    );
  }
  return cache.get(key)!;
}

/** Ask Claude to improve the local plan. Returns the plan unchanged (and why) if it can't. */
export async function refinePlan(shots: Shot[], brief: string, aspect: Aspect, look: ProdLook, text: TextMode, film: { genre?: string; direction?: string; topic?: string } = {}): Promise<{ shots: Shot[]; by: "claude" | "local"; note?: string }> {
  try {
    const r = await fetch("/api/shots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shots: shots.map((s) => ({ line: s.line, type: s.type, queries: s.queries })), brief, aspect, look, text, ...film }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !Array.isArray(j.shots) || j.shots.length !== shots.length) return { shots, by: "local", note: j.error };
    return {
      by: "claude",
      shots: shots.map((s, i) => {
        const c = j.shots[i] ?? {};
        const must = Array.isArray(c.must) ? c.must.filter((m: unknown): m is string => typeof m === "string" && !!m.trim()).slice(0, 4) : [];
        return {
          ...s,
          type: c.type ?? s.type,
          queries: c.queries?.length ? c.queries : s.queries,
          overlay: text === "keywords" ? c.overlay ?? s.overlay : s.overlay,
          ...(typeof c.visual === "string" && c.visual && { visual: c.visual }),
          ...(must.length && { must }),
          // the person's own "photos only" stands; otherwise Claude says where a photo tells it better
          ...(s.media !== "photo" && (c.media === "photo" || c.media === "video" || c.media === "any") && { media: c.media }),
        };
      }),
    };
  } catch (e: any) {
    return { shots, by: "local", note: e?.message };
  }
}

export interface Cast {
  shot: Shot;
  /** the clip (or photo) asset chosen, and alternatives */
  pick?: Asset;
  alts: Asset[];
}

/** Claude, looking at the thumbnails, picks the clip that shows the line best (1-based; 0 = none fit). */
export type Picker = (shot: Shot, candidates: Asset[]) => Promise<number | undefined>;

export function visionPicker(brief: string, max = 40): Picker {
  let left = max;
  let off = false;
  return async (shot, cands) => {
    if (off || left <= 0 || cands.length < 2) return undefined;
    left--;
    try {
      const r = await fetch("/api/shots/pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ line: shot.line, shot: `${shot.type} shot · ${shot.queries[0] ?? ""}`, brief, candidates: cands.map((a) => ({ thumb: a.thumb ?? "", title: a.title })) }),
      });
      if (!r.ok) {
        off = r.status === 503; // Claude unavailable: stop asking for this run
        return undefined;
      }
      const j = await r.json();
      return typeof j.index === "number" ? j.index : undefined;
    } catch {
      return undefined;
    }
  };
}

/**
 * Find footage for one shot. Its first searches run together on every chosen library, more only if
 * those came back thin; photos join when the shot wants them, or when no clip shows its subject.
 * Every candidate is then scored on format, length and whether it shows what the line is about.
 */
export async function castOne(shot: Shot, aspect: Aspect, look: ProdLook, used: Set<string>, pick?: Picker, sources: Sources = {}): Promise<Cast> {
  const speed = LOOKS_PROD[look].speed;
  const need = (shot.e - shot.s) * speed;
  const want = orientationFor(aspect);
  const media = shot.media ?? "video";
  const seen = new Map<string, Asset & { rank: number; q: number }>();
  const add = (list: Asset[], q: number, fallbackTitle: string) => list.forEach((a, rank) => !seen.has(a.src) && seen.set(a.src, { ...a, title: a.title || fallbackTitle, rank, q }));
  const videos = async (from: number, to: number) => {
    const qs = shot.queries.slice(from, to);
    (await Promise.all(qs.map((q) => search(q, "video", aspect, need, sources.video)))).forEach((list, k) => add(list, from + k, qs[k]));
  };
  const photos = async (n: number) => {
    const qs = shot.queries.slice(0, n);
    (await Promise.all(qs.map((q) => search(q, "image", aspect, 0, sources.image)))).forEach((list, k) => add(list, k, qs[k]));
  };
  const shows = (a: Asset & { q: number }) => (subjectMatch(a.title, shot.must, shot.queries[a.q]) ?? 0.5) > 0;
  const good = () => [...seen.values()].filter((a) => a.kind === "video" && !used.has(a.src) && want === orientationOf(a) && shows(a)).length;

  if (media === "photo") await Promise.all([photos(3), videos(0, 1)]);
  else {
    await Promise.all([videos(0, 2), ...(media === "any" ? [photos(1)] : [])]);
    if (good() < 4 && shot.queries.length > 2) await videos(2, 5);
    // nothing on film shows it: a photograph of the real thing beats a clip of something else
    if (!good()) await photos(2);
  }
  const pool = [...seen.values()];
  const byId = new Map(pool.map((a) => [a.src, a]));
  const r = castShot(
    pool.map((a) => ({ id: a.src, title: a.title, w: a.w, h: a.h, duration: a.duration, source: a.source, kind: a.kind === "video" ? ("video" as const) : ("image" as const), rank: a.rank, q: a.q })),
    shot,
    aspect,
    speed,
    used,
  );
  const strip = (a: Asset & { rank?: number; q?: number }): Asset => {
    const { rank: _r, q: _q, ...rest } = a;
    return rest;
  };
  let ranked = [r.clip, ...r.alts].map((c) => (c ? byId.get(c.id) : undefined)).filter((a): a is Asset & { rank: number; q: number } => !!a && !used.has(a.src)).map(strip);
  // A second opinion from Claude's eyes on the top few, when it's available.
  if (pick && ranked.length >= 2) {
    const top = ranked.slice(0, 6);
    const k = await pick(shot, top);
    if (k && k >= 1 && k <= top.length) ranked = [top[k - 1], ...ranked.filter((a) => a !== top[k - 1])];
  }
  const chosen = ranked[0] ?? (r.clip && byId.get(r.clip.id) ? strip(byId.get(r.clip.id)!) : undefined);
  if (chosen) used.add(chosen.src);
  return { shot, pick: chosen, alts: ranked.filter((a) => a !== chosen).slice(0, 12) };
}

const orientationOf = (a: Asset) => (!a.w || !a.h ? "landscape" : a.h > a.w * 1.1 ? "portrait" : a.w > a.h * 1.1 ? "landscape" : "square");

/** Cast every shot, three searches at a time, reporting each as it lands. */
export async function castAll(shots: Shot[], aspect: Aspect, look: ProdLook, onCast: (i: number, c: Cast) => void, signal?: AbortSignal, preUsed: string[] = [], pick?: Picker, sources: Sources = {}): Promise<Cast[]> {
  const used = new Set(preUsed);
  const out: Cast[] = new Array(shots.length);
  let next = 0;
  const worker = async () => {
    while (next < shots.length && !signal?.aborted) {
      const i = next++;
      out[i] = await castOne(shots[i], aspect, look, used, pick, sources);
      if (!signal?.aborted) onCast(i, out[i]);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return out;
}

/** The timing for a cast clip within its shot. */
export const timingFor = (a: Asset | undefined, shot: Shot, look: ProdLook) => (a?.kind === "video" ? timeClip(a.duration, shot.e - shot.s, LOOKS_PROD[look].speed) : {});
