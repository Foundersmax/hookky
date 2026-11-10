// The motion-graphics design kit: depth instead of line art. Glass surfaces with gradient borders
// and soft shadows, gradient icon tiles that glow, gradient type, words that resolve out of blur,
// a spring curve, and a pointer that clicks. Everything takes the scene's own colours.
import type { G } from "./render";
import type { IconSpec } from "../mograph/icons";
import { F, B } from "./render";
import { clamp, ease, lerp, win, rgba, mix, hexToRgb, luminance, contrast } from "./util";
import { layoutText, measure, fontString, stripMarks, type FontSpec, type Layout } from "./text";
import { drawIcon } from "./mograph";

export type Rect = { x: number; y: number; w: number; h: number };

// ---------------------------------------------------------------- colour
/** Rotate a colour's hue by `deg` (keeps its saturation and lightness). */
export function hueShift(hex: string, deg: number): string {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let h = 0;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (((h * 60 + deg) % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [R, G2, B2] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return "#" + [R, G2, B2].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
}
export const isDark = (g: G) => luminance(g.c.bg) < 0.3;
/** The accent's partner for gradients: a neighbouring hue (a grey accent gets a lighter grey). */
export function accent2(g: G): string {
  const [r, gg, b] = hexToRgb(g.c.accent);
  if (Math.max(r, gg, b) - Math.min(r, gg, b) < 24) return mix(g.c.accent, isDark(g) ? "#FFFFFF" : "#000000", 0.35);
  return hueShift(g.c.accent, 42);
}
/** Ink that reads on the accent. */
export const onAccent = (g: G) => (contrast("#FFFFFF", g.c.accent) > 2.6 ? "#FFFFFF" : mix(g.c.accent, "#000000", 0.82));

// ---------------------------------------------------------------- motion
/** A spring that overshoots a little and settles. */
export const spring = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.exp(-6.5 * t) * Math.cos(8.5 * t));

// ---------------------------------------------------------------- surfaces
/**
 * A card with depth: layered shadow, a top-lit fill, a gradient hairline border and an optional
 * accent glow. `a` fades and lifts it in; `hot` (0–1) lights the border in the accent.
 */
export function surface(g: G, r: Rect, o: { a?: number; radius?: number; glow?: number; hot?: number; flat?: boolean } = {}) {
  const { ctx, u, c } = g;
  const a = clamp(o.a ?? 1);
  if (a <= 0) return;
  const rad = Math.min(o.radius ?? 28 * u, r.w / 2, r.h / 2);
  const dark = isDark(g);
  const y = r.y + (1 - a) * 26 * u;
  ctx.save();
  ctx.globalAlpha *= a;
  if (!o.flat) {
    for (let k = 3; k >= 1; k--) {
      ctx.fillStyle = rgba("#000000", dark ? 0.1 : 0.035);
      ctx.beginPath();
      ctx.roundRect(r.x - 3 * k * u, y + (6 + 7 * k) * u - 3 * k * u, r.w + 6 * k * u, r.h + 6 * k * u, rad + 3 * k * u);
      ctx.fill();
    }
  }
  if (o.glow) {
    const gr = ctx.createRadialGradient(r.x + r.w * 0.3, y, 0, r.x + r.w * 0.3, y, Math.max(r.w, r.h) * 0.9);
    gr.addColorStop(0, rgba(c.accent, 0.22 * o.glow));
    gr.addColorStop(1, rgba(c.accent, 0));
    ctx.fillStyle = gr;
    ctx.fillRect(r.x - r.w * 0.4, y - r.h * 0.6, r.w * 1.8, r.h * 2.2);
  }
  const fill = ctx.createLinearGradient(0, y, 0, y + r.h);
  fill.addColorStop(0, dark ? mix(c.bg, c.fg, 0.1) : mix(c.bg, "#FFFFFF", 0.92));
  fill.addColorStop(1, dark ? mix(c.bg, c.fg, 0.045) : mix(c.bg, "#FFFFFF", 0.7));
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(r.x, y, r.w, r.h, rad);
  ctx.fill();
  const line = ctx.createLinearGradient(r.x, y, r.x + r.w * 0.6, y + r.h);
  const hot = clamp(o.hot ?? 0);
  line.addColorStop(0, hot ? rgba(c.accent, 0.35 + 0.65 * hot) : rgba(c.fg, dark ? 0.26 : 0.14));
  line.addColorStop(1, hot ? rgba(accent2(g), 0.2 + 0.6 * hot) : rgba(c.fg, dark ? 0.05 : 0.06));
  ctx.strokeStyle = line;
  ctx.lineWidth = (1.5 + 1.5 * hot) * u;
  ctx.stroke();
  ctx.restore();
  return y;
}

/**
 * An icon in a rounded gradient tile with a glow under it. `p` springs it in and draws the icon.
 * `quiet` gives a glass tile with an accent icon (for the many, where one hero is solid).
 */
export function tile(g: G, cx: number, cy: number, size: number, icon: IconSpec | undefined, p: number, o: { quiet?: boolean; letter?: string; alpha?: number } = {}) {
  const { ctx, u, c } = g;
  if (p <= 0) return;
  const s = size * (0.6 + 0.4 * spring(clamp(p * 1.4)));
  const a = clamp(p * 3) * (o.alpha ?? 1);
  const rad = s * 0.28;
  ctx.save();
  ctx.globalAlpha *= a;
  if (!o.quiet) {
    const gl = ctx.createRadialGradient(cx, cy + s * 0.25, 0, cx, cy + s * 0.25, s * 1.15);
    gl.addColorStop(0, rgba(c.accent, 0.42));
    gl.addColorStop(1, rgba(c.accent, 0));
    ctx.fillStyle = gl;
    ctx.fillRect(cx - s * 1.3, cy - s * 1.1, s * 2.6, s * 2.6);
    const gr = ctx.createLinearGradient(cx - s / 2, cy - s / 2, cx + s / 2, cy + s / 2);
    gr.addColorStop(0, mix(c.accent, "#FFFFFF", 0.12));
    gr.addColorStop(1, accent2(g));
    ctx.fillStyle = gr;
  } else ctx.fillStyle = isDark(g) ? mix(c.bg, c.fg, 0.1) : mix(c.bg, "#FFFFFF", 0.85);
  ctx.beginPath();
  ctx.roundRect(cx - s / 2, cy - s / 2, s, s, rad);
  ctx.fill();
  // top light and hairline
  const hl = ctx.createLinearGradient(0, cy - s / 2, 0, cy + s / 2);
  hl.addColorStop(0, rgba("#FFFFFF", o.quiet ? 0.06 : 0.28));
  hl.addColorStop(0.55, rgba("#FFFFFF", 0));
  ctx.fillStyle = hl;
  ctx.fill();
  ctx.strokeStyle = o.quiet ? rgba(c.fg, 0.16) : rgba("#FFFFFF", 0.35);
  ctx.lineWidth = 1.5 * u;
  ctx.stroke();
  ctx.restore();
  const ink = o.quiet ? c.accent : onAccent(g);
  if (icon) drawIcon(ctx, icon, cx, cy, s * 0.54, clamp((p - 0.15) * 1.6), ink, Math.max(2 * u, s * 0.045));
  else if (o.letter) {
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.font = fontString(F(g, s * 0.5));
    (ctx as any).letterSpacing = "0px";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = ink;
    ctx.fillText(o.letter, cx, cy + s * 0.03);
    ctx.restore();
  }
}

/** A rounded label pill; returns its width. `tone`: accent fill, glass, or a soft accent tint. */
export function pill(g: G, text: string, cx: number, cy: number, o: { size?: number; tone?: "accent" | "glass" | "soft"; a?: number; align?: "center" | "left" | "right"; dot?: boolean; maxW?: number } = {}): number {
  const { ctx, u, c } = g;
  const a = clamp(o.a ?? 1);
  const f = B(g, (o.size ?? 24) * u, 650);
  ctx.font = fontString(f);
  (ctx as any).letterSpacing = "0px";
  let label = text;
  const maxW = o.maxW ?? g.W - g.pad * 2;
  const dotW = o.dot ? f.size * 0.9 : 0;
  while (label.length > 2 && ctx.measureText(label).width + f.size * 1.5 + dotW > maxW) label = label.slice(0, -2).trimEnd() + "…";
  const w = ctx.measureText(label).width + f.size * 1.5 + dotW, h = f.size * 1.9;
  if (a <= 0) return w;
  const x = o.align === "left" ? cx : o.align === "right" ? cx - w : cx - w / 2;
  const tone = o.tone ?? "glass";
  ctx.save();
  ctx.globalAlpha *= a;
  if (tone === "accent") {
    const gr = ctx.createLinearGradient(x, 0, x + w, 0);
    gr.addColorStop(0, c.accent);
    gr.addColorStop(1, accent2(g));
    ctx.fillStyle = gr;
  } else ctx.fillStyle = tone === "soft" ? rgba(c.accent, 0.16) : isDark(g) ? rgba(mix(c.bg, c.fg, 0.14), 0.9) : rgba("#FFFFFF", 0.9);
  ctx.beginPath();
  ctx.roundRect(x, cy - h / 2, w, h, h / 2);
  ctx.fill();
  if (tone !== "accent") {
    ctx.strokeStyle = tone === "soft" ? rgba(c.accent, 0.4) : rgba(c.fg, 0.14);
    ctx.lineWidth = 1.5 * u;
    ctx.stroke();
  }
  const ink = tone === "accent" ? onAccent(g) : tone === "soft" ? c.accent : c.fg;
  if (o.dot) {
    ctx.fillStyle = tone === "accent" ? ink : c.accent;
    ctx.beginPath();
    ctx.arc(x + f.size * 0.85, cy, f.size * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = ink;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + f.size * 0.75 + dotW, cy + f.size * 0.04);
  ctx.restore();
  return w;
}

// ---------------------------------------------------------------- type
/** One line in a left-to-right gradient of the accent and its partner. */
export function gradText(g: G, text: string, f: FontSpec, x: number, y: number, align: "left" | "center" | "right", alpha = 1, maxW?: number) {
  const { ctx, c } = g;
  if (alpha <= 0 || !text) return 0;
  let font = f;
  let w = measure(ctx, text, font);
  if (maxW && w > maxW) (font = { ...f, size: (f.size * maxW) / w }), (w = measure(ctx, text, font));
  const x0 = align === "left" ? x : align === "center" ? x - w / 2 : x - w;
  const gr = ctx.createLinearGradient(x0, 0, x0 + w, 0);
  gr.addColorStop(0, c.accent);
  gr.addColorStop(1, accent2(g));
  ctx.save();
  ctx.globalAlpha *= clamp(alpha);
  ctx.font = fontString(font);
  (ctx as any).letterSpacing = `${(font.tracking ?? 0) * font.size}px`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = gr;
  ctx.fillText(text, x0, y);
  ctx.restore();
  return w;
}

/**
 * A headline whose words resolve out of blur one by one, rising on a spring; *accent* words take
 * the gradient. Fits `maxW`/`maxH`. Returns the layout and its top (for hit regions and stacking).
 */
export function wordsIn(g: G, text: string, font: FontSpec, x: number, yMid: number, align: "left" | "center", maxW: number, o: { t0?: number; per?: number; maxLines?: number; maxH?: number; color?: string; top?: boolean } = {}): { L: Layout; y: number } {
  const { ctx, c } = g;
  let L = layoutText(ctx, text, font, maxW, o.maxLines ?? 3, 1.04);
  for (let i = 0; i < 12 && o.maxH && L.height > o.maxH; i++) L = layoutText(ctx, text, { ...font, size: L.font.size * 0.88 }, maxW, o.maxLines ?? 3, 1.04);
  const y0 = o.top ? yMid : yMid - L.height / 2;
  const t0 = o.t0 ?? 0.1, per = o.per ?? 0.09;
  const a2 = accent2(g);
  let k = 0;
  ctx.save();
  ctx.font = fontString(L.font);
  (ctx as any).letterSpacing = `${(L.font.tracking ?? 0) * L.font.size}px`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  L.lines.forEach((line, li) => {
    let lx = align === "center" ? x - line.width / 2 : x;
    const base = y0 + li * L.lineHeight + L.lineHeight * 0.8;
    line.tokens.forEach((tok, ti) => {
      if (ti > 0 && !tok.glue) lx += L.spaceW;
      const w = ctx.measureText(tok.text).width;
      const p = win(g.t, t0 + k * per, 0.55 * g.sp);
      if (p > 0) {
        const s = spring(p);
        ctx.save();
        ctx.globalAlpha *= clamp(p * 2.2);
        if (p < 0.9) ctx.filter = `blur(${((1 - p) * L.font.size * 0.22).toFixed(1)}px)`;
        if (tok.em) {
          const gr = ctx.createLinearGradient(lx, 0, lx + w, 0);
          gr.addColorStop(0, c.accent);
          gr.addColorStop(1, a2);
          ctx.fillStyle = gr;
        } else ctx.fillStyle = o.color ?? c.fg;
        ctx.fillText(tok.text, lx, base + (1 - s) * L.font.size * 0.45);
        ctx.restore();
      }
      lx += w;
      k++;
    });
  });
  ctx.restore();
  return { L, y: y0 };
}

/** The scene headline across the top in the kit's style; returns the y beneath it. */
export function proHeader(g: G, o: { align?: "left" | "center"; scale?: number } = {}): number {
  const { W, u, pad, scene } = g;
  const align = o.align ?? "center";
  const x = align === "center" ? W / 2 : pad;
  let top = pad * 0.9;
  if (scene.kicker) {
    const kw = pill(g, stripMarks(scene.kicker), x, top + 22 * u, { size: 20, tone: "soft", a: win(g.t, 0, 0.4), align: align === "center" ? "center" : "left", dot: true });
    g.hit?.({ field: "kicker", x: align === "center" ? x - kw / 2 : x, y: top, w: kw, h: 44 * u, size: 20 * u, align: "left", lines: 1 });
    top += 66 * u;
  }
  if (!scene.headline) return top;
  const size = (g.portrait ? W * 0.075 : g.H * 0.085) * (o.scale ?? 1);
  const { L, y } = wordsIn(g, scene.headline, F(g, size), x, top, align, W - pad * 2, { maxLines: 2, top: true, t0: 0.05, per: 0.07, maxH: g.H * 0.2 });
  g.hit?.({ field: "headline", x: align === "center" ? x - L.width / 2 : x, y, w: L.width, h: L.height, size: L.font.size, align, lines: L.lines.length });
  return top + L.height + 44 * u;
}

// ---------------------------------------------------------------- pointer
/** A pointer arrow at (x, y); `press` (0–1) squeezes it and throws a ring. */
export function cursor(g: G, x: number, y: number, press = 0, alpha = 1) {
  const { ctx, u, c } = g;
  if (alpha <= 0) return;
  const k = 2.1 * u * (1 - 0.14 * Math.sin(Math.PI * clamp(press)));
  ctx.save();
  ctx.globalAlpha *= clamp(alpha);
  if (press > 0 && press < 1) {
    ctx.strokeStyle = rgba(c.accent, 0.8 * (1 - press));
    ctx.lineWidth = 3 * u;
    ctx.beginPath();
    ctx.arc(x, y, (8 + 46 * ease.outCubic(press)) * u, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.shadowColor = rgba("#000000", 0.35);
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 17);
  ctx.lineTo(4.6, 13);
  ctx.lineTo(7.6, 20);
  ctx.lineTo(10.4, 18.8);
  ctx.lineTo(7.5, 12);
  ctx.lineTo(13, 12);
  ctx.closePath();
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "#111111";
  ctx.lineWidth = 1.3;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
}

/** A check mark drawing itself inside a filled circle. */
export function checkDot(g: G, cx: number, cy: number, r: number, p: number, done = true) {
  const { ctx, u, c } = g;
  ctx.save();
  if (done && p > 0) {
    const s = spring(clamp(p * 1.3));
    const gr = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    gr.addColorStop(0, c.accent);
    gr.addColorStop(1, accent2(g));
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(cx, cy, r * (0.5 + 0.5 * s), 0, Math.PI * 2);
    ctx.fill();
    const q = ease.outCubic(clamp((p - 0.25) / 0.6));
    if (q > 0) {
      ctx.strokeStyle = onAccent(g);
      ctx.lineWidth = Math.max(2 * u, r * 0.22);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const a = { x: cx - r * 0.42, y: cy + r * 0.02 }, b = { x: cx - r * 0.1, y: cy + r * 0.34 }, d = { x: cx + r * 0.45, y: cy - r * 0.3 };
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      const q1 = clamp(q / 0.4), q2 = clamp((q - 0.4) / 0.6);
      ctx.lineTo(lerp(a.x, b.x, q1), lerp(a.y, b.y, q1));
      if (q2 > 0) ctx.lineTo(lerp(b.x, d.x, q2), lerp(b.y, d.y, q2));
      ctx.stroke();
    }
  } else {
    ctx.strokeStyle = rgba(c.fg, 0.28);
    ctx.lineWidth = 2 * u;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
