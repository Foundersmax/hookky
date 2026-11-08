// Visual-source connectors. Each returns normalized Asset records.
// Keys come from environment variables; sources without keys report "unconfigured".
import type { Asset } from "../src/types";
import { safeFetch, readLimited } from "./safeFetch";

const UA = "Hookky/0.1 (+https://localhost)";
const env = (k: string) => process.env[k]?.trim() || "";

export interface ConnectorInfo {
  id: string;
  label: string;
  configured: boolean;
  kind: "search" | "import" | "enhance";
  note: string;
}

export function listConnectors(): ConnectorInfo[] {
  return [
    { id: "openverse", label: "Openverse (open web, CC)", configured: true, kind: "search", note: "Free, no key. 800M+ openly licensed images." },
    { id: "unsplash", label: "Unsplash", configured: !!env("UNSPLASH_ACCESS_KEY"), kind: "search", note: "Set UNSPLASH_ACCESS_KEY" },
    { id: "pexels", label: "Pexels", configured: !!env("PEXELS_API_KEY"), kind: "search", note: "Set PEXELS_API_KEY (free photos and stock video)" },
    { id: "pixabay", label: "Pixabay", configured: !!env("PIXABAY_API_KEY"), kind: "search", note: "Set PIXABAY_API_KEY (free photos and stock video)" },
    { id: "coverr", label: "Coverr", configured: !!env("COVERR_API_KEY"), kind: "search", note: "Set COVERR_API_KEY (free stock video, coverr.co/developers)" },
    { id: "freepik", label: "Freepik", configured: !!env("FREEPIK_API_KEY"), kind: "search", note: "Set FREEPIK_API_KEY (stock vectors, photos, PSD)" },
    { id: "envato", label: "Envato", configured: !!env("ENVATO_TOKEN"), kind: "search", note: "Set ENVATO_TOKEN (Envato Market API)" },
    { id: "pinterest", label: "Pinterest", configured: !!env("PINTEREST_ACCESS_TOKEN"), kind: "search", note: "Set PINTEREST_ACCESS_TOKEN to search your pins. Pin URLs import without a key." },
    { id: "web", label: "Any URL", configured: true, kind: "import", note: "Paste any page (Pinterest pin, Behance, Dribbble, product page) to pull its images." },
    { id: "magnific", label: "Magnific upscaler", configured: !!env("FREEPIK_API_KEY"), kind: "enhance", note: "Upscale/enhance references via the Freepik API (FREEPIK_API_KEY)" },
  ];
}

async function getJSON(url: string, headers: Record<string, string> = {}): Promise<any> {
  const host = new URL(url).host;
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", ...headers }, signal: AbortSignal.timeout(15000) });
  } catch (e: any) {
    throw new Error(e?.name === "TimeoutError" ? `${host} took too long to answer` : `couldn't reach ${host}`);
  }
  if (res.status === 401 || res.status === 403) throw new Error(`${host} rejected the API key (${res.status}). Check it in your environment settings.`);
  if (res.status === 429) throw new Error(`${host} rate limit reached. Try again later.`);
  if (!res.ok) throw new Error(`${host} responded ${res.status}`);
  return res.json();
}

let seq = 0;
const nid = (p: string) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`;

async function openverse(q: string, n: number): Promise<Asset[]> {
  const d = await getJSON(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=${n}&mature=false`);
  return (d.results ?? []).map((r: any) => ({
    id: nid("ov"), title: r.title || q, src: r.url, thumb: r.thumbnail || r.url, source: "openverse",
    link: r.foreign_landing_url, author: r.creator, license: `${r.license ?? ""} ${r.license_version ?? ""}`.trim().toUpperCase(),
    w: r.width, h: r.height, kind: "image",
  }));
}

