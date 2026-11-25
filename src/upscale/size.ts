// Output sizes, bitrates, looks, trimming and timing for upscaling (pure, so they can be tested
// without a browser).

export const TARGETS = [
  { id: "1080p", label: "1080p", short: 1080 },
  { id: "1440p", label: "1440p", short: 1440 },
  { id: "4k", label: "4K", short: 2160 },
  { id: "8k", label: "8K", short: 4320 },
] as const;
export type TargetId = (typeof TARGETS)[number]["id"];

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
/** Output size for a target: the short edge becomes 1080 / 1440 / 2160 / 4320, the shape is kept. */
export function targetSize(src: { w: number; h: number }, id: TargetId): [number, number] {
  const short = TARGETS.find((t) => t.id === id)!.short;
  const k = short / Math.min(src.w, src.h);
  return [even(src.w * k), even(src.h * k)];
}

/** Bitrate for upscaled footage: generous, since real footage has more to keep than graphics. */
export const upscaleBitrate = (w: number, h: number, fps: number) => {
  const px = w * h;
  const base = px <= 2.2e6 ? 12e6 : px <= 4e6 ? 20e6 : px <= 9e6 ? 35e6 : 80e6;
  return Math.round(base * (fps > 32 ? 1.4 : 1));
};

/** How big a file gets before a browser tab can't hold it in memory (saving straight to disk has no such limit). */
export const MEMORY_LIMIT = 1.6e9;
export const outputBytes = (w: number, h: number, fps: number, seconds: number) => (upscaleBitrate(w, h, fps) * seconds) / 8;

// ---------------------------------------------------------------- looks
export interface Look {
  /** 0–1: compression clean-up before scaling */
  clean: number;
  /** 0–1: sharpening after scaling */
  sharp: number;
  /** 0–1: colour vibrance */
  rich: number;
  /** 0–1: fine grain */
  grain: number;
}
export const DEFAULT_LOOK: Look = { clean: 0.25, sharp: 0.7, rich: 0.15, grain: 0 };

/** Ready-made settings for common kinds of footage. */
export const PRESETS = [
  { id: "natural", label: "Natural", hint: "Balanced for most footage (recommended)", look: DEFAULT_LOOK },
  { id: "crisp", label: "Crisp", hint: "Sharper detail for clean, well-lit footage", look: { clean: 0.15, sharp: 0.95, rich: 0.12, grain: 0 } },
  { id: "restore", label: "Restore old footage", hint: "Heavy clean-up of blocky, noisy or old video, with a little grain so it doesn't look waxy", look: { clean: 0.75, sharp: 0.75, rich: 0.25, grain: 0.2 } },
  { id: "screen", label: "Screen & animation", hint: "Screen recordings, slides, cartoons and text: crisp edges, no grain", look: { clean: 0.05, sharp: 0.9, rich: 0, grain: 0 } },
  { id: "gentle", label: "Gentle (faces)", hint: "Soft on skin, for interviews and portraits", look: { clean: 0.45, sharp: 0.45, rich: 0.1, grain: 0.08 } },
] as const satisfies readonly { id: string; label: string; hint: string; look: Look }[];
export type PresetId = (typeof PRESETS)[number]["id"];
/** The preset a look matches, if it matches one exactly. */
export const presetOf = (l: Look): PresetId | undefined => PRESETS.find((p) => (Object.keys(p.look) as (keyof Look)[]).every((k) => Math.abs(p.look[k] - l[k]) < 0.001))?.id;

// ---------------------------------------------------------------- trimming
/** The frames to upscale for a part of the video (the whole video when no part is given). Always at least one frame. */
export function frameRange(duration: number, fps: number, start = 0, end = duration): { first: number; count: number; start: number; end: number } {
  const total = Math.max(1, Math.round(duration * fps));
  const s = Math.min(Math.max(0, start), duration);
  const e = Math.min(Math.max(s, end), duration);
  const first = Math.min(total - 1, Math.round(s * fps));
  const last = Math.max(first + 1, Math.min(total, Math.round(e * fps)));
  return { first, count: last - first, start: first / fps, end: last / fps };
}

// ---------------------------------------------------------------- timing
/** Seconds left, from progress so far; undefined until there's enough to go on. */
export function timeLeft(p: number, elapsedMs: number): number | undefined {
  if (p < 0.02 || elapsedMs < 3000 || p >= 1) return undefined;
  return Math.max(0, (elapsedMs / p - elapsedMs) / 1000);
}
export function formatDuration(s: number): string {
  if (s < 45) return "under a minute";
  if (s < 90) return "about a minute";
  if (s < 3600) return `about ${Math.round(s / 60)} minutes`;
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return `about ${h} h${m ? ` ${m} min` : ""}`;
}
