// Upscaling a video file in the browser: every frame is stepped to exactly, run through the GPU
// pipeline (clean → upscale → sharpen → enrich) and encoded; the sound is carried over as AAC.
// Nothing is uploaded except, where the browser can't encode AAC, the soundtrack for conversion.
//
// Built to finish long jobs: seeks and the encoder have watchdogs (nothing hangs silently), a
// GPU reset is recovered from, the encoder is tried on a real frame before the job starts (and
// the next codec used if it fails), the file can be written straight to disk (no memory limit),
// the screen is kept awake, and the loop keeps going at full speed in a background tab.
import { Muxer, ArrayBufferTarget, FileSystemWritableFileStreamTarget } from "mp4-muxer";
import { encodeAudio } from "../export";
import { Upscaler } from "./gl";
import { TARGETS, targetSize, upscaleBitrate, frameRange, outputBytes, MEMORY_LIMIT, type TargetId, type Look } from "./size";
export { TARGETS, targetSize, upscaleBitrate, type TargetId };

export interface SourceInfo {
  w: number;
  h: number;
  duration: number;
  fps: number;
}
const RATES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];
const snapRate = (f: number) => RATES.reduce((a, b) => (Math.abs(b - f) < Math.abs(a - f) ? b : a));

/** Give the page a turn without setTimeout (which background tabs slow to once a second). */
export const yieldNow = () =>
  new Promise<void>((r) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => (ch.port1.close(), r());
    ch.port2.postMessage(0);
  });

function loadVideo(url: string, timeoutMs = 30_000): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    const timer = setTimeout(() => reject(new Error("This video took too long to open. It may be damaged, or in a format this browser can't play.")), timeoutMs);
    v.onloadeddata = () => (clearTimeout(timer), resolve(v));
    v.onerror = () => (clearTimeout(timer), reject(new Error("This file couldn't be opened as a video. MP4, MOV and WebM work best.")));
    v.src = url;
  });
}

/** Seek to a time and wait for the frame; resolves false if the video doesn't answer in time. */
function seekOnce(v: HTMLVideoElement, t: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (Math.abs(v.currentTime - t) < 1e-4 && v.readyState >= 2 && !v.seeking) return resolve(true);
    let timer = 0;
    const done = (ok: boolean) => {
      clearTimeout(timer);
      v.removeEventListener("seeked", onSeeked);
      resolve(ok);
    };
    const onSeeked = () => done(true);
    v.addEventListener("seeked", onSeeked);
    timer = window.setTimeout(() => done(false), timeoutMs);
    v.currentTime = t;
  });
}
/** Seek to a time; retried (nudged a hair, then reloaded at that point) before giving up with a clear error. */
export async function seek(v: HTMLVideoElement, t: number, timeoutMs = 8000): Promise<void> {
  if (await seekOnce(v, t, timeoutMs)) return;
  if (await seekOnce(v, Math.max(0, t - 1e-3), timeoutMs)) return;
  // a decoder that's wedged sometimes comes back after a reload
  const src = v.currentSrc || v.src;
  if (src) {
    v.src = src;
    await new Promise<void>((r) => {
      const t0 = setTimeout(r, timeoutMs);
      v.onloadeddata = () => (clearTimeout(t0), r());
    });
    if (await seekOnce(v, t, timeoutMs)) return;
  }
  throw new Error(`The video stopped responding at ${t.toFixed(2)}s. The file may be damaged there: try a shorter part, or re-save the video and upscale again.`);
}

/** Size, length and frame rate of a video file (the rate is measured from its first frames). */
export async function probe(file: Blob): Promise<SourceInfo & { url: string; video: HTMLVideoElement }> {
  if (!file.size) throw new Error("That file is empty.");
  const url = URL.createObjectURL(file);
  const video = await loadVideo(url).catch((e) => {
    URL.revokeObjectURL(url);
    throw e;
  });
  if (!video.videoWidth || !isFinite(video.duration) || video.duration <= 0) {
    URL.revokeObjectURL(url);
    throw new Error(!video.videoWidth ? "That file has no picture to upscale." : "This video's length can't be read. Re-save it as MP4 and try again.");
  }
  let fps = 30;
  const rvfc = (video as any).requestVideoFrameCallback?.bind(video) as ((cb: (now: number, meta: { mediaTime: number }) => void) => number) | undefined;
  if (rvfc) {
    const times: number[] = [];
    await new Promise<void>((resolve) => {
      const stop = setTimeout(resolve, 2500);
      const tick = (_n: number, m: { mediaTime: number }) => {
        times.push(m.mediaTime);
        if (times.length >= 24) (clearTimeout(stop), resolve());
        else rvfc(tick);
      };
      rvfc(tick);
      video.play().catch(() => (clearTimeout(stop), resolve()));
    });
    video.pause();
    const d = times.slice(1).map((t, i) => t - times[i]).filter((x) => x > 0.001).sort((a, b) => a - b);
    if (d.length >= 5) fps = snapRate(1 / d[Math.floor(d.length / 2)]);
    await seek(video, 0).catch(() => {});
  }
  return { w: video.videoWidth, h: video.videoHeight, duration: video.duration, fps, url, video };
}

