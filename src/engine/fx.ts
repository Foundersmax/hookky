// Hookky effects: colour grades, camera moves, energy and atmosphere, applied to a rendered scene.
// The scene is drawn into `src` first; applyFx composites it onto the target with the scene's
// grade and effects. Everything is deterministic (seeded by the scene id and driven by scene
// time), so the preview, every export, thumbnails and contact sheets show the same frame.
import type { Brand, Effect, Grade, Project, Scene } from "../types";
import { hexToRgb, mix } from "./util";

export const hasFx = (s: Scene) => (!!s.grade && s.grade !== "none") || !!s.effects?.length;

/** One-click combinations. Each is a grade plus a few effects that belong together. */
export const LOOKS: { id: string; label: string; grade: Grade; effects: Effect[]; amount: number; note: string }[] = [
  { id: "cinematic", label: "Cinematic", grade: "teal-orange", effects: ["push-in", "vignette", "light-leak"], amount: 0.7, note: "Teal and orange, a slow push-in, warm light" },
  { id: "retro", label: "Retro film", grade: "warm-film", effects: ["dust", "vignette", "shake"], amount: 0.65, note: "Warm stock, dust and a handheld feel" },
  { id: "glitch", label: "Glitch pop", grade: "vivid", effects: ["rgb-split", "glitch", "flash"], amount: 0.75, note: "Saturated, split colour, digital bursts" },
  { id: "dreamy", label: "Dreamy", grade: "faded", effects: ["focus-pull", "bokeh", "light-leak"], amount: 0.7, note: "Soft focus, floating lights" },
  { id: "noir", label: "Noir", grade: "noir", effects: ["push-in", "vignette"], amount: 0.8, note: "Hard black and white, closing in" },
  { id: "celebrate", label: "Celebrate", grade: "vivid", effects: ["confetti", "sparkle", "flash"], amount: 0.8, note: "Confetti in your brand colours" },
  { id: "analog", label: "Analog TV", grade: "faded", effects: ["scanlines", "rgb-split", "shake"], amount: 0.6, note: "Scanlines, colour fringing, a little wobble" },
  { id: "print", label: "Brand print", grade: "duotone", effects: ["halftone", "pulse"], amount: 0.75, note: "Your two brand colours, printed dots" },
];

export const GRADE_LABEL: Record<Grade, string> = {
  none: "None", mono: "Mono", noir: "Noir", "warm-film": "Warm film", cool: "Cool", "teal-orange": "Teal & orange", faded: "Faded", vivid: "Vivid", duotone: "Brand duotone",
};
export const EFFECT_LABEL: Record<Effect, string> = {
  "push-in": "Push-in", pulse: "Pulse on beats", shake: "Shake", "focus-pull": "Focus pull", flash: "Flash", "rgb-split": "RGB split", glitch: "Glitch",
  "light-leak": "Light leak", vignette: "Vignette", bokeh: "Bokeh", dust: "Dust", sparkle: "Sparkle", confetti: "Confetti", scanlines: "Scanlines", halftone: "Halftone",
};

const FILTER_OK = typeof CanvasRenderingContext2D !== "undefined" && "filter" in CanvasRenderingContext2D.prototype;

const GRADE_FILTER: Record<Grade, string> = {
  none: "none",
  mono: "grayscale(1) contrast(1.08)",
  noir: "grayscale(1) contrast(1.55) brightness(0.92)",
  "warm-film": "sepia(0.32) saturate(1.18) contrast(1.06) hue-rotate(-6deg)",
  cool: "saturate(0.86) hue-rotate(10deg) brightness(1.02) contrast(1.04)",
  "teal-orange": "contrast(1.1) saturate(1.18)",
  faded: "contrast(0.84) brightness(1.08) saturate(0.78)",
  vivid: "saturate(1.45) contrast(1.12)",
  duotone: "grayscale(1) contrast(1.15)",
};

/** Small, fast, seeded random numbers (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedOf = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
};

/** Where the beats fall inside a scene: the voice-over's word onsets, else a 120 bpm grid. */
export function beatsIn(p: Project, start: number, dur: number): number[] {
  const words = p.audio?.words;
  if (words?.length) {
    const out = words.filter((w) => w.s >= start && w.s < start + dur).map((w) => w.s - start);
    if (out.length) return out;
  }
  const out: number[] = [];
  for (let t = 0.25; t < dur; t += 0.5) out.push(t);
  return out;
}

