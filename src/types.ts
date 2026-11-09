// Shared data model for Rookker (client + server).

export type Aspect = "16:9" | "9:16" | "1:1" | "4:5";

export const TEMPLATES = [
  "title-reveal",
  "kinetic-words",
  "product-hero",
  "split-feature",
  "feature-list",
  "stat-counter",
  "image-mosaic",
  "fullbleed",
  "quote",
  "marquee",
  "shape-burst",
  "logo-sting",
  "cta-end",
  "device-mockup",
  "countdown",
  "price-card",
  "testimonials",
  "before-after",
  "logo-reveal",
  "audiogram",
  "text-mask",
  "chat",
  "notification",
  "pov-caption",
  "versus",
  "rating",
  "spotlight",
  "word-stack",
  "word-slam",
  "scramble",
  "zoom-through",
  "letter-wave",
  "outline-fill",
  "flip-words",
  "typewriter",
  "echo-stack",
  "icon-hero",
  "icon-list",
  "metric-ring",
  "process-flow",
  "bar-compare",
  "icon-orbit",
  "line-chart",
  "column-chart",
  "donut-chart",
  "kpi-grid",
  "world-map",
  "route-map",
  "dashboard",
  "dashboard-focus",
  "live-metrics",
] as const;
export type TemplateId = (typeof TEMPLATES)[number];

export const TRANSITIONS = ["cut", "fade", "slide", "push-up", "wipe", "zoom", "circle", "blur", "whip", "spin", "glitch"] as const;
export type TransitionId = (typeof TRANSITIONS)[number];

export const BACKGROUNDS = ["solid", "gradient", "grid", "dots", "grain", "blobs", "invert", "accent", "image", "mesh", "rays", "stripes", "waves", "checker", "rings", "aurora", "starfield", "synthwave", "split"] as const;
export type BackgroundId = (typeof BACKGROUNDS)[number];

export const MOTIONS = ["snappy", "calm", "bouncy", "smooth", "dramatic"] as const;
export type Motion = (typeof MOTIONS)[number];

/** Colour grades applied to a whole scene. "duotone" maps it onto the brand background and accent. */
export const GRADES = ["none", "mono", "noir", "warm-film", "cool", "teal-orange", "faded", "vivid", "duotone"] as const;
export type Grade = (typeof GRADES)[number];
/** Post effects: camera moves, energy, atmosphere. Rendered by the engine, so exports match the preview. */
export const EFFECTS = ["push-in", "pulse", "shake", "focus-pull", "flash", "rgb-split", "glitch", "light-leak", "vignette", "bokeh", "dust", "sparkle", "confetti", "scanlines", "halftone", "beat-flash", "letterbox", "zoom-punch", "film-burn", "roll"] as const;
export type Effect = (typeof EFFECTS)[number];

export interface Stat {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  label?: string;
}

export interface Scene {
  id: string;
  template: TemplateId;
  /** seconds */
  duration: number;
  kicker?: string;
  /** Use *asterisks* to mark accent-coloured emphasis words. */
  headline?: string;
  subline?: string;
  items?: string[];
  stat?: Stat;
  /** asset id ("asset:xyz") or absolute URL */
  image?: string;
  images?: string[];
  cta?: string;
  url?: string;
  author?: string;
  background?: BackgroundId;
  align?: "left" | "center";
  transition?: TransitionId;
  motion?: Motion;
  /** colour override for this scene's accent */
  accent?: string;
  /** image framing for cropped layouts: focal point (0–1 from top-left) and zoom (1–3) */
  focus?: { x: number; y: number };
  zoom?: number;
  /** Video clips in this scene: where in the clip to start (seconds) and playback speed (1 = normal). */
  clipStart?: number;
  clipSpeed?: number;
  /** Colour grade for the scene. */
  grade?: Grade;
  /** Post effects (up to 4). */
  effects?: Effect[];
  /** Strength of the grade and effects, 0–1 (default 0.7). */
  fxAmount?: number;
  /** Text size for this scene, as a multiple of the template's own: headline type (headlines, big numbers, buttons) and labels (everything else). */
  textScale?: { display?: number; body?: number };
  /** Display font for this scene only (a built-in family or an uploaded brand font); the brand's otherwise. */
  font?: string;
  /** Banners shown full-bleed behind the scene's text, crossfading in turn (asset refs, up to 8). */
  backdrop?: string[];
  /** Icons for motion graphics ("lucide:moon"), drawn from the project's icon kit. */
  icons?: string[];
  /** How this shot was cast by the footage director: its kind and what was searched. */
  shot?: { type: string; query: string };
  notes?: string;
}

/** A saved identity to reuse across projects. */
export interface BrandKit {
  id: string;
  name: string;
  style: string;
  brand: Brand;
  /** applied to every new project */
  isDefault?: boolean;
  updatedAt: number;
}

export interface Brand {
  name: string;
  bg: string;
  fg: string;
  accent: string;
  muted: string;
  fontDisplay: string;
  fontBody: string;
  logo?: string;
  radius?: number;
}

