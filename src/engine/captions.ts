// Burned-in captions: the voice-over's words on screen as they're said, in a chosen design.
// One renderer for the preview, the export and the design picker's thumbnails.
import type { Brand, CaptionStyle, Word } from "../types";
import { fontString, displayWeight } from "./text";
import { clamp, ease, rgba, mix, contrast } from "./util";

export const CAPTION_DESIGNS = [
  { id: "pill", label: "Pill", note: "A dark pill, the spoken word lit", words: 5 },
  { id: "subtitle", label: "Subtitle", note: "Classic film subtitles, outlined", words: 7 },
  { id: "karaoke", label: "Karaoke", note: "Bold capitals, the spoken word in colour", words: 4 },
  { id: "box", label: "Highlight box", note: "The spoken word jumps into a colour box", words: 3 },
  { id: "pop", label: "Pop", note: "One or two huge words at a time", words: 2 },
  { id: "band", label: "Band", note: "A full-width strip, news style", words: 7 },
  { id: "neon", label: "Neon", note: "Glowing words", words: 4 },
  { id: "type", label: "Typewriter", note: "Words type on as they're said", words: 5 },
  { id: "minimal", label: "Minimal", note: "Small and quiet, an underline on the word", words: 6 },
] as const;
export type CaptionDesign = (typeof CAPTION_DESIGNS)[number]["id"];
export const DEFAULT_CAPTIONS: Required<Pick<CaptionStyle, "design" | "position" | "size">> = { design: "pill", position: "bottom", size: "m" };
/** Highlight colours offered beside the brand's accent. */
export const CAPTION_COLORS = ["#FFE600", "#39FF88", "#FF4D6D", "#38BDF8", "#FFFFFF"];

