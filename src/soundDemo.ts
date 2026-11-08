// Stand-in audio for previewing sound templates before the user adds their own: a beat grid
// with a quiet build and a drop, and a "voice" with words and a speech-like loudness curve.
import type { AudioTrack, MusicTrack, Word } from "./types";

export function demoMusic(bpm = 120, duration = 32, dropAt = 8): MusicTrack {
  const bl = 60 / bpm, beats: number[] = [], energy: number[] = [];
  for (let t = 0; t < duration; t += bl) {
    beats.push(+t.toFixed(3));
    energy.push(t < dropAt - 1e-3 ? 0.3 + 0.3 * (t / dropAt) : 0.95);
  }
  const drop = beats.reduce((a, b) => (Math.abs(b - dropAt) < Math.abs(a - dropAt) ? b : a), 0);
  return { name: "demo", url: "", volume: 0, duration, start: 0, bpm, beats, downbeats: beats.filter((_, i) => i % 4 === 0), energy, drop };
}

export function demoVoice(lines: string[]): AudioTrack {
  const words: Word[] = [], pauses: { s: number; e: number }[] = [];
  let t = 0.3;
  lines.forEach((line, li) => {
    for (const w of line.split(/\s+/).filter(Boolean)) {
      const len = 0.16 + Math.min(0.3, w.length * 0.045);
      words.push({ w, s: +t.toFixed(2), e: +(t + len).toFixed(2) });
      t += len + 0.06;
    }
    if (li < lines.length - 1) pauses.push({ s: +t.toFixed(2), e: +(t + 0.55).toFixed(2) }), (t += 0.55);
  });
  const duration = +(t + 0.3).toFixed(2);
  const N = 800;
  const peaks = Array.from({ length: N }, (_, i) => {
    const at = (i / (N - 1)) * duration;
    const w = words.find((x) => at >= x.s && at <= x.e);
    if (!w) return 0.03;
    const k = (at - w.s) / (w.e - w.s);
    return +(0.45 + 0.5 * Math.sin(Math.PI * k) * (0.7 + 0.3 * Math.sin(at * 37))).toFixed(3);
  });
  return { name: "demo", url: "", duration, peaks, pauses, words, wordsSource: "script-estimate" };
}
