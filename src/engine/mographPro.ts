// Product-film motion graphics, built on the kit: a kinetic hero line, a giant gradient number,
// a bento grid, a shuffling card stack, a cursor that types and clicks, a phone with callouts,
// an integrations hub with light running down its wires, and a checklist ticking itself off.
import type { G, Tpl } from "./render";
import { F, B, K } from "./render";
import { clamp, ease, lerp, win, rgba, mix, hash } from "./util";
import { drawLabel, measure, layoutText, drawLayout, stripMarks } from "./text";
import { cue, staged } from "./mograph";
import { surface, tile, pill, gradText, wordsIn, proHeader, cursor, checkDot, spring, accent2, onAccent, isDark, type Rect } from "./kit";

const parts = (it: string) => {
  const [label, detail] = it.split("|").map((x) => x.trim());
  return { label: stripMarks(label ?? ""), detail: detail ? stripMarks(detail) : "" };
};
const itemsOf = (g: G, fallback: string[], max: number) => (g.scene.items?.length ? g.scene.items : fallback).slice(0, max).map(parts);
/** Index of the item being talked about now (-1 before the first). */
const activeAt = (t: number, cues: number[]) => {
  let k = -1;
  for (let i = 0; i < cues.length; i++) if (t >= cues[i]) k = i;
  return k;
};
/** A soft pool of accent light behind the subject. */
function glow(g: G, cx: number, cy: number, R: number, a = 0.2) {
  const { ctx, c, W, H } = g;
  if (a <= 0.002) return;
  const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  gr.addColorStop(0, rgba(c.accent, a));
  gr.addColorStop(0.6, rgba(accent2(g), a * 0.35));
  gr.addColorStop(1, rgba(c.accent, 0));
  ctx.fillStyle = gr;
  // only the part of the pool that's on screen
  const x0 = Math.max(0, cx - R), y0 = Math.max(0, cy - R);
  ctx.fillRect(x0, y0, Math.min(W, cx + R) - x0, Math.min(H, cy + R) - y0);
}

function bentoRects(n: number, a: Rect, portrait: boolean, gap: number): Rect[] {
  const cols = portrait ? 2 : 4, rows = portrait ? 4 : 2;
  const cw = (a.w - gap * (cols - 1)) / cols, rh = (a.h - gap * (rows - 1)) / rows;
  const cell = (cx: number, cy: number, cs: number, rs: number): Rect => ({ x: a.x + cx * (cw + gap), y: a.y + cy * (rh + gap), w: cw * cs + gap * (cs - 1), h: rh * rs + gap * (rs - 1) });
  const L: Record<number, number[][]> = portrait
    ? { 1: [[0, 0, 2, 4]], 2: [[0, 0, 2, 2], [0, 2, 2, 2]], 3: [[0, 0, 2, 2], [0, 2, 1, 2], [1, 2, 1, 2]], 4: [[0, 0, 2, 2], [0, 2, 1, 1], [1, 2, 1, 1], [0, 3, 2, 1]], 5: [[0, 0, 2, 2], [0, 2, 1, 1], [1, 2, 1, 1], [0, 3, 1, 1], [1, 3, 1, 1]] }
    : { 1: [[0, 0, 4, 2]], 2: [[0, 0, 2, 2], [2, 0, 2, 2]], 3: [[0, 0, 2, 2], [2, 0, 2, 1], [2, 1, 2, 1]], 4: [[0, 0, 2, 2], [2, 0, 1, 1], [3, 0, 1, 1], [2, 1, 2, 1]], 5: [[0, 0, 2, 2], [2, 0, 1, 1], [3, 0, 1, 1], [2, 1, 1, 1], [3, 1, 1, 1]] };
  return (L[clamp(n, 1, 5)] ?? L[5]).map(([x, y, w, h]) => cell(x, y, w, h));
}

