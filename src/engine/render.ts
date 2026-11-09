// Rookker motion engine — renders a Project at time t onto a 2D canvas.
import type { Project, Scene, Brand, Word, TransitionId } from "../types";
import { clamp, ease, lerp, win, rgba, mix, contrast, hash } from "./util";
import { layoutText, drawLayout, drawLabel, displayWeight, displayTracking, stripMarks, measure, type FontSpec, type Layout } from "./text";
import { hasFx, applyFx } from "./fx";
import { EXTRA_TEMPLATES } from "./templates2";
import { TEXT_TEMPLATES } from "./textfx";
import { EXTRA_BACKGROUNDS } from "./backgrounds";
import { MOGRAPH_TEMPLATES } from "./mograph";
import { DATA_TEMPLATES } from "./mographData";
import { DASH_TEMPLATES } from "./mographDash";
import { BUILTIN_ICONS } from "../mograph/builtin";

/** Looks up a drawable by asset ref; `t` is the scene-local time (video clips use it). */
export type ImageGetter = (ref?: string, t?: number, rate?: number) => HTMLImageElement | undefined;

/** Where a scene's video clips are at scene-local time lt: trimmed start plus time × speed. */
export const clipTimeAt = (s: Scene, lt: number) => (s.clipStart ?? 0) + lt * (s.clipSpeed ?? 1);

interface Colors {
  bg: string;
  fg: string;
  accent: string;
  muted: string;
}

export interface G {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  u: number; // 1 unit = min(W,H)/1080
  portrait: boolean;
  pad: number;
  c: Colors;
  brand: Brand;
  scene: Scene;
  t: number; // local time
  dur: number;
  abs: number; // absolute scene start
  img: ImageGetter;
  words?: Word[];
  /** An icon's drawing by name (the project's own, else the built-in set). */
  icon: (name?: string) => import("../mograph/icons").IconSpec | undefined;
  /** How loud the soundtrack is at an absolute time, 0–1 (the voice-over, else the music's beats). */
  level: (absT: number) => number;
  E: (x: number) => number;
  sp: number; // motion speed multiplier (durations)
  /** set while drawing the scene on screen: records where editable text landed */
  hit?: (r: HitRegion) => void;
}

/** Where an editable field was drawn, in canvas (logical) pixels. */
export interface HitRegion {
  field: string; // "headline", "subline", "kicker", "items.2", "stat.value", "stat.label", "cta", "url", "author"
  x: number;
  y: number;
  w: number;
  h: number;
  size: number; // font size in px
  align: "left" | "center" | "right";
  lines: number;
}

export interface TimelineEntry {
  scene: Scene;
  start: number;
  end: number;
  index: number;
}

export function timeline(scenes: Scene[]): TimelineEntry[] {
  let t = 0;
  return scenes.map((scene, index) => {
    const e = { scene, start: t, end: t + scene.duration, index };
    t += scene.duration;
    return e;
  });
}
/** The scenes drawn at time t and their local times (two during a transition). */
export function visibleAt(project: Project, t: number): { entry: TimelineEntry; lt: number }[] {
  const tl = timeline(project.scenes);
  if (!tl.length) return [];
  const total = tl[tl.length - 1].end;
  const tt = clamp(t, 0, Math.max(0, total - 1e-4));
  let i = tl.findIndex((e) => tt >= e.start && tt < e.end);
  if (i < 0) i = tl.length - 1;
  const cur = tl[i];
  const lt = tt - cur.start;
  const tr = cur.scene.transition ?? "fade";
  const td = i > 0 ? Math.min(TRANSITION_DUR[tr] ?? 0.5, cur.scene.duration * 0.5) : 0;
  const out = [{ entry: cur, lt }];
  if (i > 0 && td > 0 && lt < td) out.push({ entry: tl[i - 1], lt: tl[i - 1].scene.duration + lt });
  return out;
}

export const totalDuration = (p: Project) => p.scenes.reduce((a, s) => a + s.duration, 0);

/** Motion presets: the easing every element uses, and how long animations take (multiplier). */
const MOTION: Record<string, { E: (x: number) => number; sp: number }> = {
  snappy: { E: ease.outExpo, sp: 0.9 },
  calm: { E: ease.outCubic, sp: 1.35 },
  bouncy: { E: ease.outBack, sp: 1.05 },
  smooth: { E: ease.inOutCubic, sp: 1.1 },
  dramatic: { E: ease.outQuart, sp: 1.8 },
};

const TRANSITION_DUR: Record<TransitionId, number> = { cut: 0, fade: 0.5, slide: 0.65, "push-up": 0.7, wipe: 0.6, zoom: 0.6, circle: 0.75, blur: 0.6, whip: 0.35, spin: 0.55, glitch: 0.3 };

// ---------------------------------------------------------------- Renderer
export class Renderer {
  private bufA: HTMLCanvasElement;
  private bufB: HTMLCanvasElement;
  private grainTile: HTMLCanvasElement;

  constructor(
    public canvas: HTMLCanvasElement,
    public W: number,
    public H: number,
    public scale = 1,
  ) {
    this.bufA = document.createElement("canvas");
    this.bufB = document.createElement("canvas");
    this.grainTile = makeGrain();
    this.resize(W, H, scale);
  }

  resize(W: number, H: number, scale = this.scale) {
    this.W = W;
    this.H = H;
    this.scale = scale;
    for (const c of [this.canvas, this.bufA, this.bufB]) {
      c.width = Math.round(W * scale);
      c.height = Math.round(H * scale);
    }
  }

  /** Editable text regions of the scene on screen in the last frame, and that scene's index. */
  hits: HitRegion[] = [];
  hitScene = -1;

  render(project: Project, t: number, img: ImageGetter) {
    const ctx = this.canvas.getContext("2d")!;
    this.hits = [];
    this.hitScene = -1;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    const tl = timeline(project.scenes);
    if (!tl.length) {
      ctx.fillStyle = project.brand.bg;
      ctx.fillRect(0, 0, this.W, this.H);
      return;
    }
    const total = tl[tl.length - 1].end;
    const tt = clamp(t, 0, Math.max(0, total - 1e-4));
    let i = tl.findIndex((e) => tt >= e.start && tt < e.end);
    if (i < 0) i = tl.length - 1;
    const cur = tl[i];
    const lt = tt - cur.start;
    const tr = cur.scene.transition ?? "fade";
    const td = i > 0 ? Math.min(TRANSITION_DUR[tr] ?? 0.5, cur.scene.duration * 0.5) : 0;

    if (i > 0 && td > 0 && lt < td) {
      const prev = tl[i - 1];
      this.drawSceneTo(this.bufA, project, prev, prev.scene.duration + lt, img);
      this.drawSceneTo(this.bufB, project, cur, lt, img, true);
      composite(ctx, this.bufA, this.bufB, tr, ease.inOutCubic(lt / td), this.W, this.H, colorsFor(project.brand, cur.scene).accent);
    } else {
      this.drawScene(ctx, project, cur, lt, img, true);
    }

    if (project.captions && project.audio?.words?.length) drawCaptions(ctx, this.W, this.H, project, tt, cur.scene);
    if (project.grain) {
      ctx.save();
      ctx.globalAlpha = 0.07;
      ctx.globalCompositeOperation = "overlay";
      const pat = ctx.createPattern(this.grainTile, "repeat")!;
      const off = Math.floor(hash(Math.floor(tt * 24)) * 256);
      ctx.translate(-off, -off);
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, this.W + 256, this.H + 256);
      ctx.restore();
    }
  }

  private drawSceneTo(c: HTMLCanvasElement, p: Project, e: TimelineEntry, lt: number, img: ImageGetter, record = false) {
    const ctx = c.getContext("2d")!;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    this.drawScene(ctx, p, e, lt, img, record);
  }

  /** Scenes with a grade or effects are drawn here first, then composited with them. */
  private fxLayer: HTMLCanvasElement | null = null;

  private drawScene(ctx: CanvasRenderingContext2D, p: Project, e: TimelineEntry, lt: number, img: ImageGetter, record = false) {
    if (!hasFx(e.scene)) return this.drawSceneRaw(ctx, p, e, lt, img, record);
    const layer = (this.fxLayer ??= document.createElement("canvas"));
    const pw = Math.round(this.W * this.scale), ph = Math.round(this.H * this.scale);
    if (layer.width !== pw || layer.height !== ph) {
      layer.width = pw;
      layer.height = ph;
    }
    const lctx = layer.getContext("2d")!;
    lctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    const before = this.hits.length;
    this.drawSceneRaw(lctx, p, e, lt, img, record);
    let cam;
    try {
      cam = applyFx(ctx, layer, { scene: e.scene, project: p, brand: p.brand, t: lt, dur: e.scene.duration, start: e.start }, this.W, this.H, this.scale);
    } catch (err) {
      // An effect must never cost the frame: fall back to the plain scene.
      reportOnce(e.scene, err);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(layer, 0, 0);
      ctx.restore();
      return;
    }
    // Keep click-to-edit regions under the text after the camera moved it.
    if (record && (cam.scale !== 1 || cam.dx || cam.dy)) {
      const cx = this.W / 2, cy = this.H / 2;
      for (let i = before; i < this.hits.length; i++) {
        const h = this.hits[i];
        this.hits[i] = { ...h, x: cx + (h.x - cx) * cam.scale + cam.dx, y: cy + (h.y - cy) * cam.scale + cam.dy, w: h.w * cam.scale, h: h.h * cam.scale };
      }
    }
  }

  private drawSceneRaw(ctx: CanvasRenderingContext2D, p: Project, e: TimelineEntry, lt: number, img: ImageGetter, record = false) {
    const { W, H } = this;
    const scene = e.scene;
    const motion = scene.motion ?? "snappy";
    const g: G = {
      ctx, W, H,
      u: Math.min(W, H) / 1080,
      portrait: H > W * 1.1,
      pad: Math.min(W, H) * 0.085,
      c: colorsFor(p.brand, scene),
      // A scene can set its own display font; everything else stays on brand.
      brand: scene.font ? { ...p.brand, fontDisplay: scene.font } : p.brand,
      scene,
      t: lt,
      dur: scene.duration,
      abs: e.start,
      img: (ref) => img(ref, clipTimeAt(scene, lt), scene.clipSpeed ?? 1),
      words: p.audio?.words,
      level: levelFor(p),
      icon: (name) => (name ? p.icons?.[name] ?? BUILTIN_ICONS[name] : undefined),
      E: MOTION[motion]?.E ?? ease.outExpo,
      sp: MOTION[motion]?.sp ?? 0.9,
      ...(record && { hit: (r: HitRegion) => this.hits.push(r) }),
    };
    if (record) this.hitScene = e.index;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    try {
      drawBackground(g);
      (TEMPLATES[scene.template] ?? TEMPLATES["title-reveal"])(g);
    } catch (err) {
      // One broken scene must never stop the preview or an export: draw a quiet placeholder.
      // A template that threw may have left saves/clips unbalanced, so clear all state where supported.
      const c2 = ctx as CanvasRenderingContext2D & { reset?: () => void };
      if (c2.reset) c2.reset();
      else ctx.restore();
      ctx.save();
      ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      ctx.fillStyle = p.brand.bg;
      ctx.fillRect(0, 0, W, H);
      drawLabel(ctx, "This scene couldn't be drawn. Edit it or ask the agent to rebuild it.", { family: p.brand.fontBody, weight: 500, size: 26 * g.u }, W / 2, H / 2, "center", p.brand.muted);
      reportOnce(scene, err);
    }
    ctx.restore();
  }
}

