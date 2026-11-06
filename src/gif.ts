// Animated GIF export: renders frames at a small size, builds one palette from frames sampled
// across the clip (so colours don't flicker between frames), then encodes with gifenc.
import { GIFEncoder, quantize, applyPalette } from "gifenc";
import type { Aspect, Project } from "./types";
import { ASPECT_SIZE } from "./types";
import { Renderer, totalDuration } from "./engine/render";
import { images } from "./runtime";
import { projectImageRefs, renderExact } from "./export";
import { VideoSeeker } from "./engine/videos";
import { gifDelays } from "./gifTiming";

export { estimateGifBytes } from "./gifTiming";

export interface GifOpts {
  /** Output width in pixels (height follows the format). */
  width: number;
  fps: number;
  /** Seconds of the cut to include; defaults to all of it. */
  from?: number;
  to?: number;
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
}


export async function exportGif(project: Project, aspect: Aspect, opts: GifOpts): Promise<Blob> {
  const p: Project = { ...project, aspect, grain: false }; // grain is noise: it bloats GIFs and dithers badly
  const [W, H] = ASPECT_SIZE[aspect];
  const scale = opts.width / W;
  const w = Math.round(W * scale), h = Math.round(H * scale);
  const from = Math.max(0, opts.from ?? 0);
  const to = Math.min(totalDuration(p), opts.to ?? Infinity);
  const frames = Math.max(1, Math.ceil((to - from) * opts.fps));
  const canvas = document.createElement("canvas");
  const r = new Renderer(canvas, W, H, scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  await document.fonts.ready;
  await images.preload(projectImageRefs(p));
  const seeker = new VideoSeeker();
  const frameAt = async (i: number) => {
    await renderExact(r, p, Math.min(to - 0.001, from + i / opts.fps), seeker);
    return ctx.getImageData(0, 0, w, h).data;
  };
  const yieldNow = () => new Promise((res) => setTimeout(res, 0));
  const cancelled = () => {
    if (opts.signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
  };

  // One shared palette from up to 10 frames across the clip.
  const samples = Math.min(10, frames);
  const stride = 3; // every 3rd pixel is plenty for a palette
  const per = Math.ceil((w * h) / stride);
  const pool = new Uint8Array(per * samples * 4);
  for (let k = 0; k < samples; k++) {
    cancelled();
    const d = await frameAt(Math.floor((k + 0.5) * (frames / samples)));
    for (let i = 0, o = k * per * 4; i < w * h; i += stride, o += 4) pool.set(d.subarray(i * 4, i * 4 + 4), o);
    opts.onProgress?.(0.1 * ((k + 1) / samples));
    await yieldNow();
  }
  const palette = quantize(pool, 256, { format: "rgb565" });

  const gif = GIFEncoder();
  const delays = gifDelays(frames, opts.fps);
  for (let i = 0; i < frames; i++) {
    cancelled();
    const index = applyPalette(await frameAt(i), palette, "rgb565");
    gif.writeFrame(index, w, h, { ...(i === 0 && { palette, repeat: 0 }), delay: delays[i] });
    if (i % 4 === 0) {
      opts.onProgress?.(0.1 + 0.9 * (i / frames));
      await yieldNow();
    }
  }
  seeker.dispose();
  gif.finish();
  opts.onProgress?.(1);
  return new Blob([gif.bytesView()], { type: "image/gif" });
}
