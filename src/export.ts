// Real-time video export: renders the project to an offscreen canvas at full resolution while
// the voice-over and music play into a MediaStreamDestination, then records both with MediaRecorder.
import type { Aspect, Project } from "./types";
import { ASPECT_SIZE } from "./types";
import { Renderer, totalDuration, visibleAt, clipTimeAt } from "./engine/render";
import { VideoSeeker } from "./engine/videos";
import { images } from "./runtime";
import { musicEnvelope, voiceGain, musicTime } from "./audio/mix";
import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { parseAdts } from "./adts";
import { downloadsCap, isHosted } from "./host";

export function pickMime(): { mime: string; ext: string } {
  const cands = [
    { mime: "video/mp4;codecs=avc1.640028,mp4a.40.2", ext: "mp4" },
    { mime: "video/mp4", ext: "mp4" },
    { mime: "video/webm;codecs=vp9,opus", ext: "webm" },
    { mime: "video/webm;codecs=vp8,opus", ext: "webm" },
    { mime: "video/webm", ext: "webm" },
  ];
  return cands.find((c) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c.mime)) ?? { mime: "", ext: "webm" };
}

/** Video clips on screen at time t, and the clip time each should show. */
export function videoTargets(p: Project, t: number): Map<string, number> {
  const m = new Map<string, number>();
  // Previous scene first, so the incoming scene wins if both use the same clip.
  for (const { entry, lt } of visibleAt(p, t).reverse())
    for (const ref of [entry.scene.image, ...(entry.scene.images ?? []), ...(entry.scene.backdrop ?? [])]) {
      const a = images.asset(ref);
      const src = a && images.videoSrc(a);
      if (src) m.set(src, clipTimeAt(entry.scene, lt));
    }
  return m;
}

/** Render one frame exactly: seek any clips on screen, then draw. */
export async function renderExact(r: Renderer, p: Project, t: number, seeker: VideoSeeker) {
  const wanted = videoTargets(p, t);
  if (wanted.size) await seeker.prepare(wanted);
  r.render(p, t, images.exact(seeker));
}

export function projectImageRefs(p: Project) {
  return [p.brand.logo, ...p.scenes.flatMap((s) => [s.image, ...(s.images ?? []), ...(s.backdrop ?? [])])];
}

type ExportOpts = {
  fps?: number;
  /** 1 = 1080p-class (1920×1080 for 16:9), 2 = 4K-class (3840×2160). */
  scale?: number;
  bitrate?: number;
  onProgress?: (p: number) => void;
  /** what the export is doing now ("Encoding the sound", …) */
  onStage?: (label: string) => void;
  signal?: AbortSignal;
};
export type ExportResult = { blob: Blob; ext: string; audio?: "aac" | "opus"; note?: string };

/** Output size in pixels for a format at a quality scale. */
export const outputSize = (aspect: Aspect, scale = 1): [number, number] => {
  const [W, H] = ASPECT_SIZE[aspect];
  return [Math.round(W * scale), Math.round(H * scale)];
};

/** A bitrate that keeps minimal motion graphics clean: more for 4K and for 60 fps. */
export function videoBitrate(width: number, height: number, fps: number) {
  const px = width * height;
  const base = px <= 2.1e6 ? 10e6 : px <= 4.2e6 ? 16e6 : 40e6;
  return Math.round(base * (fps > 30 ? 1.5 : 1));
}

/** Frame-accurate export via WebCodecs (faster than real time, never drops frames); falls back to MediaRecorder. */
export async function exportVideo(project: Project, aspect: Aspect, opts: ExportOpts): Promise<ExportResult> {
  if (typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined") {
    const codec = await pickVideoCodec(...outputSize(aspect, opts.scale), opts.fps ?? 30);
    if (codec) return exportWebCodecs(project, aspect, codec, opts);
  }
  return exportRealtime(project, aspect, opts);
}

export async function pickVideoCodec(width: number, height: number, framerate: number) {
  const cands = [
    // H.264 High at level 5.1 covers up to 4K30; level 5.2 adds 4K60.
    { codec: "avc1.640033", mux: "avc" as const },
    { codec: "avc1.640034", mux: "avc" as const },
    { codec: "avc1.4d0033", mux: "avc" as const },
    { codec: "avc1.4d0034", mux: "avc" as const },
    { codec: "vp09.00.41.08", mux: "vp9" as const },
    { codec: "av01.0.08M.08", mux: "av1" as const },
  ];
  for (const c of cands) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec: c.codec, width, height, bitrate: videoBitrate(width, height, framerate), framerate });
      if (r.supported) return c;
    } catch {}
  }
  return null;
}

type RawChunk = { data: Uint8Array; timestamp: number; duration: number };
type Sound = { mux: "aac" | "opus"; config: AudioDecoderConfig; chunks: RawChunk[]; note?: string };

