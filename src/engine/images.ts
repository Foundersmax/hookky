import type { Asset } from "../types";

/** Lazily loads images for the canvas. Remote URLs go through the same-origin proxy so exports aren't tainted. */
import { VideoStore, VideoSeeker } from "./videos";

export class ImageStore {
  /** Live clips for the preview. */
  videos = new VideoStore();
  private cache = new Map<string, HTMLImageElement | "loading" | "error">();
  assets = new Map<string, Asset>();
  private loadListeners = new Set<() => void>();
  /** Subscribe to "an image finished loading". Returns an unsubscribe function. */
  listen(fn: () => void) {
    this.loadListeners.add(fn);
    return () => void this.loadListeners.delete(fn);
  }

  setAssets(list: Asset[]) {
    this.assets = new Map(list.map((a) => [a.id, a]));
  }

  resolve(ref?: string): string | undefined {
    if (!ref) return;
    const a = this.assets.get(ref) ?? this.assets.get(`asset:${ref}`) ?? this.assets.get(ref.replace(/^asset:/, ""));
    const src = a?.src ?? (/^(https?:|blob:|data:)/.test(ref) ? ref : undefined);
    if (!src) return;
    return /^https?:/.test(src) ? `/api/img?u=${encodeURIComponent(src)}` : src;
  }

  asset(ref?: string): Asset | undefined {
    if (!ref) return;
    return this.assets.get(ref) ?? this.assets.get(`asset:${ref}`) ?? this.assets.get(ref.replace(/^asset:/, ""));
  }

  /** Playable URL of a video asset (remote clips stream through the same-origin proxy). */
  videoSrc(a: Asset): string | undefined {
    if (a.kind !== "video" || !a.src) return;
    return /^https?:/.test(a.src) ? `/api/video?u=${encodeURIComponent(a.src)}` : a.src;
  }

  /**
   * The drawable for a ref. Images ignore `t`; a video asset returns its clip at scene-local time
   * `t` (live preview), or its poster frame when no time is given.
   */
  get = (ref?: string, t?: number, rate = 1): HTMLImageElement | undefined => {
    const a = this.asset(ref);
    if (a?.kind === "video") {
      const src = this.videoSrc(a);
      if (src && t !== undefined) return this.videos.frame(src, t, rate) ?? (a.thumb ? this.get(a.thumb) : undefined);
      return a.thumb ? this.get(a.thumb) : undefined;
    }
    return this.image(ref);
  };

  /** Stills only: video assets show their poster frame (thumbnails, contact sheets, dashboards). */
  still = (ref?: string): HTMLImageElement | undefined => this.get(ref);

  /** A getter for exports: video assets come from `seeker`, already on the exact frame. */
  exact(seeker: VideoSeeker) {
    return (ref?: string, t?: number): HTMLImageElement | undefined => {
      const a = this.asset(ref);
      if (a?.kind === "video") {
        const src = this.videoSrc(a);
        return (src && seeker.frame(src)) || this.get(ref);
      }
      return this.image(ref, t);
    };
  }

  private image = (ref?: string, _t?: number): HTMLImageElement | undefined => {
    const src = this.resolve(ref);
    if (!src) return;
    const hit = this.cache.get(src);
    if (hit instanceof HTMLImageElement) return hit;
    if (!hit) {
      this.cache.set(src, "loading");
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.decoding = "async";
      im.onload = () => {
        this.cache.set(src, im);
        this.loadListeners.forEach((fn) => fn());
      };
      im.onerror = () => this.cache.set(src, "error");
      im.src = src;
    }
    return;
  };

  /** Preload every image referenced by a project (used before export). */
  async preload(refs: (string | undefined)[]) {
    await Promise.all(
      refs.filter(Boolean).map(
        (r) =>
          new Promise<void>((res) => {
            if (this.asset(r)?.kind === "video") return res();
            const src = this.resolve(r);
            if (!src) return res();
            const hit = this.cache.get(src);
            if (hit instanceof HTMLImageElement || hit === "error") return res();
            this.get(r);
            const iv = setInterval(() => {
              const h = this.cache.get(src);
              if (h instanceof HTMLImageElement || h === "error") {
                clearInterval(iv);
                res();
              }
            }, 50);
            setTimeout(() => (clearInterval(iv), res()), 8000);
          }),
      ),
    );
  }
}

/** Quick dominant-colour extraction (k-means-lite on a downscaled image). */
export async function extractPalette(src: string, k = 5): Promise<string[]> {
  const im = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = /^https?:/.test(src) ? `/api/img?u=${encodeURIComponent(src)}` : src;
  });
  const c = document.createElement("canvas");
  c.width = c.height = 48;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(im, 0, 0, 48, 48);
  const d = ctx.getImageData(0, 0, 48, 48).data;
  const px: number[][] = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) px.push([d[i], d[i + 1], d[i + 2]]);
  if (!px.length) return [];
  let cents = Array.from({ length: k }, (_, i) => px[Math.floor((i / k) * px.length)]);
  for (let it = 0; it < 8; it++) {
    const sums = cents.map(() => [0, 0, 0, 0]);
    for (const p of px) {
      let bi = 0, bd = Infinity;
      cents.forEach((c, ci) => {
        const dd = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (dd < bd) (bd = dd), (bi = ci);
      });
      const s = sums[bi];
      s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
    }
    cents = sums.map((s, i) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : cents[i]));
    (cents as any).counts = sums.map((s) => s[3]);
  }
  const counts: number[] = (cents as any).counts;
  return cents
    .map((c, i) => ({ c, n: counts[i] }))
    .sort((a, b) => b.n - a.n)
    .map(({ c }) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join(""));
}

/** Downscale an image file to a JPEG/PNG base64 payload for the agent (vision). */
export async function toAgentImage(src: string, max = 1024): Promise<{ mediaType: string; data: string }> {
  const im = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
  const s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(im.naturalWidth * s);
  c.height = Math.round(im.naturalHeight * s);
  c.getContext("2d")!.drawImage(im, 0, 0, c.width, c.height);
  const url = c.toDataURL("image/jpeg", 0.86);
  return { mediaType: "image/jpeg", data: url.split(",")[1] };
}
