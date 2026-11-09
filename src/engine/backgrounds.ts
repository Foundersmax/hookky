// Animated backgrounds behind type. Each one is drawn in the scene's own colours at a level that
// keeps the text readable; rays, rings and waves also move with the soundtrack (g.level).
import type { G } from "./render";
import { rgba, mix, clamp, ease, win } from "./util";

type Bg = (g: G) => void;
const soundAt = (g: G) => g.level(g.abs + g.t);

export const EXTRA_BACKGROUNDS: Record<string, Bg> = {
  /** A slow mesh of colour pools drifting across each other. */
  mesh(g) {
    const { ctx, W, H, c, t } = g;
    const cols = [c.accent, mix(c.accent, "#3BC9FF", 0.6), mix(c.accent, "#FF5FA2", 0.6), mix(c.bg, c.fg, 0.25)];
    cols.forEach((col, i) => {
      const x = W * (0.5 + 0.42 * Math.sin(t * 0.32 + i * 1.7));
      const y = H * (0.5 + 0.42 * Math.cos(t * 0.27 + i * 2.3));
      const R = Math.max(W, H) * 0.6;
      const gr = ctx.createRadialGradient(x, y, 0, x, y, R);
      gr.addColorStop(0, rgba(col, 0.32));
      gr.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, H);
    });
  },

  /** A sunburst turning slowly, pushing out on the voice or the beat. */
  rays(g) {
    const { ctx, W, H, c, t } = g;
    const n = 18, R = Math.hypot(W, H);
    const kick = soundAt(g);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(t * 0.12);
    ctx.scale(1 + kick * 0.06, 1 + kick * 0.06);
    ctx.fillStyle = rgba(mix(c.fg, c.accent, 0.4), 0.06 + kick * 0.05);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R, a, a + Math.PI / n);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    const gr = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.min(W, H) * 0.55);
    gr.addColorStop(0, rgba(c.bg, 0.65));
    gr.addColorStop(1, rgba(c.bg, 0));
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H);
  },

  /** Bold diagonal stripes sliding past. */
  stripes(g) {
    const { ctx, W, H, c, t, u } = g;
    const w = 70 * u, off = (t * 60 * u) % (w * 2);
    ctx.save();
    ctx.fillStyle = rgba(c.accent, 0.1);
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-Math.PI / 5);
    const L = Math.hypot(W, H);
    for (let x = -L + off; x < L; x += w * 2) ctx.fillRect(x, -L, w, L * 2);
    ctx.restore();
  },

  /** Flowing lines, their swell following the soundtrack. */
  waves(g) {
    const { ctx, W, H, c, t, u } = g;
    const lv = soundAt(g);
    ctx.save();
    ctx.lineWidth = 2 * u;
    for (let k = 0; k < 9; k++) {
      const y0 = H * (0.15 + k * 0.09);
      ctx.strokeStyle = rgba(k % 3 ? c.fg : c.accent, k % 3 ? 0.07 : 0.22);
      ctx.beginPath();
      for (let x = 0; x <= W; x += 12 * u) {
        const y = y0 + Math.sin(x / (160 * u) + t * 1.2 + k * 0.7) * (22 * u + lv * 40 * u) * Math.sin(k * 0.6 + 1);
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  },

  /** A checkerboard drifting diagonally. */
  checker(g) {
    const { ctx, W, H, c, t, u } = g;
    const s = 90 * u, ox = (t * 24 * u) % (s * 2), oy = (t * 14 * u) % (s * 2);
    ctx.fillStyle = rgba(c.fg, 0.05);
    for (let y = -s * 2 + oy; y < H + s; y += s) for (let x = -s * 2 + ox; x < W + s; x += s) if (((Math.round((x - ox) / s) + Math.round((y - oy) / s)) & 1) === 0) ctx.fillRect(x, y, s, s);
  },

  /** Rings rippling out from the centre, a new one on each push of the sound. */
  rings(g) {
    const { ctx, W, H, c, t, u } = g;
    const lv = soundAt(g);
    const maxR = Math.hypot(W, H) / 2;
    ctx.save();
    ctx.lineWidth = (2 + lv * 6) * u;
    for (let k = 0; k < 7; k++) {
      const p = ((t * 0.35 + k / 7) % 1);
      const r = p * maxR;
      ctx.strokeStyle = rgba(k % 2 ? c.accent : c.fg, (1 - p) * (k % 2 ? 0.3 : 0.1));
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  },

  /** Soft ribbons of light across the top of the frame. */
  aurora(g) {
    const { ctx, W, H, c, t } = g;
    const cols = [c.accent, mix(c.accent, "#2CF5C1", 0.6), mix(c.accent, "#8A5CFF", 0.6)];
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    cols.forEach((col, i) => {
      const gr = ctx.createLinearGradient(0, 0, 0, H * 0.75);
      gr.addColorStop(0, rgba(col, 0));
      gr.addColorStop(0.35, rgba(col, 0.22));
      gr.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.moveTo(0, H * 0.75);
      for (let x = 0; x <= W; x += W / 24) ctx.lineTo(x, H * (0.18 + 0.12 * Math.sin(x / W * 4 + t * 0.6 + i * 2)) + i * H * 0.05);
      ctx.lineTo(W, H * 0.75);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();
  },

  /** Stars streaming toward the camera. */
  starfield(g) {
    const { ctx, W, H, c, t, u } = g;
    const cx = W / 2, cy = H / 2, n = 140;
    ctx.save();
    for (let i = 0; i < n; i++) {
      const a = (i * 137.508 * Math.PI) / 180;
      const z = ((i * 0.618 + t * 0.35) % 1);
      const d = z * z * Math.hypot(W, H) * 0.7;
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
      const len = 10 * u * z * 3;
      ctx.strokeStyle = rgba(i % 9 ? c.fg : c.accent, 0.12 + z * 0.5);
      ctx.lineWidth = (0.8 + z * 2) * u;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
    ctx.restore();
  },

  /** A neon grid racing toward the horizon, sunset glow behind. */
  synthwave(g) {
    const { ctx, W, H, c, t, u } = g;
    const hz = H * 0.58;
    const glow = ctx.createRadialGradient(W / 2, hz, 0, W / 2, hz, Math.max(W, H) * 0.5);
    glow.addColorStop(0, rgba(c.accent, 0.35));
    glow.addColorStop(1, rgba(c.accent, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.strokeStyle = rgba(c.accent, 0.4);
    ctx.lineWidth = 1.5 * u;
    ctx.beginPath();
    for (let k = -12; k <= 12; k++) {
      ctx.moveTo(W / 2 + k * W * 0.02, hz);
      ctx.lineTo(W / 2 + k * W * 0.22, H);
    }
    for (let k = 0; k < 14; k++) {
      const p = ((k + (t * 0.9) % 1) / 14) ** 2;
      const y = hz + p * (H - hz);
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = rgba(c.accent, 0.5);
    ctx.fillRect(0, hz - u, W, 2 * u);
  },

  /** Two tones split on a diagonal that slowly swings. */
  split(g) {
    const { ctx, W, H, c, t } = g;
    const s = Math.sin(t * 0.4) * 0.12;
    const p = ease.outCubic(win(t, 0, 0.8));
    ctx.fillStyle = mix(c.bg, c.accent, 0.16);
    ctx.beginPath();
    ctx.moveTo(W * (0.62 + s) * p + W * (1 - p), 0);
    ctx.lineTo(W, 0);
    ctx.lineTo(W, H);
    ctx.lineTo(W * (0.38 - s) * p + W * (1 - p), H);
    ctx.closePath();
    ctx.fill();
    void clamp;
  },
};
