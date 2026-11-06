// Visual-source connectors. Each returns normalized Asset records.
// Keys come from environment variables; sources without keys report "unconfigured".
import type { Asset } from "../src/types";

const UA = "MotifStudio/0.1 (+https://localhost)";
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
    { id: "pexels", label: "Pexels", configured: !!env("PEXELS_API_KEY"), kind: "search", note: "Set PEXELS_API_KEY" },
    { id: "freepik", label: "Freepik", configured: !!env("FREEPIK_API_KEY"), kind: "search", note: "Set FREEPIK_API_KEY (stock vectors, photos, PSD)" },
    { id: "envato", label: "Envato", configured: !!env("ENVATO_TOKEN"), kind: "search", note: "Set ENVATO_TOKEN (Envato Market API)" },
    { id: "pinterest", label: "Pinterest", configured: !!env("PINTEREST_ACCESS_TOKEN"), kind: "search", note: "Set PINTEREST_ACCESS_TOKEN to search your pins. Pin URLs import without a key." },
    { id: "web", label: "Any URL", configured: true, kind: "import", note: "Paste any page (Pinterest pin, Behance, Dribbble, product page) to pull its images." },
    { id: "magnific", label: "Magnific upscaler", configured: !!env("FREEPIK_API_KEY"), kind: "enhance", note: "Upscale/enhance references via the Freepik API (FREEPIK_API_KEY)" },
  ];
}

async function getJSON(url: string, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json", ...headers }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
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

const SEARCHERS: Record<string, (q: string, n: number) => Promise<Asset[]>> = { openverse, unsplash, pexels, freepik, envato, pinterest };

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
  const u = assertPublicUrl(pageUrl);
  const res = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (compatible; MotifStudio/0.1)", Accept: "text/html,image/*" }, signal: AbortSignal.timeout(15000), redirect: "follow" });
  if (!res.ok) throw new Error(`Page responded ${res.status}`);
  const type = res.headers.get("content-type") || "";
  if (type.startsWith("image/")) {
    return { assets: [{ id: nid("url"), title: u.pathname.split("/").pop() || "image", src: u.href, thumb: u.href, source: "web", link: u.href, kind: "image" }] };
  }
  const html = (await res.text()).slice(0, 2_000_000);
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

export function assertPublicUrl(raw: string): URL {
  const u = new URL(raw);
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http(s) URLs are supported");
  const h = u.hostname;
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.endsWith(".internal") || h.endsWith(".local"))
    throw new Error("Private addresses are not allowed");
  return u;
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