async function unsplash(q: string, n: number): Promise<Asset[]> {
  const d = await getJSON(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=${n}`, {
    Authorization: `Client-ID ${env("UNSPLASH_ACCESS_KEY")}`,
  });
  return (d.results ?? []).map((r: any) => ({
    id: nid("us"), title: r.alt_description || r.description || q, src: r.urls?.regular, thumb: r.urls?.small, source: "unsplash",
    link: r.links?.html, author: r.user?.name, license: "Unsplash", w: r.width, h: r.height, kind: "image",
  }));
}

async function pexels(q: string, n: number): Promise<Asset[]> {
  const d = await getJSON(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=${n}`, { Authorization: env("PEXELS_API_KEY") });
  return (d.photos ?? []).map((r: any) => ({
    id: nid("px"), title: r.alt || q, src: r.src?.large2x || r.src?.large, thumb: r.src?.medium, source: "pexels",
    link: r.url, author: r.photographer, license: "Pexels", w: r.width, h: r.height, kind: "image",
  }));
}

async function freepik(q: string, n: number): Promise<Asset[]> {
  const d = await getJSON(`https://api.freepik.com/v1/resources?term=${encodeURIComponent(q)}&limit=${n}&order=relevance`, {
    "x-freepik-api-key": env("FREEPIK_API_KEY"),
  });
  return (d.data ?? []).map((r: any) => ({
    id: nid("fp"), title: r.title || q, src: r.image?.source?.url, thumb: r.image?.source?.url, source: "freepik",
    link: r.url, author: r.author?.name, license: r.licenses?.[0]?.type ?? "Freepik", kind: "image",
  }));
}

function firstImageUrl(obj: any): string | undefined {
  if (!obj || typeof obj !== "object") return;
  for (const v of Object.values(obj)) {
    if (typeof v === "string" && /^https?:\/\/.+\.(jpe?g|png|webp)(\?|$)/i.test(v)) return v;
    const nested = firstImageUrl(v);
    if (nested) return nested;
  }
}

async function envato(q: string, n: number): Promise<Asset[]> {
  const d = await getJSON(
    `https://api.envato.com/v1/discovery/search/search/item?term=${encodeURIComponent(q)}&site=graphicriver.net&page_size=${n}`,
    { Authorization: `Bearer ${env("ENVATO_TOKEN")}` },
  );
  return (d.matches ?? [])
    .map((r: any) => {
      const img = firstImageUrl(r.previews);
      return img && { id: nid("ev"), title: r.name || q, src: img, thumb: img, source: "envato", link: r.url, author: r.author_username, license: "Envato Market", kind: "image" };
    })
    .filter(Boolean);
}

async function pinterest(q: string, n: number): Promise<Asset[]> {
  const d = await getJSON(`https://api.pinterest.com/v5/search/pins?query=${encodeURIComponent(q)}&page_size=${Math.min(n, 50)}`, {
    Authorization: `Bearer ${env("PINTEREST_ACCESS_TOKEN")}`,
  });
  return (d.items ?? [])
    .map((r: any) => {
      const imgs = r.media?.images ?? {};
      const big = imgs["1200x"]?.url || imgs["600x"]?.url || imgs.originals?.url || firstImageUrl(r.media);
      return big && { id: nid("pin"), title: r.title || r.description || q, src: big, thumb: imgs["400x300"]?.url || big, source: "pinterest", link: r.link || `https://www.pinterest.com/pin/${r.id}/`, kind: "image" };
    })
    .filter(Boolean);
}

async function pixabay(q: string, n: number): Promise<Asset[]> {
  const d = await getJSON(`https://pixabay.com/api/?key=${encodeURIComponent(env("PIXABAY_API_KEY"))}&q=${encodeURIComponent(q.slice(0, 100))}&per_page=${Math.max(3, n)}&safesearch=true&image_type=photo`);
  return (d.hits ?? []).map((r: any) => ({
    id: nid("pb"), title: r.tags || q, src: r.largeImageURL || r.webformatURL, thumb: r.webformatURL || r.previewURL, source: "pixabay",
    link: r.pageURL, author: r.user, license: "Pixabay", w: r.imageWidth, h: r.imageHeight, kind: "image",
  }));
}

const SEARCHERS: Record<string, (q: string, n: number) => Promise<Asset[]>> = { openverse, unsplash, pexels, pixabay, freepik, envato, pinterest };

