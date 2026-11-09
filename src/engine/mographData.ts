// Motion graphics for numbers and places: a line chart that draws itself, columns, a donut, a KPI
// grid, a dotted world map with pins and flight arcs, and a street map with a route. Same rules as
// the icon templates: one accent, hairlines, and every element lands when its words are spoken.
import type { G, Tpl } from "./render";
import { F, B, K, headlineSize } from "./render";
import { clamp, ease, lerp, win, rgba, mix, hash } from "./util";
import { drawLabel, measure, layoutText, drawLayout } from "./text";
import { drawIcon, cue, staged, splitItem, weightFor } from "./mograph";
import { WORLD } from "../mograph/world";
import { placeAt, landAt } from "../mograph/places";

// ---------------------------------------------------------------- shared
/** The headline across the top (if any); returns the y below it. */
function header(g: G, align: "left" | "center" = "center", scale = 0.42): number {
  const { ctx, W, u, c, scene, pad } = g;
  let top = pad;
  if (scene.kicker) {
    drawLabel(ctx, scene.kicker.toUpperCase(), K(g, 20 * u), align === "center" ? W / 2 : pad, top + 10 * u, align, c.accent, win(g.t, 0, 0.4), W - pad * 2);
    top += 44 * u;
  }
  if (!scene.headline) return top;
  const size = headlineSize(g, scale * (g.portrait ? 1 : 1.35));
  const L = layoutText(ctx, scene.headline, F(g, size), W - pad * 2, 2);
  drawLayout(ctx, L, { x: align === "center" ? W / 2 : pad, y: top, align, color: c.fg, emColor: c.accent, t: g.t, delay: 0, dur: 0.7 * g.sp, mode: "mask", easing: g.E });
  g.hit?.({ field: "headline", x: pad, y: top, w: W - pad * 2, h: L.height, size, align, lines: L.lines.length });
  return top + L.height + 40 * u;
}

/** "$1.2k" → {value: 1.2, prefix: "$", suffix: "k"}. */
function parseValue(v = "") {
  const m = v.trim().match(/^([^\d.-]*)(-?[\d.,]+)(.*)$/);
  if (!m) return { value: 0, prefix: "", suffix: "", decimals: 0 };
  const num = m[2].replace(/,(?=\d{3}\b)/g, "").replace(",", ".");
  return { value: parseFloat(num) || 0, prefix: m[1].trim(), suffix: m[3].trim(), decimals: (num.split(".")[1] ?? "").length };
}
const fmt = (n: number, d: number, prefix = "", suffix = "") => `${prefix}${n.toFixed(d)}${suffix && /^[%kKmMbBx]/.test(suffix) ? suffix : suffix ? ` ${suffix}` : ""}`;

const rows = (g: G, fallback: string[], max: number) =>
  (g.scene.items?.length ? g.scene.items : fallback).slice(0, max).map((it) => {
    const { label, value } = splitItem(it);
    return { label: label ?? "", ...parseValue(value ?? label) };
  });

/** A rounded value tag: dark text on the accent. */
function tag(g: G, text: string, x: number, y: number, alpha: number, size = 26) {
  const { ctx, u, c } = g;
  if (alpha <= 0) return;
  const f = B(g, size * u, 700);
  const maxW = g.W - g.pad * 2;
  const w = Math.min(maxW, measure(ctx, text, f)) + 28 * u, h = size * u * 1.7;
  ctx.save();
  ctx.globalAlpha *= clamp(alpha);
  ctx.fillStyle = c.accent;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.restore();
  drawLabel(ctx, text, f, x, y + 1 * u, "center", mix(c.accent, "#000000", 0.8), alpha, maxW);
}

// ---------------------------------------------------------------- world map
/** Fit lon/lat bounds into a box with the map's own proportions; returns the projection. */
function frame(box: { x: number; y: number; w: number; h: number }, b: { lon0: number; lon1: number; lat0: number; lat1: number }) {
  let { lon0, lon1, lat0, lat1 } = b;
  // keep the box's aspect: widen whichever side is short
  const want = box.w / box.h;
  const span = lon1 - lon0, tall = lat0 - lat1;
  if (span / tall < want) {
    const d = (tall * want - span) / 2;
    lon0 -= d;
    lon1 += d;
  } else {
    const d = (span / want - tall) / 2;
    lat0 += d;
    lat1 -= d;
  }
  const s = box.w / (lon1 - lon0);
  return { s, x: (lon: number) => box.x + (lon - lon0) * s, y: (lat: number) => box.y + (lat0 - lat) * s, lon0, lon1, lat0, lat1 };
}
const WHOLE = { lon0: -170, lon1: 190, lat0: WORLD.lat0, lat1: WORLD.lat1 };
function boundsFor(pts: [number, number][], minSpan: number) {
  if (!pts.length) return WHOLE;
  let lon0 = Math.min(...pts.map((p) => p[0])), lon1 = Math.max(...pts.map((p) => p[0]));
  let lat0 = Math.max(...pts.map((p) => p[1])), lat1 = Math.min(...pts.map((p) => p[1]));
  const padLon = Math.max(minSpan - (lon1 - lon0), 0) / 2 + (lon1 - lon0) * 0.22 + 6;
  const padLat = Math.max(minSpan * 0.5 - (lat0 - lat1), 0) / 2 + (lat0 - lat1) * 0.3 + 6;
  lon0 -= padLon; lon1 += padLon; lat0 += padLat; lat1 -= padLat;
  return { lon0: Math.max(-180, lon0), lon1: Math.min(195, lon1), lat0: Math.min(WORLD.lat0, lat0), lat1: Math.max(WORLD.lat1, lat1) };
}
const mixB = (a: typeof WHOLE, b: typeof WHOLE, k: number) => ({ lon0: lerp(a.lon0, b.lon0, k), lon1: lerp(a.lon1, b.lon1, k), lat0: lerp(a.lat0, b.lat0, k), lat1: lerp(a.lat1, b.lat1, k) });

