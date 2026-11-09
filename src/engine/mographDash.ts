// Dashboards as motion graphics: a product UI that assembles itself (frame, sidebar, KPI cards,
// chart, donut, activity), a guided tour where the camera flies to each widget as it's named, and a
// live panel whose feed fills as events are said. Shapes without numbers are illustrative UI; the
// only figures shown are the ones in the scene (items "label | value | delta", stat).
import type { G, Tpl } from "./render";
import { F, B, K, headlineSize } from "./render";
import { clamp, ease, lerp, win, rgba, mix, hash } from "./util";
import { drawLabel, measure, layoutText, drawLayout } from "./text";
import { drawIcon, cue, staged, weightFor } from "./mograph";

type Rect = { x: number; y: number; w: number; h: number };
interface Kpi { label: string; value?: string; delta?: string }

const kpisOf = (g: G, fallback: string[]): Kpi[] =>
  (g.scene.items?.length ? g.scene.items : fallback).slice(0, 4).map((it) => {
    const [label, value, delta] = it.split("|").map((x) => x.trim());
    return { label: label || "Metric", ...(value && { value }), ...(delta && { delta }) };
  });

/** "$48.2k" → animated to p: the number part counts, the rest stays. */
function counting(v: string, p: number) {
  const m = v.match(/^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/);
  if (!m) return v;
  const raw = m[2].replace(/,/g, "");
  const d = (raw.split(".")[1] ?? "").length;
  const n = parseFloat(raw) * p;
  const s = d ? n.toFixed(d) : Math.round(n).toLocaleString("en-US");
  return `${m[1]}${s}${m[3]}`;
}

const seeded = (g: G, salt: number) => (i: number) => hash((g.scene.headline?.length ?? 7) * 17 + salt * 131 + i * 7.3);
/** A smooth, gently rising illustrative series. */
const series = (rnd: (i: number) => number, n: number, rise = 0.55) => Array.from({ length: n }, (_, i) => clamp(0.18 + (i / (n - 1)) * rise + (rnd(i) - 0.5) * 0.22, 0.05, 0.98));

function card(g: G, r: Rect, a: number, lift = 0) {
  const { ctx, u, c } = g;
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha *= a;
  ctx.fillStyle = mix(c.bg, c.fg, 0.045);
  ctx.strokeStyle = rgba(c.fg, 0.09);
  ctx.lineWidth = 1.5 * u;
  ctx.beginPath();
  ctx.roundRect(r.x, r.y + (1 - a) * 18 * u - lift, r.w, r.h, 16 * u);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function spark(g: G, r: Rect, vals: number[], p: number, color: string, fill = true, width = 3) {
  const { ctx, u } = g;
  if (p <= 0) return;
  const n = vals.length;
  const X = (i: number) => r.x + (r.w * i) / (n - 1), Y = (v: number) => r.y + r.h - v * r.h;
  const upto = (n - 1) * p, k = Math.floor(upto), f = upto - k;
  const hx = lerp(X(k), X(Math.min(n - 1, k + 1)), f), hy = lerp(Y(vals[k]), Y(vals[Math.min(n - 1, k + 1)]), f);
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(X(0), Y(vals[0]));
    for (let i = 1; i <= k; i++) {
      const cx = (X(i - 1) + X(i)) / 2;
      ctx.bezierCurveTo(cx, Y(vals[i - 1]), cx, Y(vals[i]), X(i), Y(vals[i]));
    }
    ctx.lineTo(hx, hy);
  };
  ctx.save();
  if (fill) {
    const gr = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
    gr.addColorStop(0, rgba(color, 0.25));
    gr.addColorStop(1, rgba(color, 0));
    trace();
    ctx.lineTo(hx, r.y + r.h);
    ctx.lineTo(X(0), r.y + r.h);
    ctx.closePath();
    ctx.fillStyle = gr;
    ctx.fill();
  }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  ctx.lineWidth = width * u;
  trace();
  ctx.stroke();
  ctx.restore();
  return { x: hx, y: hy };
}

