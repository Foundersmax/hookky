// Screen shapes for captioned videos: the same clip saved for phones (9:16), feeds (4:5, 1:1),
// YouTube (16:9) and more. Pure maths, so it can be tested without a browser: output sizes, and
// where the video goes in the frame, cropped to fill or fitted whole over a background.

export type FrameId = "original" | "9:16" | "4:5" | "1:1" | "16:9" | "4:3" | "2:3" | "21:9";
export interface FrameShape {
  id: FrameId;
  label: string;
  /** where it's used */
  hint: string;
  /** width / height (0: the source's own) */
  ratio: number;
}
export const FRAMES: FrameShape[] = [
  { id: "original", label: "Original", hint: "As uploaded", ratio: 0 },
  { id: "9:16", label: "9:16", hint: "TikTok, Reels, Shorts, Stories", ratio: 9 / 16 },
  { id: "4:5", label: "4:5", hint: "Instagram & Facebook feed", ratio: 4 / 5 },
  { id: "1:1", label: "1:1", hint: "Square posts", ratio: 1 },
  { id: "16:9", label: "16:9", hint: "YouTube, web, TV", ratio: 16 / 9 },
  { id: "4:3", label: "4:3", hint: "Classic, tablets", ratio: 4 / 3 },
  { id: "2:3", label: "2:3", hint: "Pinterest", ratio: 2 / 3 },
  { id: "21:9", label: "21:9", hint: "Cinematic, ultrawide", ratio: 21 / 9 },
];
export const frameById = (id: string) => FRAMES.find((f) => f.id === id) ?? FRAMES[0];

export type Quality = "source" | "720" | "1080" | "2160";
export const QUALITIES: { id: Quality; label: string }[] = [
  { id: "source", label: "Source" },
  { id: "720", label: "720p" },
  { id: "1080", label: "1080p" },
  { id: "2160", label: "4K" },
];