/** Encode the mixed sound with a WebCodecs AudioEncoder; null if the codec isn't available. */
async function encodeWith(codec: string, audio: AudioBuffer): Promise<{ config: AudioDecoderConfig; chunks: RawChunk[] } | null> {
  if (typeof AudioEncoder === "undefined") return null;
  const cfg = { codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 };
  try {
    if (!(await AudioEncoder.isConfigSupported(cfg)).supported) return null;
  } catch {
    return null;
  }
  const chunks: RawChunk[] = [];
  let config: AudioDecoderConfig | null = null;
  let failure: Error | null = null;
  const enc = new AudioEncoder({
    output: (c, m) => {
      const data = new Uint8Array(c.byteLength);
      c.copyTo(data);
      chunks.push({ data, timestamp: c.timestamp, duration: c.duration ?? 0 });
      if (m?.decoderConfig && !config) config = m.decoderConfig;
    },
    error: (e) => (failure = e as Error),
  });
  enc.configure(cfg);
  const L = audio.getChannelData(0), R = audio.getChannelData(audio.numberOfChannels > 1 ? 1 : 0);
  const block = 4800;
  for (let off = 0; off < audio.length; off += block) {
    const n = Math.min(block, audio.length - off);
    const data = new Float32Array(n * 2);
    data.set(L.subarray(off, off + n), 0);
    data.set(R.subarray(off, off + n), n);
    const ad = new AudioData({ format: "f32-planar", sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((off / 48000) * 1e6), data });
    enc.encode(ad);
    ad.close();
  }
  await enc.flush();
  enc.close();
  if (failure) throw failure;
  return { config: config ?? { codec, sampleRate: 48000, numberOfChannels: 2 }, chunks };
}

/** Opus chunks → a tiny audio-only MP4 → the server's AAC → raw AAC chunks (timed from 0). */
async function aacFromServer(opus: { config: AudioDecoderConfig; chunks: RawChunk[] }, signal?: AbortSignal): Promise<{ config: AudioDecoderConfig; chunks: RawChunk[] }> {
  const m = new Muxer({ target: new ArrayBufferTarget(), audio: { codec: "opus", numberOfChannels: 2, sampleRate: 48000 }, fastStart: "in-memory", firstTimestampBehavior: "offset" });
  opus.chunks.forEach((c, i) => m.addAudioChunkRaw(c.data, "key", c.timestamp, c.duration, i === 0 ? { decoderConfig: opus.config } : undefined));
  m.finalize();
  const t = AbortSignal.timeout(90_000);
  const r = await fetch("/api/export/aac", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: m.target.buffer, signal: signal ? AbortSignal.any([signal, t]) : t });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `HTTP ${r.status}`);
  const adts = parseAdts(new Uint8Array(await r.arrayBuffer()));
  if (!adts) throw new Error("The converted audio was empty.");
  // The encoder's first frame is its priming delay (1024 samples): drop it so sound and picture line up.
  const per = (1024 / adts.sampleRate) * 1e6;
  const frames = adts.frames.slice(1);
  return {
    config: { codec: "mp4a.40.2", sampleRate: adts.sampleRate, numberOfChannels: adts.channels || 2, description: adts.asc },
    chunks: frames.map((data, i) => ({ data, timestamp: Math.round(i * per), duration: Math.round(per) })),
  };
}

/**
 * The export's sound, as AAC wherever possible (it plays everywhere): the browser's own encoder,
 * else Opus converted to AAC by the server, else Opus as is (plays in browsers and VLC, not in
 * QuickTime or iOS Photos), with a note saying so.
 */
async function encodeAudio(audio: AudioBuffer, signal?: AbortSignal): Promise<Sound | null> {
  const aac = await encodeWith("mp4a.40.2", audio);
  if (aac) return { mux: "aac", ...aac };
  const opus = await encodeWith("opus", audio);
  if (!opus) return null;
  try {
    return { mux: "aac", ...(await aacFromServer(opus, signal)) };
  } catch (e) {
    if ((e as Error)?.name === "AbortError" && signal?.aborted) throw e;
    return { mux: "opus", ...opus, note: "This browser can't make AAC sound and the server couldn't convert it, so the sound is Opus: it plays in browsers and VLC, but not in QuickTime or iOS Photos. Export from Chrome on Mac or Windows for AAC." };
  }
}

/**
 * Invisible dither: ±1 level of noise over the frame before it's encoded. Rate control reads soft
 * dark gradients as "easy" and starves them, so they band and block; the dither turns the 8-bit
 * steps into fine texture the encoder keeps, and the gradients stay smooth.
 */