const reported = new WeakSet<Scene>();
function reportOnce(scene: Scene, err: unknown) {
  if (reported.has(scene)) return;
  reported.add(scene);
  console.error(`Rookker: scene "${scene.id}" (${scene.template}) failed to render`, err);
}

// ---------------------------------------------------------------- colours per scene
function colorsFor(b: Brand, s: Scene): Colors {
  const accent = s.accent || b.accent;
  if (s.background === "invert") return { bg: b.fg, fg: b.bg, accent: contrast(accent, b.fg) < 2 ? b.bg : accent, muted: mix(b.fg, b.bg, 0.45) };
  if (s.background === "accent") {
    const fg = contrast(b.fg, accent) > contrast(b.bg, accent) ? b.fg : b.bg;
    return { bg: accent, fg, accent: fg, muted: mix(accent, fg, 0.55) };
  }
  return { bg: b.bg, fg: b.fg, accent: contrast(accent, b.bg) < 1.4 ? b.fg : accent, muted: b.muted };
}

// ---------------------------------------------------------------- composite transitions
function composite(ctx: CanvasRenderingContext2D, A: HTMLCanvasElement, B: HTMLCanvasElement, tr: TransitionId, p: number, W: number, H: number, accent: string) {
  ctx.save();
  const draw = (c: HTMLCanvasElement, x = 0, y = 0, w = W, h = H) => ctx.drawImage(c, x, y, w, h);
  switch (tr) {
    case "slide":
      ctx.globalAlpha = 1 - p * 0.6;
      draw(A, -p * W * 0.35);
      ctx.globalAlpha = 1;
      draw(B, (1 - p) * W);
      break;
    case "push-up":
      draw(A, 0, -p * H);
      draw(B, 0, (1 - p) * H);
      break;
    case "wipe": {
      draw(A);
      const x = p * W;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, x, H);
      ctx.clip();
      draw(B);
      ctx.restore();
      ctx.fillStyle = accent;
      ctx.fillRect(x - W * 0.012, 0, W * 0.012 * Math.sin(p * Math.PI), H);
      break;
    }
    case "zoom": {
      const s1 = 1 + p * 0.25;
      ctx.globalAlpha = 1 - p;
      draw(A, (W - W * s1) / 2, (H - H * s1) / 2, W * s1, H * s1);
      const s2 = 0.88 + 0.12 * p;
      ctx.globalAlpha = p;
      draw(B, (W - W * s2) / 2, (H - H * s2) / 2, W * s2, H * s2);
      break;
    }
    case "circle": {
      draw(A);
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, Math.hypot(W, H) * 0.5 * ease.inOutCubic(p), 0, Math.PI * 2);
      ctx.clip();
      draw(B);
      break;
    }
    case "blur":
      ctx.filter = `blur(${p * 24}px)`;
      ctx.globalAlpha = 1 - p;
      draw(A);
      ctx.filter = `blur(${(1 - p) * 24}px)`;
      ctx.globalAlpha = p;
      draw(B);
      ctx.filter = "none";
      break;
    case "whip": {
      // A whip pan: both shots smear sideways through a streak of motion.
      const e = ease.inOutCubic(p);
      for (let i = 0; i < 5; i++) {
        const o = (i - 2) * W * 0.035 * Math.sin(p * Math.PI);
        ctx.globalAlpha = i === 2 ? 1 : 0.25;
        draw(A, -e * W + o);
        draw(B, (1 - e) * W + o);
      }
      break;
    }
    case "spin": {
      // Spin-zoom: the old shot twists away, the new one twists in.
      const e = ease.inOutCubic(p);
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(e * 0.5);
      ctx.globalAlpha = 1 - e;
      const s1 = 1 + e * 0.6;
      ctx.drawImage(A, (-W * s1) / 2, (-H * s1) / 2, W * s1, H * s1);
      ctx.restore();
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate((e - 1) * 0.5);
      ctx.globalAlpha = e;
      const s2 = 0.6 + e * 0.4 + (1 - e) * 0.9;
      ctx.drawImage(B, (-W * s2) / 2, (-H * s2) / 2, W * s2, H * s2);
      ctx.restore();
      break;
    }
    case "glitch": {
      // Digital tear: bands of both shots, offset, flickering across.
      draw(p < 0.5 ? A : B);
      const bands = 9;
      for (let i = 0; i < bands; i++) {
        const r = hash(i * 7.3 + Math.floor(p * 12));
        if (r < 0.45) continue;
        const y = (i / bands) * H, h = H / bands;
        const src = r > 0.72 ? B : A;
        const off = (r - 0.6) * W * 0.25 * Math.sin(p * Math.PI);
        ctx.drawImage(src, 0, y * (src.height / H), src.width, h * (src.height / H), off, y, W, h);
      }
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = `rgba(255,0,80,${0.18 * Math.sin(p * Math.PI)})`;
      ctx.fillRect(0, 0, W, H);
      break;
    }
    case "fade":
    default:
      draw(A);
      ctx.globalAlpha = p;
      draw(B);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- backgrounds
/**
 * Banners behind the text: each gets an equal share of the scene, crossfades into the next and
 * drifts in a slow Ken Burns move. A scrim in the brand's own background colour keeps the text
 * (drawn in the brand's text colour) as readable as on the plain background.
 */
function drawBackdrop(g: G, refs: string[]) {
  const { ctx, W, H, c, t, dur } = g;
  const n = refs.length;
  const seg = dur / n;
  const fade = Math.min(0.6, seg * 0.35);
  const i = Math.min(n - 1, Math.floor(t / seg));
  const layer = (k: number, alpha: number) => {
    const im = g.img(refs[k]);
    if (!im || alpha <= 0) return;
    const local = clamp((t - k * seg) / (seg + fade), 0, 1);
    const zoom = k % 2 ? 1.1 - 0.08 * local : 1.02 + 0.08 * local;
    const fx = k % 3 === 0 ? 0.5 : k % 3 === 1 ? 0.35 + 0.3 * local : 0.65 - 0.3 * local;
    ctx.save();
    ctx.globalAlpha = alpha;
    drawCover(ctx, im, 0, 0, W, H, zoom, fx, 0.5);
    ctx.restore();
  };
  layer(i, 1);
  // The next banner fades in over the end of this one's share.
  if (i + 1 < n) layer(i + 1, ease.inOutCubic(clamp((t - ((i + 1) * seg - fade)) / fade, 0, 1)));
  ctx.fillStyle = rgba(c.bg, 0.42);
  ctx.fillRect(0, 0, W, H);
  const gr = ctx.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, rgba(c.bg, 0.25));
  gr.addColorStop(0.5, rgba(c.bg, 0.05));
  gr.addColorStop(1, rgba(c.bg, 0.55));
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, W, H);
}

function drawBackground(g: G) {
  const { ctx, W, H, c, t, u } = g;
  const kind = g.scene.background ?? "solid";
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, W, H);
  if (g.scene.backdrop?.length) return drawBackdrop(g, g.scene.backdrop);
  if (kind === "gradient") {
    const a = t * 0.08;
    const gr = ctx.createLinearGradient(W * (0.5 - Math.cos(a) * 0.6), 0, W * (0.5 + Math.cos(a) * 0.6), H);
    gr.addColorStop(0, c.bg);
    gr.addColorStop(1, mix(c.bg, c.accent, 0.16));
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H);
  } else if (kind === "grid") {
    const step = 108 * u;
    ctx.strokeStyle = rgba(c.fg, 0.07);
    ctx.lineWidth = Math.max(1, u);
    const p = ease.outQuart(win(t, 0, 1.2));
    ctx.beginPath();
    for (let x = step; x < W; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H * p);
    }
    for (let y = step; y < H; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(W * p, y);
    }
    ctx.stroke();
  } else if (kind === "dots") {
    const step = 46 * u;
    const off = (t * 6 * u) % step;
    ctx.fillStyle = rgba(c.fg, 0.11);
    for (let x = off; x < W; x += step) for (let y = off; y < H; y += step) {
      ctx.beginPath();
      ctx.arc(x, y, 1.6 * u, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === "blobs") {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const blobs = [
      [0.25, 0.3, 0.55, c.accent, 0.5],
      [0.78, 0.65, 0.5, mix(c.accent, "#3BC9FF", 0.5), 0.35],
      [0.55, 0.95, 0.45, mix(c.accent, "#FF6BD5", 0.5), 0.3],
    ] as const;
    blobs.forEach(([bx, by, r, col, a], i) => {
      const x = W * (bx + Math.sin(t * 0.35 + i * 2) * 0.06);
      const y = H * (by + Math.cos(t * 0.3 + i) * 0.06);
      const R = Math.max(W, H) * r;
      const gr = ctx.createRadialGradient(x, y, 0, x, y, R);
      gr.addColorStop(0, rgba(col, a * 0.55));
      gr.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, H);
    });
    ctx.restore();
  } else if (EXTRA_BACKGROUNDS[kind]) {
    EXTRA_BACKGROUNDS[kind](g);
  } else if (kind === "image") {
    const im = g.img(g.scene.image);
    if (im) {
      ctx.save();
      ctx.filter = `blur(${28 * u}px) saturate(1.1)`;
      drawCover(ctx, im, -40 * u, -40 * u, W + 80 * u, H + 80 * u, (1.05 + t * 0.01) * (g.scene.zoom ?? 1), g.scene.focus?.x, g.scene.focus?.y);
      ctx.restore();
      ctx.fillStyle = rgba(c.bg, 0.55);
      ctx.fillRect(0, 0, W, H);
    }
  }
}