export const DATA_TEMPLATES: Record<string, Tpl> = {
  /** A line that draws itself left to right, its area filling beneath, a dot riding the head. */
  "line-chart"(g) {
    const { ctx, W, H, u, c, pad } = g;
    const pts = rows(g, ["Jan | 12", "Feb | 18", "Mar | 16", "Apr | 27", "May | 34", "Jun | 48"], 12);
    const top = header(g, "left");
    const n = pts.length;
    const max = Math.max(...pts.map((p) => p.value), 1) * 1.15, min = Math.min(0, ...pts.map((p) => p.value));
    const box = { x: pad + 10 * u, y: top + 50 * u, w: W - pad * 2 - (g.portrait ? 30 : 260) * u, h: H - top - pad - 120 * u };
    const X = (i: number) => box.x + (box.w * i) / Math.max(1, n - 1);
    const Y = (v: number) => box.y + box.h - ((v - min) / (max - min)) * box.h;
    // grid
    const gridIn = ease.outCubic(win(g.t, 0, 0.6));
    ctx.save();
    ctx.strokeStyle = rgba(c.fg, 0.08);
    ctx.lineWidth = 1.5 * u;
    for (let k = 0; k <= 4; k++) {
      const y = box.y + (box.h * k) / 4;
      ctx.beginPath();
      ctx.moveTo(box.x, y);
      ctx.lineTo(box.x + box.w * gridIn, y);
      ctx.stroke();
    }
    ctx.restore();
    pts.forEach((p, i) => p.label && drawLabel(ctx, p.label, B(g, (g.portrait ? 26 : 22) * u, 500), X(i), box.y + box.h + 40 * u, i === 0 ? "left" : i === n - 1 ? "right" : "center", rgba(c.fg, 0.5), gridIn, (box.w / Math.max(1, n - 1)) * (i === 0 || i === n - 1 ? 0.5 : 0.9)));
    // the line, drawn to `head` (in point units) — timed to the voice saying the last value
    const t0 = Math.min(cue(g, pts[0]?.label, 0.3), g.dur * 0.3);
    const t1 = Math.max(t0 + 0.8, Math.min(cue(g, pts[n - 1]?.label, g.dur * 0.6), g.dur * 0.75));
    const head = (n - 1) * ease.inOutCubic(win(g.t, t0, t1 - t0));
    const k = Math.floor(head), f = head - k;
    const hx = lerp(X(k), X(Math.min(n - 1, k + 1)), f), hy = lerp(Y(pts[k].value), Y(pts[Math.min(n - 1, k + 1)].value), f);
    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(X(0), Y(pts[0].value));
      for (let i = 1; i <= k; i++) {
        const cx = (X(i - 1) + X(i)) / 2;
        ctx.bezierCurveTo(cx, Y(pts[i - 1].value), cx, Y(pts[i].value), X(i), Y(pts[i].value));
      }
      ctx.lineTo(hx, hy);
    };
    // area
    const grad = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
    grad.addColorStop(0, rgba(c.accent, 0.28));
    grad.addColorStop(1, rgba(c.accent, 0));
    ctx.save();
    trace();
    ctx.lineTo(hx, box.y + box.h);
    ctx.lineTo(X(0), box.y + box.h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 5 * u;
    trace();
    ctx.stroke();
    ctx.restore();
    // points passed, and the head
    for (let i = 0; i <= k; i++) {
      ctx.fillStyle = c.bg;
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 3 * u;
      ctx.beginPath();
      ctx.arc(X(i), Y(pts[i].value), 7 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (g.t > t0) {
      const pulse = 1 + 0.5 * ((g.t * 1.4) % 1);
      ctx.fillStyle = rgba(c.accent, 0.25 * (1 - ((g.t * 1.4) % 1)));
      ctx.beginPath();
      ctx.arc(hx, hy, 14 * u * pulse * 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c.accent;
      ctx.beginPath();
      ctx.arc(hx, hy, 11 * u, 0, Math.PI * 2);
      ctx.fill();
      const last = pts[n - 1];
      const v = lerp(pts[k].value, pts[Math.min(n - 1, k + 1)].value, f);
      const done = head >= n - 1 - 1e-3;
      tag(g, fmt(v, done ? last.decimals : Math.min(1, last.decimals), last.prefix, last.suffix), clamp(hx, box.x + 60 * u, Math.min(W - pad - 60 * u, box.x + box.w)), hy - 46 * u, 1, g.portrait ? 30 : 26);
    }
    // growth summary on the right
    const first = pts[0].value, last = pts[n - 1].value;
    if (!g.portrait && first > 0 && last !== first) {
      const pct = ((last - first) / first) * 100;
      const a = win(g.t, t1, 0.5);
      const gy = box.y + box.h * 0.55;
      drawLabel(ctx, `${pct > 0 ? "+" : ""}${Math.round(pct * ease.outCubic(a))}%`, F(g, 72 * u), W - pad, gy, "right", c.accent, a);
      drawLabel(ctx, pct > 0 ? (pts[0].label && !/^(then|start|before)$/i.test(pts[0].label) ? `growth since ${pts[0].label}` : "growth") : "change", B(g, 24 * u, 500), W - pad, gy + 56 * u, "right", rgba(c.fg, 0.55), a, 240 * u);
    }
    g.hit?.({ field: "items", x: box.x, y: box.y, w: box.w, h: box.h, size: 24 * u, align: "left", lines: n });
  },

  /** Columns rise in turn as each is said; values count up on top; the best in the accent. */
  "column-chart"(g) {
    const { ctx, W, H, u, c, pad } = g;
    const cols = rows(g, ["2022 | 1.2", "2023 | 2.9", "2024 | 5.4", "2025 | 9.8"], 8);
    const top = header(g, "center");
    const n = cols.length;
    const max = Math.max(...cols.map((x) => x.value), 1);
    const best = cols.findIndex((x) => x.value === max);
    const cues = staged(g, cols.map((x) => x.label), 0.3, 0.55);
    const box = { x: pad, y: top + 70 * u, w: W - pad * 2, h: H - top - pad - 160 * u };
    const slot = box.w / n, bw = Math.min(slot * 0.56, 160 * u);
    ctx.save();
    ctx.strokeStyle = rgba(c.fg, 0.2);
    ctx.lineWidth = 2 * u;
    ctx.beginPath();
    ctx.moveTo(box.x, box.y + box.h);
    ctx.lineTo(box.x + box.w * ease.outCubic(win(g.t, 0, 0.6)), box.y + box.h);
    ctx.stroke();
    ctx.restore();
    cols.forEach((col, i) => {
      const x = box.x + slot * (i + 0.5);
      const p = ease.outCubic(win(g.t, cues[i], 0.8 * g.sp));
      const h = Math.max(4 * u, (box.h * col.value) / max) * p;
      const isBest = i === best;
      ctx.save();
      if (isBest) {
        const gr = ctx.createLinearGradient(0, box.y + box.h - h, 0, box.y + box.h);
        gr.addColorStop(0, c.accent);
        gr.addColorStop(1, rgba(c.accent, 0.55));
        ctx.fillStyle = gr;
      } else ctx.fillStyle = rgba(c.fg, 0.16 + 0.1 * (i / n));
      ctx.beginPath();
      ctx.roundRect(x - bw / 2, box.y + box.h - h, bw, h, [Math.min(bw / 2, 14 * u), Math.min(bw / 2, 14 * u), 0, 0]);
      ctx.fill();
      ctx.restore();
      if (p > 0) drawLabel(ctx, fmt(col.value * p, col.decimals, col.prefix, col.suffix), F(g, Math.min(slot * 0.3, (g.portrait ? 44 : 40) * u)), x, box.y + box.h - h - 32 * u, "center", isBest ? c.accent : rgba(c.fg, 0.8), clamp(p * 2), slot * 0.95);
      drawLabel(ctx, col.label, B(g, (g.portrait ? 26 : 24) * u, 600), x, box.y + box.h + 42 * u, "center", isBest ? c.fg : rgba(c.fg, 0.55), win(g.t, cues[i] - 0.1, 0.4), slot * 0.92);
      g.hit?.({ field: `items.${i}`, x: x - slot / 2, y: box.y + box.h + 20 * u, w: slot, h: 46 * u, size: 24 * u, align: "center", lines: 1 });
    });
  },

  /** A donut whose segments sweep in turn; the lead share counts up in the middle. */
  "donut-chart"(g) {
    const { ctx, W, H, u, c, pad } = g;
    const segs = rows(g, ["Mobile | 64%", "Desktop | 28%", "Tablet | 8%"], 5);
    const top = header(g, "center");
    const total = segs.reduce((a, s) => a + Math.max(0, s.value), 0) || 1;
    const cues = staged(g, segs.map((s) => s.label), 0.3, 0.5);
    const side = W / H > 1.25;
    const legendRow = side ? Math.min(80 * u, (H - top - pad) / segs.length) : Math.min(76 * u, (H - top - pad) * 0.42 / segs.length);
    const R = side ? Math.min((H - top - pad) * 0.42, W * 0.2) : Math.max(60 * u, Math.min(W * 0.32, (H - top - pad - legendRow * segs.length - 110 * u) / 2.6));
    const cx = side ? W * 0.36 : W / 2, cy = side ? top + (H - top - pad) / 2 : top + R * 1.3 + 20 * u;
    const colors = segs.map((_, i) => (i === 0 ? c.accent : rgba(c.fg, [0.55, 0.32, 0.2, 0.12][i - 1] ?? 0.1)));
    const thick = R * 0.3, gap = 0.025;
    let a = -Math.PI / 2;
    ctx.save();
    ctx.lineWidth = thick;
    ctx.strokeStyle = rgba(c.fg, 0.06);
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    segs.forEach((s, i) => {
      const sweep = (Math.max(0, s.value) / total) * Math.PI * 2;
      const p = ease.inOutCubic(win(g.t, cues[i], 0.8 * g.sp));
      if (p > 0) {
        ctx.strokeStyle = colors[i];
        ctx.lineWidth = thick * (i === 0 ? 1.12 : 1);
        ctx.beginPath();
        ctx.arc(cx, cy, R, a + gap, a + gap + Math.max(0, sweep - gap * 2) * p);
        ctx.stroke();
      }
      a += sweep;
    });
    ctx.restore();
    const lead = segs[0];
    const lp = ease.outCubic(win(g.t, cues[0], 1.2 * g.sp));
    const pct = lead.suffix.startsWith("%") ? lead.value : (lead.value / total) * 100;
    const txt = `${Math.round(pct * lp)}%`;
    drawLabel(ctx, txt, F(g, Math.min(R * 0.5, ((R * 1.1) / Math.max(1, measure(ctx, "100%", F(g, 100)))) * 100)), cx, cy - 8 * u, "center", c.fg, win(g.t, cues[0], 0.4));
    drawLabel(ctx, lead.label, B(g, 24 * u, 500), cx, cy + R * 0.3, "center", rgba(c.fg, 0.6), win(g.t, cues[0] + 0.2, 0.4), R * 1.2);
    // legend
    segs.forEach((s, i) => {
      const lp2 = ease.outCubic(win(g.t, cues[i] + 0.1, 0.5));
      const x = side ? cx + R + thick + 90 * u : pad + 40 * u;
      const y = side ? cy - ((segs.length - 1) * legendRow) / 2 + i * legendRow : cy + R + thick + 50 * u + i * legendRow;
      ctx.save();
      ctx.globalAlpha *= lp2;
      ctx.fillStyle = colors[i];
      ctx.beginPath();
      ctx.roundRect(x + (1 - lp2) * 20 * u, y - 10 * u, 20 * u, 20 * u, 6 * u);
      ctx.fill();
      ctx.restore();
      drawLabel(ctx, s.label, B(g, (g.portrait ? 34 : 36) * u, 600), x + 40 * u + (1 - lp2) * 20 * u, y, "left", c.fg, lp2, (side ? W - pad : W - pad - 40 * u) - (x + 40 * u) - 130 * u);
      const val = s.suffix.startsWith("%") || !s.suffix ? `${Math.round(s.suffix.startsWith("%") ? s.value : (s.value / total) * 100)}%` : fmt(s.value, s.decimals, s.prefix, s.suffix);
      drawLabel(ctx, val, F(g, (g.portrait ? 34 : 38) * u), side ? W - pad : W - pad - 40 * u, y, "right", i === 0 ? c.accent : rgba(c.fg, 0.7), lp2, 120 * u);
      g.hit?.({ field: `items.${i}`, x: x + 40 * u, y: y - 22 * u, w: 300 * u, h: 44 * u, size: 30 * u, align: "left", lines: 1 });
    });
  },

  /** Two to four numbers in quiet tiles, each counting up as it's said, an icon above. */
  "kpi-grid"(g) {
    const { ctx, W, H, u, c, scene, pad } = g;
    const ks = rows(g, ["Users | 120k", "Countries | 40", "Rating | 4.9", "Uptime | 99.9%"], 4);
    const top = header(g, "center");
    const n = ks.length;
    const colsN = g.portrait ? (n > 2 ? 2 : 1) : n === 4 ? 2 : n;
    const rowsN = Math.ceil(n / colsN);
    const gapX = 28 * u, gapY = 28 * u;
    const areaH = H - top - pad;
    const tw = (W - pad * 2 - gapX * (colsN - 1)) / colsN;
    const th = Math.min((areaH - gapY * (rowsN - 1)) / rowsN, tw * (g.portrait ? 1.1 : 0.7));
    const y0 = top + (areaH - (th * rowsN + gapY * (rowsN - 1))) / 2;
    const cues = staged(g, ks.map((k) => k.label), 0.3, 0.55);
    ks.forEach((k, i) => {
      const x = pad + (i % colsN) * (tw + gapX), y = y0 + Math.floor(i / colsN) * (th + gapY);
      const p = ease.outCubic(win(g.t, cues[i], 0.7 * g.sp));
      if (p <= 0) return;
      ctx.save();
      ctx.globalAlpha *= p;
      ctx.translate(0, (1 - p) * 30 * u);
      ctx.fillStyle = rgba(c.fg, 0.04);
      ctx.strokeStyle = rgba(c.fg, 0.12);
      ctx.lineWidth = 1.5 * u;
      ctx.beginPath();
      ctx.roundRect(x, y, tw, th, 22 * u);
      ctx.fill();
      ctx.stroke();
      // accent tick drawing along the top edge
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 4 * u;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x + 30 * u, y);
      ctx.lineTo(x + 30 * u + (tw * 0.3) * ease.inOutCubic(win(g.t, cues[i] + 0.1, 0.8)), y);
      ctx.stroke();
      const icon = scene.icons?.[i];
      const isz = Math.min(th * 0.22, 56 * u);
      if (icon) drawIcon(ctx, g.icon(icon), x + 30 * u + isz / 2, y + 34 * u + isz / 2, isz, win(g.t, cues[i], 0.8), c.accent, weightFor(g, isz) * 0.8);
      const v = k.value * ease.outCubic(win(g.t, cues[i], 1.3 * g.sp));
      const txt = fmt(v, k.decimals, k.prefix, k.suffix);
      const size = Math.min(th * 0.34, ((tw - 60 * u) / Math.max(1, measure(ctx, fmt(k.value, k.decimals, k.prefix, k.suffix), F(g, 100)))) * 100);
      drawLabel(ctx, txt, F(g, size), x + 30 * u, y + th * 0.6, "left", c.fg, 1, tw - 60 * u);
      drawLabel(ctx, k.label, B(g, Math.min(28 * u, th * 0.12), 500), x + 30 * u, y + th - 34 * u, "left", rgba(c.fg, 0.6), 1, tw - 60 * u);
      ctx.restore();
      g.hit?.({ field: `items.${i}`, x, y, w: tw, h: th, size: 28 * u, align: "left", lines: 1 });
    });
  },

  /** A dotted world: the view glides to the places named, pins drop as they're said, arcs fly from the first. */
  "world-map"(g) {
    const { ctx, W, H, u, c, scene, pad } = g;
    const names = (scene.items?.length ? scene.items : []).slice(0, 6).map((x) => splitItem(x).label);
    const places = names.map((n) => ({ name: n, at: placeAt(n) })).filter((p): p is { name: string; at: [number, number] } => !!p.at);
    const top = header(g, "center", 0.4);
    const box = { x: pad * 0.5, y: top, w: W - pad, h: H - top - pad * 0.6 };
    // the camera: the whole world, gliding in to frame the places
    const target = places.length ? boundsFor(places.map((p) => p.at), places.length === 1 ? 120 : 40) : WHOLE;
    const zoom = ease.inOutCubic(win(g.t, 0.1, Math.min(2.2, g.dur * 0.45)));
    const P = frame(box, mixB(WHOLE, target, zoom));
    // dots
    const cell = WORLD.step * P.s;
    const r = Math.max(1.2 * u, Math.min(cell * 0.3, 7 * u));
    const reveal = win(g.t, 0, 0.9);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, box.y - 10 * u, W, box.h + 20 * u);
    ctx.clip();
    const c0 = Math.max(0, Math.floor((P.lon0 + 180) / WORLD.step) - 1), c1 = Math.min(WORLD.cols - 1, Math.ceil((P.lon1 + 180) / WORLD.step) + 1);
    const r0 = Math.max(0, Math.floor((WORLD.lat0 - P.lat0) / WORLD.step) - 1), r1 = Math.min(WORLD.rows - 1, Math.ceil((WORLD.lat0 - P.lat1) / WORLD.step) + 1);
    // Dots are batched into a few paths by opacity (one fill per bucket, not per dot); small dots are squares.
    const BUCKETS = 8;
    const paths = Array.from({ length: BUCKETS + 1 }, () => new Path2D());
    const square = r < 2.2 * u;
    const dot = (path: Path2D, x: number, y: number) => {
      if (square) path.rect(x - r, y - r, r * 2, r * 2);
      else {
        path.moveTo(x + r, y);
        path.arc(x, y, r, 0, Math.PI * 2);
      }
    };
    for (let row = r0; row <= r1; row++) {
      const y = P.y(WORLD.lat0 - (row + 0.5) * WORLD.step);
      for (let col = c0; col <= c1; col++) {
        if (!landAt(col, row)) continue;
        const x = P.x(-180 + (col + 0.5) * WORLD.step);
        if (x < -r || x > W + r) continue;
        // a left-to-right sweep reveals the land, with a little shimmer
        const k = clamp((reveal * 1.4 - (x / W) * 0.4 - hash(col * 31 + row) * 0.2) / 0.6);
        if (k <= 0) continue;
        const a = (0.2 + 0.08 * hash(col + row * 7)) * k; // 0 … 0.28
        dot(paths[Math.min(BUCKETS, Math.round((a / 0.28) * BUCKETS))], x, y);
      }
      // wrap: Chukotka and friends past 180°
      if (P.lon1 > 180) for (let col = 0; col < Math.ceil((P.lon1 - 180) / WORLD.step); col++) {
        if (landAt(col, row)) dot(paths[Math.round(((0.22 * reveal) / 0.28) * BUCKETS)], P.x(180 + (col + 0.5) * WORLD.step), y);
      }
    }
    paths.forEach((path, i) => {
      if (!i) return;
      ctx.fillStyle = rgba(c.fg, (i / BUCKETS) * 0.28);
      ctx.fill(path);
    });
    ctx.restore();
    if (!places.length) return;
    const cues = staged(g, places.map((p) => p.name), 0.5, 0.55);
    const xy = (p: [number, number]) => ({ x: P.x(p[0]), y: P.y(p[1]) });
    const hub = xy(places[0].at);
    // arcs from the first place
    places.slice(1).forEach((pl, j) => {
      const i = j + 1;
      const to = xy(pl.at);
      const p = ease.inOutCubic(win(g.t, cues[i] - 0.1, 0.9 * g.sp));
      if (p <= 0) return;
      const mx = (hub.x + to.x) / 2, my = (hub.y + to.y) / 2 - Math.hypot(to.x - hub.x, to.y - hub.y) * 0.32;
      const bez = (t: number) => ({ x: (1 - t) ** 2 * hub.x + 2 * (1 - t) * t * mx + t * t * to.x, y: (1 - t) ** 2 * hub.y + 2 * (1 - t) * t * my + t * t * to.y });
      ctx.save();
      ctx.strokeStyle = rgba(c.accent, 0.85);
      ctx.lineWidth = 3 * u;
      ctx.lineCap = "round";
      ctx.setLineDash([1, 9 * u]);
      ctx.beginPath();
      const steps = 40;
      for (let s = 0; s <= steps * p; s++) {
        const q = bez(s / steps);
        if (s === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      // a plane-dot travelling the arc, then looping
      const loop = p < 1 ? p : Math.max(0, ((g.t - cues[i]) * 0.35) % 1);
      const q = bez(loop);
      ctx.fillStyle = c.accent;
      ctx.beginPath();
      ctx.arc(q.x, q.y, 6 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
    // pins and labels
    places.forEach((pl, i) => {
      const { x, y } = xy(pl.at);
      if (g.t <= cues[i]) return;
      const p = ease.outBack(clamp(win(g.t, cues[i], 0.5)));
      const ph = Math.max(0, ((g.t - cues[i]) * 0.8) % 1);
      ctx.save();
      ctx.strokeStyle = rgba(c.accent, 0.6 * (1 - ph));
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.arc(x, y, (12 + 40 * ph) * u, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = c.accent;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0, 10 * u * p), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c.bg;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0, 4 * u * p), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      const below = y < box.y + 90 * u;
      const lx = clamp(x, pad + 80 * u, W - pad - 80 * u);
      const f = B(g, (g.portrait ? 30 : 26) * u, 650);
      const maxW = Math.min(W * 0.42, 420 * u);
      const w = Math.min(maxW, measure(ctx, pl.name, f)) + 30 * u, h = 48 * u;
      const ly = below ? y + 50 * u : y - 50 * u;
      const la = clamp(win(g.t, cues[i] + 0.15, 0.4));
      ctx.save();
      ctx.globalAlpha *= la;
      ctx.fillStyle = rgba(c.bg, 0.85);
      ctx.strokeStyle = rgba(c.fg, 0.15);
      ctx.lineWidth = 1.5 * u;
      ctx.beginPath();
      ctx.roundRect(lx - w / 2, ly - h / 2, w, h, h / 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      drawLabel(ctx, pl.name, f, lx, ly + 1 * u, "center", c.fg, la, maxW);
      g.hit?.({ field: `items.${i}`, x: lx - w / 2, y: ly - h / 2, w, h, size: 26 * u, align: "center", lines: 1 });
    });
  },

  /** A quiet street grid; the route draws from A to B, a courier rides it, the arrival time counts down. */
  "route-map"(g) {
    const { ctx, W, H, u, c, scene, pad } = g;
    const [from, to] = [...(scene.items ?? []), "Pickup", "Your door"].map((x) => splitItem(x).label);
    const seed = [...(scene.headline ?? "route")].reduce((a, ch) => a + ch.charCodeAt(0), 0);
    const rnd = (i: number) => hash(seed + i * 13.7);
    const top = header(g, "left", 0.4);
    const box = { x: 0, y: top - 10 * u, w: W, h: H - top + 10 * u };
    // the city: a slightly rotated grid, a few avenues, a park, a river
    const ang = -0.18 + rnd(1) * 0.1;
    const cxm = W / 2, cym = box.y + box.h / 2;
    const step = Math.min(W, box.h) / (g.portrait ? 6 : 7);
    const N = 9;
    const P = (gx: number, gy: number) => {
      const x = gx * step, y = gy * step;
      return { x: cxm + x * Math.cos(ang) - y * Math.sin(ang), y: cym + x * Math.sin(ang) + y * Math.cos(ang) };
    };
    const lineIn = ease.outCubic(win(g.t, 0, 0.9));
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    // park block
    const pk = { gx: -2 + Math.floor(rnd(2) * 2), gy: -2 + Math.floor(rnd(3) * 2) };
    ctx.fillStyle = rgba(c.accent, 0.07 * lineIn);
    ctx.beginPath();
    const a1 = P(pk.gx + 0.12, pk.gy + 0.12), a2 = P(pk.gx + 1.88, pk.gy + 0.12), a3 = P(pk.gx + 1.88, pk.gy + 0.88), a4 = P(pk.gx + 0.12, pk.gy + 0.88);
    ctx.moveTo(a1.x, a1.y); ctx.lineTo(a2.x, a2.y); ctx.lineTo(a3.x, a3.y); ctx.lineTo(a4.x, a4.y); ctx.closePath();
    ctx.fill();
    // river
    ctx.strokeStyle = rgba(c.fg, 0.06 * lineIn);
    ctx.lineWidth = step * 0.45;
    ctx.beginPath();
    for (let s = -N; s <= N; s += 0.25) {
      const q = P(s, N * 0.55 + Math.sin(s * 0.7 + seed) * 0.8);
      if (s === -N) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
    // streets
    for (let i = -N; i <= N; i++) {
      const avenue = i % 3 === 0;
      ctx.strokeStyle = rgba(c.fg, avenue ? 0.16 : 0.08);
      ctx.lineWidth = (avenue ? 5 : 2.5) * u;
      for (const vertical of [true, false]) {
        const a = vertical ? P(i, -N) : P(-N, i), b = vertical ? P(i, N) : P(N, i);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(lerp(a.x, b.x, lineIn), lerp(a.y, b.y, lineIn));
        ctx.stroke();
      }
    }
    ctx.restore();
    // the route: an L-and-jog along the grid
    // portrait frames are narrow and tall: the route runs more up than across
    const sx = g.portrait ? -1 - Math.floor(rnd(4) * 1.2) : -2 - Math.floor(rnd(4) * 1.5), sy = g.portrait ? 2 + Math.floor(rnd(5) * 1.5) : 1 + Math.floor(rnd(5) * 1.5);
    const ex = g.portrait ? 1 + Math.floor(rnd(6) * 1.2) : 2 + Math.floor(rnd(6) * 1.5), ey = g.portrait ? -3 + Math.floor(rnd(7) * 1.2) : -2 + Math.floor(rnd(7) * 1.2);
    const midX = Math.round((sx + ex) / 2);
    const route = [P(sx, sy), P(midX, sy), P(midX, ey + 1), P(ex, ey + 1), P(ex, ey)];
    const segL = route.slice(1).map((q, i) => Math.hypot(q.x - route[i].x, q.y - route[i].y));
    const total = segL.reduce((a, b) => a + b, 0);
    const t0 = Math.min(cue(g, from, 0.5), g.dur * 0.3), t1 = Math.max(t0 + 1, Math.min(cue(g, to, g.dur * 0.7), g.dur * 0.8));
    const p = ease.inOutCubic(win(g.t, t0, t1 - t0));
    const at = (k: number) => {
      let d = k * total;
      for (let i = 0; i < segL.length; i++) {
        if (d <= segL[i] || i === segL.length - 1) {
          const f = clamp(d / Math.max(1e-6, segL[i]));
          return { x: lerp(route[i].x, route[i + 1].x, f), y: lerp(route[i].y, route[i + 1].y, f), i };
        }
        d -= segL[i];
      }
      return { ...route[route.length - 1], i: segL.length - 1 };
    };
    const head = at(p);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // the planned route, faint and dashed; the travelled part in the accent
    ctx.strokeStyle = rgba(c.accent, 0.3 * win(g.t, t0 - 0.4, 0.4));
    ctx.lineWidth = 4 * u;
    ctx.setLineDash([2 * u, 12 * u]);
    ctx.beginPath();
    route.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 9 * u;
    ctx.beginPath();
    ctx.moveTo(route[0].x, route[0].y);
    for (let i = 1; i <= head.i; i++) ctx.lineTo(route[i].x, route[i].y);
    ctx.lineTo(head.x, head.y);
    if (p > 0) ctx.stroke();
    ctx.restore();
    // pins
    const pin = (q: { x: number; y: number }, label: string, filled: boolean, a: number, field: string) => {
      if (a <= 0) return;
      const s = ease.outBack(clamp(a));
      ctx.save();
      ctx.fillStyle = filled ? c.accent : c.bg;
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 4 * u;
      ctx.beginPath();
      ctx.arc(q.x, q.y, Math.max(0, 16 * u * s), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      const f = B(g, (g.portrait ? 30 : 26) * u, 650);
      const maxW = W * 0.5;
      const w = Math.min(maxW, measure(ctx, label, f)) + 32 * u, h = 50 * u;
      const lx = clamp(q.x, pad + w / 2, W - pad - w / 2), ly = q.y - 56 * u;
      ctx.save();
      ctx.globalAlpha *= clamp(a);
      ctx.fillStyle = c.fg;
      ctx.beginPath();
      ctx.roundRect(lx - w / 2, ly - h / 2, w, h, 12 * u);
      ctx.fill();
      ctx.restore();
      drawLabel(ctx, label, f, lx, ly + 1 * u, "center", c.bg, a, maxW);
      g.hit?.({ field, x: lx - w / 2, y: ly - h / 2, w, h, size: 26 * u, align: "center", lines: 1 });
    };
    pin(route[0], from, false, win(g.t, Math.max(0, t0 - 0.5), 0.5), "items.0");
    const end = route[route.length - 1];
    if (p >= 1) {
      const ph = Math.max(0, ((g.t - t1) * 0.9) % 1);
      ctx.strokeStyle = rgba(c.accent, 0.7 * (1 - ph));
      ctx.lineWidth = 3 * u;
      ctx.beginPath();
      ctx.arc(end.x, end.y, (20 + 50 * ph) * u, 0, Math.PI * 2);
      ctx.stroke();
    }
    pin(end, to, true, win(g.t, Math.max(0, t0 - 0.2), 0.5), "items.1");
    // the courier
    if (p > 0 && p < 1) {
      const R = 30 * u;
      ctx.save();
      ctx.shadowColor = rgba("#000000", 0.25);
      ctx.shadowBlur = 20 * u;
      ctx.fillStyle = c.accent;
      ctx.beginPath();
      ctx.arc(head.x, head.y, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      const ink = mix(c.accent, "#000000", 0.8);
      const ic = g.icon(scene.icons?.[0]);
      if (ic) drawIcon(ctx, ic, head.x, head.y, R * 1.15, 1, ink, weightFor(g, R * 1.15));
      else {
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.arc(head.x, head.y, R * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // the arrival card: the time counts down as the courier rides
    const st = scene.stat;
    if (st) {
      const cardIn = ease.outCubic(win(g.t, t0, 0.6));
      const cw = Math.min(W - pad * 2, 520 * u), ch = 130 * u;
      const x = g.portrait ? (W - cw) / 2 : W - pad - cw, y = H - pad - ch + (1 - cardIn) * 40 * u;
      ctx.save();
      ctx.globalAlpha *= cardIn;
      ctx.fillStyle = rgba(c.bg, 0.92);
      ctx.strokeStyle = rgba(c.fg, 0.14);
      ctx.lineWidth = 1.5 * u;
      ctx.shadowColor = rgba("#000000", 0.18);
      ctx.shadowBlur = 30 * u;
      ctx.beginPath();
      ctx.roundRect(x, y, cw, ch, 24 * u);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.stroke();
      ctx.restore();
      const left = p >= 1 ? 0 : st.value * (1 - p);
      const arrived = p >= 1;
      drawLabel(ctx, (arrived ? "ARRIVED" : st.label || "ARRIVING IN").toUpperCase(), K(g, 18 * u), x + 32 * u, y + 40 * u, "left", rgba(c.fg, 0.55), cardIn, cw - 64 * u);
      drawLabel(ctx, arrived ? "Right on time" : fmt(Math.ceil(left), 0, st.prefix ?? "", st.suffix ?? " min"), F(g, 50 * u), x + 32 * u, y + 88 * u, "left", arrived ? c.accent : c.fg, cardIn, cw - 64 * u);
      // progress bar along the bottom of the card
      ctx.fillStyle = rgba(c.fg, 0.1 * cardIn);
      ctx.fillRect(x + 32 * u, y + ch - 14 * u, cw - 64 * u, 4 * u);
      ctx.fillStyle = c.accent;
      ctx.globalAlpha = cardIn;
      ctx.fillRect(x + 32 * u, y + ch - 14 * u, (cw - 64 * u) * p, 4 * u);
      ctx.globalAlpha = 1;
      g.hit?.({ field: "stat.value", x, y, w: cw, h: ch, size: 50 * u, align: "left", lines: 1 });
    }
  },
};