type Mux = "avc" | "hevc" | "av1" | "vp9";
type Codec = { codec: string; mux: Mux };
const CANDIDATES: Codec[] = [
  { codec: "avc1.640033", mux: "avc" }, { codec: "avc1.640034", mux: "avc" }, { codec: "avc1.64003c", mux: "avc" }, { codec: "avc1.64003e", mux: "avc" },
  { codec: "hvc1.1.6.L183.B0", mux: "hevc" }, { codec: "hvc1.1.6.L186.B0", mux: "hevc" },
  { codec: "av01.0.16M.08", mux: "av1" }, { codec: "av01.0.19M.08", mux: "av1" },
  { codec: "vp09.00.61.08", mux: "vp9" },
];
/** Every codec this browser says it can encode at this size, most widely playable first. */
export async function listCodecs(w: number, h: number, fps: number, bitrate: number): Promise<Codec[]> {
  if (typeof VideoEncoder === "undefined") return [];
  const out: Codec[] = [];
  for (const c of CANDIDATES) {
    if (out.some((o) => o.mux === c.mux)) continue; // one level per codec family is enough
    try {
      if ((await VideoEncoder.isConfigSupported({ codec: c.codec, width: w, height: h, bitrate, framerate: fps })).supported) out.push(c);
    } catch {}
  }
  return out;
}
/** The most widely playable codec this browser can encode at this size. */
export async function pickCodec(w: number, h: number, fps: number, bitrate: number): Promise<Codec | null> {
  return (await listCodecs(w, h, fps, bitrate))[0] ?? null;
}
const encoderConfig = (c: Codec, w: number, h: number, fps: number, bitrate: number) =>
  ({ codec: c.codec, width: w, height: h, bitrate, framerate: fps, ...(c.mux === "avc" && { avc: { format: "avc" as const } }), ...(c.mux === "hevc" && { hevc: { format: "hevc" as const } }) }) as VideoEncoderConfig;

/** Encode two real frames with a codec before trusting it: some encoders accept a size they then fail on. */
async function trialEncode(c: Codec, w: number, h: number, fps: number, bitrate: number): Promise<boolean> {
  let ok = false, failed = false;
  let enc: VideoEncoder | null = null;
  try {
    enc = new VideoEncoder({ output: () => (ok = true), error: () => (failed = true) });
    enc.configure(encoderConfig(c, w, h, fps, bitrate));
    const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
    const x = cv.getContext("2d") as CanvasRenderingContext2D;
    for (let i = 0; i < 2; i++) {
      x.fillStyle = i ? "#808080" : "#202020";
      x.fillRect(0, 0, w, h);
      const f = new VideoFrame(cv as CanvasImageSource & HTMLCanvasElement, { timestamp: Math.round((i * 1e6) / fps) });
      enc.encode(f, { keyFrame: i === 0 });
      f.close();
    }
    await Promise.race([enc.flush(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 20_000))]);
    return ok && !failed;
  } catch {
    return false;
  } finally {
    try {
      if (enc && enc.state !== "closed") enc.close();
    } catch {}
  }
}
/** The first codec that really encodes at this size. */
export async function workingCodec(w: number, h: number, fps: number, bitrate: number): Promise<Codec | null> {
  for (const c of await listCodecs(w, h, fps, bitrate)) if (await trialEncode(c, w, h, fps, bitrate)) return c;
  return null;
}

export const CODEC_NAME: Record<Mux, string> = { avc: "H.264", hevc: "HEVC", av1: "AV1", vp9: "VP9" };
/** Where a codec's files play, in a sentence (H.264 plays everywhere, so it has none). */
export const CODEC_NOTE: Partial<Record<Mux, string>> = {
  hevc: "HEVC plays on Apple devices, recent Windows and most TVs.",
  av1: "AV1 plays in Chrome, Edge, Firefox, VLC and on YouTube; older phones and QuickTime may not open it.",
  vp9: "VP9 plays in Chrome, Edge, Firefox and VLC; QuickTime and iPhones won't open it.",
};

