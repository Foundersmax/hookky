// Motion graphics: minimal explainer animation built from one icon kit. Line icons draw on stroke
// by stroke, rings and bars grow, a dot travels a process; one line weight, one accent, and every
// element lands when its words are spoken in the voice-over (or on a measured stagger without one).
import type { G, Tpl } from "./render";
import type { IconSpec } from "../mograph/icons";
import { F, B, K, kicker, headlineSize, textStack } from "./render";
import { clamp, ease, lerp, win, rgba, mix } from "./util";
import { drawLabel, measure, stripMarks, layoutText, drawLayout } from "./text";

// ---------------------------------------------------------------- drawing icons
const lengths = new Map<string, number>();
let probe: SVGPathElement | null = null;
/** Length of a path in its own units (for draw-on); an estimate where there's no DOM. */
function pathLength(d: string): number {
  let L = lengths.get(d);
  if (L !== undefined) return L;
  try {
    probe ??= document.createElementNS("http://www.w3.org/2000/svg", "path");
    probe.setAttribute("d", d);
    L = probe.getTotalLength();
  } catch {
    L = 0;
  }
  if (!L || !isFinite(L)) L = 120;
  lengths.set(d, L);
  return L;
}
const paths = new Map<string, Path2D>();
const path2d = (d: string) => {
  let p = paths.get(d);
  if (!p) paths.set(d, (p = new Path2D(d)));
  return p;
};

/**
 * Draw an icon centred at (cx, cy), `size` px across, `p` (0–1) of the way drawn on. Line icons
 * draw stroke by stroke at `weight` px; solid icons wipe up. Missing icons draw a quiet circle.
 */
export function drawIcon(ctx: CanvasRenderingContext2D, spec: IconSpec | undefined, cx: number, cy: number, size: number, p: number, color: string, weight = size * 0.055) {
  if (p <= 0) return;
  if (!spec) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = weight;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.32, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(p));
    ctx.stroke();
    ctx.restore();
    return;
  }
  const s = size / Math.max(spec.w, spec.h);
  ctx.save();
  ctx.translate(cx - (spec.w * s) / 2, cy - (spec.h * s) / 2);
  ctx.scale(s, s);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const n = spec.parts.length;
  spec.parts.forEach((part, i) => {
    const pi = clamp((p - (i / Math.max(1, n)) * 0.45) / 0.55);
    if (pi <= 0) return;
    const path = path2d(part.d);
    if (part.stroke) {
      const L = pathLength(part.d);
      ctx.lineWidth = weight / s;
      ctx.strokeStyle = color;
      ctx.setLineDash([L, L]);
      ctx.lineDashOffset = L * (1 - ease.inOutCubic(pi));
      ctx.stroke(path);
      ctx.setLineDash([]);
    }
    if (part.fill && !part.stroke) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, spec.h * (1 - ease.outCubic(pi)), spec.w, spec.h * ease.outCubic(pi) + 1);
      ctx.clip();
      ctx.fillStyle = color;
      ctx.fill(path);
      ctx.restore();
    }
  });
  ctx.restore();
}

// ---------------------------------------------------------------- timing to the voice
const STOP = new Set("a an and are as at be but by for from has have i in is it its of on or our so that the their this to was we with you your".split(" "));
const plain = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}%]/gu, "");
/** Scene time at which `text` is first spoken (a little before its first meaningful word), else `fallback`. */
function cue(g: G, text: string | undefined, fallback: number): number {
  if (!g.words?.length || !text) return fallback;
  const want = stripMarks(text).split(/\s+/).map(plain).filter((w) => w.length > 2 && !STOP.has(w));
  for (const w of g.words) {
    if (w.s < g.abs - 0.05 || w.s > g.abs + g.dur) continue;
    if (want.includes(plain(w.w))) return Math.max(0, w.s - g.abs - 0.15);
  }
  return fallback;
}
/** Items, icons and their cue times: evenly across the scene unless the voice says them. */
function staged(g: G, items: string[], from = 0.35, span = 0.6) {
  const step = (g.dur * span) / Math.max(1, items.length);
  let last = 0;
  return items.map((it, i) => (last = Math.max(last, cue(g, it, from + i * step))));
}
const weightFor = (g: G, size: number) => Math.max(2 * g.u, size * 0.05);
const splitItem = (it: string) => {
  const [label, value] = it.split("|").map((x) => x.trim());
  return { label, value };
};

