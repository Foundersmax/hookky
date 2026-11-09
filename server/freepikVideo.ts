// Freepik / Magnific stock video (https://docs.magnific.com/api-reference/videos/videos-api).
// Search is free and returns watermarked preview MP4s, which is what the studio casts and edits
// with. A clip is licensed (downloaded) only when the user commits to it: the API caps stock
// downloads at 100 a day on Premium plans, so we never spend one on a clip that isn't used.
import type { Asset } from "../src/types";
import { rememberVideoUrls, type Orientation } from "./connectors";

const env = (k: string) => process.env[k]?.trim() || "";
export const freepikKey = () => env("MAGNIFIC_API_KEY") || env("FREEPIK_API_KEY");

/** The API moved from api.freepik.com to api.magnific.com; both answer with the same key. */
const BASES = ["https://api.magnific.com", "https://api.freepik.com"];
let base = BASES[0];

async function call(path: string): Promise<any> {
  const key = freepikKey();
  if (!key) throw new Error("Freepik isn't connected (set FREEPIK_API_KEY).");
  let lastErr: Error | null = null;
  for (const b of [base, ...BASES.filter((x) => x !== base)]) {
    let res: Response;
    try {
      res = await fetch(b + path, {
        headers: { "x-magnific-api-key": key, "x-freepik-api-key": key, "Accept-Language": "en-US", Accept: "application/json", "User-Agent": "Rookker/1.0" },
        signal: AbortSignal.timeout(20000),
      });
    } catch (e: any) {
      lastErr = new Error(e?.name === "TimeoutError" ? "Freepik took too long to answer" : `couldn't reach ${new URL(b).host}`);
      continue;
    }
    if (res.status === 404 && /\/v1\/videos\?/.test(path)) return { data: [] }; // "no results found"
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error("Freepik rejected the API key."), { status: res.status });
    if (res.status === 429) throw Object.assign(new Error("Freepik's download or rate limit is reached for today."), { status: 429 });
    if (res.status === 400) throw Object.assign(new Error(`Freepik refused the request: ${(await res.text()).slice(0, 200)}`), { status: 400 });
    if (!res.ok) {
      lastErr = new Error(`Freepik responded ${res.status}`);
      continue;
    }
    base = b;
    return res.json();
  }
  throw lastErr ?? new Error("Freepik is unavailable");
}

// ---------------------------------------------------------------- search
const ORIENT: Record<Orientation, string> = { landscape: "horizontal", portrait: "vertical", square: "square" };
const SIZE: Record<string, number> = { "720p": 1280, "1080p": 1920, "2k": 2560, "4k": 3840 };

/** "00:00:28" or "00:25" → seconds. */
export function parseDuration(d: unknown): number | undefined {
  if (typeof d === "number") return d;
  if (typeof d !== "string") return undefined;
  const parts = d.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return undefined;
  return parts.reduce((a, n) => a * 60 + n, 0) || undefined;
}

/** Pixel size from the quality and aspect ratio the search returns. */
export function sizeOf(quality: unknown, aspect: unknown): { w?: number; h?: number } {
  const long = SIZE[String(quality)] ?? 1920;
  const [a, b] = String(aspect ?? "16:9").split(":").map(Number);
  if (!a || !b) return {};
  return a >= b ? { w: long, h: Math.round((long * b) / a) } : { w: Math.round((long * a) / b), h: long };
}

/** A search hit → a library video. `src` is the watermarked preview; licensing swaps in the real file. */
export function mapFreepikVideos(d: any, q: string): Asset[] {
  return (Array.isArray(d?.data) ? d.data : [])
    .filter((v: any) => v && v.active !== false && !v.is_ai_generated && (!v.item_subtype || v.item_subtype === "footage"))
    .map((v: any): Asset | null => {
      const previews: any[] = Array.isArray(v.previews) ? v.previews : [];
      const src = previews.map((p) => p?.url).find((u) => typeof u === "string" && /^https:\/\/.+\.mp4(\?|$)/i.test(u));
      if (!src) return null;
      const thumbs: any[] = (Array.isArray(v.thumbnails) ? v.thumbnails : []).filter((t: any) => typeof t?.url === "string");
      const thumb = [...thumbs].sort((a, b) => Math.abs((a.width ?? 0) - 640) - Math.abs((b.width ?? 0) - 640))[0]?.url;
      return {
        id: `fpv_${v.id}`,
        title: String(v.name || q).slice(0, 140),
        src,
        ...(thumb && { thumb }),
        source: "freepik",
        link: typeof v.url === "string" ? v.url : undefined,
        author: v.author?.name,
        license: v.premium ? "Freepik Premium" : "Freepik",
        ...sizeOf(v.quality, v["aspect-ratio"] ?? v.aspect_ratio),
        duration: parseDuration(v.duration),
        kind: "video",
        sourceId: String(v.id),
        watermarked: true,
      };
    })
    .filter(Boolean) as Asset[];
}

