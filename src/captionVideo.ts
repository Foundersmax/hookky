// Captions for an uploaded video: its speech is transcribed (word timings), then the captions
// are drawn over every frame and the result is encoded in the browser. The picture never leaves
// the device; only a small mono copy of the soundtrack is sent for transcription.
import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import type { Brand, CaptionStyle, Word } from "./types";
import { encodeAudio } from "./export";
import { renderCaptions } from "./engine/captions";
export { spreadWords } from "./captionWords";
import { probe, seek, soundOf, pickCodec, upscaleBitrate, CODEC_NAME, CODEC_NOTE } from "./upscale/run";

/** The soundtrack as a 16 kHz mono WAV: all a transcriber needs, at ~2 MB a minute. */
export async function speechWav(file: Blob): Promise<Blob> {
  let buf: AudioBuffer;
  try {
    buf = await new OfflineAudioContext(1, 16000, 16000).decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error("This video has no sound to transcribe (or this browser can't read its soundtrack).");
  }
  if (!buf.length) throw new Error("This video has no sound to transcribe.");
  const n = buf.length, ch = buf.numberOfChannels;
  const pcm = new Int16Array(n);
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) pcm[i] += Math.max(-1, Math.min(1, d[i])) * (32767 / ch);
  }
  const head = new DataView(new ArrayBuffer(44));
  const put = (o: number, s: string) => [...s].forEach((c, i) => head.setUint8(o + i, c.charCodeAt(0)));
  put(0, "RIFF"); head.setUint32(4, 36 + n * 2, true); put(8, "WAVE"); put(12, "fmt ");
  head.setUint32(16, 16, true); head.setUint16(20, 1, true); head.setUint16(22, 1, true); head.setUint32(24, 16000, true);
  head.setUint32(28, 32000, true); head.setUint16(32, 2, true); head.setUint16(34, 16, true); put(36, "data"); head.setUint32(40, n * 2, true);
  return new Blob([head, pcm], { type: "audio/wav" });
}

/** Transcribe a video's speech into timed words. */
export async function transcribeVideo(file: Blob, signal?: AbortSignal): Promise<Word[]> {
  const wav = await speechWav(file);
  if (wav.size > 24 * 1024 * 1024) throw new Error("That's more than about 12 minutes of sound, too long to transcribe in one go. Trim the video first.");
  const fd = new FormData();
  fd.append("audio", wav, "speech.wav");
  const t = AbortSignal.timeout(180_000);
  const r = await fetch("/api/transcribe", { method: "POST", body: fd, signal: signal ? AbortSignal.any([signal, t]) : t });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(String(j.error ?? `The transcription failed (${r.status}).`));
  const words: Word[] = (Array.isArray(j.words) ? j.words : []).filter((w: any) => w && typeof w.w === "string" && w.w.trim() && Number.isFinite(w.s) && Number.isFinite(w.e)).map((w: any) => ({ w: w.w.trim(), s: +w.s, e: Math.max(+w.e, +w.s + 0.05) }));
  if (!words.length) throw new Error("No speech was found in this video.");
  return words;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export interface CaptionedResult {
  blob: Blob;
  w: number;
  h: number;
  frames: number;
  codec: string;
  audio?: "aac" | "opus";
  notes: string[];
}

/** Burn captions into a video file; the result keeps its size, frame rate and sound. */
export async function captionVideo(
  file: Blob,
  opts: { words: Word[]; style?: CaptionStyle; brand: Pick<Brand, "accent" | "fontDisplay" | "fontBody">; onProgress?: (p: number, label: string) => void; signal?: AbortSignal },
): Promise<CaptionedResult> {
  const say = opts.onProgress ?? (() => {});
  say(0, "Reading the video");
  const src = await probe(file);
  const notes: string[] = [];
  try {
    const W = even(src.w), H = even(src.h), fps = src.fps;
    const bitrate = upscaleBitrate(W, H, fps);
    if ((bitrate * src.duration) / 8 > 1.6e9) throw new Error("This video is too long to caption in a browser tab at its size. Trim it or use a smaller copy.");
    const vc = await pickCodec(W, H, fps, bitrate);
    if (!vc) throw new Error(`This browser can't encode ${W}×${H} video. Try Chrome or Edge on a desktop.`);
    if (CODEC_NOTE[vc.mux]) notes.push(`Saved as ${CODEC_NAME[vc.mux]}: this browser can't make H.264 at this size. ${CODEC_NOTE[vc.mux]}`);
    await document.fonts?.ready;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { alpha: false })!;

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
    for (let i = 0; i < frames; i++) {
      if (opts.signal?.aborted) {
        venc.close();
        throw new DOMException("Cancelled", "AbortError");
      }
      if (failure) throw failure;
      const t = (i + 0.5) / fps;
      await seek(src.video, Math.min(src.duration - 1e-3, t));
      ctx.drawImage(src.video, 0, 0, W, H);
      renderCaptions(ctx, W, H, { words: opts.words, style: opts.style, brand: opts.brand, t });
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      venc.encode(frame, { keyFrame: i % gop === 0 });
      frame.close();
      while (venc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 4));
      if (i % 4 === 0) {
        say((i / frames) * 0.98, "Adding the captions");
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    await venc.flush();
    venc.close();
    if (failure) throw failure;
    if (sound) sound.chunks.forEach((c, i) => muxer.addAudioChunkRaw(c.data, "key", c.timestamp, c.duration, i === 0 ? { decoderConfig: sound.config } : undefined));
    muxer.finalize();
    say(1, "Done");
    return { blob: new Blob([muxer.target.buffer], { type: "video/mp4" }), w: W, h: H, frames, codec: CODEC_NAME[vc.mux], audio: sound?.mux, notes };
  } finally {
    src.video.removeAttribute("src");
    src.video.load();
    URL.revokeObjectURL(src.url);
  }
}
