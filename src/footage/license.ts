// Licensing stock footage: while you edit, Freepik clips are free watermarked previews. Licensing
// downloads the real file for each clip the cut actually uses (Freepik counts these: 100 a day on
// Premium plans), keeps it in this browser like an uploaded clip, and swaps it into the scenes.
import type { Asset, Project } from "../types";
import { getState, updateProject, addAssets } from "../store";
import { ASPECT_SIZE } from "../types";

/** Refs a scene draws from. */
const refsOf = (p: Project) => new Set(p.scenes.flatMap((s) => [s.image, ...(s.images ?? []), ...(s.backdrop ?? [])]).filter(Boolean) as string[]);

/** Watermarked previews the cut uses, each once. */
export function watermarkedInUse(p: Project, assets: Asset[]): Asset[] {
  const refs = refsOf(p);
  return assets.filter((a) => a.watermarked && a.sourceId && (refs.has(a.id) || refs.has(a.id.replace(/^asset:/, ""))));
}

export interface LicenseResult {
  licensed: number;
  failed: string[];
  /** downloads Freepik has counted today on this server */
  today?: number;
}

/** License every watermarked clip in the cut; one undo step swaps them all in. */
export async function licenseClips(onStep?: (label: string) => void): Promise<LicenseResult> {
  const { project, assets } = getState();
  const todo = watermarkedInUse(project, assets);
  const [W, H] = ASPECT_SIZE[project.aspect];
  const maxEdge = Math.max(W, H) > 1920 ? 3840 : 1920;
  const swap = new Map<string, string>();
  const failed: string[] = [];
  let today: number | undefined;
  let licensedN = 0;
  for (const [k, a] of todo.entries()) {
    onStep?.(`Licensing clip ${k + 1} of ${todo.length}`);
    try {
      const r = await fetch("/api/stock/license", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: a.source, id: a.sourceId, maxEdge }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.url) {
        failed.push(`${a.title.slice(0, 40)}: ${j.error ?? `error ${r.status}`}`);
        if (r.status === 429) break; // the day's downloads are used up
        continue;
      }
      today = j.today;
      const file = await fetch(`/api/video?u=${encodeURIComponent(j.url)}`);
      if (!file.ok) throw new Error(`download failed (${file.status})`);
      const blob = await file.blob();
      const licensed: Asset = {
        ...a,
        id: `asset:fpl_${a.sourceId}`,
        src: URL.createObjectURL(blob),
        watermarked: undefined,
        license: `${a.license ?? "Freepik"} · licensed`,
        ...(j.w && j.h && { w: j.w, h: j.h }),
      };
      addAssets([licensed]);
      licensedN++;
      swap.set(a.id, licensed.id);
      swap.set(a.id.replace(/^asset:/, ""), licensed.id);
    } catch (e: any) {
      failed.push(`${a.title.slice(0, 40)}: ${e?.message ?? e}`);
    }
  }
  if (swap.size) {
    const to = (r?: string) => (r && swap.get(r)) || r;
    updateProject((p) => ({ ...p, scenes: p.scenes.map((s) => ({ ...s, image: to(s.image), ...(s.images && { images: s.images.map((x) => to(x)!) }), ...(s.backdrop && { backdrop: s.backdrop.map((x) => to(x)!) }) })) }));
  }
  return { licensed: licensedN, failed, today };
}

/** A clip already licensed earlier is used instead of its watermarked preview. */
export function preferLicensed(a: Asset, assets: Asset[]): Asset {
  if (!a.watermarked || !a.sourceId) return a;
  return assets.find((x) => x.id === `asset:fpl_${a.sourceId}`) ?? a;
}
