// Shared data model for Hookky (client + server).

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
] as const;
export type TemplateId = (typeof TEMPLATES)[number];

export const TRANSITIONS = ["cut", "fade", "slide", "push-up", "wipe", "zoom", "circle", "blur"] as const;
export type TransitionId = (typeof TRANSITIONS)[number];

export const BACKGROUNDS = ["solid", "gradient", "grid", "dots", "grain", "blobs", "invert", "accent", "image"] as const;
export type BackgroundId = (typeof BACKGROUNDS)[number];

export const MOTIONS = ["snappy", "calm", "bouncy", "smooth", "dramatic"] as const;
export type Motion = (typeof MOTIONS)[number];

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
  notes?: string;
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

export interface AudioTrack {
  name: string;
  url: string;
  duration: number;
  peaks: number[];
  pauses: { s: number; e: number }[];
  words?: Word[];
  wordsSource?: "transcription" | "script-estimate";
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
  music?: { name: string; url: string; volume: number };
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
