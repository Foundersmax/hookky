// Beat detection for a music track: tempo, the beat grid, bar starts, how loud each beat is and
// where the drop lands. Pure math on mono samples (no DOM), so it runs the same in tests.
import type { MusicTrack } from "../types";

export interface BeatMap {
  bpm: number;
  /** seconds, into the file */
  beats: number[];
  /** bar starts (every 4th beat, on the strongest phase) */
  downbeats: number[];
  /** loudness of each beat, 0–1 */
  energy: number[];
  /** the biggest lift in the track, on a bar start (seconds into the file), if there is one */
  drop?: number;
}

const HOP = 0.01; // target onset envelope resolution, seconds
const MAX_ANALYSE = 240; // seconds

/** Onset strength every 10 ms: rises in log energy, full band plus extra weight on the bass. */
export function onsetEnvelope(x: Float32Array, sr: number): { onset: Float32Array; rms: Float32Array; hop: number } {
  const hop = Math.max(1, Math.round(sr * HOP));
  const n = Math.floor(Math.min(x.length, sr * MAX_ANALYSE) / hop);
  const full = new Float32Array(n), bass = new Float32Array(n), rms = new Float32Array(n);
  // One-pole low-pass at ~150 Hz for the kick and bass.
  const a = Math.exp((-2 * Math.PI * 150) / sr);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    let ef = 0, eb = 0;
    for (let j = i * hop, end = j + hop; j < end; j++) {
      const v = x[j];
      lp = (1 - a) * v + a * lp;
      ef += v * v;
      eb += lp * lp;
    }
    rms[i] = Math.sqrt(ef / hop);
    full[i] = Math.log1p(1000 * (ef / hop));
    bass[i] = Math.log1p(1000 * (eb / hop));
  }
  const onset = new Float32Array(n);
  for (let i = 1; i < n; i++) onset[i] = Math.max(0, full[i] - full[i - 1]) + 1.5 * Math.max(0, bass[i] - bass[i - 1]);
  // Remove the local mean so steady loud passages don't read as onsets.
  const w = 25;
  let sum = 0;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    sum += onset[i];
    if (i >= 2 * w) sum -= onset[i - 2 * w];
    const mean = sum / Math.min(i + 1, 2 * w);
    out[Math.max(0, i - w)] = Math.max(0, onset[Math.max(0, i - w)] - mean);
  }
  // The real frame length (sample rates like 22050 don't divide into 10 ms exactly).
  return { onset: out, rms, hop: hop / sr };
}

/** Beat period in envelope frames: autocorrelation over 70–180 bpm, leaning towards ~115 bpm. */
export function estimatePeriod(onset: Float32Array, HOP = 0.01): number {
  const minLag = Math.round(60 / 180 / HOP), maxLag = Math.round(60 / 70 / HOP);
  const n = onset.length;
  const ac = new Float64Array(maxLag * 2 + 2);
  for (let lag = minLag; lag <= Math.min(maxLag * 2, n - 1); lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += onset[i] * onset[i - lag];
    ac[lag] = s / (n - lag);
  }
  let best = 0, bestLag = Math.round(60 / 120 / HOP);
  for (let lag = minLag; lag <= maxLag; lag++) {
    // A real beat also lines up at twice its period.
    const score = (ac[lag] + 0.5 * (ac[lag * 2] ?? 0)) * Math.exp(-0.5 * Math.log2((60 / (lag * HOP)) / 115) ** 2 / 0.8 ** 2);
    if (score > best) (best = score), (bestLag = lag);
  }
  // Parabolic refinement for a fractional period.
  const y0 = ac[bestLag - 1] ?? 0, y1 = ac[bestLag], y2 = ac[bestLag + 1] ?? 0;
  const d = y0 - 2 * y1 + y2;
  const shift = d < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / d)) : 0;
  return bestLag + shift;
}

