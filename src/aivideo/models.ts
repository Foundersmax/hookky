// The AI video models Rookker can run, all through fal.ai (one key reaches every maker), and how a
// generation request becomes each model's own input. Endpoint ids and parameters are taken from
// fal's published client types (@fal-ai/client). Pure: shared by the server and the workspace.

export type GenMode = "text" | "image";
export type Family = "Seedance" | "Kling" | "MiniMax" | "Veo" | "Sora" | "Wan" | "Luma" | "PixVerse" | "Vidu" | "LTX" | "Grok";

export interface VideoModel {
  id: string;
  family: Family;
  name: string;
  maker: string;
  blurb: string;
  /** fal endpoint for text → video, and for image → video */
  t2v?: string;
  i2v?: string;
  /** shapes on offer for text → video (image → video follows the picture unless `i2vAspect`) */
  aspects?: string[];
  i2vAspect?: boolean;
  /** lengths in seconds; none = the model's fixed length */
  durations?: number[];
  /** how the length is sent: "5", "5s" or 5 */
  durationAs?: "string" | "seconds" | "number";
  resolutions?: string[];
  /** the subset fal.ai's endpoint takes, when smaller (requests above it are sent at its best) */
  falResolutions?: string[];
  /** sound: the switch's parameter name, or "always" when every clip has sound */
  audio?: "generate_audio" | "generate_audio_switch" | "audio" | "always";
  negative?: boolean;
  seed?: boolean;
  /** parameter names that differ from the usual `image_url` / `end_image_url` */
  imageParam?: string;
  endParam?: string;
  speed: "fast" | "standard" | "premium";
  /** the maker's own API, used when its key is set (see server/videoProviders.ts) */
  direct?: Direct;
}

/** Makers whose own APIs Rookker can call without fal.ai. */
export type Provider = "google" | "openai" | "kling" | "minimax" | "byteplus" | "luma";
export interface Direct {
  provider: Provider;
  /** for models only the maker serves (no fal.ai endpoint): what it can start from */
  modes?: GenMode[];
  /** the maker's model id (overridable on the server with AIV_MODEL_<ID>) */
  model: string;
  /** a fixed quality tier where the maker's model has one (Hailuo, Kling) */
  resolution?: string;
}
export const PROVIDER_NAMES: Record<Provider | "fal", string> = { google: "Google Vertex AI", openai: "OpenAI", kling: "Kling", minimax: "MiniMax", byteplus: "BytePlus ModelArk", luma: "Luma", fal: "fal.ai" };

