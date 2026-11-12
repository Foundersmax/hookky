// Upscaling a video file in the browser: every frame is stepped to exactly, run through the GPU
// pipeline (clean → upscale → sharpen → enrich) and encoded; the sound is carried over as AAC.
// Nothing is uploaded except, where the browser can't encode AAC, the soundtrack for conversion.
import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { encodeAudio } from "../export";
import { Upscaler, type Look } from "./gl";
import { TARGETS, targetSize, upscaleBitrate, type TargetId } from "./size";
export { TARGETS, targetSize, upscaleBitrate, type TargetId };

export interface SourceInfo {
  w: number;
  h: number;
  duration: number;
  fps: number;
}
const RATES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];
const snapRate = (f: number) => RATES.reduce((a, b) => (Math.abs(b - f) < Math.abs(a - f) ? b : a));

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error("This file couldn't be opened as a video. MP4, MOV and WebM work best."));
    v.src = url;
  });
}
const seek = (v: HTMLVideoElement, t: number) =>
  new Promise<void>((resolve) => {
    if (Math.abs(v.currentTime - t) < 1e-4 && v.readyState >= 2) return resolve();
    const done = () => {
      v.removeEventListener("seeked", done);
      resolve();
    };
    v.addEventListener("seeked", done);
    v.currentTime = t;
  });

/** Size, length and frame rate of a video file (the rate is measured from its first frames). */
export async function probe(file: Blob): Promise<SourceInfo & { url: string; video: HTMLVideoElement }> {
  const url = URL.createObjectURL(file);
  const video = await loadVideo(url).catch((e) => {
    URL.revokeObjectURL(url);
    throw e;
  });
  if (!video.videoWidth || !isFinite(video.duration) || video.duration <= 0) {
    URL.revokeObjectURL(url);
    throw new Error("That file has no picture to upscale.");
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
      video.play().catch(() => resolve());
    });
    video.pause();
    const d = times.slice(1).map((t, i) => t - times[i]).filter((x) => x > 0.001).sort((a, b) => a - b);
    if (d.length >= 5) fps = snapRate(1 / d[Math.floor(d.length / 2)]);
    await seek(video, 0);
  }
  return { w: video.videoWidth, h: video.videoHeight, duration: video.duration, fps, url, video };
}

type Mux = "avc" | "hevc" | "av1" | "vp9";
/** The most widely playable codec this browser can encode at this size. */
export async function pickCodec(w: number, h: number, fps: number, bitrate: number): Promise<{ codec: string; mux: Mux } | null> {
  if (typeof VideoEncoder === "undefined") return null;
  const cands: { codec: string; mux: Mux }[] = [
    { codec: "avc1.640033", mux: "avc" }, { codec: "avc1.640034", mux: "avc" }, { codec: "avc1.64003c", mux: "avc" }, { codec: "avc1.64003e", mux: "avc" },
    { codec: "hvc1.1.6.L183.B0", mux: "hevc" }, { codec: "hvc1.1.6.L186.B0", mux: "hevc" },
    { codec: "av01.0.16M.08", mux: "av1" }, { codec: "av01.0.19M.08", mux: "av1" },
    { codec: "vp09.00.61.08", mux: "vp9" },
  ];
  for (const c of cands) {
    try {
      if ((await VideoEncoder.isConfigSupported({ codec: c.codec, width: w, height: h, bitrate, framerate: fps })).supported) return c;
    } catch {}
  }
  return null;
}
export const CODEC_NAME: Record<Mux, string> = { avc: "H.264", hevc: "HEVC", av1: "AV1", vp9: "VP9" };
/** Where a codec's files play, in a sentence (H.264 plays everywhere, so it has none). */
export const CODEC_NOTE: Partial<Record<Mux, string>> = {
  hevc: "HEVC plays on Apple devices, recent Windows and most TVs.",
  av1: "AV1 plays in Chrome, Edge, Firefox, VLC and on YouTube; older phones and QuickTime may not open it.",
  vp9: "VP9 plays in Chrome, Edge, Firefox and VLC; QuickTime and iPhones won't open it.",
};
async function soundOf(file: Blob): Promise<AudioBuffer | null> {
  try {
    const oc = new OfflineAudioContext(2, 48000, 48000);
    const buf = await oc.decodeAudioData(await file.arrayBuffer());
    return buf.length ? buf : null;
  } catch {
    return null; // no soundtrack, or one this browser can't read: the picture still exports
  }
}

