// Attention templates: formats that stop the scroll. Footage inside giant letters, a chat thread,
// a lock screen filling with notifications, a POV caption, them-vs-us, a star rating, a spotlight
// reveal and a kinetic word stack. Same contract as the other templates: draw scene `g` at g.t.
import type { G, Tpl } from "./render";
import { F, B, K, ts, rr, placeholder, hitLayout, hitText, kicker, headlineSize, containRect, drawCover } from "./render";
import { clamp, ease, lerp, win, rgba, mix, contrast } from "./util";
import { layoutText, drawLayout, drawLabel, measure, stripMarks, displayWeight } from "./text";

/** Text that reads on a fill: the brand's fg or bg, whichever contrasts more. */
const on = (g: G, fill: string) => (contrast(g.c.fg, fill) >= contrast(g.c.bg, fill) ? g.c.fg : g.c.bg);
/** Words marked *like this* in the headline. */
const marked = (s?: string) => new Set((s?.match(/\*([^*]+)\*/g) ?? []).flatMap((m) => m.replace(/\*/g, "").toLowerCase().split(/\s+/)));
const plain = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

const scratch = new Map<string, HTMLCanvasElement>();
function layer(key: string, w: number, h: number) {
  let c = scratch.get(key);
  if (!c) scratch.set(key, (c = document.createElement("canvas")));
  if (c.width !== w || c.height !== h) (c.width = w), (c.height = h);
  return c;
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r * 0.45 : r;
    ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  ctx.closePath();
}