// ---------------------------------------------------------------- templates
export const MOGRAPH_TEMPLATES: Record<string, Tpl> = {
  /** One icon draws on inside a ring that sweeps round; the line lands beneath. */
  "icon-hero"(g) {
    const { ctx, W, H, u, c, scene, pad } = g;
    const size = Math.min(W, H) * (g.portrait ? 0.3 : 0.27);
    const cx = W / 2, cy = scene.headline ? H * (g.portrait ? 0.38 : 0.4) : H / 2;
    const appear = ease.outCubic(win(g.t, 0, 0.7 * g.sp));
    // soft disc and a ring that sweeps round, a dot riding it
    const R = size * 0.86;
    const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.25);
    gr.addColorStop(0, rgba(c.accent, 0.16 * appear));
    gr.addColorStop(1, rgba(c.accent, 0));
    ctx.fillStyle = gr;
    ctx.fillRect(cx - R * 1.4, cy - R * 1.4, R * 2.8, R * 2.8);
    const sweep = ease.inOutCubic(win(g.t, 0.05, 1.1 * g.sp));
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = rgba(c.fg, 0.12);
    ctx.lineWidth = 2 * u;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 3 * u;
    const a0 = -Math.PI / 2, a1 = a0 + Math.PI * 2 * sweep;
    ctx.beginPath();
    ctx.arc(cx, cy, R, a0, a1);
    ctx.stroke();
    const da = a1 + g.t * 0.6 * (sweep >= 1 ? 1 : 0);
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(da) * R, cy + Math.sin(da) * R, 6 * u * appear, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const t0 = cue(g, scene.headline, 0.2);
    const p = win(g.t, Math.min(t0, 0.4), 1.2 * g.sp);
    const float = Math.sin(g.t * 1.4) * 4 * u;
    drawIcon(ctx, g.icon(scene.icons?.[0]), cx, cy + float, size, p, c.fg, weightFor(g, size));
    if (scene.headline || scene.kicker) textStack(g, { x: W / 2, y: cy + R + 70 * u, maxW: W - pad * 2, align: "center", size: headlineSize(g, 0.52), delay: 0.45, maxLines: 2 });
  },

  /** Two to four ideas, each an icon that draws on as it's said, joined by a hairline. */
  "icon-list"(g) {
    const { ctx, W, H, u, c, scene, pad } = g;
    const items = (scene.items?.length ? scene.items : ["Fast", "Simple", "Secure"]).slice(0, 4).map((x) => splitItem(x).label);
    const n = items.length;
    const cues = staged(g, items);
    let top = pad;
    if (scene.headline) {
      const L = layoutText(ctx, scene.headline, F(g, headlineSize(g, 0.42)), W - pad * 2, 2);
      drawLayout(ctx, L, { x: W / 2, y: top, align: "center", color: c.fg, emColor: c.accent, t: g.t, delay: 0, dur: 0.7 * g.sp, mode: "mask", easing: g.E });
      g.hit?.({ field: "headline", x: pad, y: top, w: W - pad * 2, h: L.height, size: headlineSize(g, 0.42), align: "center", lines: L.lines.length });
      top += L.height + 40 * u;
    }
    const vertical = g.portrait;
    const areaH = H - top - pad;
    const iconSize = vertical ? Math.min(areaH / n * 0.5, W * 0.18) : Math.min((W - pad * 2) / n * 0.38, areaH * 0.32);
    const ring = iconSize * 0.78;
    const pos = items.map((_, i) =>
      vertical ? { x: pad + ring, y: top + (areaH / n) * (i + 0.5) } : { x: pad + ((W - pad * 2) / n) * (i + 0.5), y: top + areaH * 0.42 },
    );
    // hairline through the icons, drawn as they arrive
    ctx.save();
    ctx.strokeStyle = rgba(c.fg, 0.18);
    ctx.lineWidth = 2 * u;
    for (let i = 0; i < n - 1; i++) {
      const a = pos[i], b = pos[i + 1];
      const p = ease.inOutCubic(win(g.t, cues[i] + 0.2, Math.max(0.3, cues[i + 1] - cues[i])));
      if (p <= 0) continue;
      ctx.beginPath();
      if (vertical) {
        ctx.moveTo(a.x, a.y + ring);
        ctx.lineTo(a.x, lerp(a.y + ring, b.y - ring, p));
      } else {
        ctx.moveTo(a.x + ring, a.y);
        ctx.lineTo(lerp(a.x + ring, b.x - ring, p), a.y);
      }
      ctx.stroke();
    }
    ctx.restore();
    items.forEach((label, i) => {
      const { x, y } = pos[i];
      const p = win(g.t, cues[i], 0.9 * g.sp);
      const pop = ease.outBack(clamp(p * 1.6));
      if (p <= 0) return;
      ctx.save();
      ctx.strokeStyle = rgba(c.accent, 0.9);
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.arc(x, y, ring * pop, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      drawIcon(ctx, g.icon(scene.icons?.[i]), x, y, iconSize, p, c.fg, weightFor(g, iconSize));
      const f = B(g, (vertical ? 40 : 34) * u, 600);
      const lp = ease.outCubic(win(g.t, cues[i] + 0.25, 0.5));
      if (vertical) drawLabel(ctx, label, f, x + ring + 36 * u + (1 - lp) * 20 * u, y, "left", c.fg, lp);
      else drawLabel(ctx, label, f, x, y + ring + 56 * u + (1 - lp) * 16 * u, "center", c.fg, lp);
      g.hit?.({ field: `items.${i}`, x: vertical ? x + ring + 36 * u : x - ring * 1.5, y: vertical ? y - 30 * u : y + ring + 26 * u, w: vertical ? W - x - ring - pad : ring * 3, h: 60 * u, size: 34 * u, align: vertical ? "left" : "center", lines: 1 });
    });
  },

  /** A number counts up while its ring fills; an icon above it, the label below. */
  "metric-ring"(g) {
    const { ctx, W, H, u, c, scene, pad } = g;
    const st = scene.stat ?? { value: 87, suffix: "%", label: "of people notice the difference" };
    const pct = st.suffix?.trim() === "%" ? clamp(st.value / 100) : 1;
    const R = Math.min(W, H) * (g.portrait ? 0.3 : 0.27);
    const cx = W / 2, cy = H * (g.portrait ? 0.4 : 0.44);
    const t0 = cue(g, `${st.value} ${st.label ?? ""}`, 0.2);
    const p = ease.inOutCubic(win(g.t, Math.min(t0, 0.6), 1.5 * g.sp));
    // ticks, track, progress
    ctx.save();
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
      const on = i / 60 <= pct * p;
      ctx.strokeStyle = on ? rgba(c.accent, 0.55) : rgba(c.fg, 0.12);
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (R + 22 * u), cy + Math.sin(a) * (R + 22 * u));
      ctx.lineTo(cx + Math.cos(a) * (R + (i % 5 ? 30 : 38) * u), cy + Math.sin(a) * (R + (i % 5 ? 30 : 38) * u));
      ctx.stroke();
    }
    ctx.lineCap = "round";
    ctx.strokeStyle = rgba(c.fg, 0.1);
    ctx.lineWidth = 12 * u;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = c.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct * p);
    ctx.stroke();
    ctx.restore();
    const ic = scene.icons?.[0];
    if (ic) drawIcon(ctx, g.icon(ic), cx, cy - R * 0.42, R * 0.34, win(g.t, 0.1, 0.9), c.accent, weightFor(g, R * 0.34) * 0.8);
    const v = st.value * ease.outCubic(win(g.t, Math.min(t0, 0.6), 1.5 * g.sp));
    const txt = `${st.prefix ?? ""}${v.toFixed(st.decimals ?? 0)}${st.suffix ?? ""}`;
    const size = Math.min(R * 0.62, ((R * 1.5) / Math.max(1, measure(ctx, txt, F(g, 100)))) * 100);
    drawLabel(ctx, txt, F(g, size), cx, cy + (ic ? R * 0.12 : 0), "center", c.fg, win(g.t, 0.1, 0.4));
    g.hit?.({ field: "stat.value", x: cx - R * 0.7, y: cy - size * 0.5, w: R * 1.4, h: size, size, align: "center", lines: 1 });
    let y = cy + R + 90 * u;
    if (st.label) {
      const L = layoutText(ctx, st.label, B(g, (g.portrait ? 36 : 32) * u, 500), W - pad * 2, 2, 1.3);
      drawLayout(ctx, L, { x: W / 2, y, align: "center", color: rgba(c.fg, 0.8), emColor: c.accent, t: g.t, delay: Math.min(t0, 0.6) + 0.4, dur: 0.6, mode: "rise", stagger: 0.04, easing: ease.outCubic });
      g.hit?.({ field: "stat.label", x: pad, y, w: W - pad * 2, h: L.height, size: 32 * u, align: "center", lines: L.lines.length });
      y += L.height + 20 * u;
    }
    if (scene.headline) {
      const L = layoutText(ctx, scene.headline, F(g, headlineSize(g, 0.36)), W - pad * 2, 2);
      drawLayout(ctx, L, { x: W / 2, y: pad, align: "center", color: c.fg, emColor: c.accent, t: g.t, delay: 0, dur: 0.7, mode: "mask", easing: g.E });
      g.hit?.({ field: "headline", x: pad, y: pad, w: W - pad * 2, h: L.height, size: headlineSize(g, 0.36), align: "center", lines: L.lines.length });
    }
  },

  /** Steps joined by a line; a dot travels it and lights each step as it's said. */
  "process-flow"(g) {
    const { ctx, W, H, u, c, scene, pad } = g;
    const items = (scene.items?.length ? scene.items : ["Sign up", "Connect", "Launch"]).slice(0, 4).map((x) => splitItem(x).label);
    const n = items.length;
    const cues = staged(g, items, 0.4, 0.62);
    let top = pad;
    if (scene.headline) {
      const L = layoutText(ctx, scene.headline, F(g, headlineSize(g, 0.42)), W - pad * 2, 2);
      drawLayout(ctx, L, { x: W / 2, y: top, align: "center", color: c.fg, emColor: c.accent, t: g.t, delay: 0, dur: 0.7, mode: "mask", easing: g.E });
      g.hit?.({ field: "headline", x: pad, y: top, w: W - pad * 2, h: L.height, size: headlineSize(g, 0.42), align: "center", lines: L.lines.length });
      top += L.height + 50 * u;
    }
    const vertical = g.portrait;
    const areaH = H - top - pad;
    const r = vertical ? Math.min(areaH / n * 0.26, W * 0.1) : Math.min((W - pad * 2) / n * 0.2, areaH * 0.16);
    const pos = items.map((_, i) => (vertical ? { x: pad + r * 1.4, y: top + (areaH / n) * (i + 0.5) } : { x: pad + ((W - pad * 2) / n) * (i + 0.5), y: top + areaH * 0.4 }));
    // the track, and the travelling dot
    const start = pos[0], end = pos[n - 1];
    const along = (k: number) => ({ x: lerp(start.x, end.x, k), y: lerp(start.y, end.y, k) });
    const total = Math.max(1e-3, vertical ? end.y - start.y : end.x - start.x);
    ctx.save();
    ctx.strokeStyle = rgba(c.fg, 0.14);
    ctx.lineWidth = 2 * u;
    ctx.setLineDash([2 * u, 10 * u]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // the dot's position: between step i and i+1 from cue i to cue i+1
    let k = 0;
    for (let i = 0; i < n - 1; i++) {
      const seg = ease.inOutCubic(win(g.t, cues[i] + 0.3, Math.max(0.3, cues[i + 1] - cues[i] - 0.1)));
      const a = vertical ? pos[i].y : pos[i].x, b = vertical ? pos[i + 1].y : pos[i + 1].x;
      if (seg > 0) k = (lerp(a, b, seg) - (vertical ? start.y : start.x)) / total;
    }
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 3 * u;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    const at = along(k);
    ctx.lineTo(at.x, at.y);
    ctx.stroke();
    if (g.t > cues[0]) {
      ctx.fillStyle = c.accent;
      ctx.beginPath();
      ctx.arc(at.x, at.y, 9 * u, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    items.forEach((label, i) => {
      const { x, y } = pos[i];
      const on = g.t >= cues[i];
      const p = ease.outBack(clamp(win(g.t, cues[i] - 0.1, 0.45)));
      ctx.save();
      ctx.fillStyle = on ? c.accent : c.bg;
      ctx.strokeStyle = on ? c.accent : rgba(c.fg, 0.3);
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.arc(x, y, r * Math.max(0.85, p), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      const ink = on ? (mix(c.accent, "#000000", 0.75)) : rgba(c.fg, 0.55);
      drawIcon(ctx, g.icon(scene.icons?.[i]), x, y, r * 1.05, on ? win(g.t, cues[i], 0.8) : 1, ink, weightFor(g, r * 1.05));
      const lp = ease.outCubic(win(g.t, cues[i] + 0.1, 0.5));
      const num = String(i + 1).padStart(2, "0");
      if (vertical) {
        drawLabel(ctx, num, K(g, 20 * u), x + r + 34 * u, y - 26 * u, "left", c.accent, lp);
        drawLabel(ctx, label, B(g, 38 * u, 600), x + r + 34 * u, y + 16 * u, "left", c.fg, Math.max(0.35, lp));
      } else {
        drawLabel(ctx, num, K(g, 18 * u), x, y + r + 40 * u, "center", c.accent, lp);
        drawLabel(ctx, label, B(g, 32 * u, 600), x, y + r + 84 * u, "center", c.fg, Math.max(0.35, lp));
      }
      g.hit?.({ field: `items.${i}`, x: vertical ? x + r + 34 * u : x - r * 2, y: vertical ? y - 10 * u : y + r + 60 * u, w: vertical ? W - x - r - pad : r * 4, h: 50 * u, size: 32 * u, align: vertical ? "left" : "center", lines: 1 });
    });
  },

  /** Bars grow to their values as each is said; the biggest in the accent. */
  "bar-compare"(g) {
    const { ctx, W, H, u, c, scene, pad } = g;
    const rows = (scene.items?.length ? scene.items : ["Before | 3", "Others | 5", "With us | 10"]).slice(0, 4).map(splitItem);
    const vals = rows.map((r) => parseFloat((r.value ?? "").replace(/[^\d.]/g, "")) || 0);
    const max = Math.max(...vals, 1);
    const cues = staged(g, rows.map((r) => r.label), 0.35, 0.55);
    let top = pad;
    if (scene.headline) {
      const L = layoutText(ctx, scene.headline, F(g, headlineSize(g, 0.44)), W - pad * 2, 2);
      drawLayout(ctx, L, { x: pad, y: top, align: "left", color: c.fg, emColor: c.accent, t: g.t, delay: 0, dur: 0.7, mode: "mask", easing: g.E });
      g.hit?.({ field: "headline", x: pad, y: top, w: W - pad * 2, h: L.height, size: headlineSize(g, 0.44), align: "left", lines: L.lines.length });
      top += L.height + 60 * u;
    }
    const n = rows.length;
    const rowH = Math.min((g.portrait ? 230 : 170) * u, (H - top - pad) / n);
    // centre the bars in the space left under the headline
    top += Math.max(0, (H - top - pad - rowH * n) / 2 - (scene.headline ? 30 * u : 0));
    const hasIcons = !!scene.icons?.length;
    const iconW = hasIcons ? rowH * 0.5 : 0;
    const x0 = pad + (hasIcons ? iconW + 24 * u : 0);
    const barMax = W - x0 - pad - (g.portrait ? 230 : 200) * u;
    const best = vals.indexOf(Math.max(...vals));
    rows.forEach((r, i) => {
      const y = top + i * rowH;
      const p = ease.outCubic(win(g.t, cues[i], 0.9 * g.sp));
      const isBest = i === best;
      drawLabel(ctx, r.label, B(g, (g.portrait ? 40 : 34) * u, 600), x0, y + rowH * 0.2, "left", isBest ? c.fg : rgba(c.fg, 0.7), win(g.t, cues[i] - 0.1, 0.4));
      g.hit?.({ field: `items.${i}`, x: x0, y, w: barMax, h: rowH * 0.4, size: 28 * u, align: "left", lines: 1 });
      if (hasIcons) drawIcon(ctx, g.icon(scene.icons?.[i]), pad + iconW / 2, y + rowH * 0.55, iconW, win(g.t, cues[i], 0.8), isBest ? c.accent : rgba(c.fg, 0.6), weightFor(g, iconW) * 0.8);
      const bh = rowH * 0.26, by = y + rowH * 0.42;
      ctx.fillStyle = rgba(c.fg, 0.07);
      ctx.beginPath();
      ctx.roundRect(x0, by, barMax, bh, bh / 2);
      ctx.fill();
      const w = Math.max(bh, (barMax * vals[i]) / max) * p;
      if (p > 0) {
        ctx.fillStyle = isBest ? c.accent : rgba(c.fg, 0.35);
        ctx.beginPath();
        ctx.roundRect(x0, by, w, bh, bh / 2);
        ctx.fill();
        const suffix = (r.value ?? "").replace(/^[\d.,]+/, "");
        drawLabel(ctx, `${(vals[i] * p).toFixed(Number.isInteger(vals[i]) ? 0 : 1)}${suffix}`, F(g, (g.portrait ? 52 : 46) * u), x0 + w + 20 * u, by + bh / 2, "left", isBest ? c.accent : rgba(c.fg, 0.75), p);
      }
    });
  },

  /** The product at the centre, its world orbiting: icons pop in on spokes and drift round. */
  "icon-orbit"(g) {
    const { ctx, W, H, u, c, scene, pad, brand } = g;
    const icons = scene.icons ?? [];
    const sats = icons.slice(1, 7);
    const cx = W / 2, cy = H * (scene.headline ? (g.portrait ? 0.4 : 0.42) : 0.5);
    const R = Math.min(W, H) * (g.portrait ? 0.32 : 0.3);
    const core = R * 0.36;
    const appear = ease.outBack(win(g.t, 0, 0.6 * g.sp));
    const orbit = ease.inOutCubic(win(g.t, 0.2, 1 * g.sp));
    ctx.save();
    ctx.strokeStyle = rgba(c.fg, 0.14);
    ctx.lineWidth = 2 * u;
    ctx.setLineDash([3 * u, 9 * u]);
    ctx.beginPath();
    ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * orbit);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    const n = Math.max(1, sats.length);
    const spin = g.t * 0.12;
    const cues = staged(g, sats.map((s) => s.split(":")[1]?.replace(/-/g, " ") ?? ""), 0.6, 0.5);
    sats.forEach((name, i) => {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2 + spin;
      const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
      const p = ease.outBack(clamp(win(g.t, cues[i], 0.5)));
      if (p <= 0) return;
      ctx.save();
      ctx.strokeStyle = rgba(c.accent, 0.4 * clamp(p));
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * core * 1.15, cy + Math.sin(a) * core * 1.15);
      ctx.lineTo(lerp(cx, x, clamp(p)), lerp(cy, y, clamp(p)));
      ctx.stroke();
      const sr = R * 0.2 * p;
      ctx.fillStyle = c.bg;
      ctx.strokeStyle = rgba(c.fg, 0.25);
      ctx.beginPath();
      ctx.arc(x, y, sr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      drawIcon(ctx, g.icon(name), x, y, sr * 1.05, win(g.t, cues[i], 0.7), c.fg, weightFor(g, R * 0.2));
    });
    // the core
    ctx.save();
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, core * appear, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const ink = mix(c.accent, "#000000", 0.78);
    if (icons[0]) drawIcon(ctx, g.icon(icons[0]), cx, cy, core * 1.1, win(g.t, 0.15, 0.8), ink, weightFor(g, core * 1.1));
    else drawLabel(ctx, (stripMarks(brand.name || "•")[0] ?? "•").toUpperCase(), F(g, core * 1.1), cx, cy + core * 0.04, "center", ink, appear);
    if (scene.headline || scene.kicker) textStack(g, { x: W / 2, y: cy + R + R * 0.28 + 30 * u, maxW: W - pad * 2, align: "center", size: headlineSize(g, 0.48), delay: 0.5, maxLines: 2 });
    void kicker;
  },
};