function makeDither() {
  const tile = document.createElement("canvas");
  tile.width = tile.height = 128;
  const tx = tile.getContext("2d")!;
  const d = tx.createImageData(128, 128);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = Math.random() < 0.5 ? 0 : 255;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    d.data[i + 3] = 255;
  }
  tx.putImageData(d, 0, 0);
  let pat: CanvasPattern | null = null;
  return (canvas: HTMLCanvasElement, i: number) => {
    const ctx = canvas.getContext("2d")!;
    pat ??= ctx.createPattern(tile, "repeat");
    if (!pat) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1 / 128; // about one 8-bit level either way
    ctx.globalCompositeOperation = "source-over";
    const o = (i * 37) % 128;
    ctx.translate(-o, -((i * 71) % 128));
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, canvas.width + 128, canvas.height + 128);
    ctx.restore();
  };
}

/** Mix voice-over + ducked music offline into a stereo 48k buffer. */
async function mixAudio(p: Project, duration: number): Promise<AudioBuffer | null> {
  if (!p.audio && !p.music) return null;
  const sr = 48000;
  const oc = new OfflineAudioContext(2, Math.ceil(duration * sr), sr);
  const decode = async (url: string) => oc.decodeAudioData(await (await fetch(url)).arrayBuffer());
  if (p.audio) {
    const src = oc.createBufferSource();
    src.buffer = await decode(p.audio.url);
    const g = oc.createGain();
    g.gain.value = voiceGain(p.audio);
    src.connect(g).connect(oc.destination);
    src.start(0);
  }
  if (p.music) {
    const src = oc.createBufferSource();
    src.buffer = await decode(p.music.url);
    src.loop = true;
    const g = oc.createGain();
    // The exact curve the preview plays: volume, fades and the dip under the voice-over.
    const env = musicEnvelope(p, duration);
    g.gain.setValueAtTime(env[0]?.v ?? 0, 0);
    for (const k of env.slice(1)) g.gain.linearRampToValueAtTime(k.v, k.t);
    src.connect(g).connect(oc.destination);
    src.start(0, musicTime(p.music, 0, src.buffer.duration));
  }
  return oc.startRendering();
}

async function exportWebCodecs(project: Project, aspect: Aspect, vc: { codec: string; mux: "avc" | "vp9" | "av1" }, opts: ExportOpts) {
  const p: Project = { ...project, aspect };
  const scale = opts.scale ?? 1;
  const [W, H] = outputSize(aspect, scale);
  const fps = opts.fps ?? 30;
  const duration = Math.max(totalDuration(p), 0.5);
  const canvas = document.createElement("canvas");
  const r = new Renderer(canvas, ...ASPECT_SIZE[aspect], scale);
  await document.fonts.ready;
  await images.preload(projectImageRefs(p));

  const audio = await mixAudio(p, duration);
  opts.onStage?.(audio ? "Encoding the sound" : "Rendering");
  const sound = audio ? await encodeAudio(audio, opts.signal) : null;
  const audioOk = !!sound;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: vc.mux, width: W, height: H, frameRate: fps },
    ...(sound && { audio: { codec: sound.mux, numberOfChannels: 2, sampleRate: 48000 } }),
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });
  let failure: Error | null = null;
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (failure = e as Error) });
  venc.configure({ codec: vc.codec, width: W, height: H, bitrate: opts.bitrate ?? videoBitrate(W, H, fps), framerate: fps, ...(vc.mux === "avc" && { avc: { format: "avc" as const } }) });
  const dither = makeDither();

  const frames = Math.ceil(duration * fps);
  const seeker = new VideoSeeker();
  try {
    for (let i = 0; i < frames; i++) {
      if (opts.signal?.aborted) {
        venc.close();
        throw new DOMException("Export cancelled", "AbortError");
      }
      if (failure) throw failure;
      await renderExact(r, p, i / fps, seeker);
      dither(canvas, i);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      venc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      while (venc.encodeQueueSize > 8) await new Promise((res) => setTimeout(res, 2));
      if (i % 6 === 0) {
        opts.onProgress?.((i / frames) * (audioOk ? 0.92 : 1));
        await new Promise((res) => setTimeout(res, 0)); // keep UI responsive
      }
    }
    await venc.flush();
    venc.close();
  } finally {
    seeker.dispose();
  }

  if (sound) sound.chunks.forEach((c, i) => muxer.addAudioChunkRaw(c.data, "key", c.timestamp, c.duration, i === 0 ? { decoderConfig: sound.config } : undefined));
  if (failure) throw failure;
  muxer.finalize();
  opts.onProgress?.(1);
  return { blob: new Blob([muxer.target.buffer], { type: "video/mp4" }), ext: "mp4", audio: sound?.mux, ...(sound?.note && { note: sound.note }) };
}