export interface FxFrame {
  scene: Scene;
  project: Project;
  brand: Brand;
  /** scene-local time and length */
  t: number;
  dur: number;
  /** absolute start of the scene */
  start: number;
}

/** The camera transform applied to the scene (also used to move click-to-edit regions). */
export interface Camera {
  scale: number;
  dx: number; // logical px
  dy: number;
}

const scratch = new Map<string, HTMLCanvasElement>();
function canvasFor(key: string, w: number, h: number) {
  let c = scratch.get(key);
  if (!c) scratch.set(key, (c = document.createElement("canvas")));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c;
}

/** The camera for a frame: push-in, pulse on beats and shake, in logical pixels. */
export function cameraFor(f: FxFrame, W: number, H: number): Camera {
  const fx = new Set(f.scene.effects ?? []);
  const amt = f.scene.fxAmount ?? 0.7;
  const u = Math.min(W, H) / 1080;
  let scale = 1, dx = 0, dy = 0;
  if (fx.has("push-in")) scale *= 1 + 0.07 * amt * Math.min(1, f.t / Math.max(0.5, f.dur));
  if (fx.has("pulse")) {
    const beats = beatsIn(f.project, f.start, f.dur);
    let since = Infinity;
    for (const b of beats) if (b <= f.t) since = f.t - b;
    if (since < 1) scale *= 1 + 0.04 * amt * Math.exp(-since * 9);
  }
  if (fx.has("shake")) {
    // An impact at the cut, then a slight handheld drift.
    const impact = 22 * u * amt * Math.exp(-f.t * 7);
    const hand = 2.5 * u * amt;
    const k = f.t * 31;
    dx = Math.sin(k * 1.7) * impact + (Math.sin(f.t * 2.3) + Math.sin(f.t * 3.7 + 1)) * hand;
    dy = Math.cos(k * 1.3) * impact + (Math.sin(f.t * 1.9 + 2) + Math.sin(f.t * 4.1)) * hand;
    scale *= 1 + (Math.abs(impact) + hand * 2) / Math.min(W, H); // hide the edges
  }
  return { scale, dx, dy };
}

/**
 * Composite `src` (the scene, already drawn at the target's size) onto `ctx` with the scene's
 * grade and effects. `ctx` and `src` are the same pixel size; `scale` maps logical px to pixels.
 */