/** Analyse mono samples into a beat map. Returns undefined for silence or very short clips. */
export function detectBeats(x: Float32Array, sr: number, fileDuration = x.length / sr): BeatMap | undefined {
  if (fileDuration < 2) return undefined;
  const { onset, rms, hop: HOP } = onsetEnvelope(x, sr);
  const n = onset.length;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, onset[i]);
  if (peak < 1e-4) return undefined;

  const period = estimatePeriod(onset, HOP);
  // Phase: the offset whose grid collects the most onset strength.
  const P = Math.round(period);
  let bestPhase = 0, bestSum = -1;
  for (let ph = 0; ph < P; ph++) {
    let s = 0;
    for (let t = ph; t < n; t += period) s += onset[Math.round(t)] ?? 0;
    if (s > bestSum) (bestSum = s), (bestPhase = ph);
  }
  // Walk the grid, letting each beat settle on a nearby onset peak (tempo drift, swing).
  const beatsF: number[] = [];
  const win = Math.max(1, Math.round(period * 0.08));
  for (let t = bestPhase; t < n; ) {
    let at = Math.round(t), top = -1;
    for (let k = -win; k <= win; k++) {
      // The strongest onset nearby, with a slight preference for the expected spot.
      const v = (onset[Math.round(t) + k] ?? -1) * (1 - (0.3 * Math.abs(k)) / (win + 1));
      if (v > top) (top = v), (at = Math.round(t) + k);
    }
    if (top <= 0) at = Math.round(t);
    beatsF.push(at);
    t = at + period;
  }
  const beats = beatsF.map((f) => +(f * HOP).toFixed(3)).filter((b) => b < fileDuration);
  if (beats.length < 4) return undefined;

  // Loudness per beat, normalised against the track's own range.
  const raw = beatsF.slice(0, beats.length).map((f, i) => {
    const end = beatsF[i + 1] ?? f + P;
    let s = 0, c = 0;
    for (let j = f; j < Math.min(end, n); j++) (s += rms[j]), c++;
    return c ? s / c : 0;
  });
  const sorted = [...raw].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.05)], hi = sorted[Math.floor(sorted.length * 0.95)] || 1e-6;
  const energy = raw.map((v) => +Math.max(0, Math.min(1, (v - lo) / Math.max(1e-6, hi - lo))).toFixed(2));

  // Bars: the beat phase (of 4) with the strongest onsets starts each bar.
  const strength = [0, 0, 0, 0];
  beatsF.forEach((f, i) => (strength[i % 4] += (onset[f] ?? 0) + raw[i] * 0.5));
  const phase = strength.indexOf(Math.max(...strength));
  const downbeats = beats.filter((_, i) => i % 4 === phase);

  return { bpm: +(60 / (period * HOP)).toFixed(1), beats, downbeats, energy, drop: findDrop(beats, energy, phase) };
}

/** The bar where the music lifts the most: average energy of the next 2 bars minus the previous 2. */
export function findDrop(beats: number[], energy: number[], phase = 0): number | undefined {
  const span = 8;
  let best = 0, at = -1;
  for (let i = Math.max(span, phase); i + span <= energy.length; i += 1) {
    if ((i - phase) % 4) continue;
    const before = energy.slice(i - span, i).reduce((a, b) => a + b, 0) / span;
    const after = energy.slice(i, i + span).reduce((a, b) => a + b, 0) / span;
    const lift = after - before;
    if (lift > best) (best = lift), (at = i);
  }
  return at >= 0 && best >= 0.18 ? beats[at] : undefined;
}

/** Decode an audio file, map its beats and read its length (browser only). */
export async function analyzeMusicFile(file: Blob): Promise<{ duration: number; map?: BeatMap }> {
  const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
  try {
    const audio = await ac.decodeAudioData(await file.arrayBuffer());
    const len = Math.min(audio.length, audio.sampleRate * MAX_ANALYSE);
    const mono = new Float32Array(len);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const ch = audio.getChannelData(c);
      for (let i = 0; i < len; i++) mono[i] += ch[i] / audio.numberOfChannels;
    }
    return { duration: audio.duration, map: detectBeats(mono, audio.sampleRate, audio.duration) };
  } finally {
    ac.close();
  }
}

/**
 * Beats as heard in the cut: the music starts at `start` and loops, so beats are shifted and
 * repeated over `total` seconds.
 */
export function beatsInCut(m: Pick<MusicTrack, "beats" | "start" | "duration">, total: number, which: number[] | undefined = m.beats): number[] {
  if (!which?.length) return [];
  const start = m.start ?? 0, dur = m.duration ?? 0;
  const out: number[] = [];
  for (let loop = 0; loop < 50; loop++) {
    const base = loop * dur - start;
    if (loop > 0 && (!dur || base > total)) break;
    for (const b of which) {
      const t = base + b;
      if (t >= 0 && t < total) out.push(+t.toFixed(3));
    }
  }
  return out;
}
