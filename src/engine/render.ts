// Hookky motion engine — renders a Project at time t onto a 2D canvas.
import type { Project, Scene, Brand, Word, TransitionId } from "../types";
import { clamp, ease, lerp, win, rgba, mix, contrast, hash } from "./util";
import { layoutText, drawLayout, drawLabel, displayWeight, displayTracking, stripMarks, measure, type FontSpec } from "./text";

export type ImageGetter = (ref?: string) => HTMLImageElement | undefined;

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
  E: (x: number) => number;
  sp: number; // motion speed multiplier (durations)
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
export const totalDuration = (p: Project) => p.scenes.reduce((a, s) => a + s.duration, 0);

const TRANSITION_DUR: Record<TransitionId, number> = { cut: 0, fade: 0.5, slide: 0.65, "push-up": 0.7, wipe: 0.6, zoom: 0.6, circle: 0.75, blur: 0.6 };

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

  render(project: Project, t: number, img: ImageGetter) {
    const ctx = this.canvas.getContext("2d")!;
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
      this.drawSceneTo(this.bufB, project, cur, lt, img);
      composite(ctx, this.bufA, this.bufB, tr, ease.inOutCubic(lt / td), this.W, this.H, colorsFor(project.brand, cur.scene).accent);
    } else {
      this.drawScene(ctx, project, cur, lt, img);
    }

    if (project.captions && project.audio?.words?.length) drawCaptions(ctx, this.W, this.H, project, tt);
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

  private drawSceneTo(c: HTMLCanvasElement, p: Project, e: TimelineEntry, lt: number, img: ImageGetter) {
    const ctx = c.getContext("2d")!;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    this.drawScene(ctx, p, e, lt, img);
  }

  private drawScene(ctx: CanvasRenderingContext2D, p: Project, e: TimelineEntry, lt: number, img: ImageGetter) {
    const { W, H } = this;
    const scene = e.scene;
    const motion = scene.motion ?? "snappy";
    const g: G = {
      ctx, W, H,
      u: Math.min(W, H) / 1080,
      portrait: H > W * 1.1,
      pad: Math.min(W, H) * 0.085,
      c: colorsFor(p.brand, scene),
      brand: p.brand,
      scene,
      t: lt,
      dur: scene.duration,
      abs: e.start,
      img,
      words: p.audio?.words,
      E: motion === "bouncy" ? ease.outBack : motion === "calm" ? ease.outCubic : ease.outExpo,
      sp: motion === "calm" ? 1.35 : motion === "bouncy" ? 1.05 : 0.9,
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    drawBackground(g);
    (TEMPLATES[scene.template] ?? TEMPLATES["title-reveal"])(g);
    ctx.restore();
  }
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
    case "fade":
    default:
      draw(A);
      ctx.globalAlpha = p;
      draw(B);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- backgrounds
function drawBackground(g: G) {
  const { ctx, W, H, c, t, u } = g;
  const kind = g.scene.background ?? "solid";
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, W, H);
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
  } else if (kind === "image") {
    const im = g.img(g.scene.image);
    if (im) {
      ctx.save();
      ctx.filter = `blur(${28 * u}px) saturate(1.1)`;
      drawCover(ctx, im, -40 * u, -40 * u, W + 80 * u, H + 80 * u, 1.05 + t * 0.01);
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
function containRect(im: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const ir = im.naturalWidth / im.naturalHeight;
  let dw = w, dh = w / ir;
  if (dh > h) {
    dh = h;
    dw = h * ir;
  }
  return { x: x + (w - dw) / 2, y: y + (h - dh) / 2, w: dw, h: dh };
}
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  const rad = Math.min(r, w / 2, h / 2);
  if ((ctx as any).roundRect) (ctx as any).roundRect(x, y, w, h, rad);
  else ctx.rect(x, y, w, h);
}
function placeholder(g: G, x: number, y: number, w: number, h: number, label = "Drop a product image") {
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
const F = (g: G, size: number): FontSpec => ({ family: g.brand.fontDisplay, weight: displayWeight(g.brand.fontDisplay), size, tracking: displayTracking(g.brand.fontDisplay) });
const B = (g: G, size: number, weight = 450): FontSpec => ({ family: g.brand.fontBody, weight, size, tracking: -0.005 });
const K = (g: G, size: number): FontSpec => ({ family: g.brand.fontBody, weight: 600, size, tracking: 0.14 });

function kicker(g: G, text: string | undefined, x: number, y: number, align: "left" | "center", delay = 0) {
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
}

function headlineSize(g: G, scale = 1) {
  return (g.portrait ? g.W * 0.115 : g.H * 0.118) * scale;
}

/** headline + subline stack; returns bottom y */
function textStack(g: G, opts: { x: number; y: number; maxW: number; align: "left" | "center"; size?: number; maxLines?: number; delay?: number; vcenter?: boolean; color?: string; mode?: "mask" | "words" | "rise" }) {
  const { ctx, c, u, scene } = g;
  const align = opts.align;
  const H1 = scene.headline ? layoutText(ctx, scene.headline, F(g, opts.size ?? headlineSize(g)), opts.maxW, opts.maxLines ?? 3, /Serif|Fraunces/.test(g.brand.fontDisplay) ? 1.0 : 0.98) : null;
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
  if (H1) y = drawLayout(ctx, H1, { x: opts.x, y, align, color: opts.color ?? c.fg, emColor: c.accent, t: g.t, delay: d + 0.12, dur: 0.85 * g.sp, stagger: 0.09, mode: opts.mode ?? "mask", easing: g.E, emItalic: /Serif|Fraunces/.test(g.brand.fontDisplay) });
  if (S) {
    y += gap;
    y = drawLayout(ctx, S, { x: opts.x, y, align, color: rgba(opts.color ?? c.fg, 0.72), emColor: c.accent, t: g.t, delay: d + 0.45, dur: 0.8 * g.sp, mode: "rise", stagger: 0.06, easing: ease.outCubic });
  }
  return y;
}

// ---------------------------------------------------------------- templates
type Tpl = (g: G) => void;

const TEMPLATES: Record<string, Tpl> = {
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
    }
    if (scene.subline) drawLabel(ctx, stripMarks(scene.subline), B(g, 26 * u), W / 2, labelY + 34 * u, "center", rgba(c.fg, 0.65), g.E(win(g.t, 0.9, 0.6)));
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
    if (im) drawCover(ctx, im, ix, iy, iw, ih, 1.12 - 0.1 * clamp(g.t / g.dur));
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
    const lw = Math.min(W - pad * 2, measure(ctx, finalTxt, F(g, size))) * ease.inOutExpo(win(g.t, 0.4, 1.2));
    ctx.fillStyle = c.accent;
    ctx.fillRect(align === "center" ? W / 2 - lw / 2 : x, H / 2 + size * 0.55, lw, 6 * u);
    const label = st.label || scene.headline;
    if (label) {
      const L = layoutText(ctx, label, B(g, 34 * u, 500), W - pad * 2, 2, 1.3);
      drawLayout(ctx, L, { x, y: H / 2 + size * 0.55 + 40 * u, align, color: rgba(c.fg, 0.75), emColor: c.accent, t: g.t, delay: 0.8, dur: 0.7, mode: "rise" });
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
    if (im) drawCover(ctx, im, 0, 0, W, H, z);
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
    if (scene.author) {
      const ap = g.E(win(g.t, 0.9, 0.7));
      ctx.fillStyle = c.accent;
      ctx.fillRect(pad * 1.2, y + L.height + 56 * u, 40 * u * ap, 3 * u);
      drawLabel(ctx, scene.author, B(g, 26 * u, 500), pad * 1.2 + 60 * u, y + L.height + 58 * u, "left", c.muted, ap);
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
    if (scene.subline) drawLabel(ctx, stripMarks(scene.subline), B(g, 26 * u, 500), W / 2, H - g.pad, "center", c.fg, win(g.t, 0.5, 0.6));
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
    let x = cx - tw / 2;
    letters.forEach((ch, i) => {
      const lp = g.E(win(g.t, 0.6 + i * 0.035, 0.6));
      const w = measure(ctx, ch, f);
      drawLabel(ctx, ch, f, x, cy + 200 * u + (1 - lp) * 30 * u, "left", c.fg, lp);
      x += w;
    });
    if (scene.subline) drawLabel(ctx, stripMarks(scene.subline).toUpperCase(), K(g, 20 * u), cx, cy + 270 * u, "center", c.muted, win(g.t, 1.1, 0.6));
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
    if (scene.url) drawLabel(ctx, scene.url, { family: "JetBrains Mono", weight: 500, size: 24 * u }, W / 2, by + bh + 64 * u, "center", c.muted, win(g.t, 1.0, 0.5));
  },
};

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

function drawCaptions(ctx: CanvasRenderingContext2D, W: number, H: number, p: Project, t: number) {
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
  const x = W / 2 - tw / 2, y = H - Math.min(W, H) * 0.1 - h;
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