export function applyFx(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, f: FxFrame, W: number, H: number, scale: number): Camera {
  const cw = src.width, ch = src.height;
  const u = (Math.min(W, H) / 1080) * scale; // 1 design unit in device pixels
  const fx = new Set(f.scene.effects ?? []);
  const amt = Math.max(0, Math.min(1, f.scene.fxAmount ?? 0.7));
  const grade = f.scene.grade ?? "none";
  const cam = cameraFor(f, W, H);
  const seed = seedOf(f.scene.id);

  // 1. Grade (and focus pull) into a working copy.
  const work = canvasFor("work", cw, ch);
  const w = work.getContext("2d")!;
  w.setTransform(1, 0, 0, 1, 0, 0);
  w.globalCompositeOperation = "copy";
  const blur = fx.has("focus-pull") ? 16 * u * amt * Math.pow(1 - Math.min(1, f.t / 0.8), 2) : 0;
  const filters = [grade !== "none" ? GRADE_FILTER[grade] : "", blur > 0.3 ? `blur(${blur.toFixed(1)}px)` : ""].filter(Boolean).join(" ");
  if (FILTER_OK && filters) w.filter = filters;
  w.drawImage(src, 0, 0);
  if (FILTER_OK) w.filter = "none";
  w.globalCompositeOperation = "source-over";
  if (grade !== "none") tint(w, grade, f.brand, cw, ch);

  // Grade strength: the ungraded frame shows through below full amount.
  let base: HTMLCanvasElement = work;
  if (grade !== "none" && amt < 0.999) {
    const mixC = canvasFor("mix", cw, ch);
    const m = mixC.getContext("2d")!;
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.globalCompositeOperation = "copy";
    if (FILTER_OK && blur > 0.3) m.filter = `blur(${blur.toFixed(1)}px)`;
    m.drawImage(src, 0, 0);
    if (FILTER_OK) m.filter = "none";
    m.globalCompositeOperation = "source-over";
    m.globalAlpha = amt;
    m.drawImage(work, 0, 0);
    m.globalAlpha = 1;
    base = mixC;
  }

  // 2. Put the frame down through the camera, optionally split into colour channels.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const cx = cw / 2, cy = ch / 2;
  const place = (img: CanvasImageSource, ox = 0, oy = 0) =>
    ctx.drawImage(img, cx - cx * cam.scale + (cam.dx * scale) + ox, cy - cy * cam.scale + (cam.dy * scale) + oy, cw * cam.scale, ch * cam.scale);

  const glitchOn = fx.has("glitch") && glitchActive(f, seed);
  const split = (fx.has("rgb-split") ? (3 + 12 * Math.exp(-f.t * 5)) * u * amt : 0) + (glitchOn ? 14 * u * amt : 0);
  if (split > 0.5) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cw, ch);
    const chan = canvasFor("chan", cw, ch);
    const c = chan.getContext("2d")!;
    const offs: [string, number, number][] = [["#ff0000", -split, 0], ["#00ff00", 0, split * 0.25], ["#0000ff", split, 0]];
    for (const [col, ox, oy] of offs) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = "copy";
      c.drawImage(base, 0, 0);
      c.globalCompositeOperation = "multiply";
      c.fillStyle = col;
      c.fillRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = "lighter";
      place(chan, ox, oy);
    }
    ctx.globalCompositeOperation = "source-over";
  } else {
    // Edges the camera may expose are filled with the frame's own background colour.
    if (cam.scale !== 1 || cam.dx || cam.dy) {
      ctx.fillStyle = f.brand.bg;
      ctx.fillRect(0, 0, cw, ch);
    }
    place(base);
  }

  if (glitchOn) glitchSlices(ctx, base, f, seed, u, amt, cw, ch);

  // 3. Atmosphere and light on top.
  if (fx.has("light-leak")) lightLeak(ctx, f, seed, cw, ch, amt);
  if (fx.has("bokeh")) bokeh(ctx, f, seed, cw, ch, u, amt);
  if (fx.has("dust")) dust(ctx, f, seed, cw, ch, u, amt);
  if (fx.has("halftone")) halftone(ctx, cw, ch, u, amt);
  if (fx.has("scanlines")) scanlines(ctx, f, cw, ch, u, amt);
  if (fx.has("sparkle")) sparkle(ctx, f, seed, cw, ch, u, amt);
  if (fx.has("confetti")) confetti(ctx, f, seed, cw, ch, u, amt);
  if (fx.has("vignette")) vignette(ctx, cw, ch, amt);
  if (fx.has("flash")) {
    const a = 0.9 * amt * Math.exp(-f.t * 9);
    if (a > 0.01) {
      ctx.fillStyle = rgba(mix(f.brand.fg, "#ffffff", 0.5), a);
      ctx.fillRect(0, 0, cw, ch);
    }
  }
  ctx.restore();
  return cam;
}

// ---------------------------------------------------------------- grades
function tint(w: CanvasRenderingContext2D, grade: Grade, brand: Brand, cw: number, ch: number) {
  const fill = (col: string, op: GlobalCompositeOperation, a = 1) => {
    w.globalCompositeOperation = op;
    w.globalAlpha = a;
    w.fillStyle = col;
    w.fillRect(0, 0, cw, ch);
  };
  if (grade === "duotone") {
    // Greys → brand: shadows take the background colour, highlights the accent.
    fill(brand.accent, "multiply");
    fill(brand.bg, "screen");
  } else if (grade === "teal-orange") {
    fill("#0b6e78", "soft-light", 0.32);
    const g = w.createRadialGradient(cw / 2, ch * 0.45, 0, cw / 2, ch * 0.45, Math.max(cw, ch) * 0.6);
    g.addColorStop(0, "rgba(255,150,70,0.22)");
    g.addColorStop(1, "rgba(255,150,70,0)");
    w.globalCompositeOperation = "soft-light";
    w.globalAlpha = 1;
    w.fillStyle = g;
    w.fillRect(0, 0, cw, ch);
  } else if (grade === "cool") fill("#3a6cff", "soft-light", 0.18);
  else if (grade === "warm-film") fill("#ff9a4a", "soft-light", 0.14);
  else if (grade === "faded") fill("#ffffff", "screen", 0.07);
  w.globalCompositeOperation = "source-over";
  w.globalAlpha = 1;
}

// ---------------------------------------------------------------- energy
export function glitchActive(f: FxFrame, seed: number = seedOf(f.scene.id)) {
  if (f.t < 0.14) return true;
  const r = rng(seed ^ 0x9e37);
  const n = Math.max(1, Math.round(f.dur / 1.4));
  for (let i = 0; i < n; i++) {
    const at = 0.3 + r() * Math.max(0.1, f.dur - 0.6);
    if (Math.abs(f.t - at) < 0.08) return true;
  }
  return false;
}

