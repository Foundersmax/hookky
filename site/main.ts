// Landing page: plays the showcase with the real Hookky engine, in the hero and in four formats.
import { Renderer, totalDuration } from "../src/engine/render";
import { ASPECT_SIZE, type Aspect, type Project } from "../src/types";
import { showcase } from "./showcase";
import { studioUrl } from "./studio";
import { initAuth } from "./auth";

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const noImages = () => undefined;

initAuth();
// The end card of the showcase names the real studio address.
const endCard = showcase.scenes.find((s) => s.template === "cta-end");
if (endCard) endCard.url = new URL(studioUrl()).host;
for (const el of document.querySelectorAll("[data-year]")) el.textContent = String(new Date().getFullYear());

class Player {
  private renderer: Renderer;
  private project: Project;
  private start = performance.now();
  private offset = 0;
  private raf = 0;
  playing = false;
  visible = false;

  constructor(private canvas: HTMLCanvasElement, aspect: Aspect) {
    this.project = { ...showcase, aspect };
    const [W, H] = ASPECT_SIZE[aspect];
    this.renderer = new Renderer(canvas, W, H, 0.5);
    new ResizeObserver(() => this.fit()).observe(canvas);
    new IntersectionObserver(([e]) => {
      this.visible = e.isIntersecting;
      if (this.visible && this.playing) this.loop();
    }).observe(canvas);
    this.fit();
  }
  private fit() {
    const [W, H] = ASPECT_SIZE[this.project.aspect];
    const w = this.canvas.clientWidth || 640;
    this.renderer.resize(W, H, Math.min(1, (w * (devicePixelRatio || 1)) / W));
    this.draw();
  }
  time() {
    const total = totalDuration(this.project);
    return this.playing ? ((performance.now() - this.start) / 1000 + this.offset) % total : this.offset;
  }
  draw(t = this.time()) {
    this.renderer.render(this.project, t, noImages);
  }
  private loop = () => {
    cancelAnimationFrame(this.raf);
    if (!this.playing || !this.visible) return;
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };
  play() {
    this.start = performance.now();
    this.playing = true;
    this.loop();
  }
  pause() {
    this.offset = this.time();
    this.playing = false;
    cancelAnimationFrame(this.raf);
  }
  seek(t: number) {
    this.offset = t;
    this.start = performance.now();
    this.draw(t);
  }
}

async function boot() {
  await Promise.race([
    Promise.all(["Space Grotesk", "Inter", "JetBrains Mono"].flatMap((f) => [document.fonts.load(`500 40px "${f}"`), document.fonts.load(`700 40px "${f}"`)])),
    new Promise((r) => setTimeout(r, 2500)),
  ]);

  const hero = new Player(document.querySelector<HTMLCanvasElement>("#hero-canvas")!, "16:9");
  const formats = [...document.querySelectorAll<HTMLCanvasElement>("[data-aspect]")].map((c) => new Player(c, c.dataset.aspect as Aspect));
  const all = [hero, ...formats];

  const toggle = document.querySelector<HTMLButtonElement>("#hero-toggle")!;
  const setLabel = () => {
    toggle.textContent = hero.playing ? "Pause" : "Play";
    toggle.setAttribute("aria-pressed", String(hero.playing));
  };
  if (reduceMotion) {
    // Show composed frames instead of autoplaying; the visitor can still press Play.
    hero.seek(3.8); // the finished "Ads that move." title
    formats.forEach((p) => p.seek(9.5));
  } else {
    all.forEach((p) => p.play());
  }
  setLabel();
  toggle.addEventListener("click", () => {
    const next = !hero.playing;
    all.forEach((p) => (next ? p.play() : p.pause()));
    setLabel();
  });
}
boot();