// ---------- stock video
export type Orientation = "landscape" | "portrait" | "square";
/** Largest edge we fetch: crisp in a 1080p export, light enough to scrub and seek smoothly. */
const VIDEO_EDGE = 1920;

/** Pick the rendition to stream: the largest MP4 whose long edge fits VIDEO_EDGE, else the smallest. */
export function pickVideoFile<T extends { width?: number; height?: number; link?: string; url?: string; file_type?: string }>(files: T[], maxEdge = VIDEO_EDGE): T | undefined {
  const usable = files.filter((f) => (f.link || f.url) && f.width && f.height && (!f.file_type || /mp4|webm/i.test(f.file_type)));
  const edge = (f: T) => Math.max(f.width!, f.height!);
  const fits = usable.filter((f) => edge(f) <= maxEdge).sort((a, b) => edge(b) - edge(a));
  return fits[0] ?? usable.sort((a, b) => edge(a) - edge(b))[0];
}

export function mapPexelsVideos(d: any, q: string): Asset[] {
  return (d?.videos ?? [])
    .map((v: any): Asset | null => {
      const f = pickVideoFile(Array.isArray(v.video_files) ? v.video_files : []);
      if (!f) return null;
      return {
        id: nid("pxv"), title: q, src: f.link!, thumb: v.image, source: "pexels", link: v.url, author: v.user?.name, license: "Pexels",
        w: f.width, h: f.height, duration: v.duration, kind: "video",
      };
    })
    .filter(Boolean) as Asset[];
}

export function mapPixabayVideos(d: any, q: string): Asset[] {
  return (d?.hits ?? [])
    .map((v: any): Asset | null => {
      const renditions = Object.values(v.videos ?? {}) as { url?: string; width?: number; height?: number; thumbnail?: string }[];
      const f = pickVideoFile(renditions);
      if (!f) return null;
      const thumb = renditions.find((r) => r.thumbnail)?.thumbnail || (v.picture_id ? `https://i.vimeocdn.com/video/${v.picture_id}_640x360.jpg` : undefined);
      return {
        id: nid("pbv"), title: v.tags || q, src: f.url!, thumb, source: "pixabay", link: v.pageURL, author: v.user, license: "Pixabay",
        w: f.width, h: f.height, duration: v.duration, kind: "video",
      };
    })
    .filter(Boolean) as Asset[];
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(+v) ? +v : undefined);