/** Where everything sits in a dashboard of `n` KPI cards inside R (pure: no drawing). */
function dashLayout(R: Rect, n: number) {
  const narrow = R.w / R.h < 1.05;
  const s = Math.min(R.w / 1600, R.h / 900) * (narrow ? 1.5 : 1); // UI scale
  const S = (v: number) => v * s;
  const barH = S(64), sideW = narrow ? 0 : S(84), P = S(28), gx = S(20);
  const C = { x: R.x + sideW + P, y: R.y + barH + P, w: R.w - sideW - P * 2, h: R.h - barH - P * 2 };
  const top = C.y + S(54);
  const kCols = narrow ? Math.min(2, n) : n, kRows = Math.ceil(n / kCols);
  const kh = S(narrow ? 150 : 132), kw = (C.w - gx * (kCols - 1)) / kCols;
  const kpiRect: Rect = { x: C.x, y: top, w: C.w, h: kh * kRows + gx * (kRows - 1) };
  const row2 = top + kpiRect.h + gx, rest = C.y + C.h - row2;
  const chartH = narrow ? rest * 0.5 : rest * 0.62;
  const chart: Rect = narrow ? { x: C.x, y: row2, w: C.w, h: chartH } : { x: C.x, y: row2, w: C.w * 0.66 - gx / 2, h: chartH };
  const side: Rect = narrow ? { x: C.x, y: row2 + chartH + gx, w: C.w * 0.45, h: rest - chartH - gx } : { x: chart.x + chart.w + gx, y: row2, w: C.w - chart.w - gx, h: chartH };
  const tableTop = narrow ? side.y : row2 + chartH + gx;
  const table: Rect = narrow ? { x: side.x + side.w + gx, y: side.y, w: C.w - side.w - gx, h: side.h } : { x: C.x, y: tableTop, w: C.w, h: C.y + C.h - tableTop };
  return { narrow, S, barH, sideW, gx, C, top, kCols, kh, kw, kpiRect, chart, side, table };
}

const DEFAULT_NAV = ["lucide:layout-grid", "lucide:chart-line", "lucide:users", "lucide:wallet", "lucide:bell"];

/**
 * The dashboard UI inside `R`, assembled along `t`: returns the widget rects (KPI row, chart,
 * side card, activity) so a camera can visit them.
 */