/**
 * How filters are written in the query string. The docs describe deepObject filters; we try the
 * full set first and fall back to simpler forms if the API refuses one, remembering what worked.
 */
const FILTER_STYLES = [
  (o?: Orientation, min?: number) => `&filters[category]=footage&filters[ai-generated][excluded]=true${o ? `&filters[orientation][]=${ORIENT[o]}` : ""}${min ? `&filters[duration][from]=${Math.ceil(min)}` : ""}`,
  (o?: Orientation) => `&filters[category]=footage${o ? `&filters[orientation][${ORIENT[o]}]=1` : ""}`,
  () => "",
];
let style = 0;
export const freepikFilterStyle = () => style;

export async function searchFreepikVideos(q: string, n: number, orientation?: Orientation, minDuration?: number): Promise<Asset[]> {
  for (let s = style; s < FILTER_STYLES.length; s++) {
    try {
      const d = await call(`/v1/videos?term=${encodeURIComponent(q.slice(0, 100))}&order=relevance${FILTER_STYLES[s](orientation, minDuration)}`);
      style = s;
      const out = mapFreepikVideos(d, q).slice(0, Math.max(n, 6));
      rememberVideoUrls(out);
      return out;
    } catch (e: any) {
      if (e?.status !== 400) throw e;
    }
  }
  return [];
}

// ---------------------------------------------------------------- licensing
/** The MP4 option to download: the largest at or under `maxEdge`, else the smallest above it. */
export function pickOption(options: any[], maxEdge = 1920): any | undefined {
  const mp4 = (Array.isArray(options) ? options : []).filter((o) => o && o.active !== false && (!o.container || /mp4/i.test(o.container)) && o.id);
  const edge = (o: any) => Math.max(Number(o.width) || 0, Number(o.height) || 0) || SIZE[String(o.quality)] || 0;
  const fit = mp4.filter((o) => edge(o) <= maxEdge).sort((a, b) => edge(b) - edge(a));
  return fit[0] ?? mp4.sort((a, b) => edge(a) - edge(b))[0];
}

let licensedToday = { day: "", n: 0 };
export const licensesToday = () => (licensedToday.day === new Date().toISOString().slice(0, 10) ? licensedToday.n : 0);

/** Download (license) one video: its MP4 at up to `maxEdge` pixels. Returns a short-lived file URL. */
export async function licenseFreepikVideo(id: string, maxEdge = 1920): Promise<{ url: string; filename?: string; w?: number; h?: number }> {
  if (!/^\d{1,12}$/.test(id)) throw new Error("Not a Freepik video id.");
  const detail = await call(`/v1/videos/${id}`);
  const opt = pickOption(detail?.data?.options ?? [], maxEdge);
  const d = opt ? await call(`/v1/videos/${id}/options/${opt.id}/download`) : await call(`/v1/videos/${id}/download`);
  const url = d?.data?.url;
  if (typeof url !== "string" || !/^https:\/\//.test(url)) throw new Error("Freepik didn't return a file for this clip.");
  const today = new Date().toISOString().slice(0, 10);
  licensedToday = { day: today, n: (licensedToday.day === today ? licensedToday.n : 0) + 1 };
  rememberVideoUrls([{ id, title: "", src: url, source: "freepik", kind: "video" }]);
  return { url, filename: d.data.filename, w: Number(opt?.width) || undefined, h: Number(opt?.height) || undefined };
}

// ---------------------------------------------------------------- health
let probe: { ok: boolean; results?: number; filters?: number; error?: string } | undefined;
/** One search at startup, so /api/health can say whether Freepik video works (no secrets, just counts). */
export async function probeFreepikVideo() {
  if (!freepikKey()) return (probe = undefined);
  try {
    const r = await searchFreepikVideos("ocean waves", 6, "landscape", 5);
    probe = { ok: true, results: r.length, filters: style };
  } catch (e: any) {
    probe = { ok: false, error: String(e?.message ?? e).slice(0, 160) };
  }
}
export const freepikVideoStatus = () => probe;
