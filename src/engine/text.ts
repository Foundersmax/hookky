// Rich text layout for canvas: *emphasis* tokens, auto-fit sizing, masked line reveals.
import { clamp, ease, win } from "./util";

export interface Token {
  text: string;
  em: boolean;
  /** attaches to the previous token with no space, e.g. the "." in "*move*." */
  glue?: boolean;
}

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let em = false;
  let lastEndedWithSpace = true;
  for (const part of src.split(/(\*)/)) {
    if (part === "*") {
      em = !em;
      continue;
    }
    if (!part) continue;
    const words = part.split(/\s+/).filter(Boolean);
    words.forEach((w, i) => out.push({ text: w, em, ...(i === 0 && out.length && !lastEndedWithSpace && !/^\s/.test(part) ? { glue: true } : {}) }));
    lastEndedWithSpace = /\s$/.test(part);
  }
  return out;
}

export const stripMarks = (s = "") => s.replace(/\*/g, "");

export interface FontSpec {
  family: string;
  weight: number;
  size: number;
  tracking?: number; // em
  italic?: boolean;
}

export const fontString = (f: FontSpec) => `${f.italic ? "italic " : ""}${f.weight} ${f.size}px "${f.family}", "Inter", system-ui, sans-serif`;

/** Display weights that look right per family. */
export function displayWeight(family: string) {
  // Single-weight faces must not be asked for bold, or the browser fakes it.
  if (/Instrument Serif|Bebas Neue|Anton|Archivo Black|DM Serif Display/.test(family)) return 400;
  if (/Playfair|Caveat/.test(family)) return 600;
  if (/Unbounded|Bricolage/.test(family)) return 700;
  if (/Fraunces/.test(family)) return 500;
  if (/Mono/.test(family)) return 600;
  if (/Syne/.test(family)) return 700;
  return 650;
}
export function displayTracking(family: string) {
  if (/Bebas Neue|Anton/.test(family)) return 0.01; // condensed caps want a touch of air
  if (/Caveat/.test(family)) return 0;
  if (/Instrument Serif|Fraunces|Playfair|DM Serif/.test(family)) return -0.02;
  if (/Mono/.test(family)) return -0.04;
  return -0.035;
}

export interface Layout {
  lines: { tokens: Token[]; width: number }[];
  font: FontSpec;
  lineHeight: number;
  height: number;
  width: number;
  spaceW: number;
}

function setFont(ctx: CanvasRenderingContext2D, f: FontSpec) {
  ctx.font = fontString(f);
  (ctx as any).letterSpacing = `${(f.tracking ?? 0) * f.size}px`;
}

export function layoutText(
  ctx: CanvasRenderingContext2D,
  text: string,
  base: FontSpec,
  maxW: number,
  maxLines = 3,
  lineHeightRatio = 1.02,
  minSize = 12,
): Layout {
  const tokens = tokenize(text);
  let size = base.size;
  for (let iter = 0; iter < 40; iter++) {
    const font = { ...base, size };
    setFont(ctx, font);
    const spaceW = ctx.measureText(" ").width;
    const lines: Layout["lines"] = [];
    let cur: Token[] = [];
    let curW = 0;
    let tooWide = false;
    for (const t of tokens) {
      const w = ctx.measureText(t.text).width;
      if (w > maxW) tooWide = true;
      const nw = cur.length ? curW + (t.glue ? 0 : spaceW) + w : w;
      if (nw > maxW && cur.length && !t.glue) {
        lines.push({ tokens: cur, width: curW });
        cur = [t];
        curW = w;
      } else {
        cur.push(t);
        curW = nw;
      }
    }
    if (cur.length) lines.push({ tokens: cur, width: curW });
    if ((lines.length <= maxLines && !tooWide) || size <= minSize) {
      // Still too many lines at the smallest size: keep what fits and end on an ellipsis.
      if (lines.length > maxLines) {
        lines.length = maxLines;
        const last = lines[maxLines - 1];
        const t = last.tokens[last.tokens.length - 1];
        if (t) last.tokens[last.tokens.length - 1] = { ...t, text: t.text.replace(/[.,;:!?]*$/, "") + "…" };
      }
      const lineHeight = size * lineHeightRatio;
      return { lines, font, lineHeight, height: lines.length * lineHeight, width: Math.max(0, ...lines.map((l) => l.width)), spaceW };
    }
    size *= 0.92;
  }
  throw new Error("unreachable");
}