export const VIDEO_MODELS: VideoModel[] = [
  // Seedance 2.x: on BytePlus ModelArk (ids from BytePlus's docs) and on fal.ai. fal.ai's endpoints
  // stop at 720p, so a 1080p request sent there comes back at 720p.
  { id: "seedance-25", family: "Seedance", name: "Seedance 2.5", maker: "ByteDance", blurb: "ByteDance's newest: up to 30 s of multi-shot story with sound.", t2v: "bytedance/seedance-2.5/text-to-video", i2v: "bytedance/seedance-2.5/image-to-video", aspects: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], durations: [4, 5, 6, 8, 10, 12, 15, 20, 25, 30], resolutions: ["480p", "720p", "1080p"], falResolutions: ["480p", "720p"], audio: "generate_audio", seed: true, endParam: "end_image_url", speed: "premium", direct: { provider: "byteplus", model: "dreamina-seedance-2-5-260628" } },
  { id: "seedance-20", family: "Seedance", name: "Seedance 2.0", maker: "ByteDance", blurb: "Cinematic multi-shot video with sound, up to 15 s.", t2v: "bytedance/seedance-2.0/text-to-video", i2v: "bytedance/seedance-2.0/image-to-video", aspects: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], durations: [4, 5, 6, 8, 10, 12, 15], resolutions: ["480p", "720p", "1080p"], falResolutions: ["480p", "720p"], audio: "generate_audio", seed: true, endParam: "end_image_url", speed: "premium", direct: { provider: "byteplus", model: "dreamina-seedance-2-0-260128" } },
  { id: "seedance-20-fast", family: "Seedance", name: "Seedance 2.0 Fast", maker: "ByteDance", blurb: "Seedance 2 quicker and cheaper.", t2v: "bytedance/seedance-2.0/fast/text-to-video", i2v: "bytedance/seedance-2.0/fast/image-to-video", aspects: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], durations: [4, 5, 6, 8, 10, 12, 15], resolutions: ["480p", "720p"], audio: "generate_audio", seed: true, endParam: "end_image_url", speed: "fast", direct: { provider: "byteplus", model: "dreamina-seedance-2-0-fast-260128" } },
  { id: "seedance-15-pro", family: "Seedance", name: "Seedance 1.5 Pro", maker: "ByteDance", blurb: "Cinematic motion with sound, up to 12 s at 1080p.", t2v: "fal-ai/bytedance/seedance/v1.5/pro/text-to-video", i2v: "fal-ai/bytedance/seedance/v1.5/pro/image-to-video", aspects: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], durations: [4, 5, 6, 8, 10, 12], resolutions: ["480p", "720p", "1080p"], audio: "generate_audio", seed: true, endParam: "end_image_url", speed: "premium", direct: { provider: "byteplus", model: "seedance-1-5-pro-251215" } },
  { id: "seedance-1-fast", family: "Seedance", name: "Seedance 1 Pro Fast", maker: "ByteDance", blurb: "The quick, low-cost Seedance for drafts.", t2v: "fal-ai/bytedance/seedance/v1/pro/fast/text-to-video", i2v: "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video", aspects: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], durations: [3, 5, 8, 10, 12], resolutions: ["480p", "720p", "1080p"], seed: true, speed: "fast", direct: { provider: "byteplus", model: "seedance-1-0-pro-fast-251015" } },
  { id: "kling-3-pro", family: "Kling", name: "Kling 3 Pro", maker: "Kuaishou", blurb: "Kling's best: strong physics and faces, sound, up to 15 s.", t2v: "fal-ai/kling-video/v3/pro/text-to-video", i2v: "fal-ai/kling-video/v3/pro/image-to-video", aspects: ["16:9", "9:16", "1:1"], durations: [3, 5, 8, 10, 15], audio: "generate_audio", negative: true, imageParam: "start_image_url", endParam: "end_image_url", speed: "premium", direct: { provider: "kling", model: "kling-3.0", resolution: "1080p" } },
  { id: "kling-3-standard", family: "Kling", name: "Kling 3 Standard", maker: "Kuaishou", blurb: "Kling 3 at a lower price.", t2v: "fal-ai/kling-video/v3/standard/text-to-video", i2v: "fal-ai/kling-video/v3/standard/image-to-video", aspects: ["16:9", "9:16", "1:1"], durations: [3, 5, 8, 10, 15], audio: "generate_audio", negative: true, imageParam: "start_image_url", endParam: "end_image_url", speed: "standard", direct: { provider: "kling", model: "kling-3.0", resolution: "720p" } },
  { id: "kling-25-turbo", family: "Kling", name: "Kling 2.5 Turbo Pro", maker: "Kuaishou", blurb: "Fast, dependable Kling for action and camera moves.", t2v: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video", i2v: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video", aspects: ["16:9", "9:16", "1:1"], durations: [5, 10], negative: true, endParam: "tail_image_url", speed: "fast", direct: { provider: "kling", model: "kling-2.5-turbo", resolution: "1080p" } },
  { id: "hailuo-23-pro", family: "MiniMax", name: "Hailuo 2.3 Pro", maker: "MiniMax", blurb: "1080p Hailuo: expressive people and stylised looks.", t2v: "fal-ai/minimax/hailuo-2.3/pro/text-to-video", i2v: "fal-ai/minimax/hailuo-2.3/pro/image-to-video", speed: "premium", direct: { provider: "minimax", model: "MiniMax-Hailuo-2.3", resolution: "1080P" } },
  { id: "hailuo-23-standard", family: "MiniMax", name: "Hailuo 2.3 Standard", maker: "MiniMax", blurb: "768p Hailuo, 6 or 10 seconds.", t2v: "fal-ai/minimax/hailuo-2.3/standard/text-to-video", i2v: "fal-ai/minimax/hailuo-2.3/standard/image-to-video", durations: [6, 10], speed: "standard", direct: { provider: "minimax", model: "MiniMax-Hailuo-2.3", resolution: "768P" } },
  { id: "hailuo-02", family: "MiniMax", name: "Hailuo 02", maker: "MiniMax", blurb: "The previous Hailuo: cheap and quick.", t2v: "fal-ai/minimax/hailuo-02/standard/text-to-video", durations: [6, 10], speed: "fast", direct: { provider: "minimax", model: "MiniMax-Hailuo-02", resolution: "768P" } },
  { id: "veo-31", family: "Veo", name: "Veo 3.1", maker: "Google", blurb: "Google's flagship: realism, dialogue and sound.", t2v: "fal-ai/veo3.1", i2v: "fal-ai/veo3.1/image-to-video", aspects: ["16:9", "9:16"], i2vAspect: true, durations: [4, 6, 8], durationAs: "seconds", resolutions: ["720p", "1080p"], audio: "generate_audio", negative: true, seed: true, speed: "premium", direct: { provider: "google", model: "veo-3.1-generate-001" } },
  { id: "veo-31-fast", family: "Veo", name: "Veo 3.1 Fast", maker: "Google", blurb: "Veo 3.1 quicker and cheaper.", t2v: "fal-ai/veo3.1/fast", i2v: "fal-ai/veo3.1/fast/image-to-video", aspects: ["16:9", "9:16"], i2vAspect: true, durations: [4, 6, 8], durationAs: "seconds", resolutions: ["720p", "1080p"], audio: "generate_audio", negative: true, seed: true, speed: "fast", direct: { provider: "google", model: "veo-3.1-fast-generate-001" } },
  { id: "sora-2", family: "Sora", name: "Sora 2", maker: "OpenAI", blurb: "Story-like scenes with sound, up to 12 s.", t2v: "fal-ai/sora-2/text-to-video", i2v: "fal-ai/sora-2/image-to-video", aspects: ["16:9", "9:16"], i2vAspect: true, durations: [4, 8, 12], audio: "always", speed: "premium", direct: { provider: "openai", model: "sora-2" } },
  { id: "wan-26", family: "Wan", name: "Wan 2.6", maker: "Alibaba", blurb: "Multi-shot clips with sound, up to 15 s at 1080p.", t2v: "wan/v2.6/text-to-video", i2v: "wan/v2.6/image-to-video", aspects: ["16:9", "9:16", "1:1", "4:3", "3:4"], durations: [5, 10, 15], resolutions: ["720p", "1080p"], audio: "always", negative: true, seed: true, speed: "standard" },
  { id: "luma-ray-2", family: "Luma", name: "Ray 2", maker: "Luma", blurb: "Natural camera motion and lighting.", t2v: "fal-ai/luma-dream-machine/ray-2", i2v: "fal-ai/luma-dream-machine/ray-2/image-to-video", aspects: ["16:9", "9:16", "4:3", "3:4", "21:9"], i2vAspect: true, durations: [5, 9], durationAs: "seconds", resolutions: ["540p", "720p", "1080p"], endParam: "end_image_url", speed: "standard", direct: { provider: "luma", model: "ray-2" } },
  { id: "pixverse-6", family: "PixVerse", name: "PixVerse 6", maker: "PixVerse", blurb: "Punchy social clips, with sound.", t2v: "fal-ai/pixverse/v6/text-to-video", i2v: "fal-ai/pixverse/v6/image-to-video", aspects: ["16:9", "9:16", "1:1", "4:3", "3:4"], durations: [5, 8], durationAs: "number", resolutions: ["540p", "720p", "1080p"], audio: "generate_audio_switch", negative: true, seed: true, speed: "fast" },
  { id: "vidu-q3", family: "Vidu", name: "Vidu Q3", maker: "Shengshu", blurb: "Good at keeping a subject consistent; sound.", t2v: "fal-ai/vidu/q3/text-to-video", i2v: "fal-ai/vidu/q3/image-to-video", aspects: ["16:9", "9:16", "1:1", "4:3", "3:4"], durations: [4, 8], durationAs: "number", resolutions: ["540p", "720p", "1080p"], audio: "audio", seed: true, endParam: "end_image_url", speed: "standard" },
  { id: "ltx-23-fast", family: "LTX", name: "LTX 2.3 Fast", maker: "Lightricks", blurb: "Very fast, up to 4K, with sound.", t2v: "fal-ai/ltx-2.3/text-to-video/fast", i2v: "fal-ai/ltx-2.3/image-to-video/fast", aspects: ["16:9", "9:16"], i2vAspect: true, durations: [6, 8, 10], resolutions: ["1080p", "1440p", "2160p"], audio: "generate_audio", endParam: "end_image_url", speed: "fast" },
  { id: "grok-imagine", family: "Grok", name: "Grok Imagine", maker: "xAI", blurb: "xAI's video model: quick, many shapes.", t2v: "xai/grok-imagine-video/text-to-video", i2v: "xai/grok-imagine-video/image-to-video", aspects: ["16:9", "9:16", "1:1", "4:3", "3:4"], i2vAspect: true, durations: [6, 10], durationAs: "number", resolutions: ["480p", "720p"], speed: "fast" },
];
export const modelById = (id: string) => VIDEO_MODELS.find((m) => m.id === id);
/** fal.ai has this model for this mode */
export const onFal = (m: VideoModel, mode: GenMode) => !!(mode === "text" ? m.t2v : m.i2v);
export const supports = (m: VideoModel, mode: GenMode) => onFal(m, mode) || !!m.direct?.modes?.includes(mode);