function dashboard(g: G, R: Rect, t: number, kpiCues: number[], kpis: Kpi[]): Rect[] {
  const { ctx, u, c, scene, brand } = g;
  const rnd = seeded(g, 1);
  const { narrow, S, barH, sideW, gx, C, top, kCols, kh, kw, kpiRect, chart, side, table } = dashLayout(R, kpis.length);
  // window
  const inA = ease.outCubic(win(t, 0, 0.6));
  ctx.save();
  ctx.globalAlpha *= inA;
  // a soft drop shadow from a few stacked translucent shapes (a blur this size costs ~10 ms a frame)
  for (let k = 4; k >= 1; k--) {
    ctx.fillStyle = rgba("#000000", 0.05);
    ctx.beginPath();
    ctx.roundRect(R.x - S(6 * k), R.y + S(10 + 4 * k) - S(6 * k), R.w + S(12 * k), R.h + S(12 * k), S(22 + 6 * k));
    ctx.fill();
  }
  ctx.fillStyle = mix(c.bg, c.fg, 0.02);
  ctx.beginPath();
  ctx.roundRect(R.x, R.y, R.w, R.h, S(22));
  ctx.fill();
  ctx.strokeStyle = rgba(c.fg, 0.1);
  ctx.lineWidth = 1.5 * u;
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(R.x, R.y, R.w, R.h, S(22));
  ctx.clip();
  // top bar
  ctx.globalAlpha = inA;
  ctx.fillStyle = rgba(c.fg, 0.03);
  ctx.fillRect(R.x, R.y, R.w, barH);
  ["#FF5F57", "#FEBC2E", "#28C840"].forEach((col, i) => {
    ctx.fillStyle = rgba(col, 0.85);
    ctx.beginPath();
    ctx.arc(R.x + S(30) + i * S(22), R.y + barH / 2, S(6.5), 0, Math.PI * 2);
    ctx.fill();
  });
  const name = (brand.name || "Dashboard").replace(/\*/g, "");
  drawLabel(ctx, name, B(g, S(22), 650), R.x + S(120), R.y + barH / 2, "left", c.fg, inA, R.w * 0.4);
  // search pill and avatar (wide windows only)
  const sw = R.w > S(900) ? Math.min(S(360), R.w * 0.3) : 0;
  if (sw) {
    ctx.fillStyle = rgba(c.fg, 0.05);
    ctx.beginPath();
    ctx.roundRect(R.x + R.w - sw - S(90), R.y + barH / 2 - S(17), sw, S(34), S(17));
    ctx.fill();
    drawLabel(ctx, "Search", B(g, S(17), 500), R.x + R.w - sw - S(64), R.y + barH / 2, "left", rgba(c.fg, 0.35), inA, sw - S(40));
  }
  ctx.fillStyle = c.accent;
  ctx.beginPath();
  ctx.arc(R.x + R.w - S(42), R.y + barH / 2, S(16), 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  // sidebar
  if (sideW) {
    const sa = ease.outCubic(win(t, 0.15, 0.5));
    ctx.fillStyle = rgba(c.fg, 0.025 * sa);
    ctx.fillRect(R.x, R.y + barH, sideW, R.h - barH);
    const nav = (scene.icons?.length ? scene.icons : DEFAULT_NAV).slice(0, 6);
    nav.forEach((ic, i) => {
      const y = R.y + barH + S(50) + i * S(70);
      const on = i === 0;
      if (on) {
        ctx.fillStyle = rgba(c.accent, 0.16 * sa);
        ctx.beginPath();
        ctx.roundRect(R.x + S(18), y - S(24), S(48), S(48), S(12));
        ctx.fill();
      }
      drawIcon(ctx, g.icon(ic), R.x + sideW / 2, y, S(28), win(t, 0.25 + i * 0.07, 0.6), on ? c.accent : rgba(c.fg, 0.5), Math.max(1.5 * u, S(2)));
    });
  }
  // content grid
  const title = scene.kicker || "Overview";
  drawLabel(ctx, title, F(g, S(34)), C.x, C.y + S(16), "left", c.fg, win(t, 0.2, 0.4), C.w);
  kpis.forEach((k, i) => {
    const r = { x: C.x + (i % kCols) * (kw + gx), y: top + Math.floor(i / kCols) * (kh + gx), w: kw, h: kh };
    const a = ease.outCubic(win(t, kpiCues[i], 0.5));
    card(g, r, a);
    if (a <= 0) return;
    const yy = r.y + (1 - a) * 18 * u;
    drawLabel(ctx, k.label, B(g, S(19), 550), r.x + S(22), yy + S(32), "left", rgba(c.fg, 0.6), a, r.w - S(44) - (k.delta ? S(90) : 0));
    if (k.value) {
      const cp = ease.outCubic(win(t, kpiCues[i] + 0.1, 1.1));
      const f = F(g, Math.min(S(46), ((r.w - S(44)) / Math.max(1, measure(ctx, k.value, F(g, 100)))) * 100));
      drawLabel(ctx, counting(k.value, cp), f, r.x + S(22), yy + r.h * 0.62, "left", c.fg, a, r.w - S(44));
    } else {
      // no figure given: a mini trend instead of a made-up number
      spark(g, { x: r.x + S(22), y: yy + S(58), w: r.w * 0.55, h: r.h - S(84) }, series(seeded(g, 10 + i), 8), ease.inOutCubic(win(t, kpiCues[i] + 0.1, 0.9)), c.accent, false, 2.5);
    }
    if (k.delta) {
      const up = !k.delta.trim().startsWith("-");
      const f = B(g, S(17), 700);
      const w = Math.min(S(90), measure(ctx, k.delta, f)) + S(20);
      ctx.save();
      ctx.globalAlpha *= win(t, kpiCues[i] + 0.6, 0.4);
      ctx.fillStyle = rgba(up ? c.accent : "#FF5F57", 0.16);
      ctx.beginPath();
      ctx.roundRect(r.x + r.w - w - S(18), yy + S(18), w, S(28), S(14));
      ctx.fill();
      ctx.restore();
      drawLabel(ctx, k.delta, f, r.x + r.w - w / 2 - S(18), yy + S(32), "center", up ? c.accent : "#FF5F57", win(t, kpiCues[i] + 0.6, 0.4), S(90));
    }
  });
  // main chart + side card
  const t0 = Math.max(...kpiCues.slice(0, 2), 0.4) + 0.2;
  card(g, chart, ease.outCubic(win(t, t0, 0.5)));
  const ca = win(t, t0, 0.5);
  if (ca > 0) {
    drawLabel(ctx, scene.stat?.label || "Performance", B(g, S(20), 650), chart.x + S(24), chart.y + S(34), "left", c.fg, ca, chart.w * (scene.stat ? 0.5 : 0.9));
    if (scene.stat) drawLabel(ctx, `${scene.stat.prefix ?? ""}${counting(String(scene.stat.value), ease.outCubic(win(t, t0 + 0.3, 1.2)))}${scene.stat.suffix ?? ""}`, F(g, S(40)), chart.x + chart.w - S(24), chart.y + S(40), "right", c.accent, ca, chart.w * 0.42);
    // gridlines
    ctx.strokeStyle = rgba(c.fg, 0.06);
    ctx.lineWidth = 1 * u;
    for (let k = 0; k < 4; k++) {
      const y = chart.y + S(80) + ((chart.h - S(110)) * k) / 3;
      ctx.beginPath();
      ctx.moveTo(chart.x + S(24), y);
      ctx.lineTo(chart.x + chart.w - S(24), y);
      ctx.stroke();
    }
    const plot = { x: chart.x + S(24), y: chart.y + S(80), w: chart.w - S(48), h: chart.h - S(110) };
    spark(g, plot, series(seeded(g, 3), 12, 0.35).map((v) => v * 0.7), ease.inOutCubic(win(t, t0 + 0.2, 1.3)), rgba(c.fg, 0.28), false, 2);
    const head = spark(g, plot, series(rnd, 12), ease.inOutCubic(win(t, t0 + 0.1, 1.3)), c.accent, true, 3.5);
    if (head && win(t, t0 + 0.1, 0.2) > 0) {
      ctx.fillStyle = c.accent;
      ctx.beginPath();
      ctx.arc(head.x, head.y, S(7), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // side: donut
  const s0 = t0 + 0.35;
  const sa = ease.outCubic(win(t, s0, 0.5));
  card(g, side, sa);
  if (sa > 0) {
    drawLabel(ctx, "Breakdown", B(g, S(20), 650), side.x + S(24), side.y + S(34), "left", c.fg, sa);
    const R0 = Math.min(side.w * 0.3, (side.h - S(80)) * 0.36);
    const cx = side.x + (narrow ? side.w / 2 : side.w / 2), cy = side.y + S(60) + (side.h - S(60)) / 2 - (narrow ? 0 : S(10));
    const parts = [0.52, 0.28, 0.2];
    let a0 = -Math.PI / 2;
    ctx.lineWidth = R0 * 0.32;
    parts.forEach((p, i) => {
      const sweep = p * Math.PI * 2 * ease.inOutCubic(win(t, s0 + 0.1 + i * 0.12, 0.8));
      ctx.strokeStyle = i === 0 ? c.accent : rgba(c.fg, [0, 0.35, 0.15][i]);
      ctx.beginPath();
      ctx.arc(cx, cy, R0, a0 + 0.04, a0 + Math.max(0.04, sweep - 0.04));
      ctx.stroke();
      a0 += p * Math.PI * 2;
    });
  }
  // activity rows
  const r0 = s0 + 0.25;
  card(g, table, ease.outCubic(win(t, r0, 0.5)));
  if (win(t, r0, 0.5) > 0) {
    const rows = Math.max(1, Math.min(4, Math.floor((table.h - S(30)) / S(52))));
    const rr = seeded(g, 5);
    for (let i = 0; i < rows; i++) {
      const a = ease.outCubic(win(t, r0 + 0.15 + i * 0.1, 0.4));
      const y = table.y + S(36) + i * ((table.h - S(48)) / rows) + (1 - a) * 10 * u;
      ctx.save();
      ctx.globalAlpha *= a;
      ctx.fillStyle = rgba(i === 0 ? c.accent : c.fg, i === 0 ? 0.9 : 0.18);
      ctx.beginPath();
      ctx.arc(table.x + S(36), y, S(12), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(c.fg, 0.16);
      ctx.beginPath();
      ctx.roundRect(table.x + S(62), y - S(6), (table.w * 0.28) * (0.5 + rr(i) * 0.5), S(12), S(6));
      ctx.fill();
      ctx.fillStyle = rgba(c.fg, 0.08);
      ctx.beginPath();
      ctx.roundRect(table.x + table.w * 0.5, y - S(5), table.w * 0.2 * (0.4 + rr(i + 9) * 0.6), S(10), S(5));
      ctx.fill();
      ctx.fillStyle = rgba(c.accent, 0.18);
      ctx.beginPath();
      ctx.roundRect(table.x + table.w - S(110), y - S(13), S(80), S(26), S(13));
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
  return [kpiRect, chart, side, table];
}

/** Headline at the top-left/centre; returns the y beneath. */
function head(g: G, align: "left" | "center", scale = 0.38) {
  const { ctx, W, u, c, scene, pad } = g;
  if (!scene.headline) return pad;
  const size = headlineSize(g, scale * (g.portrait ? 1 : 1.35));
  const L = layoutText(ctx, scene.headline, F(g, size), W - pad * 2, 2);
  drawLayout(ctx, L, { x: align === "center" ? W / 2 : pad, y: pad, align, color: c.fg, emColor: c.accent, t: g.t, delay: 0, dur: 0.7 * g.sp, mode: "mask", easing: g.E });
  g.hit?.({ field: "headline", x: pad, y: pad, w: W - pad * 2, h: L.height, size, align, lines: L.lines.length });
  return pad + L.height + 36 * u;
}

export const DASH_TEMPLATES: Record<string, Tpl> = {
  /** The product's dashboard assembling itself: window, sidebar, KPI cards as they're said, chart, breakdown, activity. */
  dashboard(g) {
    const { ctx, W, H, u, pad } = g;
    const kpis = kpisOf(g, ["Revenue", "Active users", "Conversion"]);
    const top = head(g, "center");
    const cues = staged(g, kpis.map((k) => k.label), 0.35, 0.45);
    // a slow push-in for life
    const push = 1 + 0.035 * ease.inOutCubic(win(g.t, 0, g.dur));
    const R = { x: pad * 0.7, y: top, w: W - pad * 1.4, h: H - top - pad * 0.7 };
    ctx.save();
    ctx.translate(W / 2, R.y + R.h / 2);
    ctx.scale(push, push);
    ctx.translate(-W / 2, -(R.y + R.h / 2));
    dashboard(g, R, g.t, cues, kpis);
    ctx.restore();
    g.hit?.({ field: "items", x: R.x, y: R.y, w: R.w, h: R.h * 0.3, size: 24 * u, align: "left", lines: kpis.length });
  },

  /** A guided tour: the whole dashboard, then the camera flies to each widget as its feature is said, the rest dimmed. */
  "dashboard-focus"(g) {
    const { ctx, W, H, u, c, scene, pad } = g;
    const feats = (scene.items?.length ? scene.items : ["Live revenue", "Trends at a glance", "Where it comes from", "Every order, tracked"]).slice(0, 4).map((x) => x.split("|")[0].trim());
    const kpis = kpisOf(g, ["Revenue", "Orders", "Customers"]).filter((k) => k.value || !scene.items?.length);
    const kp = kpis.length ? kpis : [{ label: "Revenue" }, { label: "Orders" }, { label: "Customers" }];
    const cues = staged(g, feats, Math.min(1.4, g.dur * 0.25), 0.62);
    const R = { x: pad * 0.6, y: pad * 0.6, w: W - pad * 1.2, h: H - pad * 1.2 };
    // the dashboard builds fast here; the tour is the point
    const tt = g.t * 1.6 + 0.2;
    // camera: which widget, and how far through the move
    let k = -1;
    for (let i = 0; i < cues.length; i++) if (g.t >= cues[i]) k = i;
    const L = dashLayout(R, kp.length);
    const rects = [L.kpiRect, L.chart, L.side, L.table];
    const targetOf = (i: number) => {
      if (i < 0) return { s: 1, x: W / 2, y: H / 2 };
      const r = rects[i % rects.length];
      const s = clamp(Math.min((W * 0.82) / r.w, (H * 0.62) / r.h), 1, 2.4);
      return { s, x: r.x + r.w / 2, y: r.y + r.h / 2 };
    };
    const from = targetOf(k - 1), to = targetOf(k);
    const m = k < 0 ? 1 : ease.inOutCubic(win(g.t, cues[k], 0.75 * g.sp));
    const cam = { s: lerp(from.s, to.s, m), x: lerp(from.x, to.x, m), y: lerp(from.y, to.y, m) };
    // keep the focused widget a little above centre so its label fits below
    const screenY = k < 0 ? H / 2 : H * 0.44;
    ctx.save();
    ctx.translate(W / 2, lerp(H / 2, screenY, k < 0 ? 0 : 1));
    ctx.scale(cam.s, cam.s);
    ctx.translate(-cam.x, -cam.y);
    dashboard(g, R, tt, kp.map((_, i) => 0.15 + i * 0.12), kp);
    // dim everything but the focus
    if (k >= 0) {
      const r = rects[k % rects.length];
      const d = ease.outCubic(win(g.t, cues[k], 0.5)) * 0.55;
      ctx.save();
      ctx.fillStyle = rgba(c.bg, d);
      ctx.beginPath();
      ctx.rect(-W, -H, W * 3, H * 3);
      ctx.roundRect(r.x - 10 * u, r.y - 10 * u, r.w + 20 * u, r.h + 20 * u, 22 * u);
      ctx.fill("evenodd");
      ctx.strokeStyle = rgba(c.accent, 0.9 * (d / 0.55));
      ctx.lineWidth = 3 * u / cam.s;
      ctx.beginPath();
      ctx.roundRect(r.x - 10 * u, r.y - 10 * u, r.w + 20 * u, r.h + 20 * u, 22 * u);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    // the feature's name, under the focus
    if (k >= 0) {
      const a = ease.outCubic(win(g.t, cues[k] + 0.25, 0.4));
      const text = feats[k];
      const f = F(g, (g.portrait ? 58 : 52) * u);
      const w = Math.min(W - pad * 2, measure(ctx, text, f) + 70 * u), h = 96 * u;
      const textW = w - 70 * u;
      const y = H - pad - h / 2 - (1 - a) * 20 * u;
      ctx.save();
      ctx.globalAlpha *= a;
      ctx.fillStyle = c.accent;
      ctx.beginPath();
      ctx.roundRect(W / 2 - w / 2, y - h / 2, w, h, h / 2);
      ctx.fill();
      ctx.restore();
      drawLabel(ctx, text, f, W / 2, y + 2 * u, "center", mix(c.accent, "#000000", 0.82), a, textW);
      drawLabel(ctx, String(k + 1).padStart(2, "0"), K(g, 18 * u), W / 2, y - h / 2 - 24 * u, "center", c.accent, a);
      g.hit?.({ field: `items.${k}`, x: W / 2 - w / 2, y: y - h / 2, w, h, size: 52 * u, align: "center", lines: 1 });
    } else if (scene.headline) {
      // before the tour: the headline over the whole dashboard
      const a = 1 - win(g.t, cues[0] - 0.3, 0.3);
      const size = headlineSize(g, 0.5 * (g.portrait ? 1 : 1.35));
      const L = layoutText(ctx, scene.headline, F(g, size), W - pad * 2, 2);
      ctx.save();
      ctx.globalAlpha *= a;
      ctx.fillStyle = rgba(c.bg, 0.72);
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha *= a;
      drawLayout(ctx, L, { x: W / 2, y: H / 2 - L.height / 2, align: "center", color: c.fg, emColor: c.accent, t: g.t, delay: 0.1, dur: 0.7 * g.sp, mode: "mask", easing: g.E });
      ctx.restore();
      g.hit?.({ field: "headline", x: pad, y: H / 2 - L.height / 2, w: W - pad * 2, h: L.height, size, align: "center", lines: L.lines.length });
    }
  },

  /** A live panel: the number counts up and holds, a stream scrolls, events land in the feed as they're said. */
  "live-metrics"(g) {
    const { ctx, W, H, u, c, scene, pad } = g;
    const events = (scene.items?.length ? scene.items : ["New order", "New sign-up", "Payment received"]).slice(0, 5).map((x) => {
      const [label, detail] = x.split("|").map((y) => y.trim());
      return { label, detail };
    });
    const top = head(g, "left", 0.4);
    const side = W / H > 1.2;
    const panel: Rect = side ? { x: pad, y: top, w: (W - pad * 2) * 0.58, h: H - top - pad } : { x: pad, y: top, w: W - pad * 2, h: (H - top - pad) * 0.48 };
    const feed: Rect = side ? { x: panel.x + panel.w + 28 * u, y: top, w: W - pad * 2 - panel.w - 28 * u, h: panel.h } : { x: pad, y: panel.y + panel.h + 28 * u, w: panel.w, h: H - pad - panel.y - panel.h - 28 * u };
    const a = ease.outCubic(win(g.t, 0.05, 0.5));
    card(g, panel, a);
    card(g, feed, ease.outCubic(win(g.t, 0.2, 0.5)));
    // LIVE pill
    const pulse = 0.5 + 0.5 * Math.sin(g.t * 5);
    ctx.fillStyle = rgba("#FF3B30", 0.12 * a);
    ctx.beginPath();
    ctx.roundRect(panel.x + 28 * u, panel.y + 26 * u, 104 * u, 40 * u, 20 * u);
    ctx.fill();
    ctx.fillStyle = rgba("#FF3B30", (0.6 + 0.4 * pulse) * a);
    ctx.beginPath();
    ctx.arc(panel.x + 52 * u, panel.y + 46 * u, 7 * u, 0, Math.PI * 2);
    ctx.fill();
    drawLabel(ctx, "LIVE", K(g, 18 * u), panel.x + 68 * u, panel.y + 47 * u, "left", "#FF3B30", a);
    const st = scene.stat;
    if (st) {
      const p = ease.outCubic(win(g.t, Math.min(cue(g, `${st.value}`, 0.3), g.dur * 0.4), 1.4 * g.sp));
      const txt = `${st.prefix ?? ""}${counting(String(st.value), p)}${st.suffix ? (st.suffix.length > 2 ? ` ${st.suffix}` : st.suffix) : ""}`;
      const size = Math.min(panel.h * 0.26, ((panel.w - 60 * u) / Math.max(1, measure(ctx, txt, F(g, 100)))) * 100);
      drawLabel(ctx, txt, F(g, size), panel.x + 28 * u, panel.y + 70 * u + size * 0.6, "left", c.fg, a, panel.w - 56 * u);
      if (st.label) drawLabel(ctx, st.label, B(g, 26 * u, 500), panel.x + 28 * u, panel.y + 70 * u + size * 1.25, "left", rgba(c.fg, 0.55), win(g.t, 0.6, 0.4), panel.w - 56 * u);
      g.hit?.({ field: "stat.value", x: panel.x, y: panel.y + 70 * u, w: panel.w, h: size, size, align: "left", lines: 1 });
    }
    // the stream: bars scrolling left, newest in the accent
    const area = { x: panel.x + 28 * u, y: panel.y + panel.h * (st ? 0.55 : 0.3), w: panel.w - 56 * u, h: panel.h * (st ? 0.38 : 0.6) };
    const bw = 14 * u, gap = 8 * u, nb = Math.floor(area.w / (bw + gap));
    const speed = 6; // bars per second
    const shift = (g.t * speed) % 1;
    const base = Math.floor(g.t * speed);
    const rnd = seeded(g, 9);
    for (let i = 0; i < nb + 1; i++) {
      const idx = base + i;
      const v = clamp(0.25 + 0.5 * rnd(idx) * (0.6 + 0.4 * Math.sin(idx * 0.3)) + 0.2 * (i / nb), 0.08, 1);
      const x = area.x + (i - shift) * (bw + gap);
      if (x < area.x - 1 || x > area.x + area.w - bw) continue;
      const grow = ease.outCubic(win(g.t, 0.2 + (i / nb) * 0.6, 0.4));
      const h = area.h * v * grow;
      ctx.fillStyle = i >= nb - 2 ? c.accent : rgba(c.fg, 0.12 + 0.14 * (i / nb));
      ctx.beginPath();
      ctx.roundRect(x, area.y + area.h - h, bw, h, 4 * u);
      ctx.fill();
    }
    // feed
    drawLabel(ctx, "Activity", B(g, 24 * u, 650), feed.x + 28 * u, feed.y + 44 * u, "left", c.fg, win(g.t, 0.3, 0.4));
    const cues = staged(g, events.map((e) => e.label), 0.6, 0.6);
    const rowH = Math.min(96 * u, (feed.h - 90 * u) / events.length);
    // newest on top: rows slide down as each new one lands
    const landed = cues.filter((x) => g.t >= x).length;
    // the older rows step down as the newest drops in
    const enter = landed ? ease.outCubic(win(g.t, cues[landed - 1], 0.45)) : 0;
    events.forEach((e, i) => {
      if (g.t < cues[i]) return;
      const age = landed - 1 - i; // 0 = newest
      const pos = age === 0 ? 0 : age - 1 + enter;
      const yy = feed.y + 80 * u + pos * rowH;
      if (yy + rowH > feed.y + feed.h) return;
      const ap = age === 0 ? enter : 1;
      const alpha = ap * (age === 0 ? 1 : Math.max(0.35, 0.8 - age * 0.12));
      const drop = (1 - ap) * 24 * u;
      if (age === 0) {
        ctx.save();
        ctx.globalAlpha *= ap;
        ctx.fillStyle = rgba(c.accent, 0.1);
        ctx.beginPath();
        ctx.roundRect(feed.x + 16 * u, yy - drop, feed.w - 32 * u, rowH - 12 * u, 14 * u);
        ctx.fill();
        ctx.restore();
      }
      const cy = yy + (rowH - 12 * u) / 2 - drop;
      const ic = g.icon(scene.icons?.[i] ?? scene.icons?.[0]);
      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.fillStyle = age === 0 ? c.accent : rgba(c.fg, 0.1);
      ctx.beginPath();
      ctx.arc(feed.x + 54 * u, cy, 22 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (ic) drawIcon(ctx, ic, feed.x + 54 * u, cy, 24 * u, alpha, age === 0 ? mix(c.accent, "#000000", 0.8) : rgba(c.fg, 0.7), weightFor(g, 24 * u) * 0.9);
      drawLabel(ctx, e.label, B(g, 24 * u, 650), feed.x + 92 * u, cy - (e.detail ? 12 * u : 0), "left", c.fg, alpha, feed.w - 92 * u - 80 * u);
      if (e.detail) drawLabel(ctx, e.detail, B(g, 20 * u, 500), feed.x + 92 * u, cy + 16 * u, "left", rgba(c.fg, 0.55), alpha, feed.w - 92 * u - 80 * u);
      drawLabel(ctx, age === 0 ? "now" : `${Math.max(1, Math.round((g.t - cues[i])))}s`, B(g, 18 * u, 500), feed.x + feed.w - 28 * u, cy, "right", rgba(c.fg, 0.45), alpha);
      g.hit?.({ field: `items.${i}`, x: feed.x, y: cy - rowH / 2, w: feed.w, h: rowH, size: 24 * u, align: "left", lines: 1 });
    });
  },
};