// ---------------------------------------------------------------- image helpers
export function drawCover(ctx: CanvasRenderingContext2D, im: HTMLImageElement, x: number, y: number, w: number, h: number, zoom = 1, fx = 0.5, fy = 0.5) {
  const ir = im.naturalWidth / im.naturalHeight, r = w / h;
  let sw = im.naturalWidth, sh = im.naturalHeight;
  if (ir > r) sw = sh * r;
  else sh = sw / r;
  sw /= zoom;
  sh /= zoom;
  const sx = (im.naturalWidth - sw) * fx, sy = (im.naturalHeight - sh) * fy;
  ctx.drawImage(im, sx, sy, sw, sh, x, y, w, h);
}
export function containRect(im: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const ir = im.naturalWidth / im.naturalHeight;
  let dw = w, dh = w / ir;
  if (dh > h) {
    dh = h;
    dw = h * ir;
  }
  return { x: x + (w - dw) / 2, y: y + (h - dh) / 2, w: dw, h: dh };
}
export function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  const rad = Math.min(r, w / 2, h / 2);
  if ((ctx as any).roundRect) (ctx as any).roundRect(x, y, w, h, rad);
  else ctx.rect(x, y, w, h);
}
export function placeholder(g: G, x: number, y: number, w: number, h: number, label = "Drop a product image") {
  const { ctx, c, u } = g;
  const gr = ctx.createLinearGradient(x, y, x + w, y + h);
  gr.addColorStop(0, mix(c.bg, c.fg, 0.08));
  gr.addColorStop(1, mix(c.bg, c.accent, 0.22));
  ctx.fillStyle = gr;
  rr(ctx, x, y, w, h, (g.brand.radius ?? 12) * u + 8 * u);
  ctx.fill();
  drawLabel(ctx, label, { family: g.brand.fontBody, weight: 500, size: 22 * u }, x + w / 2, y + h / 2, "center", rgba(c.fg, 0.45));
}

// ---------------------------------------------------------------- shared bits
/** The scene's text size: "display" for headline type, "body" for labels (1 = the template's own). */
export const ts = (g: G, kind: "display" | "body") => g.scene.textScale?.[kind] ?? 1;
export const F = (g: G, size: number): FontSpec => ({ family: g.brand.fontDisplay, weight: displayWeight(g.brand.fontDisplay), size: size * ts(g, "display"), tracking: displayTracking(g.brand.fontDisplay) });
export const B = (g: G, size: number, weight = 450): FontSpec => ({ family: g.brand.fontBody, weight, size: size * ts(g, "body"), tracking: -0.005 });
export const K = (g: G, size: number): FontSpec => ({ family: g.brand.fontBody, weight: 600, size: size * ts(g, "body"), tracking: 0.14 });

/** Record a laid-out text block as editable. */
export function hitLayout(g: G, field: string, L: Layout, x: number, y: number, align: "left" | "center" | "right") {
  if (!g.hit || !L.lines.length) return;
  const left = align === "left" ? x : align === "center" ? x - L.width / 2 : x - L.width;
  g.hit({ field, x: left, y, w: L.width, h: L.height, size: L.font.size, align, lines: L.lines.length });
}
/** Record a single line drawn around a vertical middle `yMid` as editable. */
export function hitText(g: G, field: string, text: string, f: FontSpec, x: number, yMid: number, align: "left" | "center" | "right") {
  if (!g.hit || !text) return;
  const w = measure(g.ctx, text, f);
  const left = align === "left" ? x : align === "center" ? x - w / 2 : x - w;
  g.hit({ field, x: left, y: yMid - f.size * 0.7, w, h: f.size * 1.4, size: f.size, align, lines: 1 });
}