/** The soundtrack, decoded; null for none (or one this browser can't read: the picture still exports). */
export async function soundOf(file: Blob): Promise<AudioBuffer | null> {
  // decoding needs the whole file in memory more than once: past this, the picture goes out without sound
  if (file.size > 1.2e9) return null;
  try {
    const oc = new OfflineAudioContext(2, 48000, 48000);
    const buf = await oc.decodeAudioData(await file.arrayBuffer());
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}
/** A part of a soundtrack, from start to end seconds. */
export function sliceAudio(buf: AudioBuffer, start: number, end: number): AudioBuffer {
  const a = Math.max(0, Math.floor(start * buf.sampleRate)), b = Math.min(buf.length, Math.ceil(end * buf.sampleRate));
  const out = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: Math.max(1, b - a), sampleRate: buf.sampleRate });
  for (let ch = 0; ch < buf.numberOfChannels; ch++) out.copyToChannel(buf.getChannelData(ch).subarray(a, b), ch);
  return out;
}

/** Keep the screen (and so the job) awake; returns how to let it sleep again. */
async function stayAwake(): Promise<() => void> {
  let lock: any = null;
  const take = async () => {
    try {
      lock = await (navigator as any).wakeLock?.request("screen");
    } catch {}
  };
  // the lock drops whenever the tab is hidden; take it again when it's back
  const onVis = () => document.visibilityState === "visible" && void take();
  await take();
  document.addEventListener("visibilitychange", onVis);
  return () => {
    document.removeEventListener("visibilitychange", onVis);
    lock?.release?.().catch?.(() => {});
  };
}

export interface UpscaleProgress {
  frame: number;
  frames: number;
  /** frames finished per second, lately */
  speed?: number;
}
export interface UpscaleResult {
  /** the file, when it was built in memory (not when written straight to disk) */
  blob?: Blob;
  savedToDisk: boolean;
  w: number;
  h: number;
  frames: number;
  seconds: number;
  codec: Mux;
  audio?: "aac" | "opus";
  notes: string[];
}

