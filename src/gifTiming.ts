// Pure GIF timing and size helpers (no DOM), shared by the exporter and the tests.

/** Per-frame delays in ms that add up exactly to the clip length (GIF delays are in 1/100 s). */
export function gifDelays(frames: number, fps: number): number[] {
  return Array.from({ length: frames }, (_, i) => (Math.round(((i + 1) * 100) / fps) - Math.round((i * 100) / fps)) * 10);
}

/** Rough size before encoding, measured on typical minimal scenes (photos run larger). */
export function estimateGifBytes(width: number, height: number, fps: number, seconds: number) {
  return Math.round(width * height * fps * seconds * 0.035);
}