export interface GenRequest {
  model: string;
  mode: GenMode;
  prompt: string;
  /** image → video: the first frame (a data URL or https URL), and optionally the last */
  image?: string;
  endImage?: string;
  aspect?: string;
  duration?: number;
  resolution?: string;
  audio?: boolean;
  negative?: string;
  seed?: number;
}

const nearest = (list: number[], v: number) => list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
const isImage = (s: unknown): s is string => typeof s === "string" && (/^https:\/\/[^\s]+$/.test(s) || /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(s));

/** A request checked and snapped to what the model offers: the common ground every route builds from. */
export interface Normal {
  model: VideoModel;
  mode: GenMode;
  prompt: string;
  image?: string;
  endImage?: string;
  /** set only when the model takes a shape for this mode */
  aspect?: string;
  duration?: number;
  resolution?: string;
  /** set only when the model has a sound switch */
  audio?: boolean;
  negative?: string;
  seed?: number;
}
export function normalize(req: GenRequest): Normal {
  const m = modelById(req?.model);
  if (!m) throw new Error("That model isn't available.");
  const mode: GenMode = req.mode === "image" ? "image" : "text";
  if (!supports(m, mode)) throw new Error(`${m.name} doesn't do ${mode === "text" ? "text to video" : "image to video"}.`);
  const prompt = String(req.prompt ?? "").replace(/\s+/g, " ").trim().slice(0, 2000);
  if (!prompt) throw new Error("Describe the video first.");
  const n: Normal = { model: m, mode, prompt };
  if (mode === "image") {
    if (!isImage(req.image)) throw new Error("Add an image to animate.");
    n.image = req.image;
    if (m.endParam && isImage(req.endImage)) n.endImage = req.endImage;
  }
  if (m.aspects?.length && (mode === "text" || m.i2vAspect)) n.aspect = m.aspects.includes(req.aspect ?? "") ? req.aspect : m.aspects[0];
  if (m.durations?.length) n.duration = nearest(m.durations, Number(req.duration) || m.durations[0]);
  if (m.resolutions?.length) n.resolution = m.resolutions.includes(req.resolution ?? "") ? req.resolution : m.resolutions.includes("720p") ? "720p" : m.resolutions[0];
  if (m.audio && m.audio !== "always") n.audio = req.audio !== false;
  if (m.negative && typeof req.negative === "string" && req.negative.trim()) n.negative = req.negative.trim().slice(0, 500);
  if (m.seed && Number.isInteger(req.seed) && req.seed! >= 0 && req.seed! < 2 ** 31) n.seed = req.seed;
  return n;
}