/** Words grouped into caption lines: up to `max` words, breaking at punctuation and pauses. */
export function captionPhrases(words: Word[], max: number): Word[][] {
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

interface Opts {
  words: Word[];
  style?: CaptionStyle;
  brand: Pick<Brand, "accent" | "fontDisplay" | "fontBody">;
  t: number;
  /** height of a cinema bar at the bottom (captions sit in it when they fit) */
  bar?: number;
  /** thumbnails draw the text bigger than a frame would */
  zoom?: number;
}

export function renderCaptions(ctx: CanvasRenderingContext2D, W: number, H: number, o: Opts) {
  const st = o.style ?? {};
  const design = CAPTION_DESIGNS.find((d) => d.id === st.design) ?? CAPTION_DESIGNS[0];
  const per = st.words && st.words > 0 ? st.words : design.words;
  const phrases = captionPhrases(o.words, per);
  const t = o.t;
  // the newest phrase that has started (the one before may still be inside its hold)
  const ph = [...phrases].reverse().find((p) => t >= p[0].s - 0.1 && t <= p[p.length - 1].e + 0.25);
  if (!ph) return;
  const u = (Math.min(W, H) / 1080) * (o.zoom ?? 1);
  const k = st.size === "s" ? 0.8 : st.size === "l" ? 1.28 : 1;
  const id = design.id;
  const upper = st.upper ?? (id === "karaoke" || id === "box" || id === "pop");
  const hl = st.highlight !== false;
  const color = st.color && /^#[0-9a-f]{6}$/i.test(st.color) ? st.color : o.brand.accent;
  const display = id === "karaoke" || id === "box" || id === "pop" || id === "neon";
  const base = { pill: 34, subtitle: 40, karaoke: 58, box: 60, pop: 112, band: 36, neon: 56, type: 34, minimal: 28 }[id] * u * k;
  const family = id === "type" ? "JetBrains Mono" : display ? o.brand.fontDisplay : o.brand.fontBody;
  const weight = id === "type" ? 500 : display ? Math.max(700, displayWeight(o.brand.fontDisplay)) : id === "minimal" ? 500 : 600;
  const clean = (w: string) => (id === "pop" || id === "karaoke" || id === "box" ? w.replace(/[.,;:]+$/, "") : w);
  const text = (w: Word) => (upper ? clean(w.w).toUpperCase() : id === "minimal" ? clean(w.w).toLowerCase() : w.w);

  // Lay the words out: one line, or two when the phrase is wider than the frame allows.
  let size = base;
  const maxW = W * (id === "band" ? 0.9 : 0.86);
  const measureAll = () => {
    ctx.font = fontString({ family, weight, size });
    (ctx as any).letterSpacing = "0px";
    const sp = ctx.measureText(" ").width * (id === "box" ? 1.5 : 1);
    return { sp, ws: ph.map((w) => ctx.measureText(text(w)).width) };
  };
  let { sp, ws } = measureAll();
  const lineOf = (from: number, to: number) => ws.slice(from, to).reduce((a, b) => a + b, 0) + sp * Math.max(0, to - from - 1);
  let rows: [number, number][] = [[0, ph.length]];
  if (lineOf(0, ph.length) > maxW && ph.length > 1) {
    // split where the two lines are most even
    let best = 1;
    for (let i = 1; i < ph.length; i++) if (Math.abs(lineOf(0, i) - lineOf(i, ph.length)) < Math.abs(lineOf(0, best) - lineOf(best, ph.length))) best = i;
    rows = [[0, best], [best, ph.length]];
  }
  const widest = () => Math.max(...rows.map(([a, b]) => lineOf(a, b)));
  if (widest() > maxW) {
    size *= maxW / widest();
    ({ sp, ws } = measureAll());
  }
  const lh = size * (id === "pop" ? 1.05 : 1.3);
  const blockH = lh * rows.length;
  const padY = id === "pill" || id === "type" ? size * 0.45 : id === "band" ? size * 0.7 : 0;
  const margin = Math.min(W, H) * 0.1;
  const bar = o.bar ?? 0;
  let top: number;
  if (st.position === "top") top = margin + padY;
  else if (st.position === "middle") top = H / 2 - blockH / 2;
  else top = bar >= blockH + padY * 2 + 8 * u ? H - bar / 2 - blockH / 2 : H - margin - blockH - padY;

  // phrase entrance (pop springs in; the others ease up a touch)
  const pin = clamp((t - (ph[0].s - 0.1)) / 0.22);
  ctx.save();
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.lineJoin = "round";
  ctx.font = fontString({ family, weight, size });
  (ctx as any).letterSpacing = "0px";
  if (id === "pop") {
    const s = 0.72 + 0.28 * ease.outBack(pin);
    ctx.translate(W / 2, top + blockH / 2);
    ctx.scale(s, s);
    ctx.translate(-W / 2, -(top + blockH / 2));
  } else ctx.translate(0, (1 - ease.outCubic(pin)) * size * 0.25);
  ctx.globalAlpha = clamp(pin * 1.5);

  // backgrounds
  if (id === "band") {
    ctx.fillStyle = "rgba(8,8,10,0.78)";
    ctx.fillRect(0, top - padY, W, blockH + padY * 2);
    ctx.fillStyle = color;
    ctx.fillRect(0, top - padY, 8 * u, blockH + padY * 2);
  }
  rows.forEach(([a, b], r) => {
    const lw = lineOf(a, b);
    const x0 = W / 2 - lw / 2, y = top + lh * r + lh / 2;
    if (id === "pill" || id === "type") {
      const px = size * 0.8;
      ctx.fillStyle = id === "type" ? "rgba(8,8,10,0.86)" : "rgba(10,10,10,0.72)";
      ctx.beginPath();
      ctx.roundRect(x0 - px, y - lh / 2 - (rows.length > 1 ? 0 : padY - (lh - size) / 2) , lw + px * 2, rows.length > 1 ? lh : size + padY * 2, id === "type" ? size * 0.25 : (size + padY * 2) / 2);
      ctx.fill();
    }
    let x = x0;
    for (let i = a; i < b; i++) {
      const w = ph[i], tx = text(w), ww = ws[i];
      const active = t >= w.s && t <= w.e + 0.05, said = t > w.e;
      const on = hl && active;
      const stroke = (width: number, col = "#000000") => {
        ctx.strokeStyle = col;
        ctx.lineWidth = width;
        ctx.strokeText(tx, x, y);
      };
      if (id === "pill") {
        ctx.fillStyle = on ? color : said || !hl ? "#FFFFFF" : "rgba(255,255,255,0.5)";
        ctx.fillText(tx, x, y);
      } else if (id === "subtitle") {
        stroke(size * 0.16);
        ctx.fillStyle = on ? color : "#FFFFFF";
        ctx.fillText(tx, x, y);
      } else if (id === "karaoke" || id === "pop") {
        ctx.save();
        if (on && id === "karaoke") {
          ctx.translate(x + ww / 2, y);
          ctx.scale(1.08, 1.08);
          ctx.translate(-(x + ww / 2), -y);
        }
        stroke(size * (id === "pop" ? 0.12 : 0.18));
        ctx.fillStyle = on ? color : "#FFFFFF";
        ctx.fillText(tx, x, y);
        ctx.restore();
      } else if (id === "box") {
        if (on) {
          const bp = clamp((t - w.s) / 0.1);
          const px = size * 0.2 * (0.6 + 0.4 * bp), py = size * 0.12;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.roundRect(x - px, y - size * 0.62 - py * 0.2, ww + px * 2, size * 1.24 + py * 0.4, size * 0.16);
          ctx.fill();
          ctx.fillStyle = contrast("#FFFFFF", color) > 2.6 ? "#FFFFFF" : mix(color, "#000000", 0.85);
          ctx.fillText(tx, x, y);
        } else {
          stroke(size * 0.16);
          ctx.fillStyle = "#FFFFFF";
          ctx.fillText(tx, x, y);
        }
      } else if (id === "band") {
        ctx.fillStyle = on ? color : said || !hl ? "#FFFFFF" : "rgba(255,255,255,0.6)";
        ctx.fillText(tx, x, y);
      } else if (id === "neon") {
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = size * (on ? 0.9 : 0.45);
        ctx.fillStyle = on ? "#FFFFFF" : rgba(mix(color, "#FFFFFF", 0.35), said || !hl ? 1 : 0.55);
        ctx.fillText(tx, x, y);
        if (on) ctx.fillText(tx, x, y);
        ctx.restore();
      } else if (id === "type") {
        if (t >= w.s) {
          // letters arrive across the word's own time
          const n = Math.max(1, Math.ceil(tx.length * clamp((t - w.s) / Math.max(0.08, (w.e - w.s) * 0.7))));
          ctx.fillStyle = on ? color : "#FFFFFF";
          ctx.fillText(tx.slice(0, n), x, y);
          if (active && Math.floor(t * 4) % 2 === 0) {
            ctx.fillStyle = color;
            ctx.fillRect(x + ctx.measureText(tx.slice(0, n)).width + size * 0.08, y - size * 0.45, size * 0.1, size * 0.9);
          }
        }
      } else {
        // minimal
        ctx.shadowColor = "rgba(0,0,0,0.6)";
        ctx.shadowBlur = size * 0.3;
        ctx.fillStyle = said || active || !hl ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.55)";
        ctx.fillText(tx, x, y);
        ctx.shadowBlur = 0;
        if (on) {
          ctx.fillStyle = color;
          ctx.fillRect(x, y + size * 0.62, ww * clamp((t - w.s) / Math.max(0.08, w.e - w.s)), Math.max(2, size * 0.09));
        }
      }
      x += ww + sp;
    }
  });
  ctx.restore();
}