export function kicker(g: G, text: string | undefined, x: number, y: number, align: "left" | "center", delay = 0) {
  if (!text) return;
  const { ctx, u, c } = g;
  const p = g.E(win(g.t, delay, 0.7 * g.sp));
  const size = 22 * u;
  const label = stripMarks(text).toUpperCase();
  const w = measure(ctx, label, K(g, size));
  const dot = 10 * u;
  const total = w + dot + 14 * u;
  const x0 = align === "center" ? x - total / 2 : x;
  ctx.save();
  ctx.globalAlpha = p;
  ctx.fillStyle = c.accent;
  ctx.beginPath();
  ctx.arc(x0 + dot / 2, y, (dot / 2) * p, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  drawLabel(ctx, label, K(g, size), x0 + dot + 14 * u + (1 - p) * 20 * u, y, "left", c.muted, p);
  g.hit?.({ field: "kicker", x: x0, y: y - size * 0.8, w: total, h: size * 1.6, size, align: "left", lines: 1 });
}

export function headlineSize(g: G, scale = 1) {
  return (g.portrait ? g.W * 0.115 : g.H * 0.118) * scale;
}

/** headline + subline stack; returns bottom y */
export function textStack(g: G, opts: { x: number; y: number; maxW: number; align: "left" | "center"; size?: number; maxLines?: number; delay?: number; vcenter?: boolean; color?: string; mode?: "mask" | "words" | "rise" }) {
  const { ctx, c, u, scene } = g;
  const align = opts.align;
  const H1 = scene.headline ? layoutText(ctx, scene.headline, F(g, opts.size ?? headlineSize(g)), opts.maxW, opts.maxLines ?? 3, /Serif|Fraunces|Playfair/.test(g.brand.fontDisplay) ? 1.0 : 0.98) : null;
  const S = scene.subline ? layoutText(ctx, stripMarks(scene.subline), B(g, 30 * u), Math.min(opts.maxW, 900 * u), 3, 1.35) : null;
  const gap = 34 * u;
  const kh = scene.kicker ? 60 * u : 0;
  const total = kh + (H1?.height ?? 0) + (S ? gap + S.height : 0);
  let y = opts.vcenter ? opts.y - total / 2 : opts.y;
  const d = opts.delay ?? 0;
  if (scene.kicker) {
    kicker(g, scene.kicker, opts.x, y + 14 * u, align, d);
    y += kh;
  }
  if (H1) hitLayout(g, "headline", H1, opts.x, y, align);
  if (H1) y = drawLayout(ctx, H1, { x: opts.x, y, align, color: opts.color ?? c.fg, emColor: c.accent, t: g.t, delay: d + 0.12, dur: 0.85 * g.sp, stagger: 0.09, mode: opts.mode ?? "mask", easing: g.E, emItalic: /Serif|Fraunces|Playfair/.test(g.brand.fontDisplay) });
  if (S) {
    y += gap;
    hitLayout(g, "subline", S, opts.x, y, align);
    y = drawLayout(ctx, S, { x: opts.x, y, align, color: rgba(opts.color ?? c.fg, 0.72), emColor: c.accent, t: g.t, delay: d + 0.45, dur: 0.8 * g.sp, mode: "rise", stagger: 0.06, easing: ease.outCubic });
  }
  return y;
}

// ---------------------------------------------------------------- templates
export type Tpl = (g: G) => void;

const TEMPLATES: Record<string, Tpl> = {
  ...EXTRA_TEMPLATES,
  ...TEXT_TEMPLATES,
  ...MOGRAPH_TEMPLATES,
  ...DATA_TEMPLATES,
  ...DASH_TEMPLATES,
  "title-reveal"(g) {
    const { W, H, pad, ctx, c, u } = g;
    const align = g.scene.align ?? "center";
    const x = align === "center" ? W / 2 : pad * 1.3;
    const bottom = textStack(g, { x, y: H / 2, maxW: W - pad * 2.6, align, vcenter: true });
    // accent rule
    const p = ease.inOutExpo(win(g.t, 0.6, 0.9 * g.sp));
    const lw = 140 * u * p;
    ctx.fillStyle = c.accent;
    ctx.fillRect(align === "center" ? W / 2 - lw / 2 : x, bottom + 40 * u, lw, 4 * u);
  },

  "kinetic-words"(g) {
    const { W, H, ctx, c, u, scene } = g;
    const emSet = new Set(
      (scene.headline?.match(/\*([^*]+)\*/g) ?? []).flatMap((m) => m.replace(/\*/g, "").toLowerCase().split(/\s+/)).map(clean),
    );
    // words: VO transcript within scene window, else headline split evenly
    let words: Word[] = [];
    if (g.words?.length) words = g.words.filter((w) => w.s >= g.abs - 0.05 && w.s < g.abs + g.dur - 0.05).map((w) => ({ ...w, s: w.s - g.abs, e: w.e - g.abs }));
    if (!words.length) {
      const toks = stripMarks(scene.headline || scene.subline || "Say it in motion").split(/\s+/).filter(Boolean);
      const span = (g.dur * 0.82) / toks.length;
      words = toks.map((w, i) => ({ w, s: 0.15 + i * span, e: 0.15 + (i + 1) * span }));
    }
    const phrases = chunkPhrases(words, 3);
    let pi = 0;
    phrases.forEach((ph, i) => {
      if (g.t >= ph[0].s - 0.05) pi = i;
    });
    const ph = phrases[pi];
    if (!ph) return;
    const maxW = W * (g.portrait ? 0.84 : 0.78);
    const longest = ph.reduce((a, w) => Math.max(a, measure(ctx, w.w, F(g, 100))), 1);
    const size = Math.min(headlineSize(g, g.portrait ? 1.3 : 1.45), (maxW / longest) * 100);
    const lh = size * 1.0;
    const y0 = H / 2 - (ph.length * lh) / 2;
    g.hit?.({ field: "headline", x: W * 0.1, y: y0, w: W * 0.8, h: ph.length * lh, size, align: "center", lines: ph.length });
    // phrase exit when next phrase starts
    const next = phrases[pi + 1];
    const exitP = next ? ease.inCubic(win(g.t, next[0].s - 0.12, 0.12)) : 0;
    ph.forEach((w, i) => {
      const p = g.E(win(g.t, w.s - 0.06, 0.38));
      if (p <= 0) return;
      const em = emSet.has(clean(w.w));
      const active = g.t >= w.s && g.t < w.e + 0.15;
      ctx.save();
      const cy = y0 + i * lh + lh * 0.5;
      ctx.translate(W / 2, cy + (1 - p) * size * 0.4 - exitP * size * 0.3);
      const s = lerp(0.86, 1, p);
      ctx.scale(s, s);
      ctx.globalAlpha = clamp(p) * (1 - exitP);
      ctx.font = `${displayWeight(g.brand.fontDisplay)} ${size}px "${g.brand.fontDisplay}"`;
      (ctx as any).letterSpacing = `${displayTracking(g.brand.fontDisplay) * size}px`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = em ? c.accent : active || !g.words?.length ? c.fg : rgba(c.fg, 0.92);
      ctx.fillText(w.w, 0, 0);
      ctx.restore();
    });
    // progress tick
    ctx.fillStyle = rgba(c.fg, 0.15);
    ctx.fillRect(W / 2 - 60 * u, H - g.pad, 120 * u, 3 * u);
    ctx.fillStyle = c.accent;
    ctx.fillRect(W / 2 - 60 * u, H - g.pad, 120 * u * clamp(g.t / g.dur), 3 * u);
  },

  "product-hero"(g) {
    const { W, H, ctx, c, u, scene, pad } = g;
    const im = g.img(scene.image);
    const cx = W / 2, cy = H * (g.portrait ? 0.44 : 0.47);
    // halo + orbit
    const hp = ease.outExpo(win(g.t, 0, 1.4 * g.sp));
    const R = Math.min(W, H) * 0.36 * lerp(0.6, 1, hp);
    const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.4);
    gr.addColorStop(0, rgba(c.accent, 0.28 * hp));
    gr.addColorStop(1, rgba(c.accent, 0));
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.strokeStyle = rgba(c.fg, 0.14 * hp);
    ctx.lineWidth = 1.5 * u;
    ctx.setLineDash([2 * u, 10 * u]);
    ctx.translate(cx, cy);
    ctx.rotate(g.t * 0.15);
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 1.15, R * 1.15, 0, 0, Math.PI * 2 * hp);
    ctx.stroke();
    ctx.restore();
    // product
    const p = g.E(win(g.t, 0.15, 1.1 * g.sp));
    const float = Math.sin(g.t * 1.6) * 8 * u;
    const bw = W * (g.portrait ? 0.78 : 0.5), bh = H * (g.portrait ? 0.5 : 0.62);
    const r = im ? containRect(im, cx - bw / 2, cy - bh / 2, bw, bh) : { x: cx - bw * 0.35, y: cy - bh * 0.4, w: bw * 0.7, h: bh * 0.8 };
    // shadow
    ctx.save();
    ctx.globalAlpha = 0.35 * p;
    const sg = ctx.createRadialGradient(cx, r.y + r.h + 18 * u, 0, cx, r.y + r.h + 18 * u, r.w * 0.45);
    sg.addColorStop(0, rgba("#000000", 0.55));
    sg.addColorStop(1, rgba("#000000", 0));
    ctx.fillStyle = sg;
    ctx.scale(1, 0.18);
    ctx.fillRect(cx - r.w, (r.y + r.h + 18 * u) / 0.18 - r.w, r.w * 2, r.w * 2);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = clamp(p);
    const s = lerp(0.88, 1, p);
    ctx.translate(cx, cy + (1 - p) * 60 * u + float);
    ctx.scale(s, s);
    ctx.rotate((1 - p) * -0.04);
    if (im) ctx.drawImage(im, r.x - cx, r.y - cy, r.w, r.h);
    else {
      ctx.translate(-cx, -cy);
      placeholder(g, r.x, r.y, r.w, r.h);
    }
    ctx.restore();
    // label
    const labelY = g.portrait ? H * 0.8 : H - pad * 1.25;
    if (scene.kicker) kicker(g, scene.kicker, g.portrait ? W / 2 : pad, g.portrait ? pad * 1.6 : pad, g.portrait ? "center" : "left", 0.4);
    if (scene.headline) {
      const L = layoutText(ctx, scene.headline, F(g, headlineSize(g, 0.55)), W - pad * 2, 2);
      drawLayout(ctx, L, { x: W / 2, y: labelY - L.height, align: "center", color: c.fg, emColor: c.accent, t: g.t, delay: 0.6, dur: 0.8 * g.sp, mode: "mask", easing: g.E });
      hitLayout(g, "headline", L, W / 2, labelY - L.height, "center");
    }
    if (scene.subline) {
      drawLabel(ctx, stripMarks(scene.subline), B(g, 26 * u), W / 2, labelY + 34 * u, "center", rgba(c.fg, 0.65), g.E(win(g.t, 0.9, 0.6)));
      hitText(g, "subline", stripMarks(scene.subline), B(g, 26 * u), W / 2, labelY + 34 * u, "center");
    }
  },

  "split-feature"(g) {
    const { W, H, ctx, u, scene, pad, c } = g;
    const im = g.img(scene.image);
    const imgLeft = scene.align === "left" ? false : true;
    const reveal = ease.inOutExpo(win(g.t, 0, 1.0 * g.sp));
    let ix: number, iy: number, iw: number, ih: number;
    if (g.portrait) {
      ix = pad; iy = pad; iw = W - pad * 2; ih = H * 0.5;
    } else {
      iw = W * 0.46; ih = H - pad * 2; iy = pad; ix = imgLeft ? pad : W - pad - iw;
    }
    ctx.save();
    rr(ctx, ix, iy, iw, ih, (g.brand.radius ?? 12) * u);
    ctx.clip();
    ctx.beginPath();
    if (g.portrait) ctx.rect(ix, iy, iw, ih * reveal);
    else ctx.rect(imgLeft ? ix : ix + iw * (1 - reveal), iy, iw * reveal, ih);
    ctx.clip();
    if (im) drawCover(ctx, im, ix, iy, iw, ih, (1.12 - 0.1 * clamp(g.t / g.dur)) * (scene.zoom ?? 1), scene.focus?.x, scene.focus?.y);
    else placeholder(g, ix, iy, iw, ih);
    ctx.restore();
    if (g.portrait) textStack(g, { x: pad, y: iy + ih + pad * 0.9, maxW: W - pad * 2, align: "left", size: headlineSize(g, 0.68), delay: 0.35 });
    else {
      const tx = imgLeft ? ix + iw + pad : pad;
      textStack(g, { x: tx, y: H / 2, maxW: W - iw - pad * 3.2, align: "left", size: headlineSize(g, 0.7), vcenter: true, delay: 0.35 });
    }
  },

  "feature-list"(g) {
    const { W, H, ctx, u, scene, pad, c } = g;
    const items = (scene.items?.length ? scene.items : ["Fast", "Simple", "Beautiful"]).slice(0, 5);
    let y = pad * 1.2;
    if (scene.kicker) {
      kicker(g, scene.kicker, pad, y, "left");
      y += 50 * u;
    }
    if (scene.headline) {
      const L = layoutText(ctx, scene.headline, F(g, headlineSize(g, 0.6)), W - pad * 2, 2);
      hitLayout(g, "headline", L, pad, y, "left");
      y = drawLayout(ctx, L, { x: pad, y, align: "left", color: c.fg, emColor: c.accent, t: g.t, delay: 0.1, dur: 0.8 * g.sp, mode: "mask", easing: g.E });
    }
    const top = Math.max(y + 50 * u, g.portrait ? H * 0.32 : H * 0.36);
    const rowH = Math.min((H - pad - top) / items.length, 170 * u);
    items.forEach((it, i) => {
      const d = 0.35 + i * 0.16 * g.sp;
      const p = g.E(win(g.t, d, 0.8 * g.sp));
      const ry = top + i * rowH;
      ctx.fillStyle = rgba(c.fg, 0.16);
      ctx.fillRect(pad, ry, (W - pad * 2) * ease.inOutExpo(win(g.t, d - 0.1, 0.9)), Math.max(1, 1.5 * u));
      drawLabel(ctx, String(i + 1).padStart(2, "0"), { family: "JetBrains Mono", weight: 500, size: 22 * u }, pad, ry + rowH / 2, "left", c.accent, p);
      const L = layoutText(ctx, it, F(g, Math.min(rowH * 0.42, headlineSize(g, 0.45))), W - pad * 2 - 120 * u, 1);
      drawLayout(ctx, L, { x: pad + 110 * u, y: ry + rowH / 2 - L.height / 2, align: "left", color: c.fg, emColor: c.accent, t: g.t, delay: d, dur: 0.7 * g.sp, mode: "mask", easing: g.E });
      hitLayout(g, `items.${i}`, L, pad + 110 * u, ry + rowH / 2 - L.height / 2, "left");
    });
  },

  "stat-counter"(g) {
    const { W, H, ctx, u, scene, c, pad } = g;
    const st = scene.stat ?? { value: 100, suffix: "%", label: scene.subline ?? "" };
    const p = ease.outExpo(win(g.t, 0.2, 1.6 * g.sp));
    const v = st.value * p;
    const txt = `${st.prefix ?? ""}${v.toLocaleString("en-US", { minimumFractionDigits: st.decimals ?? 0, maximumFractionDigits: st.decimals ?? 0 })}${st.suffix ?? ""}`;
    const finalTxt = `${st.prefix ?? ""}${st.value.toLocaleString("en-US", { minimumFractionDigits: st.decimals ?? 0, maximumFractionDigits: st.decimals ?? 0 })}${st.suffix ?? ""}`;
    const size = Math.min(headlineSize(g, 2.2), ((W - pad * 2) / Math.max(1, measure(ctx, finalTxt, F(g, 100)))) * 100);
    const align = g.scene.align ?? "center";
    const x = align === "center" ? W / 2 : pad;
    kicker(g, scene.kicker, x, H / 2 - size * 0.72 - 40 * u, align);
    ctx.save();
    ctx.font = `${displayWeight(g.brand.fontDisplay)} ${size}px "${g.brand.fontDisplay}"`;
    (ctx as any).letterSpacing = `${displayTracking(g.brand.fontDisplay) * size}px`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillStyle = c.fg;
    ctx.globalAlpha = clamp(win(g.t, 0.1, 0.4));
    ctx.fillText(txt, x, H / 2);
    ctx.restore();
    if (g.hit) {
      const fw = measure(ctx, finalTxt, F(g, size));
      g.hit({ field: "stat.value", x: align === "center" ? x - fw / 2 : x, y: H / 2 - size * 0.55, w: fw, h: size * 1.1, size, align, lines: 1 });
    }
    const lw = Math.min(W - pad * 2, measure(ctx, finalTxt, F(g, size))) * ease.inOutExpo(win(g.t, 0.4, 1.2));
    ctx.fillStyle = c.accent;
    ctx.fillRect(align === "center" ? W / 2 - lw / 2 : x, H / 2 + size * 0.55, lw, 6 * u);
    const label = st.label || scene.headline;
    if (label) {
      const L = layoutText(ctx, label, B(g, 34 * u, 500), W - pad * 2, 2, 1.3);
      drawLayout(ctx, L, { x, y: H / 2 + size * 0.55 + 40 * u, align, color: rgba(c.fg, 0.75), emColor: c.accent, t: g.t, delay: 0.8, dur: 0.7, mode: "rise" });
      hitLayout(g, st.label ? "stat.label" : "headline", L, x, H / 2 + size * 0.55 + 40 * u, align);
    }
  },

  "image-mosaic"(g) {
    const { W, H, ctx, u, scene, pad, c } = g;
    const refs = (scene.images?.length ? scene.images : scene.image ? [scene.image] : []).slice(0, 6);
    const n = Math.max(3, refs.length || 3);
    const cols = g.portrait ? 2 : n <= 3 ? n : Math.ceil(n / 2);
    const rows = Math.ceil(n / cols);
    const headH = scene.headline ? headlineSize(g, 0.5) * 1.6 : 0;
    const gap = 16 * u;
    const gx = pad, gy = pad + headH, gw = W - pad * 2, gh = H - pad * 2 - headH;
    const tw = (gw - gap * (cols - 1)) / cols, th = (gh - gap * (rows - 1)) / rows;
    if (scene.headline) {
      const L = layoutText(ctx, scene.headline, F(g, headlineSize(g, 0.5)), gw, 1);
      drawLayout(ctx, L, { x: pad, y: pad - 8 * u, align: "left", color: c.fg, emColor: c.accent, t: g.t, delay: 0, dur: 0.7, mode: "mask", easing: g.E });
      hitLayout(g, "headline", L, pad, pad - 8 * u, "left");
    }
    for (let i = 0; i < n; i++) {
      const col = i % cols, row = Math.floor(i / cols);
      const x = gx + col * (tw + gap), y = gy + row * (th + gap);
      const p = ease.inOutExpo(win(g.t, 0.1 + i * 0.12 * g.sp, 0.9 * g.sp));
      ctx.save();
      rr(ctx, x, y, tw, th, (g.brand.radius ?? 8) * u * 0.6);
      ctx.clip();
      ctx.beginPath();
      ctx.rect(x, y + th * (1 - p), tw, th * p);
      ctx.clip();
      const im = g.img(refs[i % Math.max(1, refs.length)]);
      if (im) drawCover(ctx, im, x, y, tw, th, 1.18 - 0.14 * p - 0.04 * clamp(g.t / g.dur));
      else placeholder(g, x, y, tw, th, "");
      ctx.restore();
    }
  },

  fullbleed(g) {
    const { W, H, ctx, u, scene, pad } = g;
    const im = g.img(scene.image);
    const z = 1.14 - 0.12 * ease.outCubic(clamp(g.t / g.dur));
    if (im) drawCover(ctx, im, 0, 0, W, H, z * (scene.zoom ?? 1), scene.focus?.x, scene.focus?.y);
    else placeholder(g, 0, 0, W, H);
    const gr = ctx.createLinearGradient(0, H * 0.35, 0, H);
    gr.addColorStop(0, "rgba(0,0,0,0)");
    gr.addColorStop(1, "rgba(0,0,0,0.62)");
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H);
    const save = g.c;
    g.c = { ...g.c, fg: "#FFFFFF", muted: "rgba(255,255,255,0.7)" as any };
    const align = scene.align ?? "left";
    const L = scene.headline ? layoutText(ctx, scene.headline, F(g, headlineSize(g, 0.8)), W - pad * 2, 3) : null;
    const y = H - pad - (L?.height ?? 0) - (scene.subline ? 60 * u : 0);
    textStack(g, { x: align === "center" ? W / 2 : pad, y: y - (scene.kicker ? 60 * u : 0), maxW: W - pad * 2, align, size: headlineSize(g, 0.8), color: "#FFFFFF", delay: 0.25 });
    g.c = save;
  },

  quote(g) {
    const { W, H, ctx, u, scene, pad, c } = g;
    const p = g.E(win(g.t, 0, 0.8));
    ctx.save();
    ctx.globalAlpha = p;
    ctx.font = `400 ${260 * u}px "Instrument Serif", serif`;
    ctx.fillStyle = c.accent;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("“", pad - 10 * u, pad - 40 * u + (1 - p) * 30 * u);
    ctx.restore();
    const L = layoutText(ctx, scene.headline ?? "", { ...F(g, headlineSize(g, 0.62)), family: /Mono/.test(g.brand.fontDisplay) ? g.brand.fontDisplay : g.brand.fontDisplay }, W - pad * 2.4, 5, 1.12);
    const y = H / 2 - L.height / 2;
    drawLayout(ctx, L, { x: pad * 1.2, y, align: "left", color: c.fg, emColor: c.accent, t: g.t, delay: 0.2, dur: 0.9 * g.sp, mode: "mask", stagger: 0.1, easing: g.E });
    hitLayout(g, "headline", L, pad * 1.2, y, "left");
    if (scene.author) {
      const ap = g.E(win(g.t, 0.9, 0.7));
      ctx.fillStyle = c.accent;
      ctx.fillRect(pad * 1.2, y + L.height + 56 * u, 40 * u * ap, 3 * u);
      drawLabel(ctx, scene.author, B(g, 26 * u, 500), pad * 1.2 + 60 * u, y + L.height + 58 * u, "left", c.muted, ap);
      hitText(g, "author", scene.author, B(g, 26 * u, 500), pad * 1.2 + 60 * u, y + L.height + 58 * u, "left");
    }
  },

  marquee(g) {
    const { W, H, ctx, u, scene, c } = g;
    const text = stripMarks(scene.headline || "New").toUpperCase() + "  ·  ";
    const size = g.portrait ? W * 0.22 : H * 0.24;
    const f = F(g, size);
    const tw = measure(ctx, text, f);
    const rows = 3;
    const p = ease.outExpo(win(g.t, 0, 0.9));
    g.hit?.({ field: "headline", x: 0, y: H / 2 - size * 0.55, w: W, h: size * 1.1, size, align: "center", lines: 1 });
    for (let r = 0; r < rows; r++) {
      const dir = r % 2 ? 1 : -1;
      const speed = 160 * u * (1 + r * 0.15);
      const off = ((g.t * speed * dir) % tw + tw) % tw;
      const y = H / 2 + (r - 1) * size * 1.02 + (1 - p) * dir * 80 * u;
      ctx.save();
      ctx.font = `${displayWeight(g.brand.fontDisplay)} ${size}px "${g.brand.fontDisplay}"`;
      (ctx as any).letterSpacing = `${displayTracking(g.brand.fontDisplay) * size}px`;
      ctx.textBaseline = "middle";
      ctx.globalAlpha = p;
      for (let x = -off - tw; x < W + tw; x += tw) {
        if (r === 1) {
          ctx.fillStyle = c.accent;
          ctx.fillText(text, x, y);
        } else {
          ctx.strokeStyle = rgba(c.fg, 0.55);
          ctx.lineWidth = 2 * u;
          ctx.strokeText(text, x, y);
        }
      }
      ctx.restore();
    }
    if (scene.subline) {
      drawLabel(ctx, stripMarks(scene.subline), B(g, 26 * u, 500), W / 2, H - g.pad, "center", c.fg, win(g.t, 0.5, 0.6));
      hitText(g, "subline", stripMarks(scene.subline), B(g, 26 * u, 500), W / 2, H - g.pad, "center");
    }
  },

  "shape-burst"(g) {
    const { W, H, ctx, u, c, scene } = g;
    const cx = W / 2, cy = H / 2;
    const m = Math.max(W, H);
    for (let i = 0; i < 6; i++) {
      const p = ease.outExpo(win(g.t, i * 0.08, 1.4 * g.sp));
      ctx.beginPath();
      ctx.arc(cx, cy, m * 0.08 * (i + 1) * p, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(i % 2 ? c.fg : c.accent, (1 - i / 7) * 0.6 * (1 - win(g.t, g.dur - 0.5, 0.5) * 0.5));
      ctx.lineWidth = (i === 0 ? 6 : 1.5) * u;
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(g.t * 0.5 + ease.outExpo(win(g.t, 0, 1.2)) * Math.PI * 0.5);
    const sq = m * 0.16 * g.E(win(g.t, 0.1, 1));
    ctx.strokeStyle = c.fg;
    ctx.lineWidth = 2 * u;
    ctx.strokeRect(-sq / 2, -sq / 2, sq, sq);
    ctx.restore();
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + hash(i) * 0.3;
      const p = ease.outExpo(win(g.t, 0.15 + hash(i + 9) * 0.25, 1.1));
      const r1 = m * 0.12 + m * 0.3 * p, r2 = r1 + m * 0.05 * (1 - p * 0.6);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.strokeStyle = rgba(c.accent, 1 - p * 0.7);
      ctx.lineWidth = 3 * u;
      ctx.stroke();
    }
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, 14 * u * ease.outBack(win(g.t, 0.3, 0.6)), 0, Math.PI * 2);
    ctx.fill();
    if (scene.headline) {
      const L = layoutText(ctx, scene.headline, F(g, headlineSize(g, 0.55)), W * 0.7, 2);
      drawLayout(ctx, L, { x: cx, y: cy + m * 0.12, align: "center", color: c.fg, emColor: c.accent, t: g.t, delay: 0.5, dur: 0.8, mode: "mask", easing: g.E });
      hitLayout(g, "headline", L, cx, cy + m * 0.12, "center");
    }
  },

  "logo-sting"(g) {
    const { W, H, ctx, u, c, scene, brand } = g;
    const logo = g.img(scene.image || brand.logo);
    const cx = W / 2, cy = H / 2;
    const p = ease.inOutExpo(win(g.t, 0, 1.0 * g.sp));
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy - 30 * u, Math.min(W, H) * 0.3 * p, 0, Math.PI * 2);
    ctx.clip();
    if (logo) {
      const r = containRect(logo, cx - 240 * u, cy - 30 * u - 160 * u, 480 * u, 320 * u);
      ctx.drawImage(logo, r.x, r.y, r.w, r.h);
    } else {
      ctx.fillStyle = c.accent;
      ctx.beginPath();
      ctx.arc(cx, cy - 30 * u, 70 * u, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    const name = stripMarks(scene.headline || brand.name || "Brand");
    const f = F(g, 64 * u);
    const letters = [...name];
    const tw = measure(ctx, name, f);
    g.hit?.({ field: "headline", x: cx - tw / 2, y: cy + 200 * u - f.size * 0.7, w: tw, h: f.size * 1.4, size: f.size, align: "center", lines: 1 });
    let x = cx - tw / 2;
    letters.forEach((ch, i) => {
      const lp = g.E(win(g.t, 0.6 + i * 0.035, 0.6));
      const w = measure(ctx, ch, f);
      drawLabel(ctx, ch, f, x, cy + 200 * u + (1 - lp) * 30 * u, "left", c.fg, lp);
      x += w;
    });
    if (scene.subline) {
      drawLabel(ctx, stripMarks(scene.subline).toUpperCase(), K(g, 20 * u), cx, cy + 270 * u, "center", c.muted, win(g.t, 1.1, 0.6));
      hitText(g, "subline", stripMarks(scene.subline).toUpperCase(), K(g, 20 * u), cx, cy + 270 * u, "center");
    }
  },

  "cta-end"(g) {
    const { W, H, ctx, u, c, scene, brand, pad } = g;
    const logo = g.img(brand.logo);
    if (logo) {
      const lp = g.E(win(g.t, 0, 0.7));
      ctx.save();
      ctx.globalAlpha = lp;
      const r = containRect(logo, W / 2 - 110 * u, pad * 0.9, 220 * u, 90 * u);
      ctx.drawImage(logo, r.x, r.y, r.w, r.h);
      ctx.restore();
    } else if (brand.name) {
      drawLabel(ctx, brand.name, F(g, 36 * u), W / 2, pad * 1.4, "center", c.fg, g.E(win(g.t, 0, 0.7)));
    }
    const bottom = textStack(g, { x: W / 2, y: H * 0.44, maxW: W - pad * 2.4, align: "center", vcenter: true, size: headlineSize(g, 0.85), delay: 0.1 });
    const cta = stripMarks(scene.cta || "Get started");
    const bf = B(g, 32 * u, 600);
    const bw = measure(ctx, cta, bf) + 96 * u, bh = 88 * u;
    const by = Math.max(bottom + 70 * u, H * 0.62);
    g.hit?.({ field: "cta", x: W / 2 - bw / 2, y: by, w: bw, h: bh, size: 32 * u, align: "center", lines: 1 });
    const bp = ease.outBack(win(g.t, 0.7, 0.7));
    ctx.save();
    ctx.translate(W / 2, by + bh / 2);
    ctx.scale(bp, bp);
    const pulse = (g.t * 0.8) % 1;
    if (g.t > 1.4) {
      ctx.strokeStyle = rgba(c.accent, 0.5 * (1 - pulse));
      ctx.lineWidth = 2 * u;
      rr(ctx, -bw / 2 - pulse * 24 * u, -bh / 2 - pulse * 24 * u, bw + pulse * 48 * u, bh + pulse * 48 * u, (brand.radius ?? 999) * u + pulse * 24 * u);
      ctx.stroke();
    }
    ctx.fillStyle = c.accent;
    rr(ctx, -bw / 2, -bh / 2, bw, bh, (brand.radius ?? 999) * u);
    ctx.fill();
    ctx.restore();
    const onAccent = contrast(c.bg, c.accent) > contrast(c.fg, c.accent) ? c.bg : c.fg;
    drawLabel(ctx, cta, bf, W / 2, by + bh / 2 + 1, "center", onAccent, win(g.t, 0.85, 0.3));
    if (scene.url) {
      drawLabel(ctx, scene.url, { family: "JetBrains Mono", weight: 500, size: 24 * u }, W / 2, by + bh + 64 * u, "center", c.muted, win(g.t, 1.0, 0.5));
      hitText(g, "url", scene.url, { family: "JetBrains Mono", weight: 500, size: 24 * u }, W / 2, by + bh + 64 * u, "center");
    }
  },

  "device-mockup"(g) {
    const { W, H, ctx, u, c, scene, pad } = g;
    const im = g.img(scene.image);
    const phone = g.portrait || W / H < 1.2;
    const p = g.E(win(g.t, 0, 1.1 * g.sp));
    const float = Math.sin(g.t * 1.2) * 6 * u;
    // device geometry
    let dw: number, dh: number, dx: number, dy: number;
    if (phone) {
      dh = H * (g.portrait ? 0.56 : 0.74);
      dw = dh * 0.49;
      dx = g.portrait ? W / 2 - dw / 2 : W * 0.62 - dw / 2;
      dy = g.portrait ? H * 0.1 : H / 2 - dh / 2;
    } else {
      dw = W * 0.52;
      dh = dw * 0.62;
      dx = W - pad - dw;
      dy = H / 2 - dh / 2 - dh * 0.06;
    }
    ctx.save();
    ctx.globalAlpha = clamp(p);
    ctx.translate(0, (1 - p) * 90 * u + float);
    // shadow
    ctx.fillStyle = rgba("#000000", 0.28);
    ctx.beginPath();
    ctx.ellipse(dx + dw / 2, dy + dh + (phone ? 26 : 40) * u, dw * 0.42, 14 * u, 0, 0, Math.PI * 2);
    ctx.fill();
    const bezel = phone ? dw * 0.045 : dw * 0.022;
    const r = phone ? dw * 0.16 : 14 * u;
    ctx.fillStyle = mix(c.fg, c.bg, 0.08);
    rr(ctx, dx, dy, dw, dh, r);
    ctx.fill();
    const sx = dx + bezel, sy = dy + bezel, sw = dw - bezel * 2, sh = dh - bezel * 2;
    ctx.save();
    rr(ctx, sx, sy, sw, sh, Math.max(2, r - bezel));
    ctx.clip();
    if (im) drawCover(ctx, im, sx, sy, sw, sh, (1.06 - 0.06 * clamp(g.t / g.dur)) * (scene.zoom ?? 1), scene.focus?.x, scene.focus?.y);
    else placeholder(g, sx, sy, sw, sh, "Drop a screenshot");
    // screen glare
    const gl = ctx.createLinearGradient(sx, sy, sx + sw, sy + sh);
    gl.addColorStop(0, "rgba(255,255,255,0.10)");
    gl.addColorStop(0.45, "rgba(255,255,255,0)");
    ctx.fillStyle = gl;
    ctx.fillRect(sx, sy, sw, sh);
    ctx.restore();
    if (phone) {
      ctx.fillStyle = mix(c.fg, c.bg, 0.08);
      rr(ctx, dx + dw / 2 - dw * 0.14, sy + 6 * u, dw * 0.28, dw * 0.07, dw * 0.035);
      ctx.fill();
    } else {
      // laptop base
      ctx.fillStyle = mix(c.fg, c.bg, 0.2);
      rr(ctx, dx - dw * 0.06, dy + dh, dw * 1.12, dh * 0.045, dh * 0.02);
      ctx.fill();
    }
    ctx.restore();
    // copy
    if (g.portrait) textStack(g, { x: W / 2, y: H * 0.72, maxW: W - pad * 2, align: "center", size: headlineSize(g, 0.6), delay: 0.4 });
    else textStack(g, { x: pad, y: H / 2, maxW: (phone ? dx - pad * 1.6 : dx - pad * 1.8), align: "left", size: headlineSize(g, 0.66), vcenter: true, delay: 0.4 });
  },

  countdown(g) {
    const { W, H, ctx, u, c, scene, pad } = g;
    const from = Math.max(1, Math.min(10, Math.round(scene.stat?.value ?? 3)));
    const steps = from + 1; // N … 1, then the reveal
    const slot = (g.dur * 0.92) / steps;
    const k = Math.min(steps - 1, Math.floor(g.t / slot));
    const lt = g.t - k * slot;
    const num = from - k;
    const align = scene.align ?? "center";
    const x = align === "center" ? W / 2 : pad;
    kicker(g, scene.kicker || "Launching in", x, H * 0.24, align);
    // ring that empties each beat
    const R = Math.min(W, H) * 0.24;
    ctx.save();
    ctx.lineWidth = 4 * u;
    ctx.strokeStyle = rgba(c.fg, 0.1);
    ctx.beginPath();
    ctx.arc(W / 2, H * 0.53, R, 0, Math.PI * 2);
    ctx.stroke();
    if (num > 0) {
      ctx.strokeStyle = c.accent;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(W / 2, H * 0.53, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - clamp(lt / slot)));
      ctx.stroke();
    }
    ctx.restore();
    const p = ease.outBack(win(lt, 0, 0.35));
    const out = ease.inCubic(win(lt, slot - 0.18, 0.18));
    ctx.save();
    ctx.translate(W / 2, H * 0.53);
    const sc = lerp(0.7, 1, p) * (1 - out * 0.25);
    ctx.scale(sc, sc);
    ctx.globalAlpha = clamp(p) * (1 - out);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (num > 0) {
      const size = R * 1.15;
      ctx.font = `${displayWeight(g.brand.fontDisplay)} ${size}px "${g.brand.fontDisplay}"`;
      ctx.fillStyle = c.fg;
      ctx.fillText(String(num), 0, size * 0.04);
    } else {
      const L = layoutText(ctx, scene.headline || "Now *live*", F(g, headlineSize(g, 0.85)), W - pad * 2, 2);
      ctx.translate(-W / 2, -H * 0.53);
      drawLayout(ctx, L, { x: W / 2, y: H * 0.53 - L.height / 2, align: "center", color: c.fg, emColor: c.accent, t: lt, delay: 0, dur: 0.6, mode: "mask", easing: g.E });
    }
    ctx.restore();
    g.hit?.({ field: num > 0 ? "stat.value" : "headline", x: W / 2 - R, y: H * 0.53 - R, w: R * 2, h: R * 2, size: R * 0.6, align: "center", lines: 1 });
  },

  "price-card"(g) {
    const { W, H, ctx, u, c, scene, pad, brand } = g;
    const st = scene.stat ?? { value: 29, prefix: "$", suffix: "/mo" };
    const cw = g.portrait ? W - pad * 2 : Math.min(W * 0.42, 760 * u);
    const items = (scene.items ?? []).slice(0, 4);
    const priceSize = Math.min(150 * u, cw * 0.28);
    const content = 72 * u + (scene.kicker ? 64 * u : 0) + priceSize + 30 * u + (st.label ? 50 * u : 0) + items.length * 54 * u + 56 * u + 78 * u + 48 * u;
    const ch = Math.min(H - pad * 2, content);
    const cx = W / 2 - cw / 2, cy = H / 2 - ch / 2;
    const p = g.E(win(g.t, 0, 0.9 * g.sp));
    ctx.save();
    ctx.translate(0, (1 - p) * 60 * u);
    ctx.globalAlpha = clamp(p);
    ctx.fillStyle = mix(c.bg, c.fg, 0.06);
    rr(ctx, cx, cy, cw, ch, Math.min(32, brand.radius ?? 16) * u + 8 * u);
    ctx.fill();
    ctx.strokeStyle = rgba(c.fg, 0.1);
    ctx.lineWidth = 1.5 * u;
    ctx.stroke();
    ctx.restore();
    const ix = cx + 56 * u;
    let y = cy + 72 * u;
    if (scene.kicker) {
      kicker(g, scene.kicker, ix, y, "left", 0.2);
      y += 64 * u;
    }
    // price
    const pv = ease.outExpo(win(g.t, 0.35, 1.1 * g.sp));
    const priceTxt = `${st.prefix ?? ""}${(st.value * pv).toLocaleString("en-US", { minimumFractionDigits: st.decimals ?? 0, maximumFractionDigits: st.decimals ?? 0 })}`;
    const size = priceSize;
    ctx.save();
    ctx.globalAlpha = clamp(win(g.t, 0.3, 0.4));
    ctx.font = `${displayWeight(brand.fontDisplay)} ${size}px "${brand.fontDisplay}"`;
    (ctx as any).letterSpacing = `${displayTracking(brand.fontDisplay) * size}px`;
    ctx.fillStyle = c.fg;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(priceTxt, ix, y + size * 0.82);
    const pw = ctx.measureText(`${st.prefix ?? ""}${st.value.toLocaleString("en-US", { minimumFractionDigits: st.decimals ?? 0, maximumFractionDigits: st.decimals ?? 0 })}`).width;
    ctx.restore();
    g.hit?.({ field: "stat.value", x: ix, y, w: pw, h: size, size, align: "left", lines: 1 });
    if (st.suffix) drawLabel(ctx, st.suffix, B(g, 30 * u, 500), ix + pw + 12 * u, y + size * 0.66, "left", c.muted, win(g.t, 0.6, 0.4));
    y += size + 30 * u;
    if (st.label) {
      drawLabel(ctx, st.label, B(g, 26 * u), ix, y, "left", rgba(c.fg, 0.7), win(g.t, 0.6, 0.5));
      hitText(g, "stat.label", st.label, B(g, 26 * u), ix, y, "left");
      y += 50 * u;
    }
    items.forEach((it, i) => {
      const d = 0.7 + i * 0.12;
      const ip = g.E(win(g.t, d, 0.6));
      ctx.save();
      ctx.globalAlpha = clamp(ip);
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 3.5 * u;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(ix, y);
      ctx.lineTo(ix + 9 * u, y + 9 * u);
      ctx.lineTo(ix + 24 * u, y - 9 * u);
      ctx.stroke();
      ctx.restore();
      const t = stripMarks(it);
      drawLabel(ctx, t, B(g, 28 * u, 500), ix + 44 * u + (1 - ip) * 14 * u, y, "left", c.fg, ip);
      hitText(g, `items.${i}`, t, B(g, 28 * u, 500), ix + 44 * u, y, "left");
      y += 54 * u;
    });
    // button
    const cta = stripMarks(scene.cta || "Choose plan");
    const bh = 78 * u, bw = cw - 112 * u, by = cy + ch - bh - 48 * u;
    const bp = ease.outBack(win(g.t, 1.1, 0.6));
    ctx.save();
    ctx.translate(ix + bw / 2, by + bh / 2);
    ctx.scale(bp, bp);
    ctx.fillStyle = c.accent;
    rr(ctx, -bw / 2, -bh / 2, bw, bh, (brand.radius ?? 999) * u);
    ctx.fill();
    ctx.restore();
    const onAccent = contrast(c.bg, c.accent) > contrast(c.fg, c.accent) ? c.bg : c.fg;
    drawLabel(ctx, cta, B(g, 28 * u, 600), ix + bw / 2, by + bh / 2 + 1, "center", onAccent, win(g.t, 1.25, 0.3));
    g.hit?.({ field: "cta", x: ix, y: by, w: bw, h: bh, size: 28 * u, align: "center", lines: 1 });
    if (scene.headline && !g.portrait) {
      // headline sits to the side on wide formats
      const L = layoutText(ctx, scene.headline, F(g, headlineSize(g, 0.55)), cx - pad * 1.6, 3);
      if (cx - pad * 1.6 > 200 * u) {
        drawLayout(ctx, L, { x: pad, y: H / 2 - L.height / 2, align: "left", color: c.fg, emColor: c.accent, t: g.t, delay: 0.2, dur: 0.8 * g.sp, mode: "mask", easing: g.E });
        hitLayout(g, "headline", L, pad, H / 2 - L.height / 2, "left");
      }
    }
  },

  testimonials(g) {
    const { W, H, ctx, u, c, scene, pad, brand } = g;
    const raw = (scene.items?.length ? scene.items : ["Changed how we launch. — Ana, Lumen", "Fastest ads we've ever shipped. — Kofi, Orbit"]).slice(0, 3);
    const quotes = raw.map((q) => {
      const m = q.split(/\s+[—–-]\s+/);
      return { text: m[0].replace(/^["“]|["”]$/g, ""), who: m[1] ?? "" };
    });
    let top = pad;
    if (scene.headline) {
      const L = layoutText(ctx, scene.headline, F(g, headlineSize(g, 0.5)), W - pad * 2, 2);
      drawLayout(ctx, L, { x: g.portrait ? pad : W / 2, y: top, align: g.portrait ? "left" : "center", color: c.fg, emColor: c.accent, t: g.t, delay: 0, dur: 0.8 * g.sp, mode: "mask", easing: g.E });
      hitLayout(g, "headline", L, g.portrait ? pad : W / 2, top, g.portrait ? "left" : "center");
      top += L.height + 50 * u;
    }
    const n = quotes.length;
    const cols = g.portrait ? 1 : n;
    const gap = 28 * u;
    const cw = (W - pad * 2 - gap * (cols - 1)) / cols;
    const qSize = Math.min(52 * u, cw * (g.portrait ? 0.06 : 0.085));
    const qLayouts = quotes.map((q) => layoutText(ctx, q.text, B(g, qSize, 500), cw - 64 * u, g.portrait ? 4 : 6, 1.28));
    const tallest = Math.max(...qLayouts.map((L) => L.height));
    const fit = tallest + 100 * u + 90 * u; // quote mark above, author below
    const ch = g.portrait ? Math.min((H - top - pad - gap * (n - 1)) / n, fit + 40 * u) : Math.min(H - top - pad, fit);
    const cy0 = g.portrait ? top + (H - top - pad - (ch * n + gap * (n - 1))) / 2 : top + (H - top - pad - ch) / 2;
    quotes.forEach((q, i) => {
      const col = g.portrait ? 0 : i, row = g.portrait ? i : 0;
      const x = pad + col * (cw + gap), y = cy0 + row * (ch + gap);
      const d = 0.2 + i * 0.18 * g.sp;
      const p = g.E(win(g.t, d, 0.8 * g.sp));
      ctx.save();
      ctx.globalAlpha = clamp(p);
      ctx.translate(0, (1 - p) * 50 * u);
      ctx.fillStyle = mix(c.bg, c.fg, 0.06);
      rr(ctx, x, y, cw, ch, Math.min(28, brand.radius ?? 16) * u + 6 * u);
      ctx.fill();
      ctx.font = `400 ${90 * u}px "Instrument Serif", serif`;
      ctx.fillStyle = c.accent;
      ctx.textBaseline = "top";
      ctx.fillText("“", x + 30 * u, y + 12 * u);
      ctx.restore();
      const qL = qLayouts[i];
      drawLayout(ctx, qL, { x: x + 32 * u, y: y + 100 * u, align: "left", color: c.fg, emColor: c.accent, t: g.t, delay: d + 0.15, dur: 0.6, mode: "rise", stagger: 0.04 });
      hitLayout(g, `items.${i}`, qL, x + 32 * u, y + 100 * u, "left");
      if (q.who) drawLabel(ctx, q.who, B(g, 22 * u, 600), x + 32 * u, y + ch - 40 * u, "left", c.muted, win(g.t, d + 0.4, 0.5));
    });
  },

  "before-after"(g) {
    const { W, H, ctx, u, c, scene, pad } = g;
    const a = g.img(scene.images?.[0] ?? scene.image), b = g.img(scene.images?.[1]);
    const labels = [scene.items?.[0] ?? "Before", scene.items?.[1] ?? "After"];
    const fx = pad, fy = pad, fw = W - pad * 2, fh = H - pad * 2 - (scene.headline ? headlineSize(g, 0.5) * 1.6 : 0);
    const y0 = scene.headline ? fy + headlineSize(g, 0.5) * 1.6 : fy;
    if (scene.headline) {
      const L = layoutText(ctx, scene.headline, F(g, headlineSize(g, 0.5)), fw, 1);
      drawLayout(ctx, L, { x: pad, y: pad - 8 * u, align: "left", color: c.fg, emColor: c.accent, t: g.t, delay: 0, dur: 0.7, mode: "mask", easing: g.E });
      hitLayout(g, "headline", L, pad, pad - 8 * u, "left");
    }
    const r = Math.min(24, g.brand.radius ?? 12) * u;
    // the divider sweeps across, pauses at the middle, then reveals "after"
    const sweep = ease.inOutCubic(win(g.t, 0.5, g.dur * 0.35)) * 0.5 + ease.inOutCubic(win(g.t, g.dur * 0.55, g.dur * 0.3)) * 0.5;
    const split = fx + fw * (1 - sweep);
    ctx.save();
    rr(ctx, fx, y0, fw, fh, r);
    ctx.clip();
    if (a) drawCover(ctx, a, fx, y0, fw, fh, 1.04);
    else placeholder(g, fx, y0, fw, fh, "Drop the before image");
    ctx.save();
    ctx.beginPath();
    ctx.rect(split, y0, fx + fw - split, fh);
    ctx.clip();
    if (b) drawCover(ctx, b, fx, y0, fw, fh, 1.04);
    else {
      ctx.fillStyle = mix(c.bg, c.accent, 0.35);
      ctx.fillRect(fx, y0, fw, fh);
    }
    ctx.restore();
    ctx.restore();
    if (sweep > 0 && sweep < 1) {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(split - 2 * u, y0, 4 * u, fh);
      ctx.beginPath();
      ctx.arc(split, y0 + fh / 2, 26 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#111111";
      drawLabel(ctx, "‹ ›", B(g, 24 * u, 700), split, y0 + fh / 2, "center", "#111111");
    }
    const tag = (text: string, x: number, align: "left" | "right", alpha: number, field: string) => {
      const f = K(g, 20 * u);
      const w = measure(ctx, text.toUpperCase(), f) + 32 * u;
      const tx = align === "left" ? x : x - w;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      rr(ctx, tx, y0 + 20 * u, w, 44 * u, 22 * u);
      ctx.fill();
      ctx.restore();
      drawLabel(ctx, text.toUpperCase(), f, tx + 16 * u, y0 + 42 * u, "left", "#FFFFFF", alpha);
      g.hit?.({ field, x: tx, y: y0 + 20 * u, w, h: 44 * u, size: 20 * u, align: "left", lines: 1 });
    };
    tag(labels[0], fx + 20 * u, "left", clamp(1 - sweep * 1.6), "items.0");
    tag(labels[1], fx + fw - 20 * u, "right", clamp(sweep * 1.6 - 0.3), "items.1");
  },

  audiogram(g) {
    const { W, H, ctx, u, c, scene, brand, pad } = g;
    const now = g.abs + g.t;
    const lv = g.level(now);
    const inP = g.E(win(g.t, 0, 0.9 * g.sp));
    const land = !g.portrait && W > H * 1.2;
    // Avatar: the scene's image in a circle, else the brand's initial, with rings that breathe with the voice.
    const R = Math.min(W, H) * (land ? 0.2 : 0.17);
    const ax = land ? pad + R * 1.25 : W / 2, ay = land ? H * 0.5 : H * (g.portrait ? 0.3 : 0.31);
    for (let k = 3; k >= 1; k--) {
      const rr2 = R * (1 + k * 0.12 + lv * 0.16 * k) * inP;
      ctx.beginPath();
      ctx.arc(ax, ay, rr2, 0, Math.PI * 2);
      ctx.fillStyle = rgba(c.accent, (0.07 + lv * 0.08) * (4 - k) * 0.5 * inP);
      ctx.fill();
    }
    ctx.save();
    ctx.beginPath();
    ctx.arc(ax, ay, R * inP, 0, Math.PI * 2);
    ctx.clip();
    const im = g.img(scene.image || brand.logo);
    if (im) drawCover(ctx, im, ax - R, ay - R, R * 2, R * 2, scene.zoom ?? 1, scene.focus?.x ?? 0.5, scene.focus?.y ?? 0.5);
    else {
      ctx.fillStyle = c.accent;
      ctx.fillRect(ax - R, ay - R, R * 2, R * 2);
      const initial = (stripMarks(brand.name || scene.headline || "•").trim()[0] ?? "•").toUpperCase();
      drawLabel(ctx, initial, F(g, R * 1.05), ax, ay + R * 0.04, "center", contrast(c.fg, c.accent) > contrast(c.bg, c.accent) ? c.fg : c.bg);
    }
    ctx.restore();

    // Text column.
    const x0 = land ? ax + R * 1.7 : pad;
    const colW = land ? W - x0 - pad : W - pad * 2;
    const align: "left" | "center" = land ? "left" : "center";
    const tx = align === "center" ? W / 2 : x0;
    let y = land ? H * 0.2 : ay + R * 1.55;
    if (scene.kicker) {
      kicker(g, scene.kicker, tx, y, align, 0.2);
      y += 56 * u;
    }
    if (scene.headline) {
      const L = layoutText(ctx, scene.headline, F(g, (land ? 64 : 70) * u), colW, 2, 1.02);
      hitLayout(g, "headline", L, tx, y, align);
      y = drawLayout(ctx, L, { x: tx, y, align, color: c.fg, emColor: c.accent, t: g.t, delay: 0.25, dur: 0.8 * g.sp, stagger: 0.08, mode: "mask", easing: g.E });
    }

    // Waveform: the voice around "now" scrolls past; what's been said is bright, what's coming is faint.
    const bars = land ? 64 : 44;
    const wy = land ? H * 0.56 : y + (g.portrait ? 150 : 110) * u;
    const ww = colW, bw = ww / bars, maxH = (land ? 150 : 130) * u;
    const step = 0.06;
    for (let i = 0; i < bars; i++) {
      const at = now + (i - bars * 0.5) * step;
      const v = Math.max(0.04, g.level(at));
      const appear = clamp(inP * 1.4 - Math.abs(i - bars / 2) / bars);
      const h = maxH * v * appear;
      const past = at <= now;
      ctx.fillStyle = past ? (Math.abs(at - now) < step ? c.accent : rgba(c.accent, 0.85)) : rgba(c.fg, 0.22);
      rr(ctx, x0 + i * bw + bw * 0.18, wy - h / 2, bw * 0.64, Math.max(h, 3 * u), bw * 0.32);
      ctx.fill();
    }

    // Live caption: the phrase being spoken, word by word; else the subline.
    const cy = wy + maxH * 0.5 + (land ? 90 : 110) * u;
    const words = g.words;
    const size = (land ? 46 : 54) * u;
    const fnt = F(g, size);
    if (words?.length) {
      const phrases = chunkPhrases(words, land ? 6 : 4);
      const ph = phrases.find((p2) => now >= p2[0].s - 0.1 && now <= p2[p2.length - 1].e + 0.3) ?? [...phrases].reverse().find((p2) => p2[0].s <= now);
      if (ph && now <= ph[ph.length - 1].e + 0.6) {
        const space = measure(ctx, " ", fnt);
        const widths = ph.map((w) => measure(ctx, w.w, fnt));
        const total = widths.reduce((a, b) => a + b, 0) + space * (ph.length - 1);
        const k = total > colW ? colW / total : 1;
        const f2 = { ...fnt, size: size * k };
        let cx = align === "center" ? W / 2 - (total * k) / 2 : x0;
        ph.forEach((w, i) => {
          const said = now >= w.s;
          const active = now >= w.s && now <= w.e + 0.08;
          const p2 = ease.outCubic(win(now, w.s - 0.05, 0.25));
          drawLabel(ctx, w.w, f2, cx, cy - (1 - p2) * 10 * u, "left", active ? c.accent : said ? c.fg : rgba(c.fg, 0.28));
          cx += (widths[i] + space) * k;
        });
      }
    } else if (scene.subline) {
      const L = layoutText(ctx, stripMarks(scene.subline), B(g, 34 * u, 500), colW, 2, 1.3);
      hitLayout(g, "subline", L, tx, cy - 20 * u, align);
      drawLayout(ctx, L, { x: tx, y: cy - 20 * u, align, color: rgba(c.fg, 0.8), emColor: c.accent, t: g.t, delay: 0.5, dur: 0.8, mode: "rise", stagger: 0.05, easing: ease.outCubic });
    }
  },

  "logo-reveal"(g) {
    const { W, H, ctx, u, c, scene, brand } = g;
    const logo = g.img(scene.image || brand.logo);
    const cx = W / 2, cy = H / 2 - 20 * u;
    const name = stripMarks(scene.headline || brand.name || "Brand");
    // two lines draw in from the centre, then the mark wipes up between them
    const lp = ease.inOutExpo(win(g.t, 0, 0.8 * g.sp));
    const half = Math.min(W, H) * 0.32;
    ctx.fillStyle = c.accent;
    ctx.fillRect(cx - half * lp, cy - 110 * u, half * 2 * lp, 3 * u);
    ctx.fillRect(cx - half * lp, cy + 110 * u, half * 2 * lp, 3 * u);
    const mp = ease.outExpo(win(g.t, 0.5, 0.9 * g.sp));
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - half, cy - 106 * u, half * 2, 212 * u);
    ctx.clip();
    ctx.translate(0, (1 - mp) * 220 * u);
    if (logo) {
      const r = containRect(logo, cx - half * 0.8, cy - 90 * u, half * 1.6, 180 * u);
      ctx.drawImage(logo, r.x, r.y, r.w, r.h);
    } else {
      const f = F(g, Math.min(150 * u, (half * 1.7) / Math.max(1, name.length * 0.55)));
      drawLabel(ctx, name, f, cx, cy, "center", c.fg);
      g.hit?.({ field: "headline", x: cx - half, y: cy - 90 * u, w: half * 2, h: 180 * u, size: f.size, align: "center", lines: 1 });
    }
    ctx.restore();
    if (scene.subline) {
      const sub = stripMarks(scene.subline).toUpperCase();
      drawLabel(ctx, sub, K(g, 22 * u), cx, cy + 170 * u, "center", c.muted, win(g.t, 1.1, 0.6));
      hitText(g, "subline", sub, K(g, 22 * u), cx, cy + 170 * u, "center");
    }
  },
};