export async function upscaleVideo(
  file: Blob,
  opts: {
    target: TargetId;
    look: Look;
    /** a part of the video, in seconds; the whole video when absent */
    range?: { start: number; end: number };
    /** write the file here as it's made (File System Access API): no memory limit */
    sink?: FileSystemWritableFileStream;
    onProgress?: (p: number, label: string, info?: UpscaleProgress) => void;
    signal?: AbortSignal;
  },
): Promise<UpscaleResult> {
  const say = opts.onProgress ?? (() => {});
  const aborted = () => opts.signal?.aborted;
  const cancel = () => new DOMException("Upscale cancelled", "AbortError");
  say(0, "Reading the video");
  const src = await probe(file);
  const notes: string[] = [];
  let up: Upscaler | null = null;
  let venc: VideoEncoder | null = null;
  const wake = await stayAwake();
  try {
    const [W, H] = targetSize(src, opts.target);
    const fps = src.fps;
    const bitrate = upscaleBitrate(W, H, fps);
    const part = frameRange(src.duration, fps, opts.range?.start, opts.range?.end);
    const seconds = part.count / fps;
    const bytes = outputBytes(W, H, fps, seconds);
    if (!opts.sink && bytes > MEMORY_LIMIT)
      throw new Error(`At ${W}×${H} this ${Math.round(seconds)}-second video would be about ${(bytes / 1e9).toFixed(1)} GB, more than a browser tab can hold. Choose "Save straight to disk" (Chrome or Edge on a computer), pick a smaller size, or upscale a shorter part.`);

    say(0, "Testing the encoder");
    const vc = await workingCodec(W, H, fps, bitrate);
    if (aborted()) throw cancel();
    if (!vc) throw new Error(`This browser can't encode ${W}×${H} video. Try Chrome or Edge on a desktop, or a smaller size.`);
    if (CODEC_NOTE[vc.mux]) notes.push(`Saved as ${CODEC_NAME[vc.mux]}: this browser can't make H.264 at this size. ${CODEC_NOTE[vc.mux]}`);
    up = new Upscaler(W, H);

    say(0, "Reading the sound");
    const whole = await soundOf(file);
    if (aborted()) throw cancel();
    if (!whole && file.size > 1.2e9) notes.push("The file is too large to read its sound in the browser, so the upscaled video is silent.");
    const audio = whole && opts.range ? sliceAudio(whole, part.start, part.end) : whole;
    const sound = audio ? await encodeAudio(audio, opts.signal) : null;
    if (sound?.note) notes.push(sound.note);

    const muxer = new Muxer({
      target: opts.sink ? new FileSystemWritableFileStreamTarget(opts.sink) : new ArrayBufferTarget(),
      video: { codec: vc.mux, width: W, height: H, frameRate: fps },
      ...(sound && { audio: { codec: sound.mux, numberOfChannels: 2, sampleRate: 48000 } }),
      // in memory the index goes up front (plays while downloading); on disk it goes at the end
      fastStart: opts.sink ? false : "in-memory",
      firstTimestampBehavior: "offset",
    });
    let failure: Error | null = null;
    let lastOutput = Date.now();
    let made = 0;
    venc = new VideoEncoder({
      output: (c, m) => {
        lastOutput = Date.now();
        made++;
        muxer.addVideoChunk(c, m);
      },
      error: (e) => (failure = e as Error),
    });
    venc.configure(encoderConfig(vc, W, H, fps, bitrate));

    // sound goes in alongside the picture, so a file on disk is interleaved like any other MP4
    let nextAudio = 0;
    const addAudioUntil = (us: number) => {
      if (!sound) return;
      while (nextAudio < sound.chunks.length && sound.chunks[nextAudio].timestamp <= us) {
        const c = sound.chunks[nextAudio];
        muxer.addAudioChunkRaw(c.data, "key", c.timestamp, c.duration, nextAudio === 0 ? { decoderConfig: sound.config } : undefined);
        nextAudio++;
      }
    };
    const STALL_MS = 90_000;
    const waitForEncoder = async (max: number) => {
      while (venc!.encodeQueueSize > max) {
        if (failure) throw failure;
        if (aborted()) throw cancel();
        if (Date.now() - lastOutput > STALL_MS) throw new Error("The video encoder stopped responding. Close other tabs or apps using the graphics card, then try again (a smaller size is easier on the machine).");
        await new Promise<void>((r) => {
          const t = setTimeout(r, 50);
          venc!.addEventListener("dequeue", () => (clearTimeout(t), r()), { once: true });
        });
      }
    };

    const frames = part.count;
    const gop = Math.round(fps * 2);
    const label = `Upscaling to ${W}×${H}`;
    let resets = 0;
    const t0 = performance.now();
    let mark = { t: t0, i: 0 }, speed: number | undefined;
    for (let i = 0; i < frames; i++) {
      if (aborted()) throw cancel();
      if (failure) throw failure;
      const at = (part.first + i + 0.5) / fps; // the middle of the frame's time, so a seek never lands on the one before
      await seek(src.video, Math.min(src.duration - 1e-3, at));
      up.render(src.video, src.w, src.h, opts.look);
      if (up.lost) {
        // the graphics card reset: make a new pipeline and draw this frame again
        if (++resets > 3) throw new Error("The graphics card kept resetting. Close other tabs or apps using it, then try a smaller size.");
        try {
          up.dispose();
        } catch {}
        await new Promise((r) => setTimeout(r, 400));
        up = new Upscaler(W, H);
        up.render(src.video, src.w, src.h, opts.look);
        if (up.lost) throw new Error("The graphics card isn't available right now. Reload the page and try again.");
        notes.push("The graphics card reset during the upscale; it recovered and carried on.");
      }
      addAudioUntil(((i + 1) * 1e6) / fps);
      const frame = new VideoFrame(up.canvas as HTMLCanvasElement, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      venc.encode(frame, { keyFrame: i % gop === 0 });
      frame.close();
      await waitForEncoder(4);
      if (i % 4 === 0 || i === frames - 1) {
        const now = performance.now();
        if (now - mark.t > 1500) (speed = ((i - mark.i) * 1000) / (now - mark.t)), (mark = { t: now, i });
        say((i / frames) * 0.98, label, { frame: i + 1, frames, speed });
        await yieldNow();
      }
    }
    say(0.98, "Finishing the file", { frame: frames, frames, speed });
    await Promise.race([venc.flush(), new Promise((_, rej) => setTimeout(() => rej(new Error("The video encoder didn't finish. Try again, or pick a smaller size.")), STALL_MS))]);
    if (failure) throw failure;
    venc.close();
    venc = null;
    if (made === 0) throw new Error("The encoder produced no video. Try again, or pick a smaller size.");
    addAudioUntil(Infinity);
    muxer.finalize();
    let blob: Blob | undefined;
    if (opts.sink) await opts.sink.close();
    else blob = new Blob([(muxer.target as ArrayBufferTarget).buffer], { type: "video/mp4" });
    say(1, "Done", { frame: frames, frames, speed });
    return { blob, savedToDisk: !!opts.sink, w: W, h: H, frames, seconds, codec: vc.mux, audio: sound?.mux, notes: [...new Set(notes)] };
  } catch (e) {
    // a half-written file on disk is thrown away, not left looking finished
    if (opts.sink) await opts.sink.abort().catch(() => {});
    throw e;
  } finally {
    wake();
    try {
      if (venc && venc.state !== "closed") venc.close();
    } catch {}
    up?.dispose();
    src.video.removeAttribute("src");
    src.video.load();
    URL.revokeObjectURL(src.url);
  }
}
