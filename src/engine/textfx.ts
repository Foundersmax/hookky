// Energetic text animations. Every one takes its words from the voice-over inside the scene (so
// each word lands as it's said) or, without one, from the headline spread across the scene.
// *Marked* words are the accent.
import type { G, Tpl } from "./render";
import type { Word } from "../types";
import { F, chunkPhrases, rr } from "./render";
import { clamp, ease, lerp, win, rgba, mix, hash } from "./util";
import { drawLabel, measure, stripMarks, displayWeight, fontString } from "./text";

const plain = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
const marked = (s?: string) => new Set((s?.match(/\*([^*]+)\*/g) ?? []).flatMap((m) => m.replace(/\*/g, "").toLowerCase().split(/\s+/)).map(plain));

/** The words to animate, in scene time: the voice-over's, else the headline's, spaced evenly. */
function spoken(g: G, fallback = "Make them stop scrolling"): Word[] {
  if (g.words?.length) {
    const ws = g.words.filter((w) => w.s >= g.abs - 0.05 && w.s < g.abs + g.dur - 0.05).map((w) => ({ ...w, s: w.s - g.abs, e: w.e - g.abs }));
    if (ws.length) return ws;
  }
  const toks = stripMarks(g.scene.headline || g.scene.subline || fallback).split(/\s+/).filter(Boolean);
  const span = (g.dur * 0.82) / Math.max(1, toks.length);
  return toks.map((w, i) => ({ w, s: 0.12 + i * span, e: 0.12 + (i + 1) * span }));
}
/** Index of the word being said at t (the last one started). */
const current = (ws: Word[], t: number) => {
  let k = -1;
  ws.forEach((w, i) => t >= w.s - 0.04 && (k = i));
  return k;
};
/** Largest size (≤ max) at which `text` fits `maxW`. */
const fit = (g: G, text: string, maxW: number, max: number) => Math.min(max, (maxW / Math.max(1, measure(g.ctx, text, F(g, 100)))) * 100);
/** Set the brand's display face on a context (with the engine's fallbacks and tracking); returns the font string. */
const font = (g: G, size: number, ctx: CanvasRenderingContext2D = g.ctx) => {
  const f = F(g, size);
  ctx.font = fontString(f);
  (ctx as any).letterSpacing = `${(f.tracking ?? 0) * size}px`;
  return ctx.font;
};
const hitAll = (g: G, size: number) => g.hit?.({ field: "headline", x: g.pad, y: g.H * 0.3, w: g.W - g.pad * 2, h: g.H * 0.4, size, align: "center", lines: 1 });
/** Calm or smooth motion asks for the minimal version: no shakes, flashes or trails. */
const gentle = (g: G) => g.scene.motion === "calm" || g.scene.motion === "smooth";
const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&$@!?";

