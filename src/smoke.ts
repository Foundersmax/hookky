// Engine smoke test (dev only, not in the production bundle): renders every template in every
// aspect ratio with every background, motion and transition at several moments, plus random junk
// scenes through the cleaner. Fails on any thrown error or on a blank frame. Run: npm run test:engine
import { Renderer } from "./engine/render";
import { ASPECT_SIZE, TEMPLATES, BACKGROUNDS, TRANSITIONS, type Aspect, type Project, type Scene } from "./types";
import { sanitizeScene } from "./sanitize";
import { STYLE_PRESETS } from "./presets";

const ASPECTS = Object.keys(ASPECT_SIZE) as Aspect[];
const MOTIONS = ["calm", "snappy", "bouncy"] as const;

// a tiny opaque test image (data URL) so image templates draw real pixels
const img = (() => {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 48;
  const g = c.getContext("2d")!;
  g.fillStyle = "#3a6";
  g.fillRect(0, 0, 64, 48);
  g.fillStyle = "#fff";
  g.fillRect(20, 10, 24, 28);
  return c.toDataURL("image/png");
})();
let imgEl: HTMLImageElement | undefined;
const getImage = (ref?: string) => (ref ? imgEl : undefined);

const content = (t: Scene["template"]): Partial<Scene> => ({
  kicker: "Introducing",
  headline: t === "quote" ? "The quietest *launch* we have ever shipped, by far." : "Meet *Orbit* today",
  subline: "Titanium body and a ten-day battery.",
  items: ["Titanium body", "Ten-day battery", "Sleep coaching"],
  stat: { value: 10, suffix: " days", label: "Battery life" },
  image: "img",
  images: ["img", "img", "img", "img"],
  cta: "Pre-order now",
  url: "orbit.watch",
  author: "Jane Doe, Wired",
});

function nonBlank(canvas: HTMLCanvasElement) {
  const g = canvas.getContext("2d")!;
  const { width: w, height: h } = canvas;
  const d = g.getImageData(0, 0, w, h).data;
  let min = 255, max = 0;
  for (let i = 0; i < d.length; i += 4 * 97) {
    const v = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return max - min > 12; // something other than a flat fill was drawn
}

async function run() {
  imgEl = await new Promise<HTMLImageElement>((r) => {
    const i = new Image();
    i.onload = () => r(i);
    i.src = img;
  });
  const failures: string[] = [];
  const origError = console.error;
  let renderErrors: string[] = [];
  console.error = (...a: unknown[]) => {
    renderErrors.push(a.map(String).join(" ").slice(0, 200));
  };
  const canvas = document.createElement("canvas");
  const r = new Renderer(canvas, 1920, 1080, 0.25);
  let frames = 0;
  const brand = { name: "Orbit", ...STYLE_PRESETS[1].brand };

  for (const aspect of ASPECTS) {
    const [W, H] = ASPECT_SIZE[aspect];
    r.resize(W, H, 0.25);
    TEMPLATES.forEach((template, ti) => {
      BACKGROUNDS.forEach((background, bi) => {
        const motion = MOTIONS[(ti + bi) % 3];
        const transition = TRANSITIONS[(ti + bi) % TRANSITIONS.length];
        const a: Scene = { id: "a", template, duration: 3, background, motion, transition: "cut", ...content(template) };
        const b: Scene = { id: "b", template: TEMPLATES[(ti + 5) % TEMPLATES.length], duration: 3, background: BACKGROUNDS[(bi + 3) % BACKGROUNDS.length], transition, ...content(TEMPLATES[(ti + 5) % TEMPLATES.length]) };
        const p: Project = { id: "p", title: "t", aspect, style: "noir", brand, captions: bi % 2 === 0, grain: bi % 3 === 0, scenes: [a, b] };
        for (const t of [0, 0.35, 1.5, 2.95, 3.2, 5.9]) {
          renderErrors = [];
          try {
            r.render(p, t, getImage);
          } catch (e) {
            failures.push(`${aspect} ${template}/${background} t=${t}: threw ${(e as Error).message}`);
          }
          if (renderErrors.length) failures.push(`${aspect} ${template}/${background} t=${t}: ${renderErrors[0]}`);
          frames++;
        }
        r.render(p, 1.5, getImage);
        if (!nonBlank(canvas)) failures.push(`${aspect} ${template}/${background}: blank frame at 1.5s`);
      });
    });
  }

  // fuzz: random junk through the cleaner must always render
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const junkValues: unknown[] = [null, undefined, 0, -1, 1e9, NaN, "", "x".repeat(5000), "*", "**", "* *", "\u0000\u0007", [], [null], {}, { value: "a" }, true, "#zz", "javascript:x", "asset:missing"];
  const pick = () => junkValues[Math.floor(rnd() * junkValues.length)];
  const fields = ["template", "duration", "kicker", "headline", "subline", "items", "stat", "image", "images", "cta", "url", "author", "background", "align", "transition", "motion", "accent"];
  for (let k = 0; k < 300; k++) {
    const raw: Record<string, unknown> = {};
    for (const f of fields) if (rnd() < 0.6) raw[f] = f === "template" && rnd() < 0.7 ? TEMPLATES[Math.floor(rnd() * TEMPLATES.length)] : pick();
    const s = sanitizeScene(raw);
    const p: Project = { id: "p", title: "t", aspect: ASPECTS[k % 4], style: "noir", brand, captions: true, grain: false, scenes: [s, sanitizeScene({ ...raw, id: "z" })] };
    r.resize(...ASPECT_SIZE[p.aspect], 0.2);
    for (const t of [0.2, 1.4, s.duration + 0.2]) {
      renderErrors = [];
      try {
        r.render(p, t, getImage);
      } catch (e) {
        failures.push(`fuzz #${k}: threw ${(e as Error).message} for ${JSON.stringify(raw).slice(0, 160)}`);
      }
      if (renderErrors.length) failures.push(`fuzz #${k}: ${renderErrors[0]} for ${JSON.stringify(raw).slice(0, 160)}`);
      frames++;
    }
  }
  console.error = origError;
  const result = { frames, failures: failures.slice(0, 50), failureCount: failures.length };
  (window as any).__smoke = result;
  document.getElementById("out")!.textContent = JSON.stringify(result, null, 2);
}

run().catch((e) => ((window as any).__smoke = { frames: 0, failures: [`runner crashed: ${e?.message ?? e}`], failureCount: 1 }));