export interface UpscaleResult {
  blob: Blob;
  w: number;
  h: number;
  frames: number;
  codec: Mux;
  audio?: "aac" | "opus";
  notes: string[];
}

export async function upscaleVideo(
  file: Blob,
  opts: { target: TargetId; look: Look; onProgress?: (p: number, label: string) => void; signal?: AbortSignal },
): Promise<UpscaleResult> {
  const say = opts.onProgress ?? (() => {});
  say(0, "Reading the video");
  const src = await probe(file);
  const notes: string[] = [];
  let up: Upscaler | null = null;
  try {
    const [W, H] = targetSize(src, opts.target);
    const fps = src.fps;
    const bitrate = upscaleBitrate(W, H, fps);
    const bytes = (bitrate * src.duration) / 8;
    if (bytes > 1.6e9) throw new Error(`At ${W}×${H} this ${Math.round(src.duration)}-second video would be about ${(bytes / 1e9).toFixed(1)} GB, more than a browser tab can hold. Pick a smaller size or a shorter clip.`);
    const vc = await pickCodec(W, H, fps, bitrate);
    if (!vc) throw new Error(`This browser can't encode ${W}×${H} video. Try Chrome or Edge on a desktop, or a smaller size.`);
    if (CODEC_NOTE[vc.mux]) notes.push(`Saved as ${CODEC_NAME[vc.mux]}: this browser can't make H.264 at this size. ${CODEC_NOTE[vc.mux]}`);
    up = new Upscaler(W, H);

    say(0, "Reading the sound");
    const audio = await soundOf(file);
    const sound = audio ? await encodeAudio(audio, opts.signal) : null;
    if (sound?.note) notes.push(sound.note);

    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: vc.mux, width: W, height: H, frameRate: fps },
      ...(sound && { audio: { codec: sound.mux, numberOfChannels: 2, sampleRate: 48000 } }),
      fastStart: "in-memory",
      firstTimestampBehavior: "offset",
    });
    let failure: Error | null = null;
    const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (failure = e as Error) });
    venc.configure({ codec: vc.codec, width: W, height: H, bitrate, framerate: fps, ...(vc.mux === "avc" && { avc: { format: "avc" as const } }), ...(vc.mux === "hevc" && { hevc: { format: "hevc" as const } }) } as VideoEncoderConfig);

    const frames = Math.max(1, Math.round(src.duration * fps));
    const gop = Math.round(fps * 2);
    const label = `Upscaling to ${W}×${H}`;
    for (let i = 0; i < frames; i++) {
      if (opts.signal?.aborted) {
        venc.close();
        throw new DOMException("Upscale cancelled", "AbortError");
      }
      if (failure) throw failure;
      // the middle of each frame's time, so a seek never lands on the frame before
      await seek(src.video, Math.min(src.duration - 1e-3, (i + 0.5) / fps));
      up.render(src.video, src.w, src.h, opts.look);
      const frame = new VideoFrame(up.canvas as HTMLCanvasElement, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      venc.encode(frame, { keyFrame: i % gop === 0 });
      frame.close();
      while (venc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 4));
      if (i % 4 === 0) {
        say((i / frames) * 0.98, label);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    await venc.flush();
    venc.close();
    if (failure) throw failure;
    if (sound) sound.chunks.forEach((c, i) => muxer.addAudioChunkRaw(c.data, "key", c.timestamp, c.duration, i === 0 ? { decoderConfig: sound.config } : undefined));
    muxer.finalize();
    say(1, "Done");
    return { blob: new Blob([muxer.target.buffer], { type: "video/mp4" }), w: W, h: H, frames, codec: vc.mux, audio: sound?.mux, notes };
  } finally {
    up?.dispose();
    src.video.removeAttribute("src");
    src.video.load();
    URL.revokeObjectURL(src.url);
  }
}