function glitchSlices(ctx: CanvasRenderingContext2D, base: HTMLCanvasElement, f: FxFrame, seed: number, u: number, amt: number, cw: number, ch: number) {
  const r = rng(seed ^ Math.floor(f.t * 30));
  const n = 5 + Math.floor(r() * 6);
  for (let i = 0; i < n; i++) {
    const y = Math.floor(r() * ch);
    const h = Math.max(2, Math.floor((4 + r() * 50) * u));
    const off = (r() - 0.5) * 120 * u * amt;
    ctx.drawImage(base, 0, y, cw, h, off, y, cw, h);
  }
  // A thin bright bar now and then.
  if (r() < 0.5) {
    ctx.fillStyle = rgba(f.brand.accent, 0.5 * amt);
    ctx.fillRect(0, r() * ch, cw, Math.max(1, 3 * u));
  }
}

// ---------------------------------------------------------------- atmosphere
function lightLeak(ctx: CanvasRenderingContext2D, f: FxFrame, seed: number, cw: number, ch: number, amt: number) {
  const r = rng(seed ^ 0x51ed);
  const cols = ["#ff7a3d", "#ff3d7a", f.brand.accent];
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 3; i++) {
    const phase = r();
    const x = cw * (((phase + f.t * (0.035 + i * 0.012)) % 1.2) - 0.1);
    const y = ch * (0.15 + 0.7 * r());
    const rad = Math.max(cw, ch) * (0.35 + 0.25 * r());
    const pulse = 0.75 + 0.25 * Math.sin(f.t * 1.3 + i * 2);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, rgba(cols[i], 0.42 * amt * pulse));
    g.addColorStop(1, rgba(cols[i], 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);
  }
  ctx.globalCompositeOperation = "source-over";
}

function vignette(ctx: CanvasRenderingContext2D, cw: number, ch: number, amt: number) {
  const d = Math.hypot(cw, ch) / 2;
  const g = ctx.createRadialGradient(cw / 2, ch / 2, d * 0.45, cw / 2, ch / 2, d);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${0.7 * amt})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cw, ch);
}

function bokeh(ctx: CanvasRenderingContext2D, f: FxFrame, seed: number, cw: number, ch: number, u: number, amt: number) {
  const r = rng(seed ^ 0xb0c);
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 16; i++) {
    const rad = (24 + r() * 90) * u;
    const x = r() * cw + Math.sin(f.t * 0.4 + i) * 20 * u;
    const y = (((r() * ch - f.t * (8 + r() * 18) * u) % (ch + rad * 2)) + ch + rad * 2) % (ch + rad * 2) - rad;
    const col = i % 3 === 0 ? f.brand.accent : mix(f.brand.fg, f.brand.accent, 0.3);
    const a = (0.1 + r() * 0.16) * amt * (0.7 + 0.3 * Math.sin(f.t * 1.5 + i));
    const g = ctx.createRadialGradient(x, y, rad * 0.2, x, y, rad);
    g.addColorStop(0, rgba(col, a));
    g.addColorStop(0.85, rgba(col, a * 0.8));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}

function dust(ctx: CanvasRenderingContext2D, f: FxFrame, seed: number, cw: number, ch: number, u: number, amt: number) {
  const r = rng(seed ^ 0xd057);
  for (let i = 0; i < 70; i++) {
    const x = ((r() * cw + f.t * (r() - 0.5) * 30 * u) % cw + cw) % cw;
    const y = ((r() * ch + f.t * (4 + r() * 10) * u) % ch + ch) % ch;
    const flick = 0.5 + 0.5 * Math.sin(f.t * (3 + r() * 7) + i);
    ctx.fillStyle = `rgba(255,255,255,${(0.08 + 0.3 * r()) * amt * flick})`;
    ctx.beginPath();
    ctx.arc(x, y, (0.7 + r() * 1.8) * u, 0, Math.PI * 2);
    ctx.fill();
  }
  // An occasional hair or scratch, like a real film gate.
  const s = rng(seed ^ Math.floor(f.t * 4));
  if (s() < 0.35 * amt) {
    ctx.strokeStyle = `rgba(255,255,255,${0.18 * amt})`;
    ctx.lineWidth = Math.max(1, 1.2 * u);
    const x = s() * cw;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (s() - 0.5) * 30 * u, ch);
    ctx.stroke();
  }
}

