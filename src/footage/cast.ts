// Casting footage in the studio: search the stock libraries for each shot (a few at a time), pick
// the best unused clip, fall back to photos, and ask Claude to sharpen the shot list when it can.
import type { Aspect, Asset } from "../types";
import { castShot, orientationFor, timeClip, type ProdLook, type Shot, type TextMode, LOOKS_PROD } from "./plan";

const cache = new Map<string, Promise<Asset[]>>();

async function search(q: string, kind: "video" | "image", aspect: Aspect): Promise<Asset[]> {
  const o = orientationFor(aspect);
  const key = `${kind}|${o}|${q}`;
  if (!cache.has(key)) {
    const url = `/api/search?q=${encodeURIComponent(q)}&count=${kind === "video" ? 14 : 10}${kind === "video" ? `&type=video&orientation=${o}` : ""}`;
    cache.set(
      key,
      fetch(url)
        .then((r) => (r.ok ? r.json() : { assets: [] }))
        .then((r) => (Array.isArray(r.assets) ? (r.assets as Asset[]) : []))
        .catch(() => {
          cache.delete(key);
          return [];
        }),
    );
  }
  return cache.get(key)!;
}

/** Ask Claude to improve the local plan. Returns the plan unchanged (and why) if it can't. */
export async function refinePlan(shots: Shot[], brief: string, aspect: Aspect, look: ProdLook, text: TextMode): Promise<{ shots: Shot[]; by: "claude" | "local"; note?: string }> {
  try {
    const r = await fetch("/api/shots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shots: shots.map((s) => ({ line: s.line, type: s.type, queries: s.queries })), brief, aspect, look, text }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !Array.isArray(j.shots) || j.shots.length !== shots.length) return { shots, by: "local", note: j.error };
    return {
      by: "claude",
      shots: shots.map((s, i) => ({ ...s, type: j.shots[i].type ?? s.type, queries: j.shots[i].queries?.length ? j.shots[i].queries : s.queries, overlay: text === "keywords" ? j.shots[i].overlay ?? s.overlay : s.overlay })),
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

/** Find footage for one shot: each query in turn until there are enough good clips; photos if no video. */
export async function castOne(shot: Shot, aspect: Aspect, look: ProdLook, used: Set<string>): Promise<Cast> {
  const speed = LOOKS_PROD[look].speed;
  const seen = new Map<string, Asset>();
  for (const q of shot.queries) {
    for (const a of await search(q, "video", aspect)) if (a.src && !seen.has(a.src)) seen.set(a.src, { ...a, title: a.title || q });
    const good = [...seen.values()].filter((a) => !used.has(a.src) && orientationFor(aspect) === orientationOf(a)).length;
    if (good >= 4) break;
  }
  let pool = [...seen.values()];
  if (!pool.length) {
    // No footage for this idea: photos, which the edit moves with a slow push.
    for (const q of shot.queries.slice(0, 2)) for (const a of await search(q, "image", aspect)) if (a.src && !seen.has(a.src)) seen.set(a.src, a);
    pool = [...seen.values()];
  }
  const byId = new Map(pool.map((a) => [a.src, a]));
  const r = castShot(
    pool.map((a) => ({ id: a.src, title: a.title, w: a.w, h: a.h, duration: a.duration, source: a.source })),
    shot,
    aspect,
    speed,
    used,
  );
  const pick = r.clip ? byId.get(r.clip.id) : undefined;
  if (pick) used.add(pick.src);
  return { shot, pick, alts: r.alts.map((c) => byId.get(c.id)!).filter(Boolean) };
}

const orientationOf = (a: Asset) => (!a.w || !a.h ? "landscape" : a.h > a.w * 1.1 ? "portrait" : a.w > a.h * 1.1 ? "landscape" : "square");

/** Cast every shot, three searches at a time, reporting each as it lands. */
export async function castAll(shots: Shot[], aspect: Aspect, look: ProdLook, onCast: (i: number, c: Cast) => void, signal?: AbortSignal, preUsed: string[] = []): Promise<Cast[]> {
  const used = new Set(preUsed);
  const out: Cast[] = new Array(shots.length);
  let next = 0;
  const worker = async () => {
    while (next < shots.length && !signal?.aborted) {
      const i = next++;
      out[i] = await castOne(shots[i], aspect, look, used);
      if (!signal?.aborted) onCast(i, out[i]);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return out;
}

/** The timing for a cast clip within its shot. */
export const timingFor = (a: Asset | undefined, shot: Shot, look: ProdLook) => (a?.kind === "video" ? timeClip(a.duration, shot.e - shot.s, LOOKS_PROD[look].speed) : {});
