// Strict cleaning of scenes and brand values from any source (Claude, the local director,
// an opened project file, an older saved version). Whatever comes in, what comes out is
// something the renderer can draw without throwing.
import type { Brand, Project, Scene, Stat, Aspect, Direction } from "./types";
import { TEMPLATES, TRANSITIONS, BACKGROUNDS, MOTIONS, PACES, GRADES, EFFECTS } from "./types";
import { STYLE_PRESETS } from "./presets";
import { LOOKS } from "./engine/fx";
import { uid } from "./engine/util";

const MAX_TEXT = 280;

const str = (v: unknown, max = MAX_TEXT): string | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) v = String(v);
  if (typeof v !== "string") return undefined;
  const t = v.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
};
const num = (v: unknown, min: number, max: number): number | undefined => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | undefined => (list as readonly string[]).includes(v as string) ? (v as T) : undefined;
export const isHex = (v: unknown): v is string => typeof v === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim());
const hex = (v: unknown) => (isHex(v) ? v.trim() : undefined);
const ref = (v: unknown) => {
  if (typeof v !== "string") return undefined; // numbers etc. are never references
  const s = str(v, 2048);
  return s && (/^asset:[\w.-]+$/.test(s) || /^(https?:\/\/|data:image\/|blob:)/.test(s) || /^(?=.*[A-Za-z])[\w.-]{2,80}$/.test(s)) ? s : undefined;
};

function stat(v: unknown): Stat | undefined {
  if (v == null) return undefined;
  if (typeof v === "number" || typeof v === "string") {
    const value = num(v, -1e12, 1e12);
    return value === undefined ? undefined : { value };
  }
  if (typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const value = num(o.value, -1e12, 1e12);
  if (value === undefined) return undefined;
  return {
    value,
    prefix: str(o.prefix, 8),
    suffix: str(o.suffix, 12),
    decimals: num(o.decimals, 0, 4) !== undefined ? Math.round(num(o.decimals, 0, 4)!) : undefined,
    label: str(o.label, 120),
  };
}

const list = (v: unknown, max: number, each: (x: unknown) => string | undefined): string[] | undefined => {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(/\n|•|;/) : [];
  const out = arr.map(each).filter((x): x is string => !!x).slice(0, max);
  return out.length ? out : undefined;
};

function focusOf(v: unknown): { x: number; y: number } | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const x = num(o.x, 0, 1), y = num(o.y, 0, 1);
  return x === undefined || y === undefined ? undefined : { x: +x.toFixed(3), y: +y.toFixed(3) };
}

