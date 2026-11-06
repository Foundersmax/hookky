// Video clips inside scenes. The renderer asks for "an image" by asset ref; for a video asset it
// gets the clip's <video> element positioned at the scene's local time, so every template that
// draws images (full-bleed, split, device screen, mosaic, image backgrounds…) also plays video.
//
// Preview: one element per clip plays in real time and is nudged back when it drifts.
// Export:  MP4/MOV clips are decoded frame-exactly with WebCodecs (ClipDecoder); other formats use
//          a separate set of elements, seeked and awaited before each render.

import type { ClipDecoder } from "./clipDecoder";

/** An element the renderer can draw like an image (it reads naturalWidth / naturalHeight). */
export type Drawable = HTMLImageElement;

function makeVideo(src: string): HTMLVideoElement {
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.loop = false;
  v.preload = "auto";
  v.crossOrigin = "anonymous";
  // Templates size images by naturalWidth/naturalHeight; give videos the same shape.
  Object.defineProperty(v, "naturalWidth", { get: () => v.videoWidth });
  Object.defineProperty(v, "naturalHeight", { get: () => v.videoHeight });
  v.src = src;
  return v;
}

const ready = (v: HTMLVideoElement) => v.readyState >= 2 && v.videoWidth > 0;
/** Clips shorter than their scene loop. */
export const clipTime = (t: number, duration: number) => (duration > 0 && Number.isFinite(duration) ? ((t % duration) + duration) % duration : Math.max(0, t));

export class VideoStore {
  private live = new Map<string, { el: HTMLVideoElement; used: number }>();
  private listeners = new Set<() => void>();
  playing = false;
  private sweeper: ReturnType<typeof setInterval> | null = null;

  listen(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private entry(src: string) {
    let e = this.live.get(src);
    if (!e) {
      const el = makeVideo(src);
      const changed = () => this.listeners.forEach((f) => f());
      // A paused preview redraws once the requested frame is decoded.
      el.addEventListener("loadeddata", changed);
      el.addEventListener("seeked", () => !this.playing && changed());
      e = { el, used: 0 };
      this.live.set(src, e);
      this.sweeper ??= setInterval(() => this.sweep(), 400);
    }
    return e;
  }

  /** Pause clips that left the screen so they don't burn CPU or drift. */
  private sweep() {
    const now = performance.now();
    for (const e of this.live.values()) if (now - e.used > 350 && !e.el.paused) e.el.pause();
  }

  /** The clip at a scene-local time, for the live preview (real-time playback, drift-corrected). */
  frame(src: string, t: number, rate = 1): Drawable | undefined {
    const e = this.entry(src);
    e.used = performance.now();
    const v = e.el;
    if (!ready(v)) return undefined;
    const target = clipTime(t, v.duration);
    const drift = Math.abs(v.currentTime - target);
    if (this.playing) {
      if (v.playbackRate !== rate) v.playbackRate = rate;
      if (v.paused) v.play().catch(() => {});
      if (drift > 0.3 * Math.max(1, rate) && !v.seeking) v.currentTime = target;
    } else {
      if (!v.paused) v.pause();
      if (drift > 0.03 && !v.seeking) v.currentTime = target;
    }
    return v as unknown as Drawable;
  }

  /** Metadata for a new upload or search result: size, length and a poster frame. */
  static async probe(src: string): Promise<{ w: number; h: number; duration: number; poster: string }> {
    const v = makeVideo(src);
    try {
      await new Promise<void>((res, rej) => {
        v.addEventListener("loadeddata", () => res(), { once: true });
        v.addEventListener("error", () => rej(new Error("This video can't be played in the browser. Try an MP4 (H.264) or WebM file.")), { once: true });
        setTimeout(() => rej(new Error("The video took too long to load.")), 20000);
      });
      await seekTo(v, Math.min(1, v.duration / 3));
      const c = document.createElement("canvas");
      const s = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
      c.width = Math.round(v.videoWidth * s);
      c.height = Math.round(v.videoHeight * s);
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      return { w: v.videoWidth, h: v.videoHeight, duration: v.duration, poster: c.toDataURL("image/jpeg", 0.82) };
    } finally {
      v.removeAttribute("src");
      v.load();
    }
  }
}

/**
 * Seek and wait until the frame at `t` is the one the element will draw. "seeked" means the
 * frame is decoded; for an element on the page, requestVideoFrameCallback then confirms it was
 * presented (Chrome can otherwise hand drawImage the previous frame).
 */
export function seekTo(v: HTMLVideoElement, t: number, timeoutMs = 4000): Promise<void> {
  if (Math.abs(v.currentTime - t) < 1e-4 && ready(v) && !v.seeking) return Promise.resolve();
  return new Promise<void>((res) => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      res();
    };
    const timer = setTimeout(done, timeoutMs);
    const rvfc = (v as any).requestVideoFrameCallback as undefined | ((cb: (now: number, meta?: { mediaTime?: number }) => void) => number);
    v.addEventListener(
      "seeked",
      () => {
        if (typeof rvfc !== "function" || !v.isConnected || document.hidden) return done();
        // Registered only after "seeked", so it can't fire for a frame from before this seek, and
        // it checks the presented frame's media time. A seek onto the frame already on screen
        // presents nothing new, hence the fallback.
        const check = (_now: number, meta?: { mediaTime?: number }) => {
          if (meta?.mediaTime === undefined || Math.abs(meta.mediaTime - v.currentTime) < 0.012) done();
          else rvfc.call(v, check);
        };
        rvfc.call(v, check);
        setTimeout(done, 400);
      },
      { once: true },
    );
    v.currentTime = t;
  });
}