/** Fallback: render in real time and capture with MediaRecorder. */
async function exportRealtime(
  project: Project,
  aspect: Aspect,
  opts: ExportOpts,
): Promise<{ blob: Blob; ext: string }> {
  const p: Project = { ...project, aspect };
  const scale = opts.scale ?? 1;
  const [W, H] = outputSize(aspect, scale);
  const fps = opts.fps ?? 30;
  const canvas = document.createElement("canvas");
  const r = new Renderer(canvas, ...ASPECT_SIZE[aspect], scale);
  await document.fonts.ready;
  await images.preload(projectImageRefs(p));
  r.render(p, 0, images.get);

  const duration = Math.max(totalDuration(p), 0.5);
  const stream = canvas.captureStream(fps);
  const ac = new AudioContext();
  await ac.resume();
  const dest = ac.createMediaStreamDestination();
  const sources: AudioBufferSourceNode[] = [];
  const decode = async (url: string) => ac.decodeAudioData(await (await fetch(url)).arrayBuffer());

  if (p.audio) {
    const src = ac.createBufferSource();
    src.buffer = await decode(p.audio.url);
    const vg = ac.createGain();
    vg.gain.value = voiceGain(p.audio);
    src.connect(vg).connect(dest);
    sources.push(src);
  }
  let musicGain: GainNode | undefined;
  if (p.music) {
    const src = ac.createBufferSource();
    src.buffer = await decode(p.music.url);
    src.loop = true;
    musicGain = ac.createGain();
    musicGain.gain.value = p.music.volume;
    src.connect(musicGain).connect(dest);
    sources.push(src);
  }
  for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);

  const { mime, ext } = pickMime();
  const rec = new MediaRecorder(stream, { ...(mime && { mimeType: mime }), videoBitsPerSecond: opts.bitrate ?? videoBitrate(W, H, fps), audioBitsPerSecond: 192_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((res) => (rec.onstop = () => res()));
  rec.start(250);

  const t0 = ac.currentTime + 0.15;
  for (const s of sources) s.start(t0, s.loop && p.music ? musicTime(p.music, 0, s.buffer?.duration) : 0);
  if (musicGain) {
    const env = musicEnvelope(p, duration);
    musicGain.gain.setValueAtTime(env[0]?.v ?? 0, t0);
    for (const k of env.slice(1)) musicGain.gain.linearRampToValueAtTime(k.v, t0 + k.t);
  }

  await new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (opts.signal?.aborted) return reject(new DOMException("Export cancelled", "AbortError"));
      const t = ac.currentTime - t0;
      images.videos.playing = true;
      r.render(p, Math.max(0, t), images.get);
      opts.onProgress?.(Math.min(1, Math.max(0, t / duration)));
      if (t >= duration) return resolve();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }).finally(() => {
    for (const s of sources) try { s.stop(); } catch {}
  });

  await new Promise((r) => setTimeout(r, 250));
  rec.stop();
  await stopped;
  ac.close();
  stream.getTracks().forEach((t) => t.stop());
  return { blob: new Blob(chunks, { type: mime || "video/webm" }), ext };
}

/** Save a file: through the viewer's save prompt on claude.ai, a plain download elsewhere. */
export async function download(blob: Blob, name: string): Promise<boolean> {
  const dl = await downloadsCap;
  if (dl) {
    try {
      await dl.save({ filename: name, data: blob });
      return true;
    } catch (e: any) {
      if (e?.code === "declined") return false;
      if (!["unavailable", "not_granted", "capability_disabled", "capability_removed"].includes(e?.code)) throw new Error(e?.message || "Couldn't save the file");
      if (isHosted) throw new Error("Saving files isn't available in this view.");
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return true;
}

/** One frame as an image file: PNG by default, JPEG for smaller thumbnails. */
export async function posterPng(project: Project, t: number, opts: { aspect?: Aspect; scale?: number; type?: "image/png" | "image/jpeg" } = {}): Promise<Blob> {
  const p: Project = { ...project, aspect: opts.aspect ?? project.aspect };
  const c = document.createElement("canvas");
  const r = new Renderer(c, ...ASPECT_SIZE[p.aspect], opts.scale ?? 1);
  await document.fonts.ready;
  await images.preload(projectImageRefs(p));
  const seeker = new VideoSeeker();
  try {
    await renderExact(r, p, t, seeker);
  } finally {
    seeker.dispose();
  }
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't draw the frame"))), opts.type ?? "image/png", 0.92));
}

/** The moment that best sells the cut: the first scene with a headline, fully animated in. */
export function coverMoment(p: Project): number {
  let t = 0;
  for (const s of p.scenes) {
    if (s.headline && s.template !== "shape-burst") return t + Math.min(s.duration - 0.08, Math.max(1, s.duration * 0.72));
    t += s.duration;
  }
  return Math.min(1.5, totalDuration(p) / 2);
}