/**
 * A request as the model's own endpoint and input on fal.ai. Options the model doesn't have are left out;
 * values it doesn't offer snap to the nearest it does. Throws a plain message when the request
 * can't be run (no prompt, unknown model, image → video without an image).
 */
export function buildInput(req: GenRequest): { endpoint: string; input: Record<string, unknown>; model: VideoModel } {
  // (fal.ai's own endpoint and field names; models only a maker serves have none)
  const n = normalize(req);
  const m = n.model;
  const endpoint = n.mode === "text" ? m.t2v : m.i2v;
  if (!endpoint) throw new Error(`${m.name} isn't on fal.ai.`);
  const input: Record<string, unknown> = { prompt: n.prompt };
  if (n.image) input[m.imageParam ?? "image_url"] = n.image;
  if (n.endImage) input[m.endParam!] = n.endImage;
  if (n.aspect) input.aspect_ratio = n.aspect;
  if (n.duration !== undefined) input.duration = m.durationAs === "number" ? n.duration : m.durationAs === "seconds" ? `${n.duration}s` : String(n.duration);
  if (n.resolution) {
    const ok = m.falResolutions ?? m.resolutions ?? [];
    input.resolution = ok.includes(n.resolution) ? n.resolution : ok.filter((r) => parseInt(r) <= parseInt(n.resolution!)).pop() ?? ok[0];
  }
  if (n.audio !== undefined) input[m.audio as string] = n.audio;
  if (n.negative) input.negative_prompt = n.negative;
  if (n.seed !== undefined) input.seed = n.seed;
  return { endpoint, input, model: m };
}