export type RevealMode = "mask" | "fade" | "rise" | "words" | "none";

export interface DrawTextOpts {
  x: number;
  y: number; // top of block
  align: "left" | "center" | "right";
  color: string;
  emColor: string;
  t: number;
  delay?: number;
  dur?: number;
  stagger?: number;
  mode?: RevealMode;
  easing?: (t: number) => number;
  alpha?: number;
  emItalic?: boolean;
}

/** Draw a laid-out block. Returns block bottom y. */
export function drawLayout(ctx: CanvasRenderingContext2D, L: Layout, o: DrawTextOpts) {
  const mode = o.mode ?? "mask";
  const dur = o.dur ?? 0.8;
  const stagger = o.stagger ?? 0.09;
  const E = o.easing ?? ease.outExpo;
  ctx.save();
  ctx.textBaseline = "alphabetic";
  let wordIndex = 0;
  L.lines.forEach((line, li) => {
    const top = o.y + li * L.lineHeight;
    const baseline = top + L.lineHeight * 0.8;
    let x = o.align === "left" ? o.x : o.align === "center" ? o.x - line.width / 2 : o.x - line.width;
    const lp = E(win(o.t, (o.delay ?? 0) + li * stagger, dur));
    ctx.save();
    if (mode === "mask") {
      ctx.beginPath();
      ctx.rect(x - L.font.size, top - L.lineHeight * 0.15, line.width + L.font.size * 2, L.lineHeight * 1.2);
      ctx.clip();
      ctx.translate(0, (1 - lp) * L.lineHeight * 1.1);
    } else if (mode === "rise") {
      ctx.globalAlpha *= lp;
      ctx.translate(0, (1 - lp) * L.font.size * 0.5);
    } else if (mode === "fade") {
      ctx.globalAlpha *= lp;
    }
    ctx.globalAlpha *= o.alpha ?? 1;
    line.tokens.forEach((tok, ti) => {
      if (ti > 0 && !tok.glue) x += L.spaceW;
      const f = tok.em && o.emItalic ? { ...L.font, italic: true } : L.font;
      setFont(ctx, f);
      const w = ctx.measureText(tok.text).width;
      ctx.save();
      if (mode === "words") {
        const wp = E(win(o.t, (o.delay ?? 0) + wordIndex * stagger, dur));
        ctx.globalAlpha *= wp;
        ctx.translate(0, (1 - wp) * L.font.size * 0.35);
      }
      ctx.fillStyle = tok.em ? o.emColor : o.color;
      ctx.fillText(tok.text, x, baseline);
      ctx.restore();
      x += w;
      wordIndex++;
    });
    ctx.restore();
  });
  ctx.restore();
  return o.y + L.height;
}

/** Convenience: single-line label (kicker etc.) */
export function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  f: FontSpec,
  x: number,
  y: number,
  align: CanvasTextAlign,
  color: string,
  alpha = 1,
  maxW?: number,
) {
  ctx.save();
  setFont(ctx, f);
  // Fit a width: shrink a little (to 72%), then cut with an ellipsis. Never spill off the frame.
  if (maxW !== undefined && maxW > 0 && text) {
    let w = ctx.measureText(text).width;
    if (w > maxW) {
      setFont(ctx, { ...f, size: f.size * Math.max(0.72, maxW / w) });
      w = ctx.measureText(text).width;
      if (w > maxW) {
        let lo = 0, hi = text.length;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (ctx.measureText(text.slice(0, mid).trimEnd() + "…").width <= maxW) lo = mid;
          else hi = mid - 1;
        }
        text = lo ? text.slice(0, lo).trimEnd() + "…" : "";
      }
    }
  }
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.globalAlpha *= clamp(alpha);
  ctx.fillText(text, x, y);
  const w = ctx.measureText(text).width;
  ctx.restore();
  return w;
}

export function measure(ctx: CanvasRenderingContext2D, text: string, f: FontSpec) {
  ctx.save();
  setFont(ctx, f);
  const w = ctx.measureText(text).width;
  ctx.restore();
  return w;
}
