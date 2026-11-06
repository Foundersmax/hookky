import type { AudioTrack, Word } from "../types";

/** Decode a voice-over, compute waveform peaks and natural pauses. */
export async function analyzeAudio(file: File): Promise<AudioTrack> {
  const buf = await file.arrayBuffer();
  const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
  const audio = await ac.decodeAudioData(buf.slice(0));
  ac.close();
  const ch = audio.getChannelData(0);
  const sr = audio.sampleRate;

  // peaks for the timeline waveform
  const N = 1600;
  const block = Math.floor(ch.length / N);
  const peaks: number[] = [];
  for (let i = 0; i < N; i++) {
    let m = 0;
    for (let j = i * block; j < (i + 1) * block; j += 4) m = Math.max(m, Math.abs(ch[j] || 0));
    peaks.push(m);
  }
  const maxPeak = Math.max(...peaks, 1e-6);

  // RMS envelope at 20ms → silence detection with an adaptive threshold
  const hop = Math.floor(sr * 0.02);
  const rms: number[] = [];
  for (let i = 0; i + hop <= ch.length; i += hop) {
    let s = 0;
    for (let j = i; j < i + hop; j++) s += ch[j] * ch[j];
    rms.push(Math.sqrt(s / hop));
  }
  const sorted = [...rms].sort((a, b) => a - b);
  const noise = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  const loud = sorted[Math.floor(sorted.length * 0.9)] ?? 0.1;
  const thr = noise + (loud - noise) * 0.12;
  const pauses: { s: number; e: number }[] = [];
  let start = -1;
  rms.forEach((v, i) => {
    if (v < thr) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      const s = start * 0.02, e = i * 0.02;
      if (e - s >= 0.22) pauses.push({ s, e });
      start = -1;
    }
  });
  if (start >= 0) pauses.push({ s: start * 0.02, e: rms.length * 0.02 });

  return {
    name: file.name,
    url: URL.createObjectURL(file),
    duration: audio.duration,
    peaks: peaks.map((p) => +(p / maxPeak).toFixed(3)),
    pauses: pauses.map((p) => ({ s: +p.s.toFixed(2), e: +p.e.toFixed(2) })),
  };
}

/** Speech regions = gaps between pauses. */
export function speechRegions(track: AudioTrack) {
  const regions: { s: number; e: number }[] = [];
  let t = 0;
  for (const p of track.pauses) {
    if (p.s - t > 0.15) regions.push({ s: t, e: p.s });
    t = p.e;
  }
  if (track.duration - t > 0.15) regions.push({ s: t, e: track.duration });
  return regions;
}

/**
 * Estimate word timings from a pasted script: distribute words across detected speech
 * regions, weighting by syllable-ish length, and break sentences at pauses when possible.
 */
export function alignScript(script: string, track: AudioTrack): Word[] {
  const words = script.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return [];
  const regions = speechRegions(track);
  const speechTotal = regions.reduce((a, r) => a + (r.e - r.s), 0) || track.duration;
  const weight = (w: string) => Math.max(1, w.replace(/[^a-z0-9]/gi, "").length * 0.6 + (/[.,!?;:]$/.test(w) ? 2 : 0));
  const total = words.reduce((a, w) => a + weight(w), 0);
  const out: Word[] = [];
  let acc = 0;
  const mapTime = (x: number) => {
    // x is 0..speechTotal along speech; map to absolute time through regions
    let rem = x;
    for (const r of regions) {
      const len = r.e - r.s;
      if (rem <= len) return r.s + rem;
      rem -= len;
    }
    return regions.length ? regions[regions.length - 1].e : x;
  };
  for (const w of words) {
    const a = (acc / total) * speechTotal;
    acc += weight(w);
    const b = (acc / total) * speechTotal;
    out.push({ w, s: +mapTime(a).toFixed(2), e: +mapTime(b - 0.02).toFixed(2) });
  }
  return out;
}

/** Group timed words into sentences (for agent context + scene planning). */
export function sentences(words: Word[]) {
  const out: { s: number; e: number; text: string }[] = [];
  let cur: Word[] = [];
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    if (/[.!?]$/.test(w.w) || !next || next.s - w.e > 0.6) {
      out.push({ s: cur[0].s, e: cur[cur.length - 1].e, text: cur.map((x) => x.w).join(" ") });
      cur = [];
    }
  });
  return out;
}
