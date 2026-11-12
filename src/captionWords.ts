// Timing typed words across a video when there is no transcription (pure).
import type { Word } from "./types";

/** Typed or pasted words spread across the video (longer words get more time): for when there's no transcription. */
export function spreadWords(script: string, duration: number): Word[] {
  const ws = script.split(/\s+/).filter(Boolean);
  if (!ws.length || !(duration > 0)) return [];
  const weight = ws.map((w) => 2 + w.length + (/[.!?]$/.test(w) ? 5 : /[,;:]$/.test(w) ? 2 : 0));
  const total = weight.reduce((a, b) => a + b, 0);
  const span = Math.max(0.2, duration - 0.4);
  let t = 0.2;
  return ws.map((w, i) => {
    const d = (weight[i] / total) * span;
    const out = { w, s: +t.toFixed(3), e: +(t + d * 0.86).toFixed(3) };
    t += d;
    return out;
  });
}