/** Clean one scene. Unknown fields are dropped; bad values fall back to safe defaults. */
export function sanitizeScene(input: unknown, keepId?: string): Scene {
  const s = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const scene: Scene = {
    id: keepId ?? (typeof s.id === "string" && s.id ? s.id.slice(0, 40) : uid()),
    template: oneOf(s.template, TEMPLATES) ?? "title-reveal",
    // An audiogram follows a whole voice-over clip; everything else is one beat of an ad.
    duration: +(num(s.duration, 0.8, s.template === "audiogram" ? 120 : 15) ?? 3).toFixed(2),
    kicker: str(s.kicker, 60),
    headline: str(s.headline, 160),
    subline: str(s.subline, 200),
    items: list(s.items, 6, (x) => str(x, 80)),
    stat: stat(s.stat),
    image: ref(s.image),
    images: list(s.images, 8, ref),
    cta: str(s.cta, 40),
    url: str(s.url, 80),
    author: str(s.author, 80),
    background: oneOf(s.background, BACKGROUNDS),
    align: oneOf(s.align, ["left", "center"] as const),
    transition: oneOf(s.transition, TRANSITIONS) ?? "fade",
    motion: oneOf(s.motion, MOTIONS),
    accent: hex(s.accent),
    focus: focusOf(s.focus),
    zoom: num(s.zoom, 1, 3),
    clipStart: num(s.clipStart, 0, 3600) || undefined,
    clipSpeed: ((v) => (v === undefined || v === 1 ? undefined : +v.toFixed(2)))(num(s.clipSpeed, 0.1, 4)),
    grade: ((g) => (g && g !== "none" ? g : undefined))(oneOf(s.grade, GRADES)),
    effects: ((list) => (list.length ? list : undefined))([...new Set((Array.isArray(s.effects) ? s.effects : []).filter((e: unknown) => (EFFECTS as readonly unknown[]).includes(e)))].slice(0, 4) as Scene["effects"] & {}),
    fxAmount: ((v) => (v === undefined ? undefined : +v.toFixed(2)))(num(s.fxAmount, 0, 1)),
    backdrop: Array.isArray(s.backdrop) ? list(s.backdrop, 8, ref) : undefined,
    font: ((f) => (f && /^[\w .'-]+$/.test(f) ? f : undefined))(str(s.font, 60)),
    notes: str(s.notes, 400),
    shot: ((v: any) => (v && typeof v === "object" && typeof v.query === "string" ? { type: String(v.type ?? "medium").slice(0, 20), query: v.query.slice(0, 80) } : undefined))(s.shot),
  };
  for (const k of Object.keys(scene) as (keyof Scene)[]) if (scene[k] === undefined) delete scene[k];
  return scene;
}

const FONT_RE = /^[A-Za-z0-9 ]{2,40}$/;

/** Clean a partial brand update. Invalid colours and fonts are ignored rather than applied. */
export function sanitizeBrand(input: unknown): Partial<Brand> & { style?: string } {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: Partial<Brand> & { style?: string } = {};
  const name = str(b.name, 60);
  if (name) out.name = name;
  for (const k of ["bg", "fg", "accent", "muted"] as const) if (isHex(b[k])) out[k] = (b[k] as string).trim();
  for (const k of ["fontDisplay", "fontBody"] as const) if (typeof b[k] === "string" && FONT_RE.test(b[k] as string)) out[k] = b[k] as string;
  const logo = ref(b.logo);
  if (logo) out.logo = logo;
  const radius = num(b.radius, 0, 999);
  if (radius !== undefined) out.radius = radius;
  if (typeof b.style === "string" && /^[a-z-]{2,20}$/.test(b.style)) out.style = b.style;
  return out;
}

/** Clean a whole project (saved copy, opened file). `fallback` supplies anything missing. */
export function sanitizeProject(input: unknown, fallback: Project): Project {
  const p = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const scenes = (Array.isArray(p.scenes) ? p.scenes : []).slice(0, 80).map((s) => sanitizeScene(s));
  const seen = new Set<string>();
  for (const s of scenes) if (seen.has(s.id)) s.id = uid(); else seen.add(s.id);
  const brand = { ...fallback.brand, ...sanitizeBrand(p.brand) };
  delete (brand as { style?: string }).style;
  return {
    ...fallback,
    id: str(p.id, 40) ?? fallback.id,
    title: str(p.title, 120) ?? fallback.title,
    aspect: oneOf(p.aspect, ["16:9", "9:16", "1:1", "4:5"] as const satisfies readonly Aspect[]) ?? fallback.aspect,
    style: typeof p.style === "string" && /^[a-z-]{2,20}$/.test(p.style) ? p.style : fallback.style,
    brand,
    captions: typeof p.captions === "boolean" ? p.captions : fallback.captions,
    grain: typeof p.grain === "boolean" ? p.grain : fallback.grain,
    scenes: scenes.length ? scenes : fallback.scenes,
    audio: undefined,
    music: undefined,
  };
}

/** Clean the creative directions the agent pitches: 1–3 complete routes, or none. */
export function sanitizeDirections(input: unknown): Direction[] {
  const arr = Array.isArray(input) ? input : [];
  const out: Direction[] = [];
  for (const x of arr) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const name = str(o.name, 40);
    const hook = str(o.hook, 80);
    if (!name || !hook) continue;
    out.push({
      name,
      pitch: str(o.pitch, 240) ?? "",
      style: oneOf(o.style, STYLE_PRESETS.map((p) => p.id)) ?? "noir",
      motion: oneOf(o.motion, MOTIONS) ?? "snappy",
      pace: oneOf(o.pace, PACES) ?? "steady",
      hook,
      accent: hex(o.accent),
      look: oneOf(o.look, LOOKS.map((l) => l.id)),
    });
    if (out.length === 3) break;
  }
  return out;
}