// ---------------------------------------------------------------- soundtrack level
const levelCache = new WeakMap<object, (t: number) => number>();
/** Loudness over time: the voice-over's waveform peaks, else a bump on each music beat. */
export function levelFor(p: Project): (t: number) => number {
  const a = p.audio;
  if (a?.peaks?.length && a.duration > 0) {
    let f = levelCache.get(a);
    if (!f) {
      const pk = a.peaks, n = pk.length, d = a.duration, vol = Math.min(1.2, a.volume ?? 1);
      f = (t) => {
        if (t < 0 || t > d) return 0;
        const x = (t / d) * (n - 1), i = Math.floor(x), k = x - i;
        return clamp(((pk[i] ?? 0) * (1 - k) + (pk[i + 1] ?? 0) * k) * vol);
      };
      levelCache.set(a, f);
    }
    return f;
  }
  const m = p.music;
  if (m?.beats?.length) {
    let f = levelCache.get(m);
    if (!f) {
      const start = m.start ?? 0, dur = m.duration ?? 0, beats = m.beats, en = m.energy;
      f = (t) => {
        let at = start + t;
        if (dur > 0) at %= dur;
        // last beat at or before `at` (binary search)
        let lo = 0, hi = beats.length - 1, i = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (beats[mid] <= at) (i = mid), (lo = mid + 1);
          else hi = mid - 1;
        }
        if (i < 0) return 0.15;
        const e = en?.[i] ?? 0.7;
        return clamp(0.12 + e * 0.88 * Math.exp(-(at - beats[i]) * 6));
      };
      levelCache.set(m, f);
    }
    return f;
  }
  return () => 0;
}

