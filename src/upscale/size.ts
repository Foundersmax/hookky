// Output sizes and bitrates for upscaling (pure, so they can be tested without a browser).

export const TARGETS = [
  { id: "1080p", label: "1080p", short: 1080 },
  { id: "4k", label: "4K", short: 2160 },
  { id: "8k", label: "8K", short: 4320 },
] as const;
export type TargetId = (typeof TARGETS)[number]["id"];

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
/** Output size for a target: the short edge becomes 1080 / 2160 / 4320, the shape is kept. */
export function targetSize(src: { w: number; h: number }, id: TargetId): [number, number] {
  const short = TARGETS.find((t) => t.id === id)!.short;
  const k = short / Math.min(src.w, src.h);
  return [even(src.w * k), even(src.h * k)];
}

/** Bitrate for upscaled footage: generous, since real footage has more to keep than graphics. */
export const upscaleBitrate = (w: number, h: number, fps: number) => {
  const px = w * h;
  const base = px <= 2.2e6 ? 12e6 : px <= 9e6 ? 35e6 : 80e6;
  return Math.round(base * (fps > 32 ? 1.4 : 1));
};