/** Coverr's video list. Field names beyond urls / max_width / max_height aren't fully documented, so read defensively. */
export function mapCoverrVideos(d: any, q: string): Asset[] {
  const list: any[] = Array.isArray(d) ? d : d?.hits ?? d?.videos ?? d?.data ?? d?.results ?? [];
  return list
    .map((v: any): Asset | null => {
      const u = v?.urls ?? {};
      const src = [u.mp4, u.mp4_preview, u.mp4_download, v?.url].find((x) => typeof x === "string" && /^https:\/\//.test(x));
      if (!src) return null;
      const thumb = [v.poster, v.thumbnail, u.poster, u.thumbnail, v.cover_image, v.image].find((x) => typeof x === "string" && /^https?:\/\//.test(x));
      return {
        id: nid("cvv"), title: String(v.title || v.description || q).slice(0, 120), src, ...(thumb && { thumb }), source: "coverr",
        link: v.slug ? `https://coverr.co/videos/${v.slug}` : undefined, license: "Coverr",
        w: num(v.max_width) ?? num(v.width), h: num(v.max_height) ?? num(v.height), duration: num(v.duration), kind: "video",
        ...(v.id !== undefined && { sourceId: String(v.id) }),
      };
    })
    .filter(Boolean) as Asset[];
}

const orientationOf = (a: Asset): Orientation => (!a.w || !a.h ? "landscape" : a.h > a.w * 1.1 ? "portrait" : a.w > a.h * 1.1 ? "landscape" : "square");

const VIDEO_SEARCHERS: Record<string, (q: string, n: number, o?: Orientation) => Promise<Asset[]>> = {
  pexels: async (q, n, o) => mapPexelsVideos(await getJSON(`https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&per_page=${n}${o ? `&orientation=${o}` : ""}`, { Authorization: env("PEXELS_API_KEY") }), q),
  coverr: async (q, n) => mapCoverrVideos(await getJSON(`https://api.coverr.co/videos?query=${encodeURIComponent(q.slice(0, 100))}&page_size=${Math.min(25, Math.max(3, n))}&urls=true`, { Authorization: `Bearer ${env("COVERR_API_KEY")}` }), q),
  pixabay: async (q, n) => mapPixabayVideos(await getJSON(`https://pixabay.com/api/videos/?key=${encodeURIComponent(env("PIXABAY_API_KEY"))}&q=${encodeURIComponent(q.slice(0, 100))}&per_page=${Math.max(3, n)}&safesearch=true`), q),
};

/** Search stock video. Clips matching the project's orientation come first. */
export async function searchVideos(query: string, sources: string[] | undefined, count = 12, orientation?: Orientation) {
  const configured = new Set(listConnectors().filter((c) => c.configured && VIDEO_SEARCHERS[c.id]).map((c) => c.id));
  const wanted = (sources?.length ? sources : [...configured]).filter((s) => VIDEO_SEARCHERS[s]);
  const notes: string[] = [];
  if (!wanted.length || ![...wanted].some((s) => configured.has(s))) notes.push("No stock video source is connected. Add PIXABAY_API_KEY or COVERR_API_KEY (both free).");
  const per = Math.max(4, Math.ceil(count / Math.max(1, wanted.length)));
  const results = await Promise.all(
    wanted.map(async (s) => {
      if (!configured.has(s)) return [];
      try {
        return await VIDEO_SEARCHERS[s](query, per, orientation);
      } catch (e: any) {
        notes.push(`${s}: ${e.message}`);
        return [];
      }
    }),
  );
  const out: Asset[] = [];
  for (let i = 0; out.length < count * 2 && results.some((r) => r[i]); i++) for (const r of results) if (r[i]) out.push(r[i]);
  if (orientation) out.sort((a, b) => Number(orientationOf(b) === orientation) - Number(orientationOf(a) === orientation));
  const assets = out.filter((a) => a.src).slice(0, count);
  rememberVideoUrls(assets);
  return { assets, notes };
}

/** Tell a stock source its item was used, where its terms require it (Coverr). */
export async function reportStockUse(source: string, id: string) {
  if (source !== "coverr" || !/^[\w-]{1,64}$/.test(id) || !env("COVERR_API_KEY")) return false;
  const res = await fetch(`https://api.coverr.co/videos/${encodeURIComponent(id)}/stats/downloads`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${env("COVERR_API_KEY")}`, "User-Agent": UA },
    signal: AbortSignal.timeout(10000),
  });
  return res.ok;
}

/** Hosts the video proxy will stream from (the stock sources' CDNs). Redirects are still SSRF-checked. */
export const VIDEO_HOSTS = [/(^|\.)pexels\.com$/, /(^|\.)pixabay\.com$/, /(^|\.)vimeo\.com$/, /(^|\.)vimeocdn\.com$/, /(^|\.)coverr\.co$/];

/** Clip URLs our own searches returned (their CDNs aren't always documented). Kept for this server's lifetime. */
const issued = new Set<string>();
export function rememberVideoUrls(assets: Asset[]) {
  for (const a of assets) if (a.kind === "video" && a.src) issued.add(a.src);
  if (issued.size > 5000) for (const k of [...issued].slice(0, 1000)) issued.delete(k);
}

export function videoHostAllowed(raw: string) {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && (VIDEO_HOSTS.some((re) => re.test(u.hostname)) || issued.has(raw));
  } catch {
    return false;
  }
}

export async function searchVisuals(query: string, sources: string[] | undefined, count = 12) {
  const configured = new Set(listConnectors().filter((c) => c.configured && c.kind === "search").map((c) => c.id));
  const wanted = (sources?.length ? sources : [...configured]).filter((s) => SEARCHERS[s]);
  const per = Math.max(4, Math.ceil(count / Math.max(1, wanted.length)));
  const notes: string[] = [];
  const results = await Promise.all(
    wanted.map(async (s) => {
      if (!configured.has(s)) {
        notes.push(`${s}: not configured (${listConnectors().find((c) => c.id === s)?.note})`);
        return [];
      }
      try {
        return await SEARCHERS[s](query, per);
      } catch (e: any) {
        notes.push(`${s}: ${e.message}`);
        return [];
      }
    }),
  );
  // interleave sources for variety
  const out: Asset[] = [];
  for (let i = 0; out.length < count && results.some((r) => r[i]); i++) for (const r of results) if (r[i] && out.length < count) out.push(r[i]);
  return { assets: out.filter((a) => a.src), notes };
}

// ---------- URL import: works for Pinterest pins, Behance, Dribbble, product pages, etc.
export async function importFromUrl(pageUrl: string, max = 16): Promise<{ assets: Asset[]; title?: string }> {
  const { res, url: u } = await safeFetch(pageUrl, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Hookky/0.1)", Accept: "text/html,image/*" } });
  if (!res.ok) throw new Error(`Page responded ${res.status}`);
  const type = res.headers.get("content-type") || "";
  if (type.startsWith("image/")) {
    await res.body?.cancel().catch(() => {});
    return { assets: [{ id: nid("url"), title: u.pathname.split("/").pop() || "image", src: u.href, thumb: u.href, source: "web", link: u.href, kind: "image" }] };
  }
  const html = (await readLimited(res, 5_000_000)).toString("utf8");
  const title = html.match(/<title[^>]*>([^<]{0,200})/i)?.[1]?.trim();
  const found = new Map<string, number>();
  const add = (raw: string | undefined, score: number) => {
    if (!raw) return;
    try {
      const abs = new URL(raw.replace(/&amp;/g, "&"), u).href;
      if (!/^https?:/.test(abs) || /\.(svg|gif)(\?|$)/i.test(abs) || /sprite|icon|favicon|logo-small|avatar|pixel|1x1/i.test(abs)) return;
      found.set(abs, Math.max(found.get(abs) ?? 0, score));
    } catch {}
  };
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*>/gi)) add(m[0].match(/content=["']([^"']+)/i)?.[1], 10);
  for (const m of html.matchAll(/<img[^>]+>/gi)) {
    const tag = m[0];
    const srcset = tag.match(/srcset=["']([^"']+)/i)?.[1];
    const best = srcset?.split(",").map((s) => s.trim().split(/\s+/)[0]).pop();
    add(best || tag.match(/\s(?:data-src|src)=["']([^"']+)/i)?.[1], 1);
  }
  const assets = [...found.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([src]) => ({ id: nid("url"), title: title || u.hostname, src, thumb: src, source: `web:${u.hostname.replace(/^www\./, "")}`, link: u.href, kind: "image" as const }));
  return { assets, title };
}

// ---------- Magnific upscaler (via Freepik API): async task
export async function magnificUpscale(imageBase64: string, scale: "2x" | "4x" = "2x"): Promise<string> {
  const key = env("FREEPIK_API_KEY");
  if (!key) throw new Error("Magnific needs FREEPIK_API_KEY");
  const start = await fetch("https://api.freepik.com/v1/ai/image-upscaler", {
    method: "POST",
    headers: { "x-freepik-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ image: imageBase64, scale_factor: scale, optimized_for: "standard", creativity: 0, hdr: 0, resemblance: 0 }),
  });
  if (!start.ok) throw new Error(`Magnific responded ${start.status}: ${(await start.text()).slice(0, 200)}`);
  const taskId = (await start.json())?.data?.task_id;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const st = await getJSON(`https://api.freepik.com/v1/ai/image-upscaler/${taskId}`, { "x-freepik-api-key": key });
    const s = st?.data?.status;
    if (s === "COMPLETED") return st.data.generated?.[0];
    if (s === "FAILED") throw new Error("Magnific task failed");
  }
  throw new Error("Magnific task timed out");
}