// ---------------------------------------------------------------- words → phrases, captions
const clean = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

export function chunkPhrases(words: Word[], max = 3): Word[][] {
  const out: Word[][] = [];
  let cur: Word[] = [];
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    const gap = next ? next.s - w.e : 1;
    if (cur.length >= max || /[.,!?;:—]$/.test(w.w) || gap > 0.35 || !next) {
      out.push(cur);
      cur = [];
    }
  });
  return out;
}

function drawCaptions(ctx: CanvasRenderingContext2D, W: number, H: number, p: Project, t: number, scene?: Scene) {
  const words = p.audio!.words!;
  const phrases = chunkPhrases(words, 5);
  const ph = phrases.find((ph) => t >= ph[0].s - 0.1 && t <= ph[ph.length - 1].e + 0.25);
  if (!ph) return;
  const u = Math.min(W, H) / 1080;
  const size = 34 * u;
  const f: FontSpec = { family: p.brand.fontBody, weight: 600, size, tracking: -0.01 };
  const text = ph.map((w) => w.w).join(" ");
  const tw = measure(ctx, text, f);
  const padX = 28 * u, h = size * 1.9;
  // Under cinema bars, subtitles sit in the bottom bar like a film's.
  const bar = scene?.effects?.includes("letterbox") ? (W / H > 1.2 ? (H - W / 2.39) / 2 : H * 0.06) : 0;
  const x = W / 2 - tw / 2, y = bar >= h + 8 * u ? H - bar / 2 - h / 2 : H - Math.min(W, H) * 0.1 - h;
  ctx.save();
  ctx.fillStyle = "rgba(10,10,10,0.72)";
  rr(ctx, x - padX, y, tw + padX * 2, h, h / 2);
  ctx.fill();
  let cx = x;
  for (const w of ph) {
    const ww = measure(ctx, w.w, f);
    const active = t >= w.s && t <= w.e + 0.05;
    drawLabel(ctx, w.w, f, cx, y + h / 2, "left", active ? p.brand.accent : t > w.e ? "#FFFFFF" : "rgba(255,255,255,0.5)");
    cx += ww + measure(ctx, " ", f);
  }
  ctx.restore();
}

function makeGrain() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  const d = ctx.createImageData(256, 256);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = Math.random() * 255;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    d.data[i + 3] = 255;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}
