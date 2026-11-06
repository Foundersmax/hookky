// Frame-exact clip decoding for exports. The MP4 is demuxed with mp4box and decoded with
// WebCodecs, so frame N of the output always shows exactly the clip frame on screen at that
// moment (seeking a <video> element can't promise that). Access is usually sequential, so the
// decoder keeps running forward; it restarts from the nearest keyframe only when it must.
import { createFile, MP4BoxBuffer, DataStream, Endianness, type Sample } from "mp4box";

interface Chunk {
  /** presentation time in µs from the first frame */
  ts: number;
  dur: number;
  key: boolean;
  data: Uint8Array;
}

type Drawable = HTMLCanvasElement & { naturalWidth: number; naturalHeight: number };

const MAX_BYTES = 400e6;

export class ClipDecoder {
  /** A canvas holding the current frame, drawable like an image. */
  readonly canvas: Drawable;
  readonly duration: number;
  private dec: VideoDecoder | null = null;
  private fed = -1;
  private flushed = false;
  private frames: VideoFrame[] = [];
  private waiters: (() => void)[] = [];
  private failure: Error | null = null;
  private shown = -1;
  private sortedTs: number[];

  private constructor(
    private chunks: Chunk[],
    private config: VideoDecoderConfig,
    width: number,
    height: number,
  ) {
    const c = document.createElement("canvas") as Drawable;
    c.width = width;
    c.height = height;
    Object.defineProperty(c, "naturalWidth", { get: () => c.width });
    Object.defineProperty(c, "naturalHeight", { get: () => c.height });
    this.canvas = c;
    this.sortedTs = chunks.map((c) => c.ts).sort((a, b) => a - b);
    const last = chunks.reduce((m, c) => Math.max(m, c.ts + c.dur), 0);
    this.duration = last / 1e6;
  }

  /** Open an MP4/MOV clip for exact decoding, or null when it isn't one this browser can decode. */
  static async open(src: string): Promise<ClipDecoder | null> {
    if (typeof VideoDecoder === "undefined") return null;
    try {
      const res = await fetch(src);
      if (!res.ok || Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
      const buf = await res.arrayBuffer();
      return await ClipDecoder.fromBuffer(buf);
    } catch {
      return null;
    }
  }

  static async fromBuffer(buf: ArrayBuffer): Promise<ClipDecoder | null> {
    const file = createFile();
    const samples: Sample[] = [];
    let track: { id: number; codec: string; timescale: number; video?: { width: number; height: number } } | undefined;
    file.onReady = (info) => {
      track = info.videoTracks?.[0] as typeof track;
      if (!track) return;
      file.setExtractionOptions(track.id, null, { nbSamples: Infinity });
      file.start();
    };
    file.onSamples = (_id, _user, list) => void samples.push(...list);
    file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(buf, 0), true);
    file.flush();
    if (!track || !samples.length) return null;

    // The decoder needs the codec's setup record (avcC / hvcC / vpcC / av1C) without its box header.
    let description: Uint8Array | undefined;
    for (const entry of file.getTrackById(track.id).mdia.minf.stbl.stsd.entries as any[]) {
      const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
      if (box) {
        const s = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
        box.write(s);
        description = new Uint8Array(s.buffer, 8);
        break;
      }
    }
    const width = track.video?.width ?? 0, height = track.video?.height ?? 0;
    const config: VideoDecoderConfig = { codec: track.codec, codedWidth: width, codedHeight: height, ...(description && { description }) };
    const support = await VideoDecoder.isConfigSupported(config).catch(() => null);
    if (!support?.supported || !width || !height) return null;

    // Time zero is the first presented frame (B-frame reordering shifts composition times).
    const ts0 = Math.min(...samples.map((s) => s.cts));
    const chunks = samples
      .filter((s) => s.data)
      .map((s) => ({ ts: Math.round(((s.cts - ts0) / s.timescale) * 1e6), dur: Math.round((s.duration / s.timescale) * 1e6), key: s.is_sync, data: s.data! }));
    if (!chunks.length || !chunks[0].key) return null;
    return new ClipDecoder(chunks, config, width, height);
  }

  private start(fromKey: number) {
    this.dec?.close();
    for (const f of this.frames) f.close();
    this.frames = [];
    this.failure = null;
    this.flushed = false;
    this.dec = new VideoDecoder({
      output: (f) => {
        this.frames.push(f);
        this.frames.sort((a, b) => a.timestamp - b.timestamp);
        this.wake();
      },
      error: (e) => {
        this.failure = e instanceof Error ? e : new Error(String(e));
        this.wake();
      },
    });
    this.dec.configure(this.config);
    this.fed = fromKey - 1;
  }

  private wake() {
    const w = this.waiters;
    this.waiters = [];
    for (const fn of w) fn();
  }
  private nextOutput() {
    return new Promise<void>((res) => {
      const t = setTimeout(res, 1000);
      this.waiters.push(() => (clearTimeout(t), res()));
    });
  }

  /** Draw the frame on screen at clip time t (seconds) into `canvas`. */
  async frameAt(t: number): Promise<Drawable> {
    // The frame showing at t: the last one that starts at or before it (1 ms of slack for rounding).
    const want = this.sortedTs[Math.max(0, upperBound(this.sortedTs, t * 1e6 + 1000) - 1)];
    if (want === this.shown) return this.canvas;
    const di = this.chunks.findIndex((c) => c.ts === want);
    let key = di;
    while (key > 0 && !this.chunks[key].key) key--;

    let f = this.frames.find((x) => x.timestamp === want);
    // Restart from the keyframe when the target is behind what was shown (those frames are
    // released), after a final flush, or when it's more than a keyframe ahead (skip the gap).
    // A target already fed but not found is still in the decoder's reorder buffer: keep going.
    if (!f && (!this.dec || this.flushed || want < this.shown || key > this.fed + 1)) this.start(key);

    for (let guard = 0; !f && guard < 100000; guard++) {
      if (this.failure) throw this.failure;
      if (this.fed < this.chunks.length - 1 && this.dec!.decodeQueueSize < 6) {
        const c = this.chunks[++this.fed];
        this.dec!.decode(new EncodedVideoChunk({ type: c.key ? "key" : "delta", timestamp: c.ts, duration: c.dur, data: c.data }));
      } else if (this.fed >= this.chunks.length - 1) {
        await this.dec!.flush();
        this.flushed = true;
        f = this.frames.find((x) => x.timestamp === want);
        break;
      } else await this.nextOutput();
      f = this.frames.find((x) => x.timestamp === want);
    }
    if (!f) f = [...this.frames].reverse().find((x) => x.timestamp <= want) ?? this.frames[0];
    if (!f) return this.canvas;

    const g = this.canvas.getContext("2d")!;
    if (this.canvas.width !== f.displayWidth || this.canvas.height !== f.displayHeight) {
      this.canvas.width = f.displayWidth;
      this.canvas.height = f.displayHeight;
    }
    g.drawImage(f, 0, 0, this.canvas.width, this.canvas.height);
    this.shown = f.timestamp;
    // Frames before this one are behind the export: release them (decoders have small frame pools).
    this.frames = this.frames.filter((x) => (x.timestamp < f!.timestamp ? (x.close(), false) : true));
    return this.canvas;
  }

  close() {
    for (const f of this.frames) f.close();
    this.frames = [];
    try {
      this.dec?.close();
    } catch {
      /* already closed */
    }
    this.dec = null;
  }
}

function upperBound(a: number[], x: number) {
  let lo = 0, hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m] <= x) lo = m + 1;
    else hi = m;
  }
  return lo;
}