export const EXTRA_TEMPLATES: Record<string, Tpl> = {
  /** The footage plays inside giant letters. */
  "text-mask"(g) {
    const { W, H, ctx, u, c, scene, brand, pad } = g;
    const text = stripMarks(scene.headline || brand.name || "Bold").toUpperCase().trim();
    const words = text.split(/\s+/);
    const lines = text.length > 11 && words.length > 1 ? [words.slice(0, Math.ceil(words.length / 2)).join(" "), words.slice(Math.ceil(words.length / 2)).join(" ")] : [text];
    const f100 = F(g, 100);
    const widest = Math.max(...lines.map((l) => measure(ctx, l, f100)), 1);
    const size = Math.min((g.portrait ? H * 0.3 : H * 0.5) / lines.length, ((W - pad * 1.4) / widest) * 100);
    const lh = size * 0.92;
    const top = H / 2 - (lines.length * lh) / 2 - (scene.subline ? 40 * u : 0);
    const sc = ctx.getTransform().a || 1;
    const off = layer("mask", Math.max(1, Math.round(W * sc)), Math.max(1, Math.round(H * sc)));
    const o = off.getContext("2d")!;
    o.setTransform(sc, 0, 0, sc, 0, 0);
    o.globalCompositeOperation = "source-over";
    o.clearRect(0, 0, W, H);
    const im = g.img(scene.image);
    const z = lerp(1.3, 1.05, ease.outCubic(clamp(g.t / Math.max(1, g.dur))));
    if (im) drawCover(o, im, 0, 0, W, H, z * (scene.zoom ?? 1), scene.focus?.x, scene.focus?.y);
    else {
      const gr = o.createLinearGradient(0, 0, W, H);
      gr.addColorStop(0, c.accent);
      gr.addColorStop(0.5 + 0.3 * Math.sin(g.t * 1.4), mix(c.accent, c.fg, 0.5));
      gr.addColorStop(1, c.accent);
      o.fillStyle = gr;
      o.fillRect(0, 0, W, H);
    }
    // Keep only the letters (each line rising out of a slot): draw them on their own layer, then
    // keep the footage only where that layer has ink, across the whole frame.
    const txt = layer("mask-text", off.width, off.height);
    const tc = txt.getContext("2d")!;
    tc.setTransform(sc, 0, 0, sc, 0, 0);
    tc.clearRect(0, 0, W, H);
    tc.font = `${displayWeight(brand.fontDisplay)} ${size}px "${brand.fontDisplay}"`;
    tc.textAlign = "center";
    tc.textBaseline = "middle";
    lines.forEach((l, i) => {
      const p = g.E(win(g.t, 0.1 + i * 0.15, 0.9 * g.sp));
      tc.save();
      tc.beginPath();
      tc.rect(0, top + i * lh - lh * 0.1, W, lh * 1.05);
      tc.clip();
      tc.fillStyle = "#000";
      tc.fillText(l, W / 2, top + i * lh + lh / 2 + (1 - p) * lh);
      tc.restore();
    });
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.globalCompositeOperation = "destination-in";
    o.drawImage(txt, 0, 0);
    o.globalCompositeOperation = "source-over";
    o.font = tc.font;
    // A thin outline flashes first, then the footage fills the letters.
    ctx.save();
    // Bright at first, then a fine edge that stays so dark footage still reads as letters.
    const ol = Math.max(0.45, 1 - clamp((g.t - 0.6) / 0.6)) * clamp(g.t / 0.3);
    if (ol > 0) {
      ctx.globalAlpha = ol;
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = (ol > 0.5 ? 2.5 : 1.5) * u;
      ctx.font = o.font;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      lines.forEach((l, i) => ctx.strokeText(l, W / 2, top + i * lh + lh / 2));
    }
    ctx.restore();
    ctx.drawImage(off, 0, 0, W, H);
    g.hit?.({ field: "headline", x: pad, y: top, w: W - pad * 2, h: lines.length * lh, size, align: "center", lines: lines.length });
    if (scene.kicker) kicker(g, scene.kicker, W / 2, top - 50 * u, "center", 0.5);
    if (scene.subline) {
      const L = layoutText(ctx, stripMarks(scene.subline), B(g, 32 * u, 500), W - pad * 2, 2, 1.3);
      const y = top + lines.length * lh + 40 * u;
      hitLayout(g, "subline", L, W / 2, y, "center");
      drawLayout(ctx, L, { x: W / 2, y, align: "center", color: rgba(c.fg, 0.8), emColor: c.accent, t: g.t, delay: 0.8, dur: 0.7, mode: "rise", stagger: 0.05, easing: ease.outCubic });
    }
  },

  /** A message thread: bubbles pop in turn, the other side typing first. */
  chat(g) {
    const { W, H, ctx, u, c, scene, brand, pad } = g;
    const raw = (scene.items?.length ? scene.items : ["does it actually work?", "> try it for 7 days, free", "ok I'm sold 😍"]).slice(0, 7);
    const msgs = raw.map((m, i) => {
      const t = m.trim();
      const right = t.startsWith(">") ? true : t.startsWith("<") ? false : i % 2 === 1;
      return { text: t.replace(/^[<>]\s*/, ""), right };
    });
    const colW = g.portrait ? W - pad * 1.2 : Math.min(W * 0.52, 980 * u);
    const x0 = (W - colW) / 2;
    // Header: avatar, name, "online".
    const hp = g.E(win(g.t, 0, 0.5));
    const hy = (g.portrait ? pad * 1.2 : pad * 0.8) - (1 - hp) * 40 * u;
    ctx.save();
    ctx.globalAlpha = hp;
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.arc(x0 + 34 * u, hy + 34 * u, 34 * u, 0, Math.PI * 2);
    ctx.fill();
    const name = stripMarks(scene.kicker || brand.name || "Support");
    drawLabel(ctx, name[0]?.toUpperCase() ?? "•", F(g, 36 * u), x0 + 34 * u, hy + 36 * u, "center", on(g, c.accent));
    drawLabel(ctx, name, B(g, 30 * u, 650), x0 + 84 * u, hy + 24 * u, "left", c.fg);
    drawLabel(ctx, "online", B(g, 22 * u, 500), x0 + 84 * u, hy + 54 * u, "left", c.accent);
    ctx.restore();
    hitText(g, "kicker", name, B(g, 30 * u, 650), x0 + 84 * u, hy + 24 * u, "left");
    ctx.fillStyle = rgba(c.fg, 0.1);
    ctx.fillRect(x0, hy + 86 * u, colW, 1.5 * u);

    const fs = (g.portrait ? 40 : 38) * u;
    const font = B(g, fs, 500);
    const maxB = colW * 0.74;
    const n = msgs.length;
    const span = (g.dur - (scene.headline ? 1.6 : 0.6)) / n;
    const L = msgs.map((m) => layoutText(ctx, m.text, font, maxB - 44 * u, 4, 1.25));
    const bh = L.map((l) => l.height + 30 * u);
    const gap = 16 * u;
    const top = hy + 110 * u, bottom = H - pad - (scene.headline ? 150 * u : 0);
    // Messages shown so far (with a typing bubble before each reply).
    const shownAt = msgs.map((_, i) => 0.35 + i * span + (i > 0 ? 0.45 : 0));
    let shown = 0;
    shownAt.forEach((t0, i) => g.t >= t0 && (shown = i + 1));
    const typing = shown < n && g.t >= shownAt[shown] - 0.5 && shown > 0;
    const heights = bh.slice(0, shown).reduce((a, h) => a + h + gap, 0) + (typing ? 70 * u + gap : 0);
    const scroll = Math.max(0, top + heights - bottom);
    let y = top - scroll;
    msgs.slice(0, shown).forEach((m, i) => {
      const p = ease.outBack(win(g.t, shownAt[i], 0.35));
      const w = Math.min(maxB, L[i].width + 44 * u);
      const x = m.right ? x0 + colW - w : x0;
      const fill = m.right ? c.accent : mix(c.bg, c.fg, 0.1);
      ctx.save();
      ctx.translate(m.right ? x + w : x, y + bh[i]);
      ctx.scale(lerp(0.6, 1, p), lerp(0.6, 1, p));
      ctx.globalAlpha = clamp(p * 1.5);
      ctx.fillStyle = fill;
      rr(ctx, m.right ? -w : 0, -bh[i], w, bh[i], 26 * u);
      ctx.fill();
      ctx.restore();
      if (p > 0.4) drawLayout(ctx, L[i], { x: x + 22 * u, y: y + 15 * u, align: "left", color: on(g, fill), emColor: m.right ? on(g, fill) : c.accent, t: g.t, delay: shownAt[i], dur: 0.25, mode: "rise", stagger: 0.01 });
      hitLayout(g, `items.${i}`, L[i], x + 22 * u, y + 15 * u, "left");
      y += bh[i] + gap;
    });
    if (typing) {
      const right = msgs[shown].right;
      const w = 110 * u, h = 62 * u, x = right ? x0 + colW - w : x0;
      ctx.fillStyle = right ? rgba(c.accent, 0.5) : mix(c.bg, c.fg, 0.1);
      rr(ctx, x, y, w, h, 26 * u);
      ctx.fill();
      for (let k = 0; k < 3; k++) {
        const a = 0.35 + 0.65 * Math.max(0, Math.sin(g.t * 9 - k * 0.9));
        ctx.fillStyle = rgba(right ? on(g, c.accent) : c.fg, a);
        ctx.beginPath();
        ctx.arc(x + 32 * u + k * 23 * u, y + h / 2, 7 * u, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (scene.headline) {
      const t0 = g.dur - 1.4;
      const p = g.E(win(g.t, t0, 0.6));
      if (p > 0) {
        const HL = layoutText(ctx, scene.headline, F(g, headlineSize(g, 0.7)), colW, 2);
        const hy2 = H - pad - HL.height;
        ctx.save();
        ctx.globalAlpha = p;
        ctx.fillStyle = rgba(c.bg, 0.9);
        ctx.fillRect(0, hy2 - 40 * u, W, H - hy2 + 40 * u);
        ctx.restore();
        hitLayout(g, "headline", HL, W / 2, hy2, "center");
        drawLayout(ctx, HL, { x: W / 2, y: hy2, align: "center", color: c.fg, emColor: c.accent, t: g.t, delay: t0, dur: 0.6, mode: "mask", easing: g.E });
      }
    }
  },

  /** A lock screen filling with notifications, then the line. */
  notification(g) {
    const { W, H, ctx, u, c, scene, brand, pad } = g;
    const im = g.img(scene.image);
    if (im) {
      drawCover(ctx, im, 0, 0, W, H, 1.08 + g.t * 0.01, scene.focus?.x, scene.focus?.y);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, 0, W, H);
    }
    const fg = im ? "#FFFFFF" : c.fg;
    const timeY = g.portrait ? H * 0.12 : H * 0.14;
    const tp = g.E(win(g.t, 0, 0.6));
    ctx.save();
    ctx.globalAlpha = tp;
    drawLabel(ctx, scene.kicker || "9:41", { family: brand.fontDisplay, weight: 600, size: (g.portrait ? 150 : 120) * u * ts(g, "display"), tracking: -0.02 }, W / 2, timeY + (g.portrait ? 75 : 60) * u, "center", fg, 1, W - pad * 2);
    ctx.restore();
    hitText(g, "kicker", scene.kicker || "9:41", F(g, 120 * u), W / 2, timeY + 60 * u, "center");
    const raw = (scene.items?.length ? scene.items : [`${brand.name || "Orbit"}: Your order has shipped 📦`, "Messages: wait, where did you get that?", `${brand.name || "Orbit"}: 2 left in your size`]).slice(0, 5);
    const notes = raw.map((r) => {
      const m = r.match(/^([^:]{1,24}):\s*(.+)$/);
      return { app: m ? m[1].trim() : brand.name || "App", text: m ? m[2] : r };
    });
    const cardW = g.portrait ? W - pad * 1.2 : Math.min(W * 0.46, 900 * u);
    const x = (W - cardW) / 2;
    const fs = (g.portrait ? 32 : 30) * u;
    const n = notes.length;
    const span = Math.max(0.45, (g.dur - (scene.headline ? 1.8 : 0.8)) / n);
    let y = timeY + (g.portrait ? 190 : 150) * u;
    // Newest on top: draw in reverse arrival order.
    const arrived = notes.map((_, i) => 0.5 + i * span).filter((t0) => g.t >= t0).length;
    for (let k = arrived - 1; k >= 0; k--) {
      const nte = notes[k];
      const t0 = 0.5 + k * span;
      const p = ease.outBack(win(g.t, t0, 0.45));
      const L = layoutText(ctx, nte.text, B(g, fs, 500), cardW - 140 * u, 2, 1.25);
      const h = L.height + 80 * u;
      ctx.save();
      ctx.globalAlpha = clamp(p * 1.3);
      ctx.translate(0, (1 - p) * -60 * u);
      ctx.fillStyle = im ? "rgba(255,255,255,0.82)" : mix(c.bg, c.fg, 0.08);
      rr(ctx, x, y, cardW, h, 30 * u);
      ctx.fill();
      ctx.fillStyle = c.accent;
      rr(ctx, x + 24 * u, y + 24 * u, 64 * u, 64 * u, 16 * u);
      ctx.fill();
      drawLabel(ctx, nte.app[0]?.toUpperCase() ?? "•", F(g, 34 * u), x + 56 * u, y + 58 * u, "center", on(g, c.accent));
      const ink = im ? "#111111" : c.fg;
      drawLabel(ctx, nte.app.toUpperCase(), K(g, 19 * u), x + 108 * u, y + 38 * u, "left", rgba(ink, 0.6), 1, cardW - 220 * u);
      drawLabel(ctx, "now", B(g, 20 * u, 500), x + cardW - 26 * u, y + 38 * u, "right", rgba(ink, 0.5));
      drawLayout(ctx, L, { x: x + 108 * u, y: y + 54 * u, align: "left", color: ink, emColor: c.accent, t: 99, delay: 0, dur: 0.01, mode: "rise" });
      ctx.restore();
      hitLayout(g, `items.${k}`, L, x + 108 * u, y + 54 * u, "left");
      y += h + 14 * u;
    }
    if (scene.headline) {
      const t0 = g.dur - 1.5;
      const HL = layoutText(ctx, scene.headline, F(g, headlineSize(g, 0.6)), W - pad * 2, 2);
      const hy = H - pad * 1.1 - HL.height;
      hitLayout(g, "headline", HL, W / 2, hy, "center");
      drawLayout(ctx, HL, { x: W / 2, y: hy, align: "center", color: fg, emColor: c.accent, t: g.t, delay: t0, dur: 0.7, mode: "mask", easing: g.E });
    }
  },

  /** Social-native: footage with a POV caption that pops word by word. */
  "pov-caption"(g) {
    const { W, H, ctx, u, c, scene, pad } = g;
    const im = g.img(scene.image);
    if (im) drawCover(ctx, im, 0, 0, W, H, (1.04 + 0.06 * clamp(g.t / g.dur)) * (scene.zoom ?? 1), scene.focus?.x, scene.focus?.y);
    else {
      // No footage yet: the brand's colours drifting, so the caption still has a world.
      const gr = ctx.createLinearGradient(0, 0, W * (0.6 + 0.4 * Math.sin(g.t * 0.6)), H);
      gr.addColorStop(0, mix(c.bg, c.accent, 0.55));
      gr.addColorStop(1, mix(c.bg, c.fg, 0.08));
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, H);
    }
    // Progress bar like a story.
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(pad * 0.5, pad * 0.4, W - pad, 5 * u);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(pad * 0.5, pad * 0.4, (W - pad) * clamp(g.t / g.dur), 5 * u);
    const em = marked(scene.headline);
    const text = `${scene.kicker ? `${stripMarks(scene.kicker)} ` : ""}${stripMarks(scene.headline || "POV: you finally found the one")}`;
    const words = text.split(/\s+/).filter(Boolean);
    const size = (g.portrait ? 58 : 50) * u;
    const font = { family: g.brand.fontBody, weight: 800, size: size * ts(g, "body"), tracking: -0.01 };
    const maxW = W * (g.portrait ? 0.82 : 0.6);
    const space = measure(ctx, " ", font);
    const lines: string[][] = [[]];
    let lw = 0;
    for (const w of words) {
      const ww = measure(ctx, w, font);
      if (lw + ww > maxW && lines[lines.length - 1].length) lines.push([]), (lw = 0);
      lines[lines.length - 1].push(w);
      lw += ww + space;
    }
    const lh = font.size * 1.32;
    const y0 = H * (g.portrait ? 0.3 : 0.26) - (lines.length * lh) / 2;
    const per = Math.min(0.16, (g.dur * 0.55) / words.length);
    let k = 0;
    lines.forEach((line, li) => {
      const widths = line.map((w) => measure(ctx, w, font));
      const total = widths.reduce((a, b) => a + b, 0) + space * (line.length - 1);
      const firstK = k;
      const vis = line.filter((_, j) => g.t >= 0.2 + (firstK + j) * per).length;
      if (vis) {
        const shownW = widths.slice(0, vis).reduce((a, b) => a + b, 0) + space * (vis - 1);
        const padX = 20 * u;
        ctx.fillStyle = "#FFFFFF";
        rr(ctx, W / 2 - total / 2 - padX, y0 + li * lh - lh * 0.08, shownW + padX * 2, lh * 0.96, 14 * u);
        ctx.fill();
      }
      let x = W / 2 - total / 2;
      line.forEach((w, j) => {
        const t0 = 0.2 + k * per;
        const p = ease.outBack(win(g.t, t0, 0.22));
        if (p > 0) {
          ctx.save();
          ctx.translate(x + widths[j] / 2, y0 + li * lh + lh * 0.4);
          ctx.scale(lerp(0.5, 1, p), lerp(0.5, 1, p));
          drawLabel(ctx, w, font, 0, 0, "center", em.has(plain(w)) ? c.accent : "#111111", clamp(p * 2));
          ctx.restore();
        }
        x += widths[j] + space;
        k++;
      });
    });
    g.hit?.({ field: "headline", x: W / 2 - maxW / 2, y: y0, w: maxW, h: lines.length * lh, size, align: "center", lines: lines.length });
    if (scene.subline) {
      const L = layoutText(ctx, stripMarks(scene.subline), B(g, 30 * u, 600), W - pad * 2, 2, 1.3);
      const y = H - pad * 1.6 - L.height;
      hitLayout(g, "subline", L, W / 2, y, "center");
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 12 * u;
      drawLayout(ctx, L, { x: W / 2, y, align: "center", color: "#FFFFFF", emColor: c.accent, t: g.t, delay: 0.3 + words.length * per, dur: 0.5, mode: "rise", stagger: 0.04 });
      ctx.restore();
    }
  },

  /** Them vs us: crosses on one side, ticks on yours, row by row. */
  versus(g) {
    const { W, H, ctx, u, c, scene, brand, pad } = g;
    const rows = (scene.items?.length ? scene.items : ["Setup in minutes", "No hidden fees", "Human support 24/7", "Cancel anytime"]).slice(0, 6).map((r) => {
      const [label, them, us] = r.split("|").map((x) => x.trim());
      return { label, them, us };
    });
    let top = pad;
    if (scene.headline) {
      const L = layoutText(ctx, scene.headline, F(g, headlineSize(g, 0.5)), W - pad * 2, 2);
      hitLayout(g, "headline", L, W / 2, top, "center");
      drawLayout(ctx, L, { x: W / 2, y: top, align: "center", color: c.fg, emColor: c.accent, t: g.t, delay: 0, dur: 0.7 * g.sp, mode: "mask", easing: g.E });
      top += L.height + 46 * u;
    }
    const tw = Math.min(W - pad * 2, 1200 * u);
    const x0 = (W - tw) / 2;
    const colW = tw * (g.portrait ? 0.22 : 0.2);
    const labW = tw - colW * 2;
    const headH = 70 * u;
    const rowH = Math.min(110 * u, (H - top - pad - headH) / rows.length);
    const usX = x0 + labW + colW;
    // Your column glows.
    const hp = g.E(win(g.t, 0.2, 0.6));
    ctx.save();
    ctx.globalAlpha = hp;
    ctx.fillStyle = rgba(c.accent, 0.14);
    rr(ctx, usX, top, colW, headH + rowH * rows.length + 14 * u, 22 * u);
    ctx.fill();
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 2.5 * u;
    ctx.stroke();
    ctx.restore();
    const themName = stripMarks(scene.kicker || "Others");
    const usName = stripMarks(scene.cta || brand.name || "Us");
    drawLabel(ctx, themName.toUpperCase(), K(g, 20 * u), x0 + labW + colW / 2, top + headH / 2, "center", c.muted, hp, colW * 0.92);
    drawLabel(ctx, usName.toUpperCase(), K(g, 22 * u), usX + colW / 2, top + headH / 2, "center", c.accent, hp, colW * 0.92);
    hitText(g, "kicker", themName.toUpperCase(), K(g, 20 * u), x0 + labW + colW / 2, top + headH / 2, "center");
    hitText(g, "cta", usName.toUpperCase(), K(g, 22 * u), usX + colW / 2, top + headH / 2, "center");
    const step = Math.min(0.55, (g.dur - 1.2) / rows.length);
    rows.forEach((r, i) => {
      const y = top + headH + i * rowH;
      const t0 = 0.5 + i * step;
      const p = g.E(win(g.t, t0, 0.5));
      ctx.fillStyle = rgba(c.fg, 0.08);
      ctx.fillRect(x0, y, tw, 1.5 * u);
      const f = B(g, Math.min(36 * u, rowH * 0.36), 550);
      drawLabel(ctx, r.label, f, x0 + 8 * u + (1 - p) * 20 * u, y + rowH / 2, "left", c.fg, p, labW - 20 * u);
      hitText(g, `items.${i}`, r.label, f, x0 + 8 * u, y + rowH / 2, "left");
      const cx1 = x0 + labW + colW / 2, cx2 = usX + colW / 2, cy = y + rowH / 2;
      const r1 = g.E(win(g.t, t0 + 0.12, 0.35)), r2 = ease.outBack(win(g.t, t0 + 0.3, 0.4));
      if (r.them) drawLabel(ctx, r.them, B(g, 24 * u, 500), cx1, cy, "center", c.muted, r1, colW * 0.92);
      else if (r1 > 0) {
        ctx.save();
        ctx.globalAlpha = r1;
        ctx.strokeStyle = mix(c.muted, "#e5484d", 0.6);
        ctx.lineWidth = 5 * u;
        ctx.lineCap = "round";
        const s = 15 * u;
        ctx.beginPath();
        ctx.moveTo(cx1 - s, cy - s);
        ctx.lineTo(cx1 + s, cy + s);
        ctx.moveTo(cx1 + s, cy - s);
        ctx.lineTo(cx1 - s, cy + s);
        ctx.stroke();
        ctx.restore();
      }
      if (r.us) drawLabel(ctx, r.us, B(g, 26 * u, 700), cx2, cy, "center", c.accent, clamp(r2), colW * 0.92);
      else if (r2 > 0) {
        ctx.save();
        ctx.translate(cx2, cy);
        ctx.scale(r2, r2);
        ctx.fillStyle = c.accent;
        ctx.beginPath();
        ctx.arc(0, 0, 24 * u, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = on(g, c.accent);
        ctx.lineWidth = 5 * u;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(-10 * u, 0);
        ctx.lineTo(-3 * u, 8 * u);
        ctx.lineTo(11 * u, -8 * u);
        ctx.stroke();
        ctx.restore();
      }
    });
  },

  /** Stars fill, the score counts up, a review lands. */
  rating(g) {
    const { W, H, ctx, u, c, scene, pad } = g;
    const st = scene.stat ?? { value: 4.9, label: "from 2,000+ reviews" };
    const value = clamp(st.value, 0, 5);
    const cy = H * (g.portrait ? 0.32 : 0.3);
    const R = Math.min(W / 13, 64 * u * (g.portrait ? 1.2 : 1));
    const gap = R * 2.35;
    const fill = clamp((g.t - 0.3) / (1.2 * g.sp)) * value;
    for (let i = 0; i < 5; i++) {
      const cx = W / 2 + (i - 2) * gap;
      const pop = ease.outBack(win(g.t, 0.05 * i, 0.4));
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(pop, pop);
      star(ctx, 0, 0, R);
      ctx.fillStyle = rgba(c.fg, 0.12);
      ctx.fill();
      const part = clamp(fill - i);
      if (part > 0) {
        ctx.save();
        ctx.clip();
        ctx.fillStyle = c.accent;
        ctx.fillRect(-R, -R, R * 2 * part, R * 2);
        ctx.restore();
      }
      ctx.restore();
    }
    const shown = (Math.round(fill * 10) / 10).toFixed(st.decimals ?? 1);
    const ny = cy + R + 110 * u;
    drawLabel(ctx, `${st.prefix ?? ""}${shown}${st.suffix ?? ""}`, F(g, 150 * u), W / 2, ny, "center", c.fg, win(g.t, 0.2, 0.4));
    if (st.label) {
      drawLabel(ctx, st.label, B(g, 28 * u, 500), W / 2, ny + 100 * u, "center", c.muted, win(g.t, 0.8, 0.5));
      hitText(g, "stat.label", st.label, B(g, 28 * u, 500), W / 2, ny + 100 * u, "center");
    }
    if (scene.headline) {
      const L = layoutText(ctx, `“${stripMarks(scene.headline)}”`, B(g, (g.portrait ? 40 : 36) * u, 500), Math.min(W - pad * 2, 1100 * u), 3, 1.3);
      const y = ny + 170 * u;
      hitLayout(g, "headline", L, W / 2, y, "center");
      drawLayout(ctx, L, { x: W / 2, y, align: "center", color: c.fg, emColor: c.accent, t: g.t, delay: 1.2, dur: 0.7, mode: "rise", stagger: 0.03, easing: ease.outCubic });
      if (scene.author) drawLabel(ctx, `— ${scene.author}`, B(g, 24 * u, 600), W / 2, y + L.height + 40 * u, "center", c.muted, win(g.t, 1.6, 0.5));
    }
  },

  /** A dark stage; a beam sweeps in and lands on the product. */
  spotlight(g) {
    const { W, H, ctx, u, c, scene, pad } = g;
    const im = g.img(scene.image);
    const cx = W / 2, cy = H * (g.portrait ? 0.42 : 0.44);
    const bw = W * (g.portrait ? 0.7 : 0.4), bh = H * (g.portrait ? 0.42 : 0.55);
    if (im) {
      const r = containRect(im, cx - bw / 2, cy - bh / 2, bw, bh);
      const fl = Math.sin(g.t * 1.4) * 6 * u;
      ctx.drawImage(im, r.x, r.y + fl, r.w, r.h);
    } else placeholder(g, cx - bw / 3, cy - bh / 3, (bw * 2) / 3, (bh * 2) / 3);
    // Where the beam is: sweeping from the corner, settling on the product.
    const p = ease.inOutCubic(win(g.t, 0.15, 1.3 * g.sp));
    const sx = lerp(W * 0.12, cx, p) + Math.sin(g.t * 2.2) * (1 - p) * W * 0.05;
    const sy = lerp(H * 0.2, cy, p);
    const R = Math.min(W, H) * lerp(0.16, 0.36, p);
    const dark = ctx.createRadialGradient(sx, sy, R * 0.55, sx, sy, R * 1.25);
    dark.addColorStop(0, "rgba(0,0,0,0)");
    dark.addColorStop(1, "rgba(0,0,0,0.9)");
    ctx.fillStyle = dark;
    ctx.fillRect(0, 0, W, H);
    // The cone of light from above.
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const cone = ctx.createLinearGradient(sx, 0, sx, sy);
    cone.addColorStop(0, rgba(mix(c.accent, "#ffffff", 0.7), 0.0));
    cone.addColorStop(1, rgba(mix(c.accent, "#ffffff", 0.7), 0.16));
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(sx - R * 0.15, 0);
    ctx.lineTo(sx + R * 0.15, 0);
    ctx.lineTo(sx + R, sy);
    ctx.lineTo(sx - R, sy);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    if (scene.headline || scene.subline) {
      const y = cy + bh / 2 + 30 * u;
      const L = scene.headline ? layoutText(ctx, scene.headline, F(g, headlineSize(g, 0.55)), W - pad * 2, 2) : null;
      if (L) {
        hitLayout(g, "headline", L, W / 2, y, "center");
        drawLayout(ctx, L, { x: W / 2, y, align: "center", color: "#FFFFFF", emColor: c.accent, t: g.t, delay: 1.2 * g.sp, dur: 0.8, mode: "mask", easing: g.E });
      }
      if (scene.subline) {
        const S = layoutText(ctx, stripMarks(scene.subline), B(g, 28 * u, 500), W - pad * 2, 2, 1.3);
        const sy2 = y + (L?.height ?? 0) + 24 * u;
        hitLayout(g, "subline", S, W / 2, sy2, "center");
        drawLayout(ctx, S, { x: W / 2, y: sy2, align: "center", color: "rgba(255,255,255,0.75)", emColor: c.accent, t: g.t, delay: 1.5 * g.sp, dur: 0.6, mode: "rise", stagger: 0.04 });
      }
    }
  },

  /** A kinetic poster: each word slams in, sized to fill the width. */
  "word-stack"(g) {
    const { W, H, ctx, u, c, scene, brand, pad } = g;
    const em = marked(scene.headline);
    const words = stripMarks(scene.headline || "Make them stop scrolling").toUpperCase().split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    for (const w of words) {
      const last = lines[lines.length - 1];
      if (last && words.length > 5 && last.length + w.length < 9) lines[lines.length - 1] = `${last} ${w}`;
      else lines.push(w);
    }
    const f100 = F(g, 100);
    const sizes = lines.map((l) => ((W - pad * 2) / Math.max(1, measure(ctx, l, f100))) * 100);
    const capped = sizes.map((s) => Math.min(s, H * 0.3));
    const total = capped.reduce((a, s) => a + s * 0.9, 0);
    const k = Math.min(1, (H - pad * 2) / total);
    let y = H / 2 - (total * k) / 2;
    const step = Math.min(0.28, (g.dur * 0.6) / lines.length);
    lines.forEach((l, i) => {
      const size = capped[i] * k;
      const p = g.E(win(g.t, 0.1 + i * step, 0.45 * g.sp));
      const isEm = l.split(" ").some((w) => em.has(plain(w)));
      const fill = isEm ? c.accent : i % 2 ? mix(c.fg, c.bg, 0.12) : c.fg;
      ctx.save();
      ctx.translate(W / 2 + (1 - p) * (i % 2 ? 1 : -1) * W * 0.6, y + size * 0.45);
      ctx.rotate((1 - p) * (i % 2 ? 0.12 : -0.12));
      ctx.scale(1, lerp(0.2, 1, p));
      drawLabel(ctx, l, { family: brand.fontDisplay, weight: displayWeight(brand.fontDisplay), size: size * ts(g, "display"), tracking: -0.02 }, 0, 0, "center", fill, clamp(p * 2));
      ctx.restore();
      y += size * 0.9;
    });
    g.hit?.({ field: "headline", x: pad, y: H / 2 - (total * k) / 2, w: W - pad * 2, h: total * k, size: 60 * u, align: "center", lines: lines.length });
  },
};