export type Fit = "fill" | "fit";
export type Backdrop = "blur" | "black" | "white" | "brand";
export interface Framing {
  fit: Fit;
  /** fill: which part of the video stays in frame (0..1 each way; 0.5 = centre) */
  focusX: number;
  focusY: number;
  /** fill: extra zoom (1 = just enough to fill) */
  zoom: number;
  /** fit: what shows around the video */
  backdrop: Backdrop;
}
export const DEFAULT_FRAMING: Framing = { fit: "fill", focusX: 0.5, focusY: 0.5, zoom: 1, backdrop: "blur" };

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * The output size for a shape and quality. Quality sets the short side ("source" keeps the
 * source's short side, so nothing is upscaled); the long side follows the shape. Capped at 4K's
 * short side and 4096 on the long side, which is what browsers can encode.
 */
export function outputSize(srcW: number, srcH: number, frame: FrameId, quality: Quality): { w: number; h: number } {
  const f = frameById(frame);
  const ratio = f.ratio || srcW / srcH;
  if (frame === "original" && quality === "source") return { w: even(srcW), h: even(srcH) };
  let short = quality === "source" ? Math.min(srcW, srcH) : Number(quality);
  short = Math.min(short, 2160);
  let w = ratio >= 1 ? short * ratio : short;
  let h = ratio >= 1 ? short : short / ratio;
  const over = Math.max(w, h) / 4096;
  if (over > 1) (w /= over), (h /= over);
  return { w: even(w), h: even(h) };
}

export interface Placement {
  /** the part of the source drawn, and where it goes in the output */
  sx: number; sy: number; sw: number; sh: number;
  dx: number; dy: number; dw: number; dh: number;
  /** fit: the background copy, covering the whole frame (only for the blur backdrop) */
  bg?: { sx: number; sy: number; sw: number; sh: number };
}

/** Where the video goes in a W×H output. */
export function place(srcW: number, srcH: number, W: number, H: number, f: Framing): Placement {
  const cover = Math.max(W / srcW, H / srcH);
  if (f.fit === "fit") {
    const s = Math.min(W / srcW, H / srcH);
    const dw = srcW * s, dh = srcH * s;
    // the blurred copy: the source cropped (from the centre) to the frame's shape
    const bw = W / cover, bh = H / cover;
    return {
      sx: 0, sy: 0, sw: srcW, sh: srcH,
      dx: (W - dw) / 2, dy: (H - dh) / 2, dw, dh,
      ...(f.backdrop === "blur" && { bg: { sx: (srcW - bw) / 2, sy: (srcH - bh) / 2, sw: bw, sh: bh } }),
    };
  }
  // fill: crop a window of the frame's shape out of the source, zoomed and moved to the focus
  const s = cover * clamp(f.zoom || 1, 1, 4);
  const sw = W / s, sh = H / s;
  const sx = clamp(f.focusX, 0, 1) * (srcW - sw);
  const sy = clamp(f.focusY, 0, 1) * (srcH - sh);
  return { sx, sy, sw, sh, dx: 0, dy: 0, dw: W, dh: H };
}

/** Moving the crop by dragging: a drag of (dx, dy) output pixels, as a new focus. */
export function panFocus(srcW: number, srcH: number, W: number, H: number, f: Framing, dx: number, dy: number): { focusX: number; focusY: number } {
  const p = place(srcW, srcH, W, H, { ...f, fit: "fill" });
  const s = W / p.sw;
  const roomX = srcW - p.sw, roomY = srcH - p.sh;
  return {
    focusX: roomX > 0.5 ? clamp(f.focusX - dx / s / roomX, 0, 1) : 0.5,
    focusY: roomY > 0.5 ? clamp(f.focusY - dy / s / roomY, 0, 1) : 0.5,
  };
}

/** How much of the picture a fill crop keeps (1 = all of it): to warn before cutting most of it away. */
export function keptShare(srcW: number, srcH: number, W: number, H: number, f: Framing): number {
  if (f.fit === "fit") return 1;
  const p = place(srcW, srcH, W, H, f);
  return (p.sw * p.sh) / (srcW * srcH);
}

/** Captions a bit bigger on tall screens, where they're read on a phone held upright. */
export const captionZoom = (W: number, H: number) => (H > W * 1.1 ? 1.25 : 1);

/** A file name suffix for a shape: "-9x16". */
export const frameSuffix = (frame: FrameId) => (frame === "original" ? "" : `-${frame.replace(":", "x")}`);

/**
 * Draw one frame: the backdrop, then the video where `place` puts it. The blur is a cheap and
 * portable one: the background copy drawn tiny, then scaled up smoothly, then darkened a little.
 */
export function drawFramed(ctx: CanvasRenderingContext2D, video: CanvasImageSource, srcW: number, srcH: number, W: number, H: number, f: Framing, brandColor = "#111111", scratch?: { c?: HTMLCanvasElement | OffscreenCanvas }) {
  const p = place(srcW, srcH, W, H, f);
  if (f.fit === "fit") {
    if (p.bg) {
      const tw = 24, th = Math.max(2, Math.round((24 * H) / W));
      let c = scratch?.c;
      if (!c || c.width !== tw || c.height !== th) {
        c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(tw, th) : Object.assign(document.createElement("canvas"), { width: tw, height: th });
        if (scratch) scratch.c = c;
      }
      const t = c.getContext("2d") as CanvasRenderingContext2D;
      t.imageSmoothingEnabled = true;
      t.drawImage(video, p.bg.sx, p.bg.sy, p.bg.sw, p.bg.sh, 0, 0, tw, th);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      // CSS-style blur where the browser has it (smooth); else the tiny copy scaled up is the blur
      if (typeof (ctx as { filter?: unknown }).filter === "string") {
        ctx.filter = `blur(${Math.round(Math.max(W, H) / 60)}px)`;
        ctx.drawImage(c as CanvasImageSource, 0, 0, tw, th, -W * 0.05, -H * 0.05, W * 1.1, H * 1.1);
        ctx.filter = "none";
      } else ctx.drawImage(c as CanvasImageSource, 0, 0, tw, th, 0, 0, W, H);
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    } else {
      ctx.fillStyle = f.backdrop === "white" ? "#ffffff" : f.backdrop === "brand" ? brandColor : "#000000";
      ctx.fillRect(0, 0, W, H);
    }
  }
  ctx.drawImage(video, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.dw, p.dh);
}
