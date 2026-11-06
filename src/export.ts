// Real-time video export: renders the project to an offscreen canvas at full resolution while
// the voice-over and music play into a MediaStreamDestination, then records both with MediaRecorder.
import type { Aspect, Project } from "./types";
import { ASPECT_SIZE } from "./types";
import { Renderer, totalDuration } from "./engine/render";
import { images } from "./runtime";
import { speechRegions } from "./audio/analyze";
import { Muxer, ArrayBufferTarget } from "mp4-muxer";

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

export function projectImageRefs(p: Project) {
  return [p.brand.logo, ...p.scenes.flatMap((s) => [s.image, ...(s.images ?? [])])];
}

type ExportOpts = { fps?: number; bitrate?: number; onProgress?: (p: number) => void; signal?: AbortSignal };

/** Frame-accurate export via WebCodecs (faster than real time, never drops frames); falls back to MediaRecorder. */
export async function exportVideo(project: Project, aspect: Aspect, opts: ExportOpts): Promise<{ blob: Blob; ext: string }> {
  if (typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined") {
    const codec = await pickVideoCodec(...ASPECT_SIZE[aspect], opts.fps ?? 30);
    if (codec) return exportWebCodecs(project, aspect, codec, opts);
  }
  return exportRealtime(project, aspect, opts);
}

async function pickVideoCodec(width: number, height: number, framerate: number) {
  const cands = [
    { codec: "avc1.640033", mux: "avc" as const },
    { codec: "avc1.4d0033", mux: "avc" as const },
    { codec: "vp09.00.41.08", mux: "vp9" as const },
    { codec: "av01.0.08M.08", mux: "av1" as const },
  ];
  for (const c of cands) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec: c.codec, width, height, bitrate: 12e6, framerate });
      if (r.supported) return c;
    } catch {}
  }
  return null;
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
    src.connect(oc.destination);
    src.start(0);
  }
  if (p.music) {
    const src = oc.createBufferSource();
    src.buffer = await decode(p.music.url);
    src.loop = true;
    const g = oc.createGain();
    const v = p.music.volume;
    g.gain.setValueAtTime(v, 0);
    if (p.audio)
      for (const reg of speechRegions(p.audio)) {
        g.gain.setTargetAtTime(v * 0.4, reg.s, 0.08);
        g.gain.setTargetAtTime(v, reg.e, 0.25);
      }
    g.gain.setTargetAtTime(0, Math.max(0, duration - 0.8), 0.25);
    src.connect(g).connect(oc.destination);
    src.start(0);
  }
  return oc.startRendering();
}

async function exportWebCodecs(project: Project, aspect: Aspect, vc: { codec: string; mux: "avc" | "vp9" | "av1" }, opts: ExportOpts) {
  const p: Project = { ...project, aspect };
  const [W, H] = ASPECT_SIZE[aspect];
  const fps = opts.fps ?? 30;
  const duration = Math.max(totalDuration(p), 0.5);
  const canvas = document.createElement("canvas");
  const r = new Renderer(canvas, W, H, 1);
  await document.fonts.ready;
  await images.preload(projectImageRefs(p));

  const audio = await mixAudio(p, duration);
  let ac: { codec: string; mux: "aac" | "opus" } | null = null;
  if (audio && typeof AudioEncoder !== "undefined") {
    for (const c of [{ codec: "mp4a.40.2", mux: "aac" as const }, { codec: "opus", mux: "opus" as const }]) {
      try {
        if ((await AudioEncoder.isConfigSupported({ codec: c.codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 })).supported) {
          ac = c;
          break;
        }
      } catch {}
    }
  }
  const audioOk = !!ac;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: vc.mux, width: W, height: H, frameRate: fps },
    ...(ac && { audio: { codec: ac.mux, numberOfChannels: 2, sampleRate: 48000 } }),
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });
  let failure: Error | null = null;
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (failure = e as Error) });
  venc.configure({ codec: vc.codec, width: W, height: H, bitrate: opts.bitrate ?? (W * H > 2e6 ? 16e6 : 10e6), framerate: fps, ...(vc.mux === "avc" && { avc: { format: "avc" as const } }) });

  const frames = Math.ceil(duration * fps);
  for (let i = 0; i < frames; i++) {
    if (opts.signal?.aborted) {
      venc.close();
      throw new DOMException("Export cancelled", "AbortError");
    }
    if (failure) throw failure;
    r.render(p, i / fps, images.get);
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

  if (ac && audio) {
    const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => (failure = e as Error) });
    aenc.configure({ codec: ac.codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 });
    const L = audio.getChannelData(0), R = audio.getChannelData(audio.numberOfChannels > 1 ? 1 : 0);
    const block = 4800;
    for (let off = 0; off < audio.length; off += block) {
      const n = Math.min(block, audio.length - off);
      const data = new Float32Array(n * 2);
      data.set(L.subarray(off, off + n), 0);
      data.set(R.subarray(off, off + n), n);
      const ad = new AudioData({ format: "f32-planar", sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((off / 48000) * 1e6), data });
      aenc.encode(ad);
      ad.close();
    }
    await aenc.flush();
    aenc.close();
  }
  if (failure) throw failure;
  muxer.finalize();
  opts.onProgress?.(1);
  return { blob: new Blob([muxer.target.buffer], { type: "video/mp4" }), ext: "mp4" };
}

/** Fallback: render in real time and capture with MediaRecorder. */
async function exportRealtime(
  project: Project,
  aspect: Aspect,
  opts: ExportOpts,
): Promise<{ blob: Blob; ext: string }> {
  const p: Project = { ...project, aspect };
  const [W, H] = ASPECT_SIZE[aspect];
  const fps = opts.fps ?? 30;
  const canvas = document.createElement("canvas");
  const r = new Renderer(canvas, W, H, 1);
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
    src.connect(dest);
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
  const rec = new MediaRecorder(stream, { ...(mime && { mimeType: mime }), videoBitsPerSecond: opts.bitrate ?? (W * H > 2e6 ? 16e6 : 10e6), audioBitsPerSecond: 192_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((res) => (rec.onstop = () => res()));
  rec.start(250);

  const t0 = ac.currentTime + 0.15;
  for (const s of sources) s.start(t0);
  if (musicGain && p.audio) {
    // duck music under speech
    const v = p.music!.volume;
    musicGain.gain.setValueAtTime(v, t0);
    for (const reg of speechRegions(p.audio)) {
      musicGain.gain.setTargetAtTime(v * 0.4, t0 + reg.s, 0.08);
      musicGain.gain.setTargetAtTime(v, t0 + reg.e, 0.25);
    }
    musicGain.gain.setTargetAtTime(0, t0 + duration - 0.6, 0.2); // fade out
  }

  await new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (opts.signal?.aborted) return reject(new DOMException("Export cancelled", "AbortError"));
      const t = ac.currentTime - t0;
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

export function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export async function posterPng(project: Project, t: number): Promise<Blob> {
  const [W, H] = ASPECT_SIZE[project.aspect];
  const c = document.createElement("canvas");
  const r = new Renderer(c, W, H, 1);
  await images.preload(projectImageRefs(project));
  r.render(project, t, images.get);
  return new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
}