export interface Word {
  w: string;
  s: number;
  e: number;
}

/** The background music bed and how it sits in the mix. */
export interface MusicTrack {
  name: string;
  url: string;
  /** 0–1 */
  volume: number;
  /** Length of the file in seconds (it loops to fill the cut). */
  duration?: number;
  /** Where in the track the ad starts, seconds. */
  start?: number;
  /** Fade in at the start and out at the end of the cut, seconds. */
  fadeIn?: number;
  fadeOut?: number;
  /** How far the music dips while the voice-over speaks, 0 (not at all) to 1 (silent). Default 0.6. */
  duck?: number;
  /** Beat map of the file (seconds into the file), filled in when the track is analysed. */
  bpm?: number;
  beats?: number[];
  downbeats?: number[];
  /** loudness of each beat, 0–1 */
  energy?: number[];
  /** where the music lifts the most (seconds into the file) */
  drop?: number;
  /** what the track sounds like: sections, mood, loudness (from the audio analysis) */
  insight?: import("./audio/insight").MusicInsight;
}

export interface AudioTrack {
  name: string;
  url: string;
  duration: number;
  /** Voice-over loudness, 0–1.5 (1 = as recorded). */
  volume?: number;
  peaks: number[];
  pauses: { s: number; e: number }[];
  words?: Word[];
  wordsSource?: "transcription" | "script-estimate";
  /** how it's spoken and what it says (from the audio analysis) */
  insight?: import("./audio/insight").VoiceInsight;
}

export interface Project {
  id: string;
  title: string;
  aspect: Aspect;
  style: string;
  brand: Brand;
  scenes: Scene[];
  captions: boolean;
  grain: boolean;
  audio?: AudioTrack;
  music?: MusicTrack;
  /** Icon drawings the scenes use, kept with the project so it renders and exports offline. */
  icons?: Record<string, import("./mograph/icons").IconSpec>;
}

export interface Asset {
  id: string;
  title: string;
  /** original full URL (remote) or blob/data URL (upload) */
  src: string;
  thumb?: string;
  source: string;
  link?: string;
  author?: string;
  license?: string;
  w?: number;
  h?: number;
  palette?: string[];
  kind: "image" | "logo" | "font" | "video";
  /** videos only: length in seconds */
  duration?: number;
  /** the item's id at its source (used to report usage where a source requires it) */
  sourceId?: string;
  /** a stock preview with the source's watermark; licensing replaces it with the real file */
  watermarked?: boolean;
  /** fonts only: the family name it registers, and its weight */
  family?: string;
  weight?: number;
}

export interface ChatAttachment {
  kind: "image" | "audio";
  name: string;
  assetId?: string;
  /** small preview */
  preview?: string;
}

export const PACES = ["punchy", "steady", "cinematic"] as const;
export type Pace = (typeof PACES)[number];

/** One creative route the agent pitches before building. */
export interface Direction {
  name: string;
  pitch: string;
  style: string;
  motion: Motion;
  pace: Pace;
  /** Opening headline, *word* = accent. */
  hook: string;
  accent?: string;
  /** Effects look for the whole ad (an id from LOOKS). */
  look?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  thinking?: string;
  attachments?: ChatAttachment[];
  activity?: string[];
  pending?: boolean;
  error?: boolean;
  /** Creative directions pitched in this reply, shown as cards. */
  directions?: Direction[];
  /** Index of the direction the user built. */
  picked?: number;
  /** The brief the directions answer (used by the local director when one is picked). */
  brief?: string;
  /** A visual-review turn: the attachment is the contact sheet Claude was shown. */
  review?: boolean;
  /** On a failed reply: what to send again when the user presses Retry. */
  retry?: { text: string; display?: string; attachments?: ChatAttachment[]; review?: boolean };
}

/** Server → client stream events */
export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "activity"; label: string }
  | { type: "assets"; assets: Asset[] }
  | { type: "storyboard"; storyboard: StoryboardInput }
  | { type: "patch"; ops: PatchOp[] }
  | { type: "brand"; brand: Partial<Brand> & { style?: string } }
  | { type: "settings"; settings: Partial<Pick<Project, "aspect" | "captions" | "grain" | "title">> }
  | { type: "directions"; directions: Direction[] }
  | { type: "kit"; name: string }
  | { type: "error"; message: string }
  | { type: "done" };

export interface StoryboardInput {
  title?: string;
  aspect?: Aspect;
  style?: string;
  fit_to_voiceover?: boolean;
  scenes: Omit<Scene, "id">[];
}

export type PatchOp =
  | { op: "update"; index: number; scene: Partial<Scene> }
  | { op: "insert"; index: number; scene: Omit<Scene, "id"> }
  | { op: "delete"; index: number }
  | { op: "move"; index: number; to: number };

export const ASPECT_SIZE: Record<Aspect, [number, number]> = {
  "16:9": [1920, 1080],
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
  "4:5": [1080, 1350],
};