/**
 * Where to seek so the frame shown is the one on screen at clip time t. Seeking exactly onto a
 * frame boundary can land on the previous frame (float rounding), so aim 2 ms in: less than
 * half a frame at any real frame rate, so it picks the right frame whether the browser floors
 * or rounds.
 */
export const exactSeekTime = (t: number, duration: number) => Math.min(clipTime(t, duration) + 0.002, Math.max(0, duration - 0.001));

/**
 * Exact frames for exports: its own elements (the preview keeps playing undisturbed), seeked
 * and awaited for each output frame before the renderer draws it.
 */
export class VideoSeeker {
  private els = new Map<string, HTMLVideoElement>();
  private decoders = new Map<string, Promise<ClipDecoder | null>>();
  private exact = new Map<string, Drawable>();
  private host: HTMLDivElement | null = null;

  /** Elements live on the page (out of sight) so the browser presents every seeked frame. */
  private attach(v: HTMLVideoElement) {
    if (!this.host) {
      this.host = document.createElement("div");
      this.host.setAttribute("aria-hidden", "true");
      // In the viewport (2px, nearly transparent): browsers skip presenting off-screen video.
      this.host.style.cssText = "position:fixed;right:0;bottom:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:-1";
      document.body.appendChild(this.host);
    }
    v.style.cssText = "position:absolute;inset:0;width:2px;height:2px";
    this.host.appendChild(v);
  }

  /** Make sure every clip in `wanted` (src → scene-local time) is showing exactly that frame. */
  async prepare(wanted: Map<string, number>) {
    await Promise.all(
      [...wanted].map(async ([src, t]) => {
        // The MP4 decoder (mp4box + WebCodecs) loads only when an export actually has a clip.
        if (!this.decoders.has(src)) this.decoders.set(src, import("./clipDecoder").then((m) => m.ClipDecoder.open(src)).catch(() => null));
        const dec = await this.decoders.get(src)!;
        if (dec) {
          try {
            this.exact.set(src, (await dec.frameAt(clipTime(t, dec.duration))) as unknown as Drawable);
            return;
          } catch {
            dec.close();
            this.decoders.set(src, Promise.resolve(null)); // decoding failed: use the element from now on
          }
        }
        let v = this.els.get(src);
        if (!v) {
          v = makeVideo(src);
          this.attach(v);
          this.els.set(src, v);
          await new Promise<void>((res) => {
            if (ready(v!)) return res();
            v!.addEventListener("loadeddata", () => res(), { once: true });
            v!.addEventListener("error", () => res(), { once: true });
            setTimeout(res, 15000);
          });
        }
        if (ready(v)) await seekTo(v, exactSeekTime(t, v.duration));
      }),
    );
  }

  frame(src: string): Drawable | undefined {
    const exact = this.exact.get(src);
    if (exact) return exact;
    const v = this.els.get(src);
    // Once a clip has shown a frame, keep drawing it (never flash back to the poster).
    return v && v.videoWidth > 0 ? (v as unknown as Drawable) : undefined;
  }

  dispose() {
    for (const d of this.decoders.values()) d.then((x) => x?.close());
    this.decoders.clear();
    this.exact.clear();
    for (const v of this.els.values()) {
      v.removeAttribute("src");
      v.load();
    }
    this.els.clear();
    this.host?.remove();
    this.host = null;
  }
}