export const TEXT_TEMPLATES: Record<string, Tpl> = {
  /** One word at a time, giant, slammed in with an impact shake. */
  "word-slam"(g) {
    const { ctx, W, H, c, u, pad } = g;
    const ws = spoken(g), em = marked(g.scene.headline);
    const k = current(ws, g.t);
    if (k < 0) return;
    const w = ws[k];
    const text = w.w.toUpperCase().replace(/[.,!?;:]+$/, "");
    const size = fit(g, text, W - pad * 1.6, (g.portrait ? H * 0.2 : H * 0.42));
    const soft = gentle(g);
    const p = clamp((g.t - w.s + 0.04) / (soft ? 0.3 : 0.16));
    const s = lerp(soft ? 1.12 : 1.7, 1, ease.outCubic(p));
    const shake = soft ? 0 : Math.exp(-(g.t - w.s) * 14) * 14 * u;
    const isEm = em.has(plain(w.w)) || /\d/.test(w.w);
    // impact flash on emphasised words
    if (!soft && isEm && g.t - w.s < 0.18) {
      ctx.fillStyle = rgba(c.accent, 0.22 * (1 - (g.t - w.s) / 0.18));
      ctx.fillRect(0, 0, W, H);
    }
    ctx.save();
    ctx.translate(W / 2 + Math.sin(g.t * 90) * shake, H / 2 + Math.cos(g.t * 77) * shake);
    ctx.rotate(soft ? 0 : (1 - ease.outCubic(p)) * (k % 2 ? 0.08 : -0.08));
    ctx.scale(s, s);
    ctx.globalAlpha = clamp(p * 2);
    font(g, size);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = isEm ? c.accent : c.fg;
    ctx.fillText(text, 0, 0);
    ctx.restore();
    // word counter ticks
    const n = ws.length;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i <= k ? c.accent : rgba(c.fg, 0.18);
      ctx.fillRect(W / 2 - (n * 14 * u) / 2 + i * 14 * u, H - pad, 9 * u, 4 * u);
    }
    hitAll(g, size);
  },

  /** Letters decode from noise into each word as it's spoken. */
  scramble(g) {
    const { ctx, W, H, c, u, pad } = g;
    const ws = spoken(g), em = marked(g.scene.headline);
    const phrases = chunkPhrases(ws, 3);
    let pi = 0;
    phrases.forEach((ph, i) => g.t >= ph[0].s - 0.05 && (pi = i));
    const ph = phrases[pi];
    if (!ph) return;
    const lines = ph.map((w) => w.w.toUpperCase());
    const size = Math.min(...lines.map((l) => fit(g, l, W - pad * 2, g.portrait ? W * 0.17 : H * 0.2)));
    const lh = size * 1.02;
    const y0 = H / 2 - (lines.length * lh) / 2 + lh / 2;
    font(g, size);
    ctx.textBaseline = "middle";
    ph.forEach((w, i) => {
      const text = lines[i];
      const settle = (g.t - w.s) / 0.35; // 0 → 1 as the word resolves
      if (settle < -0.15) return;
      const isEm = em.has(plain(w.w));
      const total = measure(ctx, text, F(g, size));
      let x = W / 2 - total / 2;
      // highlight slab behind resolved accent words
      if (isEm && settle > 0.6) {
        const p = ease.outCubic(clamp((settle - 0.6) / 0.6));
        ctx.fillStyle = c.accent;
        ctx.fillRect(x - 10 * u, y0 + i * lh - lh * 0.42, (total + 20 * u) * p, lh * 0.84);
      }
      for (let j = 0; j < text.length; j++) {
        const ch = text[j];
        const done = settle * text.length * 1.4 > j;
        const glyph = done || ch === " " ? ch : GLYPHS[Math.floor(hash(j * 13.1 + Math.floor(g.t * 24) + i * 7) * GLYPHS.length)];
        ctx.fillStyle = done ? (isEm ? c.bg : c.fg) : rgba(c.accent, 0.85);
        ctx.textAlign = "left";
        ctx.fillText(glyph, x, y0 + i * lh);
        x += ctx.measureText(ch).width;
      }
    });
    hitAll(g, size);
  },

  /** Words fly out of the depth, hold, then rush past the camera. */
  "zoom-through"(g) {
    const { ctx, W, H, c, pad } = g;
    const ws = spoken(g), em = marked(g.scene.headline);
    const k = current(ws, g.t);
    const draw = (i: number, sc: number, a: number) => {
      const w = ws[i];
      const text = w.w.toUpperCase().replace(/[.,!?;:]+$/, "");
      const size = fit(g, text, W - pad * 2, g.portrait ? H * 0.16 : H * 0.34);
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(sc, sc);
      ctx.globalAlpha = clamp(a);
      font(g, size);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = em.has(plain(w.w)) ? c.accent : c.fg;
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };
    if (k < 0) return;
    // the previous word rushing past
    const trails = gentle(g) ? 1 : 3;
    if (k > 0) {
      const p = clamp((g.t - ws[k].s + 0.04) / (gentle(g) ? 0.35 : 0.25));
      if (p < 1) for (let tr = 0; tr < trails; tr++) draw(k - 1, 1 + ease.inCubic(p) * (gentle(g) ? 0.8 : 3 + tr * 0.6), (1 - p) * (tr ? 0.25 : 1));
    }
    const p = ease.outCubic(clamp((g.t - ws[k].s + 0.04) / (gentle(g) ? 0.45 : 0.3)));
    for (let tr = trails - 1; tr >= 0; tr--) draw(k, lerp(gentle(g) ? 0.7 : 0.15, 1, p) * (1 - tr * 0.06 * (1 - p)), tr ? 0.2 * p : p);
    hitAll(g, 80);
  },

  /** Letters bounce in one by one and keep riding a wave; words alternate solid and outline. */
  "letter-wave"(g) {
    const { ctx, W, H, c, u, pad } = g;
    const ws = spoken(g), em = marked(g.scene.headline);
    const phrases = chunkPhrases(ws, 3);
    let pi = 0;
    phrases.forEach((ph, i) => g.t >= ph[0].s - 0.05 && (pi = i));
    const ph = phrases[pi];
    if (!ph) return;
    // Wide frames: one line. Tall frames: a word per line, as big as the longest word allows.
    const stack = g.portrait || g.H > g.W * 0.9;
    const text = ph.map((w) => w.w).join(" ");
    const size = stack ? Math.min(...ph.map((w) => fit(g, w.w, W - pad * 2, H * 0.14))) : fit(g, text, W - pad * 2, H * 0.2);
    const f = F(g, size);
    font(g, size);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const lh = size * 1.05;
    const space = ctx.measureText(" ").width;
    let x = W / 2 - measure(ctx, text, f) / 2;
    let rowY = H / 2;
    ph.forEach((w, wi) => {
      if (stack) {
        x = W / 2 - measure(ctx, w.w, f) / 2;
        rowY = H / 2 + (wi - (ph.length - 1) / 2) * lh;
      }
      const isEm = em.has(plain(w.w));
      for (let j = 0; j < w.w.length; j++) {
        const ch = w.w[j];
        const t0 = w.s + j * 0.035;
        const p = (gentle(g) ? ease.outCubic : ease.outBack)(clamp((g.t - t0) / 0.32));
        const wave = Math.sin(g.t * 5 - (x / W) * 9) * (gentle(g) ? 3 : 10) * u * clamp(g.t - t0);
        if (p > 0) {
          ctx.save();
          ctx.translate(x, rowY + (1 - p) * size * 0.8 + wave);
          ctx.globalAlpha = clamp(p);
          if (wi % 2 && !isEm) {
            ctx.strokeStyle = c.fg;
            ctx.lineWidth = Math.max(2, size * 0.025);
            ctx.strokeText(ch, 0, 0);
          } else {
            ctx.fillStyle = isEm ? c.accent : c.fg;
            ctx.fillText(ch, 0, 0);
          }
          ctx.restore();
        }
        x += ctx.measureText(ch).width;
      }
      x += space;
    });
    hitAll(g, size);
  },

  /** Karaoke: the line sits in outline and fills with colour word by word as it's spoken. */
  "outline-fill"(g) {
    const { ctx, W, H, c, pad } = g;
    const ws = spoken(g), em = marked(g.scene.headline);
    const phrases = chunkPhrases(ws, 3);
    let pi = 0;
    phrases.forEach((ph, i) => g.t >= ph[0].s - 0.25 && (pi = i));
    const ph = phrases[pi];
    if (!ph) return;
    // up to two lines
    const half = Math.ceil(ph.length / 2);
    // Tall frames stack a word per line so the type can be big; wide frames use one or two lines.
    const lines = g.portrait ? ph.map((w) => [w]) : ph.length > 2 ? [ph.slice(0, half), ph.slice(half)] : [ph];
    const size = Math.min(...lines.map((l) => fit(g, l.map((w) => w.w.toUpperCase()).join(" "), W - pad * 2, g.portrait ? H * 0.12 : H * 0.24)));
    const lh = size * 1.05;
    font(g, size);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const space = ctx.measureText(" ").width;
    const appear = ease.outCubic(clamp((g.t - (ph[0].s - 0.25)) / 0.25));
    lines.forEach((line, li) => {
      const total = line.reduce((a, w) => a + ctx.measureText(w.w.toUpperCase()).width, 0) + space * (line.length - 1);
      let x = W / 2 - total / 2;
      const y = H / 2 + (li - (lines.length - 1) / 2) * lh + (1 - appear) * 30;
      for (const w of line) {
        const text = w.w.toUpperCase();
        const ww = ctx.measureText(text).width;
        ctx.globalAlpha = appear;
        ctx.strokeStyle = rgba(c.fg, 0.85);
        ctx.lineWidth = Math.max(2, size * 0.03);
        ctx.strokeText(text, x, y);
        const p = clamp((g.t - w.s) / Math.max(0.12, w.e - w.s));
        if (p > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x - 2, y - lh / 2, (ww + 4) * p, lh);
          ctx.clip();
          ctx.fillStyle = em.has(plain(w.w)) ? c.accent : c.fg;
          ctx.fillText(text, x, y);
          ctx.restore();
        }
        x += ww + space;
      }
    });
    ctx.globalAlpha = 1;
    hitAll(g, size);
  },

  /** Each word flips in like a cube turning; accent words land on a slab. */
  "flip-words"(g) {
    const { ctx, W, H, c, u, pad } = g;
    const ws = spoken(g), em = marked(g.scene.headline);
    const k = current(ws, g.t);
    if (k < 0) return;
    const slot = (i: number, p: number, out: boolean) => {
      const w = ws[i];
      const text = w.w.toUpperCase().replace(/[.,!?;:]+$/, "");
      const size = fit(g, text, W - pad * 2.4, g.portrait ? H * 0.15 : H * 0.3);
      const isEm = em.has(plain(w.w)) || /\d/.test(w.w);
      const sy = out ? 1 - p : p;
      const dy = (out ? -p : 1 - p) * size * 0.55;
      ctx.save();
      ctx.translate(W / 2, H / 2 + dy);
      ctx.scale(1, Math.max(0.001, sy));
      ctx.globalAlpha = clamp(sy * 1.4);
      font(g, size);
      const tw = ctx.measureText(text).width;
      if (isEm) {
        ctx.fillStyle = c.accent;
        rr(ctx, -tw / 2 - 24 * u, -size * 0.58, tw + 48 * u, size * 1.16, 14 * u);
        ctx.fill();
      }
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = isEm ? mix(c.bg, "#000000", 0.2) : c.fg;
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };
    const p = ease.inOutCubic(clamp((g.t - ws[k].s + 0.04) / 0.22));
    if (k > 0 && p < 1) slot(k - 1, p, true);
    slot(k, p, false);
    hitAll(g, 80);
  },

  /** Rapid typing with a caret; key words get a marker sweep once typed. */
  typewriter(g) {
    const { ctx, W, H, c, u, pad } = g;
    const ws = spoken(g), em = marked(g.scene.headline);
    const text = ws.map((w) => w.w).join(" ");
    // As big as lets the whole line fit in about four rows.
    const size = Math.max(40 * u, Math.min((g.portrait ? 110 : 120) * u, Math.sqrt(((W - pad * 2) * H * 0.6) / Math.max(1, text.length * 0.55 * 1.22))));
    const f = { family: g.brand.fontDisplay, weight: displayWeight(g.brand.fontDisplay), size, tracking: -0.01 };
    font(g, size);
    // lay out words into lines
    const maxW = W - pad * 2;
    const space = ctx.measureText(" ").width + size * 0.14;
    const lines: { w: Word; x: number; line: number; width: number }[] = [];
    let x = 0, line = 0;
    for (const w of ws) {
      const width = ctx.measureText(w.w).width;
      if (x + width > maxW && x > 0) (x = 0), line++;
      lines.push({ w, x, line, width });
      x += width + space;
    }
    const nLines = line + 1, lh = size * 1.22;
    const y0 = H / 2 - (nLines * lh) / 2 + lh / 2;
    const left = pad;
    let caret = { x: left, y: y0 };
    for (const it of lines) {
      const typed = clamp((g.t - it.w.s) / Math.max(0.08, Math.min(0.35, it.w.e - it.w.s)));
      if (typed <= 0) break;
      const n = Math.max(1, Math.round(it.w.w.length * typed));
      const part = it.w.w.slice(0, n);
      const y = y0 + it.line * lh;
      const isEm = em.has(plain(it.w.w));
      if (isEm && typed >= 1) {
        const sw = ease.outCubic(clamp((g.t - it.w.e) / 0.25));
        ctx.fillStyle = rgba(c.accent, 0.85);
        ctx.fillRect(left + it.x - 6 * u, y - size * 0.1, (it.width + 12 * u) * sw, size * 0.5);
      }
      drawLabel(ctx, part, f, left + it.x, y, "left", c.fg);
      caret = { x: left + it.x + ctx.measureText(part).width + 6 * u, y };
    }
    if (Math.floor(g.t * 2.5) % 2 === 0 || g.t < ws[ws.length - 1]?.e) {
      ctx.fillStyle = c.accent;
      ctx.fillRect(caret.x, caret.y - size * 0.45, 6 * u, size * 0.85);
    }
    void text;
    hitAll(g, size);
  },

  /** The word, echoed: a solid middle with outlined repeats above and below, scrolling. */
  "echo-stack"(g) {
    const { ctx, W, H, c, pad } = g;
    const ws = spoken(g), em = marked(g.scene.headline);
    const k = current(ws, g.t);
    if (k < 0) return;
    const w = ws[k];
    const text = w.w.toUpperCase().replace(/[.,!?;:]+$/, "");
    const size = fit(g, text, W - pad * 1.6, g.portrait ? H * 0.12 : H * 0.2);
    const lh = size * 0.92;
    const p = ease.outCubic(clamp((g.t - w.s + 0.04) / 0.3));
    const drift = (1 - p) * lh;
    const isEm = em.has(plain(w.w));
    font(g, size);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const reach = gentle(g) ? 1 : 4;
    for (let i = -reach; i <= reach; i++) {
      const y = H / 2 + i * lh + drift * (i < 0 ? -1 : 1);
      const a = i === 0 ? 1 : Math.max(0, (gentle(g) ? 0.25 : 0.55) - Math.abs(i) * 0.12) * p;
      if (a <= 0) continue;
      if (i === 0) {
        ctx.globalAlpha = clamp(p * 1.5);
        ctx.fillStyle = isEm ? c.accent : c.fg;
        ctx.fillText(text, W / 2, y);
      } else {
        ctx.globalAlpha = a;
        ctx.strokeStyle = isEm ? c.accent : c.fg;
        ctx.lineWidth = Math.max(1.5, size * 0.018);
        ctx.strokeText(text, W / 2, y);
      }
    }
    ctx.globalAlpha = 1;
    hitAll(g, size);
  },
};