function sparkle(ctx: CanvasRenderingContext2D, f: FxFrame, seed: number, cw: number, ch: number, u: number, amt: number) {
  const r = rng(seed ^ 0x5a1);
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 14; i++) {
    const x = (0.05 + 0.9 * r()) * cw;
    const y = (0.05 + 0.9 * r()) * ch;
    const phase = r() * Math.PI * 2;
    const tw = Math.pow(Math.max(0, Math.sin(f.t * (2.2 + r() * 2) + phase)), 3);
    if (tw < 0.02) continue;
    const size = (10 + r() * 22) * u * tw;
    const col = i % 2 ? f.brand.accent : "#ffffff";
    ctx.fillStyle = rgba(col, 0.9 * amt * tw);
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const ang = (k * Math.PI) / 4;
      const rad = k % 2 === 0 ? size : size * 0.18;
      ctx.lineTo(x + Math.cos(ang) * rad, y + Math.sin(ang) * rad);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}

function confetti(ctx: CanvasRenderingContext2D, f: FxFrame, seed: number, cw: number, ch: number, u: number, amt: number) {
  if (f.t > 3.4) return;
  const r = rng(seed ^ 0xc0ff);
  const cols = [f.brand.accent, f.brand.fg, mix(f.brand.accent, "#ff3d7a", 0.6), mix(f.brand.accent, "#3d8bff", 0.6)];
  const g = 1500 * u;
  const n = Math.round(50 + 50 * amt);
  const fade = Math.min(1, Math.max(0, (3.4 - f.t) / 0.8));
  for (let i = 0; i < n; i++) {
    const fromLeft = i % 2 === 0;
    const x0 = fromLeft ? -10 * u : cw + 10 * u;
    const y0 = ch * (0.75 + 0.2 * r());
    const vx = (fromLeft ? 1 : -1) * (250 + r() * 650) * u;
    const vy = -(900 + r() * 700) * u;
    const t = Math.max(0, f.t - r() * 0.15);
    const x = x0 + vx * t * Math.exp(-t * 0.6);
    const y = y0 + vy * t + 0.5 * g * t * t;
    if (y > ch + 40 * u) continue;
    const spin = t * (4 + r() * 8) + r() * 6;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(spin);
    ctx.scale(1, Math.cos(spin * 1.7));
    ctx.fillStyle = rgba(cols[i % cols.length], fade);
    ctx.fillRect(-5 * u, -9 * u, 10 * u, 18 * u);
    ctx.restore();
  }
}

let scanTile: HTMLCanvasElement | null = null;
function scanlines(ctx: CanvasRenderingContext2D, f: FxFrame, cw: number, ch: number, u: number, amt: number) {
  const step = Math.max(2, Math.round(3 * u));
  if (!scanTile || scanTile.height !== step) {
    scanTile = document.createElement("canvas");
    scanTile.width = 1;
    scanTile.height = step;
    const t = scanTile.getContext("2d")!;
    t.fillStyle = "rgba(0,0,0,0.55)";
    t.fillRect(0, step - Math.max(1, Math.floor(step / 3)), 1, Math.max(1, Math.floor(step / 3)));
  }
  ctx.globalAlpha = 0.6 * amt;
  ctx.fillStyle = ctx.createPattern(scanTile, "repeat")!;
  ctx.fillRect(0, 0, cw, ch);
  ctx.globalAlpha = 1;
  // A soft bright band rolling down the screen.
  const y = ((f.t * 0.35) % 1.3 - 0.15) * ch;
  const g = ctx.createLinearGradient(0, y - 60 * u, 0, y + 60 * u);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.5, `rgba(255,255,255,${0.07 * amt})`);
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, y - 60 * u, cw, 120 * u);
}

let dotTile: { c: HTMLCanvasElement; key: number } | null = null;
function halftone(ctx: CanvasRenderingContext2D, cw: number, ch: number, u: number, amt: number) {
  const step = Math.max(4, Math.round(7 * u));
  if (!dotTile || dotTile.key !== step) {
    const c = document.createElement("canvas");
    c.width = c.height = step;
    const t = c.getContext("2d")!;
    t.fillStyle = "rgba(0,0,0,0.9)";
    t.beginPath();
    t.arc(step / 2, step / 2, step * 0.26, 0, Math.PI * 2);
    t.fill();
    dotTile = { c, key: step };
  }
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = 0.55 * amt;
  ctx.fillStyle = ctx.createPattern(dotTile.c, "repeat")!;
  ctx.fillRect(0, 0, cw, ch);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}