/** Small set pieces that make a bento tile feel like product UI. */
function decor(g: G, kind: number, r: Rect, p: number) {
  const { ctx, u, c } = g;
  if (p <= 0) return;
  const a2 = accent2(g);
  ctx.save();
  ctx.globalAlpha *= clamp(p * 2);
  if (kind === 0) {
    // a rising line with its area
    const n = 9, vals = Array.from({ length: n }, (_, i) => 0.2 + 0.6 * (i / (n - 1)) ** 1.4 + 0.12 * Math.sin(i * 1.9));
    const q = ease.inOutCubic(clamp(p));
    const X = (i: number) => r.x + (r.w * i) / (n - 1), Y = (v: number) => r.y + r.h - v * r.h;
    const upto = (n - 1) * q, k = Math.floor(upto), f = upto - k;
    const hx = lerp(X(k), X(Math.min(n - 1, k + 1)), f), hy = lerp(Y(vals[k]), Y(vals[Math.min(n - 1, k + 1)]), f);
    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(X(0), Y(vals[0]));
      for (let i = 1; i <= k; i++) ctx.bezierCurveTo((X(i - 1) + X(i)) / 2, Y(vals[i - 1]), (X(i - 1) + X(i)) / 2, Y(vals[i]), X(i), Y(vals[i]));
      ctx.lineTo(hx, hy);
    };
    const gr = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
    gr.addColorStop(0, rgba(c.accent, 0.3));
    gr.addColorStop(1, rgba(c.accent, 0));
    trace();
    ctx.lineTo(hx, r.y + r.h);
    ctx.lineTo(X(0), r.y + r.h);
    ctx.fillStyle = gr;
    ctx.fill();
    const lg = ctx.createLinearGradient(r.x, 0, r.x + r.w, 0);
    lg.addColorStop(0, c.accent);
    lg.addColorStop(1, a2);
    ctx.strokeStyle = lg;
    ctx.lineWidth = 4 * u;
    ctx.lineCap = "round";
    trace();
    ctx.stroke();
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(hx, hy, 7 * u, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 1) {
    // a switch flipping on
    const w = Math.min(r.w, 96 * u), h = w * 0.54, x = r.x + r.w - w, y = r.y;
    const on = ease.inOutCubic(clamp((p - 0.3) / 0.5));
    ctx.fillStyle = mix(mix(c.bg, c.fg, 0.2), c.accent, on);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(x + h / 2 + (w - h) * on, y + h / 2, h * 0.38, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 2) {
    // a row of faces
    const d = Math.min(56 * u, r.h), n = 4;
    for (let i = 0; i < n; i++) {
      const q = spring(clamp((p - i * 0.12) * 1.6));
      if (q <= 0) continue;
      const x = r.x + r.w - d / 2 - i * d * 0.68;
      ctx.fillStyle = i === 0 ? c.accent : mix(c.accent, i % 2 ? a2 : c.fg, 0.35 + i * 0.12);
      ctx.strokeStyle = isDark(g) ? mix(c.bg, c.fg, 0.08) : "#FFFFFF";
      ctx.lineWidth = 4 * u;
      ctx.beginPath();
      ctx.arc(x, r.y + d / 2, (d / 2) * q, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } else if (kind === 3) {
    // a bar filling
    const h = 14 * u, y = r.y + r.h - h;
    ctx.fillStyle = rgba(c.fg, 0.1);
    ctx.beginPath();
    ctx.roundRect(r.x, y, r.w, h, h / 2);
    ctx.fill();
    const gr = ctx.createLinearGradient(r.x, 0, r.x + r.w, 0);
    gr.addColorStop(0, c.accent);
    gr.addColorStop(1, a2);
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.roundRect(r.x, y, Math.max(h, r.w * 0.86 * ease.inOutCubic(clamp(p))), h, h / 2);
    ctx.fill();
  } else {
    checkDot(g, r.x + r.w - 28 * u, r.y + 28 * u, 28 * u, clamp(p));
  }
  ctx.restore();
}

export const PRO_TEMPLATES: Record<string, Tpl> = {
  /** The hook: words resolve out of blur on a spring, the accent word in a gradient, icon tiles drifting around. */
  "hero-type"(g) {
    const { ctx, W, H, u, c, scene, pad } = g;
    const cy = H * 0.5 - (scene.subline ? 26 * u : 0);
    glow(g, W / 2, cy, Math.max(W, H) * 0.55, 0.16 * ease.outCubic(win(g.t, 0, 1)));
    const size = g.portrait ? W * 0.135 : H * 0.185;
    const { L, y } = wordsIn(g, scene.headline || "Say it *boldly*", F(g, size), W / 2, cy, "center", W - pad * 2.2, { maxLines: g.portrait ? 4 : 3, maxH: H * 0.5, t0: 0.15, per: 0.1 });
    g.hit?.({ field: "headline", x: W / 2 - L.width / 2, y, w: L.width, h: L.height, size: L.font.size, align: "center", lines: L.lines.length });
    if (scene.kicker) {
      const kw = pill(g, stripMarks(scene.kicker), W / 2, y - 54 * u, { tone: "soft", dot: true, size: 22, a: win(g.t, 0, 0.5) });
      g.hit?.({ field: "kicker", x: W / 2 - kw / 2, y: y - 76 * u, w: kw, h: 44 * u, size: 22 * u, align: "center", lines: 1 });
    }
    // the underline draws itself
    const up = ease.inOutCubic(win(g.t, 0.55, 0.8 * g.sp));
    if (up > 0) {
      const w = Math.min(L.width * 0.4, 260 * u) * up, by = y + L.height + 22 * u;
      const gr = ctx.createLinearGradient(W / 2 - w / 2, 0, W / 2 + w / 2, 0);
      gr.addColorStop(0, c.accent);
      gr.addColorStop(1, accent2(g));
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.roundRect(W / 2 - w / 2, by, w, 7 * u, 3.5 * u);
      ctx.fill();
    }
    if (scene.subline) {
      const sy = y + L.height + 84 * u;
      drawLabel(ctx, stripMarks(scene.subline), B(g, 34 * u, 500), W / 2, sy, "center", rgba(c.fg, 0.7), win(g.t, 0.8, 0.5), W - pad * 2);
      g.hit?.({ field: "subline", x: pad, y: sy - 24 * u, w: W - pad * 2, h: 48 * u, size: 34 * u, align: "center", lines: 1 });
    }
    // icon tiles drift at the corners, clear of the words
    const spots = g.portrait ? [[-0.3, -0.36], [0.3, -0.33], [-0.28, 0.34], [0.3, 0.37]] : [[-0.39, -0.3], [0.39, -0.27], [-0.36, 0.3], [0.38, 0.31]];
    (scene.icons ?? []).slice(0, 4).forEach((name, i) => {
      const [fx, fy] = spots[i];
      const p = win(g.t, 0.45 + i * 0.14, 0.8);
      const s = (g.portrait ? 120 : 112) * u * (i % 2 ? 0.82 : 1);
      // never over the words
      const tx0 = W / 2 + fx * W, ty0 = H / 2 + fy * H, mg = s * 0.75;
      if (Math.abs(tx0 - W / 2) < L.width / 2 + mg && ty0 > y - mg - (scene.kicker ? 80 * u : 0) && ty0 < y + L.height + mg + (scene.subline ? 110 * u : 0)) return;
      tile(g, W / 2 + fx * W + Math.sin(g.t * 0.8 + i * 2) * 10 * u, H / 2 + fy * H + Math.cos(g.t * 0.9 + i * 1.3) * 12 * u, s, g.icon(name), p, { quiet: i % 2 === 1, alpha: 0.95 });
    });
  },

  /** One giant number in a gradient, counting up on a spring over a climbing line; the label and a change pill beneath. */
  "stat-hero"(g) {
    const { ctx, W, H, u, c, scene, pad } = g;
    const st = scene.stat ?? { value: 87, suffix: "%", label: "of customers feel the difference" };
    const top = scene.headline || scene.kicker ? proHeader(g) : pad;
    const cy = top + (H - top - pad) * 0.42;
    const t0 = Math.min(cue(g, `${st.value} ${st.label ?? ""}`, 0.25), g.dur * 0.4);
    const p = win(g.t, t0, 1.5 * g.sp);
    // the climbing line behind
    const lp = ease.inOutCubic(win(g.t, Math.max(0, t0 - 0.2), 1.6 * g.sp));
    if (lp > 0) {
      const n = 24, x0 = -20 * u, x1 = W + 20 * u, base = H * 0.92, amp = H * 0.5;
      const Y = (i: number) => base - amp * ((i / (n - 1)) ** 1.8 * 0.9 + 0.05 * Math.sin(i * 0.9));
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W * lp, H);
      ctx.clip();
      ctx.beginPath();
      ctx.moveTo(x0, Y(0));
      for (let i = 1; i < n; i++) ctx.lineTo(lerp(x0, x1, i / (n - 1)), Y(i));
      const gr = ctx.createLinearGradient(0, base - amp, 0, H);
      gr.addColorStop(0, rgba(c.accent, 0.2));
      gr.addColorStop(1, rgba(c.accent, 0));
      ctx.strokeStyle = rgba(c.accent, 0.5);
      ctx.lineWidth = 3 * u;
      ctx.stroke();
      ctx.lineTo(x1, H);
      ctx.lineTo(x0, H);
      ctx.fillStyle = gr;
      ctx.fill();
      ctx.restore();
    }
    glow(g, W / 2, cy, Math.min(W, H) * 0.7, 0.14 * clamp(p * 2));
    const v = st.value * ease.outCubic(p);
    const suffix = (st.suffix ?? "").trim();
    const dec = st.decimals ?? (Number.isInteger(st.value) ? 0 : 1);
    const num = (x: number) => x.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
    const txt = `${st.prefix ?? ""}${num(v)}${suffix.length <= 2 ? suffix : ""}`;
    const full = `${st.prefix ?? ""}${num(st.value)}${suffix.length <= 2 ? suffix : ""}`;
    const base = g.portrait ? W * 0.36 : H * 0.42;
    const size = Math.min(base, ((W - pad * 2) / Math.max(1, measure(ctx, full, F(g, 100)))) * 100);
    const pop = 0.86 + 0.14 * spring(clamp(p * 1.2));
    ctx.save();
    ctx.translate(W / 2, cy);
    ctx.scale(pop, pop);
    gradText(g, txt, F(g, size), 0, 0, "center", clamp(p * 3));
    ctx.restore();
    g.hit?.({ field: "stat.value", x: W / 2 - size, y: cy - size * 0.5, w: size * 2, h: size, size, align: "center", lines: 1 });
    let y = cy + size * 0.56;
    if (suffix.length > 2) {
      drawLabel(ctx, suffix, F(g, 54 * u), W / 2, y, "center", c.fg, win(g.t, t0 + 0.3, 0.4), W - pad * 2);
      y += 70 * u;
    }
    if (st.label) {
      const L = layoutText(ctx, st.label, B(g, (g.portrait ? 40 : 36) * u, 500), Math.min(W - pad * 2, 1000 * u), 2, 1.3);
      drawLayout(ctx, L, { x: W / 2, y, align: "center", color: rgba(c.fg, 0.78), emColor: c.accent, t: g.t, delay: t0 + 0.5, dur: 0.6, mode: "rise", stagger: 0.04, easing: ease.outCubic });
      g.hit?.({ field: "stat.label", x: pad, y, w: W - pad * 2, h: L.height, size: L.font.size, align: "center", lines: L.lines.length });
      y += L.height + 44 * u;
    }
    const delta = scene.items?.[0];
    if (delta && y < H - pad * 0.6) {
      const dw = pill(g, stripMarks(delta), W / 2, y, { tone: "soft", size: 26, a: spring(win(g.t, t0 + 1.0, 0.6)) });
      g.hit?.({ field: "items.0", x: W / 2 - dw / 2, y: y - 26 * u, w: dw, h: 52 * u, size: 26 * u, align: "center", lines: 1 });
    }
  },

  /** A bento grid: a hero tile and smaller ones, each a piece of product UI, lighting up as it's said. */
  bento(g) {
    const { ctx, W, H, u, c, scene, pad } = g;
    const items = itemsOf(g, ["Live analytics | Every number, as it happens", "One-click setup", "Built for teams", "99.9% uptime"], 5);
    const top = proHeader(g);
    const gap = 22 * u;
    const rects = bentoRects(items.length, { x: pad, y: top, w: W - pad * 2, h: H - top - pad * 0.8 }, g.portrait, gap);
    const cues = staged(g, items.map((x) => x.label), 0.5, 0.6);
    const act = activeAt(g.t, cues);
    items.forEach((it, i) => {
      const r = rects[i];
      const a = spring(win(g.t, 0.2 + i * 0.1, 0.7 * g.sp));
      if (a <= 0) return;
      const hot = i === act ? clamp(win(g.t, cues[i], 0.3)) : 0;
      const y = surface(g, r, { a, hot, glow: i === 0 ? 1 : hot })!;
      const hero = i === 0;
      const wide = r.w > r.h * 1.7 && !hero;
      const m = (hero ? 36 : 26) * u;
      const ts = Math.min(hero ? 124 * u : 78 * u, r.h * (wide ? 0.56 : 0.34));
      const said = clamp(win(g.t, cues[i], 0.6));
      ctx.save();
      ctx.globalAlpha *= clamp(a * 1.5);
      tile(g, r.x + m + ts / 2, wide ? y + r.h / 2 : y + m + ts / 2, ts, g.icon(scene.icons?.[i]), win(g.t, 0.3 + i * 0.1, 0.8), { quiet: !hero && i !== act });
      const lf = hero ? F(g, Math.min(60 * u, r.h * 0.16)) : B(g, Math.min(34 * u, r.h * 0.2), 650);
      const tx = wide ? r.x + m + ts + 24 * u : r.x + m;
      const tw = r.x + r.w - m - tx - (wide ? 110 * u : 0);
      const ty = wide ? y + r.h / 2 - (it.detail ? 16 * u : 0) : y + r.h - m - lf.size * 0.5 - (it.detail && hero ? 46 * u : 0);
      drawLabel(ctx, it.label, lf, tx, ty, "left", c.fg, 1, tw);
      if (it.detail && (hero || wide)) drawLabel(ctx, it.detail, B(g, (hero ? 28 : 22) * u, 500), tx, ty + (hero ? 54 : 36) * u, "left", rgba(c.fg, 0.6), 1, tw);
      ctx.restore();
      g.hit?.({ field: `items.${i}`, x: tx, y: ty - lf.size * 0.7, w: tw, h: lf.size * 1.4, size: lf.size, align: "left", lines: 1 });
      // set piece: the hero's chart sits right of its tile; small tiles carry theirs top-right
      const dp = Math.max(said, win(g.t, 0.9 + i * 0.25, 0.9)) * clamp(a);
      if (hero) {
        const cy0 = y + m + ts + 20 * u, cy1 = ty - lf.size * 0.7 - 24 * u;
        if (cy1 - cy0 > 50 * u) decor(g, 0, { x: r.x + m, y: cy0, w: r.w - m * 2, h: cy1 - cy0 }, dp);
        else decor(g, 0, { x: r.x + m + ts + 30 * u, y: y + m, w: r.w - m * 2 - ts - 30 * u, h: ts }, dp);
      }
      else if (!wide || r.w > 300 * u) decor(g, ((i - 1) % 4) + 1, wide ? { x: r.x + r.w - m - 100 * u, y: y + r.h / 2 - 28 * u, w: 100 * u, h: 56 * u } : { x: r.x + r.w * 0.45, y: y + m, w: r.w * 0.55 - m, h: Math.max(30 * u, r.h * 0.4 - m) }, dp);
    });
  },

  /** A stack of cards: the one being talked about springs to the front, the others fan out behind. */
  "card-stack"(g) {
    const { ctx, W, H, u, c, scene, pad } = g;
    const items = itemsOf(g, ["Plan | Map the launch", "Build | Ship it together", "Grow | Watch it land"], 4);
    const n = items.length;
    const top = proHeader(g);
    const areaH = H - top - pad * 0.8;
    const ch = Math.min(areaH * 0.9, g.portrait ? W * 0.9 : 600 * u), cw = Math.min(ch * 0.8, g.portrait ? W * 0.66 : W * 0.3);
    const cx = W / 2, cy = top + areaH / 2;
    const cues = staged(g, items.map((x) => x.label), 0.45, 0.62);
    const k = Math.max(0, activeAt(g.t, cues));
    const m = spring(win(g.t, k === 0 ? 0.15 : cues[k], 0.75 * g.sp));
    const slot = (i: number, act: number) => {
      const d = i - act, depth = Math.abs(d), side = Math.sign(d);
      return { x: side * (cw * 0.62 + (depth - 1) * cw * 0.34) * (depth ? 1 : 0), y: depth * 22 * u, s: 1 - 0.13 * depth, rot: side * 0.075 * depth, a: depth ? Math.max(0.25, 0.8 - 0.25 * (depth - 1)) : 1 };
    };
    const order = items.map((_, i) => i).sort((a, b) => Math.abs(b - k) - Math.abs(a - k));
    glow(g, cx, cy, cw * 1.6, 0.16);
    for (const i of order) {
      const to = slot(i, k), from = k === 0 ? { ...to, y: to.y + H * 0.25, a: 0 } : slot(i, k - 1);
      const s = { x: lerp(from.x, to.x, m), y: lerp(from.y, to.y, m), s: lerp(from.s, to.s, m), rot: lerp(from.rot, to.rot, m), a: lerp(from.a, to.a, clamp(m)) };
      const it = items[i], front = i === k;
      ctx.save();
      ctx.translate(cx + s.x, cy + s.y);
      ctx.rotate(s.rot);
      ctx.scale(s.s, s.s);
      ctx.globalAlpha *= clamp(s.a);
      const r = { x: -cw / 2, y: -ch / 2, w: cw, h: ch };
      surface(g, r, { hot: front ? clamp(m) : 0, glow: front ? 1 : 0, radius: 34 * u });
      const pd = cw * 0.1;
      tile(g, r.x + pd + cw * 0.13, r.y + pd + cw * 0.13, cw * 0.26, g.icon(scene.icons?.[i]), front ? 0.4 + 0.6 * clamp(m) : 1, { quiet: !front });
      drawLabel(ctx, String(i + 1).padStart(2, "0"), K(g, cw * 0.05), r.x + cw - pd, r.y + pd + cw * 0.05, "right", rgba(c.fg, 0.45));
      const L = layoutText(ctx, it.label, F(g, cw * 0.14), cw - pd * 2, 2);
      const ty = r.y + ch * 0.46;
      drawLayout(ctx, L, { x: r.x + pd, y: ty, align: "left", color: c.fg, emColor: c.accent, t: 9, mode: "none" });
      if (it.detail) {
        const D = layoutText(ctx, it.detail, B(g, cw * 0.062, 500), cw - pd * 2, 3, 1.35);
        drawLayout(ctx, D, { x: r.x + pd, y: ty + L.height + cw * 0.05, align: "left", color: rgba(c.fg, 0.62), emColor: c.accent, t: 9, mode: "none" });
      }
      // a quiet foot: a bar that fills on the front card
      const by = r.y + ch - pd - 10 * u;
      ctx.fillStyle = rgba(c.fg, 0.1);
      ctx.beginPath();
      ctx.roundRect(r.x + pd, by, cw - pd * 2, 10 * u, 5 * u);
      ctx.fill();
      if (front) {
        const gr = ctx.createLinearGradient(r.x + pd, 0, r.x + cw - pd, 0);
        gr.addColorStop(0, c.accent);
        gr.addColorStop(1, accent2(g));
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.roundRect(r.x + pd, by, Math.max(10 * u, (cw - pd * 2) * ((i + 1) / n) * ease.inOutCubic(clamp(m))), 10 * u, 5 * u);
        ctx.fill();
      }
      ctx.restore();
      if (front) g.hit?.({ field: `items.${i}`, x: cx - cw / 2 + pd, y: cy + ty, w: cw - pd * 2, h: L.height, size: L.font.size, align: "left", lines: L.lines.length });
    }
    // which card: dots under the stack
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i === k ? c.accent : rgba(c.fg, 0.22);
      ctx.beginPath();
      ctx.roundRect(cx - (n * 26 * u) / 2 + i * 26 * u + (i === k ? -8 * u : 0), cy + ch / 2 + 36 * u, (i === k ? 28 : 12) * u, 12 * u, 6 * u);
      ctx.fill();
    }
  },

  /** The product in use: a prompt types itself, the pointer glides to the button and clicks, it loads, the result lands. */
  "cursor-demo"(g) {
    const { ctx, W, H, u, c, scene, pad, brand } = g;
    const [typed, result, toast] = [scene.items?.[0] ?? "Launch ad for our new smartwatch", scene.items?.[1] ?? "Your ad is ready", scene.items?.[2] ?? "Done in 4 seconds"].map((x) => stripMarks(x.split("|")[0]));
    const top = proHeader(g);
    const areaH = H - top - pad * 0.8;
    const ww = Math.min(W - pad * (g.portrait ? 1.2 : 2), g.portrait ? W : areaH * 1.55), wh = Math.min(areaH, g.portrait ? ww * 1.05 : ww * 0.56);
    const R: Rect = { x: W / 2 - ww / 2, y: top + (areaH - wh) / 2, w: ww, h: wh };
    const wa = spring(win(g.t, 0.1, 0.8 * g.sp));
    glow(g, W / 2, R.y + wh / 2, ww * 0.8, 0.14 * clamp(wa));
    const wy = surface(g, R, { a: wa, radius: 30 * u, glow: 0.6 });
    if (wy === undefined) return;
    const S = Math.min(ww / 1100, wh / 640) / u; // window units → u
    const q = (v: number) => v * S * u;
    const m = q(44);
    // chrome
    ctx.save();
    ctx.globalAlpha *= clamp(wa);
    ["#FF5F57", "#FEBC2E", "#28C840"].forEach((col, i) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(R.x + m + i * q(26), wy + q(40), q(8), 0, Math.PI * 2);
      ctx.fill();
    });
    drawLabel(ctx, stripMarks(brand.name || "App"), B(g, q(24), 650), R.x + ww / 2, wy + q(40), "center", rgba(c.fg, 0.7), 1, ww * 0.5);
    ctx.strokeStyle = rgba(c.fg, 0.08);
    ctx.lineWidth = 1.5 * u;
    ctx.beginPath();
    ctx.moveTo(R.x, wy + q(80));
    ctx.lineTo(R.x + ww, wy + q(80));
    ctx.stroke();
    ctx.restore();
    // timings
    const tT0 = 0.55, tT1 = Math.min(tT0 + 1.5, g.dur * 0.36);
    const tClick = tT1 + 0.6, tDone = Math.max(tClick + 0.55, Math.min(cue(g, result, tClick + 0.7), g.dur * 0.8));
    // the field
    const fh = q(96), fx = R.x + m, fy = wy + q(120), fw = ww - m * 2;
    const fa = clamp(win(g.t, 0.3, 0.4));
    ctx.save();
    ctx.globalAlpha *= fa;
    ctx.fillStyle = isDark(g) ? rgba("#000000", 0.28) : rgba("#000000", 0.04);
    ctx.strokeStyle = g.t < tClick ? rgba(c.accent, 0.7) : rgba(c.fg, 0.14);
    ctx.lineWidth = 2 * u;
    ctx.beginPath();
    ctx.roundRect(fx, fy, fw, fh, q(22));
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    const bw = Math.min(fw * 0.34, q(250)), bh = fh - q(24), bx = fx + fw - bw - q(12), by = fy + q(12);
    const tf = B(g, q(32), 500);
    const chars = Math.round(typed.length * clamp(win(g.t, tT0, tT1 - tT0)));
    const shown = typed.slice(0, chars);
    const tw = drawLabel(ctx, shown || (g.t < tT0 ? "Describe what you need…" : ""), tf, fx + q(28), fy + fh / 2, "left", shown ? c.fg : rgba(c.fg, 0.35), fa, bx - fx - q(48));
    if (g.t >= tT0 && g.t < tClick && Math.floor(g.t * 2.5) % 2 === 0) {
      ctx.fillStyle = c.accent;
      ctx.fillRect(fx + q(28) + Math.min(tw, bx - fx - q(48)) + q(4), fy + fh * 0.28, 3 * u, fh * 0.44);
    }
    g.hit?.({ field: "items.0", x: fx + q(28), y: fy, w: bx - fx - q(48), h: fh, size: tf.size, align: "left", lines: 1 });
    // the button
    const press = win(g.t, tClick, 0.35);
    const loading = g.t >= tClick + 0.1 && g.t < tDone;
    ctx.save();
    ctx.globalAlpha *= fa;
    const bs = 1 - 0.05 * Math.sin(Math.PI * press);
    ctx.translate(bx + bw / 2, by + bh / 2);
    ctx.scale(bs, bs);
    const bg2 = ctx.createLinearGradient(-bw / 2, 0, bw / 2, 0);
    bg2.addColorStop(0, c.accent);
    bg2.addColorStop(1, accent2(g));
    ctx.fillStyle = bg2;
    ctx.beginPath();
    ctx.roundRect(-bw / 2, -bh / 2, bw, bh, q(16));
    ctx.fill();
    if (loading) {
      ctx.strokeStyle = onAccent(g);
      ctx.lineWidth = q(5);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(0, 0, q(15), g.t * 9, g.t * 9 + Math.PI * 1.4);
      ctx.stroke();
    } else drawLabel(ctx, stripMarks(scene.cta || "Generate"), B(g, q(28), 700), 0, q(2), "center", onAccent(g), 1, bw - q(30));
    ctx.restore();
    g.hit?.({ field: "cta", x: bx, y: by, w: bw, h: bh, size: q(28), align: "center", lines: 1 });
    // the result
    const ry = fy + fh + q(30), rh = wy + wh - m * 0.8 - ry;
    const rp = spring(win(g.t, tDone, 0.7));
    if (rh > q(90)) {
      if (loading || (rp < 1 && g.t >= tClick)) {
        // skeleton lines shimmering while it works
        for (let i = 0; i < 3; i++) {
          const sh = 0.5 + 0.5 * Math.sin(g.t * 6 - i * 0.9);
          ctx.fillStyle = rgba(c.fg, (0.06 + 0.06 * sh) * (1 - rp));
          ctx.beginPath();
          ctx.roundRect(fx, ry + q(14) + i * q(46), fw * [0.82, 0.64, 0.74][i], q(22), q(11));
          ctx.fill();
        }
      }
      if (rp > 0) {
        const card: Rect = { x: fx, y: ry, w: fw, h: rh };
        const cy2 = surface(g, card, { a: clamp(rp), radius: q(22), hot: clamp(1 - win(g.t, tDone + 0.8, 0.8)), flat: true })!;
        const dot = Math.min(q(36), rh * 0.2);
        checkDot(g, card.x + q(34) + dot, cy2 + q(30) + dot, dot, win(g.t, tDone + 0.1, 0.6));
        drawLabel(ctx, result, F(g, Math.min(q(44), rh * 0.24)), card.x + q(34) + dot * 2 + q(22), cy2 + q(30) + dot, "left", c.fg, clamp(rp), fw - dot * 2 - q(110));
        g.hit?.({ field: "items.1", x: card.x + q(34) + dot * 2 + q(22), y: cy2 + q(30), w: fw - dot * 2 - q(110), h: dot * 2, size: q(44), align: "left", lines: 1 });
        const rows = Math.max(0, Math.min(3, Math.floor((rh - q(60) - dot * 2) / q(40))));
        for (let i = 0; i < rows; i++) {
          const lp = ease.outCubic(win(g.t, tDone + 0.3 + i * 0.12, 0.6));
          ctx.fillStyle = i === 0 ? rgba(c.accent, 0.5) : rgba(c.fg, 0.12);
          ctx.beginPath();
          ctx.roundRect(card.x + q(34), cy2 + q(52) + dot * 2 + i * q(40), (fw - q(68)) * [0.9, 0.72, 0.5][i] * lp, q(16), q(8));
          ctx.fill();
        }
      }
    }
    // the toast
    const tp = spring(win(g.t, tDone + 0.5, 0.6));
    if (tp > 0) {
      const tw2 = pill(g, `✓  ${toast}`, R.x + ww - m * 0.4, wy - q(6) + (1 - tp) * -20 * u, { tone: "accent", size: 24 * S, a: clamp(tp), align: "right", maxW: ww * 0.7 });
      g.hit?.({ field: "items.2", x: R.x + ww - m * 0.4 - tw2, y: wy - q(30), w: tw2, h: q(50), size: q(24), align: "left", lines: 1 });
    }
    // the pointer: waits, glides to the button, clicks, drifts off
    const from = { x: R.x + ww * 0.62, y: wy + wh * 0.82 }, to = { x: bx + bw * 0.55, y: by + bh * 0.6 };
    const mv = ease.inOutCubic(win(g.t, tT1 - 0.1, tClick - tT1 + 0.1));
    const away = ease.inOutCubic(win(g.t, tClick + 0.5, 0.9));
    cursor(g, lerp(from.x, to.x, mv) + away * q(90), lerp(from.y, to.y, mv) + away * q(70) - Math.sin(mv * Math.PI) * q(30), press, clamp(win(g.t, 0.5, 0.4)) * (1 - 0.6 * away));
  },

  /** A phone showing the app: its rows light up as each feature is said, with callouts beside it. */
  "phone-screens"(g) {
    const { ctx, W, H, u, c, scene, pad, brand } = g;
    const items = itemsOf(g, ["Track every order", "Instant alerts", "Pay in one tap"], 4);
    const top = proHeader(g, { align: g.portrait ? "center" : "left" });
    const areaH = H - top - pad * 0.6;
    const ph = Math.min(areaH * (g.portrait ? 0.86 : 1), 1500 * u), pw = ph * 0.485;
    const cx = W / 2, py0 = top + (g.portrait ? 0 : (areaH - ph) / 2);
    const rise = spring(win(g.t, 0.1, 0.9 * g.sp));
    const py = py0 + (1 - rise) * H * 0.3;
    const cues = staged(g, items.map((x) => x.label), 0.6, 0.6);
    const act = activeAt(g.t, cues);
    glow(g, cx, py + ph / 2, ph * 0.75, 0.2 * clamp(rise));
    ctx.save();
    ctx.globalAlpha *= clamp(rise * 1.5);
    // body
    for (let k = 3; k >= 1; k--) {
      ctx.fillStyle = rgba("#000000", 0.1);
      ctx.beginPath();
      ctx.roundRect(cx - pw / 2 - 4 * k * u, py + 10 * k * u, pw + 8 * k * u, ph, pw * 0.15);
      ctx.fill();
    }
    ctx.fillStyle = "#0B0B0E";
    ctx.beginPath();
    ctx.roundRect(cx - pw / 2, py, pw, ph, pw * 0.15);
    ctx.fill();
    ctx.strokeStyle = rgba("#FFFFFF", 0.22);
    ctx.lineWidth = 2 * u;
    ctx.stroke();
    const b = pw * 0.035, sx = cx - pw / 2 + b, sy = py + b, sw = pw - b * 2, sh = ph - b * 2;
    ctx.beginPath();
    ctx.roundRect(sx, sy, sw, sh, pw * 0.12);
    ctx.clip();
    ctx.fillStyle = isDark(g) ? mix(c.bg, c.fg, 0.03) : mix(c.bg, "#FFFFFF", 0.6);
    ctx.fillRect(sx, sy, sw, sh);
    const sg = ctx.createLinearGradient(0, sy, 0, sy + sh * 0.4);
    sg.addColorStop(0, rgba(c.accent, 0.22));
    sg.addColorStop(1, rgba(c.accent, 0));
    ctx.fillStyle = sg;
    ctx.fillRect(sx, sy, sw, sh * 0.4);
    // island, greeting
    ctx.fillStyle = "#0B0B0E";
    ctx.beginPath();
    ctx.roundRect(cx - sw * 0.16, sy + sw * 0.035, sw * 0.32, sw * 0.075, sw * 0.04);
    ctx.fill();
    const m = sw * 0.07;
    drawLabel(ctx, stripMarks(brand.name || "App"), F(g, sw * 0.085), sx + m, sy + sw * 0.25, "left", c.fg, 1, sw - m * 2 - sw * 0.14);
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.arc(sx + sw - m - sw * 0.05, sy + sw * 0.25, sw * 0.05, 0, Math.PI * 2);
    ctx.fill();
    // rows
    const y0 = sy + sw * 0.37, rowGap = sw * 0.035;
    const rh = Math.min(sw * 0.3, (sh - (y0 - sy) - sw * 0.2 - rowGap * (items.length - 1)) / items.length);
    const rowY: number[] = [];
    items.forEach((it, i) => {
      const r = { x: sx + m, y: y0 + i * (rh + rowGap), w: sw - m * 2, h: rh };
      rowY.push(r.y + rh / 2);
      const a = spring(win(g.t, 0.35 + i * 0.1, 0.6));
      const on = i === act;
      surface(g, r, { a, radius: sw * 0.06, hot: on ? 1 : 0, flat: true });
      const ts = rh * 0.6;
      tile(g, r.x + rh * 0.2 + ts / 2, r.y + rh / 2, ts, g.icon(scene.icons?.[i]), a, { quiet: !on });
      drawLabel(ctx, it.label, B(g, Math.min(sw * 0.058, rh * 0.26), 650), r.x + rh * 0.36 + ts, r.y + rh / 2 - (it.detail ? rh * 0.12 : 0), "left", i <= act ? c.fg : rgba(c.fg, 0.6), a, r.w - ts - rh * 0.5);
      if (it.detail) drawLabel(ctx, it.detail, B(g, Math.min(sw * 0.042, rh * 0.19), 500), r.x + rh * 0.36 + ts, r.y + rh / 2 + rh * 0.18, "left", rgba(c.fg, 0.5), a, r.w - ts - rh * 0.5);
    });
    // tab bar
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i === 0 ? c.accent : rgba(c.fg, 0.25);
      ctx.beginPath();
      ctx.arc(sx + sw * (0.2 + i * 0.2), sy + sh - sw * 0.1, sw * 0.022, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // callouts
    if (g.portrait) {
      if (act >= 0) {
        const it = items[act];
        const cw2 = pill(g, it.detail || it.label, cx, py0 + ph + 56 * u, { tone: "accent", size: 30, a: spring(win(g.t, cues[act] + 0.1, 0.5)) });
        g.hit?.({ field: `items.${act}`, x: cx - cw2 / 2, y: py0 + ph + 26 * u, w: cw2, h: 60 * u, size: 30 * u, align: "center", lines: 1 });
      }
    } else {
      items.forEach((it, i) => {
        const p = win(g.t, cues[i], 0.6);
        if (p <= 0) return;
        const left = i % 2 === 0;
        const ex = cx + (left ? -1 : 1) * (pw / 2 + 4 * u), lx = cx + (left ? -1 : 1) * (pw / 2 + Math.min(150 * u, (W - pw) * 0.14)), ly = rowY[i];
        const lp = ease.outCubic(p);
        ctx.save();
        ctx.strokeStyle = rgba(c.accent, 0.8);
        ctx.lineWidth = 2.5 * u;
        ctx.setLineDash([2 * u, 8 * u]);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(ex, ly);
        ctx.lineTo(lerp(ex, lx, lp), ly);
        ctx.stroke();
        ctx.restore();
        const pw2 = pill(g, it.label, lx + (left ? -10 : 10) * u, ly, { tone: i === act ? "accent" : "glass", size: 28, a: spring(clamp((p - 0.3) * 1.6)), align: left ? "right" : "left", maxW: (W - pw) / 2 - pad - 170 * u });
        g.hit?.({ field: `items.${i}`, x: left ? lx - 10 * u - pw2 : lx + 10 * u, y: ly - 28 * u, w: pw2, h: 56 * u, size: 28 * u, align: "left", lines: 1 });
      });
    }
  },

  /** The product in the middle, the tools it works with around it, light running down the wires as each connects. */
  integrations(g) {
    const { ctx, W, H, u, c, scene, pad, brand } = g;
    const icons = scene.icons ?? [];
    const sats = icons.slice(1, 7);
    const n = Math.max(2, sats.length);
    const labels = (scene.items ?? []).map((x) => parts(x).label);
    const top = proHeader(g);
    const areaH = H - top - pad * 0.7;
    const cx = W / 2, cy = top + areaH / 2;
    const core = Math.min(areaH * (g.portrait ? 0.22 : 0.34), 250 * u);
    const ss = core * 0.56;
    const pos = Array.from({ length: n }, (_, i) => {
      const half = Math.ceil(n / 2), side = i < half ? -1 : 1, k = i < half ? i : i - half, count = i < half ? half : n - half;
      const f = count === 1 ? 0 : k / (count - 1) - 0.5;
      return g.portrait ? { x: cx + f * (W - pad * 2 - ss) * 0.9, y: cy + side * areaH * 0.36 } : { x: cx + side * Math.min(W * 0.34, areaH * 1.0), y: cy + f * areaH * 0.72 };
    });
    const cues = staged(g, Array.from({ length: n }, (_, i) => labels[i] ?? ""), 0.5, 0.55);
    glow(g, cx, cy, core * 2.6, 0.22 * ease.outCubic(win(g.t, 0, 0.8)));
    pos.forEach((q, i) => {
      const p = win(g.t, cues[i], 0.7 * g.sp);
      if (p <= 0) return;
      // the wire: an S-curve into the core
      const mx = g.portrait ? q.x : (q.x + cx) / 2, my = g.portrait ? (q.y + cy) / 2 : q.y;
      const mx2 = g.portrait ? cx : (q.x + cx) / 2, my2 = g.portrait ? (q.y + cy) / 2 : cy;
      const bez = (t: number) => {
        const a = (1 - t) ** 3, b2 = 3 * (1 - t) ** 2 * t, d = 3 * (1 - t) * t * t, e = t ** 3;
        return { x: a * q.x + b2 * mx + d * mx2 + e * cx, y: a * q.y + b2 * my + d * my2 + e * cy };
      };
      const lp = ease.inOutCubic(clamp(p));
      ctx.save();
      ctx.strokeStyle = rgba(c.fg, 0.16);
      ctx.lineWidth = 2.5 * u;
      ctx.beginPath();
      for (let s = 0; s <= 30 * lp; s++) {
        const w = bez(s / 30);
        if (s === 0) ctx.moveTo(w.x, w.y);
        else ctx.lineTo(w.x, w.y);
      }
      ctx.stroke();
      // light running down it
      if (lp >= 1) {
        const ph = ((g.t - cues[i]) * 0.55 + i * 0.17) % 1;
        for (let s = 0; s < 8; s++) {
          const w = bez(clamp(ph - s * 0.012));
          ctx.fillStyle = rgba(s === 0 ? "#FFFFFF" : c.accent, (1 - s / 8) * 0.9);
          ctx.beginPath();
          ctx.arc(w.x, w.y, (5 - s * 0.45) * u, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    });
    pos.forEach((q, i) => {
      const p = win(g.t, cues[i], 0.7 * g.sp);
      tile(g, q.x, q.y, ss, g.icon(sats[i]), p, { quiet: true, letter: labels[i]?.[0]?.toUpperCase() });
      if (labels[i] && p > 0) {
        drawLabel(ctx, labels[i], B(g, 24 * u, 600), q.x, q.y + ss / 2 + 30 * u, "center", rgba(c.fg, 0.8), clamp((p - 0.3) * 2), g.portrait ? (W - pad * 2) / Math.ceil(n / 2) - 16 * u : W * 0.24);
        g.hit?.({ field: `items.${i}`, x: q.x - ss, y: q.y + ss / 2 + 10 * u, w: ss * 2, h: 40 * u, size: 24 * u, align: "center", lines: 1 });
      }
    });
    // the core, pulsing as each wire lands
    const act = activeAt(g.t, cues);
    const pulse = act >= 0 ? Math.exp(-((g.t - cues[act] - 0.7) ** 2) * 14) : 0;
    tile(g, cx, cy, core * (1 + 0.06 * pulse), g.icon(icons[0]), win(g.t, 0.1, 0.8), { letter: (stripMarks(brand.name || "•")[0] ?? "•").toUpperCase() });
  },

  /** A list that ticks itself off as each line is said, its progress bar filling; "all done" at the end. */
  checklist(g) {
    const { ctx, W, H, u, c, scene, pad } = g;
    const items = itemsOf(g, ["Connect your store", "Import products", "Launch your first ad", "Watch sales land"], 5);
    const n = items.length;
    const top = scene.kicker ? proHeader({ ...g, scene: { ...scene, headline: undefined } }) : pad;
    const areaH = H - top - pad * 0.8;
    const cw = Math.min(W - pad * (g.portrait ? 1.4 : 2), 1040 * u);
    const head = 150 * u;
    const rowH = Math.min((g.portrait ? 150 : 112) * u, (areaH - head - 40 * u) / n);
    const ch = head + rowH * n + 36 * u;
    const R: Rect = { x: W / 2 - cw / 2, y: top + (areaH - ch) / 2, w: cw, h: ch };
    const cues = staged(g, items.map((x) => x.label), 0.6, 0.62);
    const done = cues.filter((x) => g.t >= x + 0.25).length;
    const all = done === n ? win(g.t, cues[n - 1] + 0.5, 0.6) : 0;
    const a = spring(win(g.t, 0.1, 0.8 * g.sp));
    glow(g, W / 2, R.y + ch / 2, cw * 0.9, (0.12 + 0.14 * all) * clamp(a));
    const y = surface(g, R, { a, radius: 34 * u, glow: 0.5 + all, hot: all });
    if (y === undefined) return;
    const m = 44 * u;
    ctx.save();
    ctx.globalAlpha *= clamp(a);
    const title = stripMarks(scene.headline || "Getting started");
    drawLabel(ctx, title, F(g, 46 * u), R.x + m, y + 62 * u, "left", c.fg, 1, cw - m * 2 - 150 * u);
    g.hit?.({ field: "headline", x: R.x + m, y: y + 32 * u, w: cw - m * 2 - 150 * u, h: 60 * u, size: 46 * u, align: "left", lines: 1 });
    drawLabel(ctx, `${done}/${n}`, F(g, 40 * u), R.x + cw - m, y + 62 * u, "right", done === n ? c.accent : rgba(c.fg, 0.55));
    // progress
    const by = y + 108 * u, bw = cw - m * 2;
    ctx.fillStyle = rgba(c.fg, 0.1);
    ctx.beginPath();
    ctx.roundRect(R.x + m, by, bw, 12 * u, 6 * u);
    ctx.fill();
    const prog = cues.reduce((s, x) => s + ease.inOutCubic(win(g.t, x + 0.1, 0.5)), 0) / n;
    if (prog > 0) {
      const gr = ctx.createLinearGradient(R.x + m, 0, R.x + m + bw, 0);
      gr.addColorStop(0, c.accent);
      gr.addColorStop(1, accent2(g));
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.roundRect(R.x + m, by, Math.max(12 * u, bw * prog), 12 * u, 6 * u);
      ctx.fill();
    }
    items.forEach((it, i) => {
      const ry = y + head + i * rowH, mid = ry + rowH / 2;
      const p = win(g.t, cues[i], 0.7);
      const rowIn = ease.outCubic(win(g.t, 0.35 + i * 0.08, 0.5));
      ctx.save();
      ctx.globalAlpha *= rowIn;
      // the line being ticked flashes softly
      const flash = p > 0 ? Math.exp(-((g.t - cues[i] - 0.3) ** 2) * 10) : 0;
      if (flash > 0.02) {
        ctx.fillStyle = rgba(c.accent, 0.12 * flash);
        ctx.beginPath();
        ctx.roundRect(R.x + m * 0.5, ry + 6 * u, cw - m, rowH - 12 * u, 18 * u);
        ctx.fill();
      }
      if (i > 0) {
        ctx.fillStyle = rgba(c.fg, 0.07);
        ctx.fillRect(R.x + m, ry, cw - m * 2, 1.5 * u);
      }
      const r = Math.min(26 * u, rowH * 0.27);
      checkDot(g, R.x + m + r, mid, r, p, p > 0);
      const f = B(g, Math.min((g.portrait ? 46 : 36) * u, rowH * 0.34), 600);
      const tx = R.x + m + r * 2 + 28 * u, maxW = cw - m * 2 - r * 2 - 28 * u - (it.detail ? cw * 0.3 : 0);
      drawLabel(ctx, it.label, f, tx, mid, "left", p > 0 ? c.fg : rgba(c.fg, 0.55), 1, maxW);
      if (it.detail) drawLabel(ctx, it.detail, B(g, Math.min(26 * u, rowH * 0.26), 500), R.x + cw - m, mid, "right", rgba(c.fg, 0.5), 1, cw * 0.28);
      ctx.restore();
      g.hit?.({ field: `items.${i}`, x: tx, y: mid - rowH * 0.35, w: maxW, h: rowH * 0.7, size: f.size, align: "left", lines: 1 });
    });
    ctx.restore();
    if (all > 0) pill(g, "All done", R.x + cw - 20 * u, y - 4 * u, { tone: "accent", size: 26, a: spring(all), align: "right" });
    // a few sparks when the list completes
    if (all > 0 && all < 1) {
      for (let i = 0; i < 14; i++) {
        const ang = hash(i * 3.1) * Math.PI * 2, d = (60 + 260 * hash(i * 7.7)) * u * ease.outCubic(all);
        ctx.fillStyle = rgba(i % 2 ? c.accent : accent2(g), 1 - all);
        ctx.beginPath();
        ctx.arc(R.x + cw - 90 * u + Math.cos(ang) * d, y + Math.sin(ang) * d, (3 + 4 * hash(i)) * u, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },
};
