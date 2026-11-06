// Small rendered frames of each scene for the timeline, cached by scene content so only
// changed scenes redraw. Rendering happens in idle time, a few scenes per slice.
import { useEffect, useState } from "react";
import type { Project, Scene } from "../types";
import { ASPECT_SIZE } from "../types";
import { Renderer } from "../engine/render";
import { images } from "../runtime";

const SHOW_H = 36; // displayed height inside a timeline block
const THUMB_H = SHOW_H * 2; // rendered at 2x for sharp edges on retina screens
const cache = new Map<string, string>();
let renderer: Renderer | null = null;

const keyFor = (p: Project, s: Scene) => JSON.stringify([s, p.brand, p.aspect, p.style]);
/** A representative moment: late enough that the scene has animated in. */
const momentFor = (s: Scene) => Math.min(s.duration - 0.05, Math.max(0.9, s.duration * 0.55));

function renderThumb(p: Project, s: Scene): string {
  const [W, H] = ASPECT_SIZE[p.aspect];
  const scale = THUMB_H / H;
  const canvas = renderer?.canvas ?? document.createElement("canvas");
  if (!renderer) renderer = new Renderer(canvas, W, H, scale);
  else renderer.resize(W, H, scale);
  renderer.render({ ...p, scenes: [{ ...s, transition: "cut" }], captions: false, grain: false }, momentFor(s), images.get);
  return canvas.toDataURL("image/jpeg", 0.82);
}

const idle = (fn: () => void) => ((window as any).requestIdleCallback ? (window as any).requestIdleCallback(fn, { timeout: 400 }) : setTimeout(fn, 30));

/** Map of scene id → thumbnail data URL for the current project. */
export function useThumbs(project: Project) {
  const [, bump] = useState(0);
  const [imgTick, setImgTick] = useState(0);
  useEffect(() => images.listen(() => setImgTick((n) => n + 1)), []);

  // Image loads change how scenes look: drop cached thumbs that use images (runs before the render pass).
  // image loads change how scenes look: drop cached thumbs that reference images
  useEffect(() => {
    if (!imgTick) return;
    for (const s of project.scenes) if (s.image || s.images?.length || s.background === "image" || s.template === "logo-sting" || s.template === "cta-end") cache.delete(keyFor(project, s));
  }, [imgTick]);

  useEffect(() => {
    let cancelled = false;
    const todo = project.scenes.filter((s) => !cache.has(keyFor(project, s)));
    if (!todo.length) return;
    const timer = setTimeout(function step() {
      idle(() => {
        if (cancelled) return;
        for (const s of todo.splice(0, 3)) {
          try {
            cache.set(keyFor(project, s), renderThumb(project, s));
          } catch {
            /* a scene that can't render just has no thumbnail */
          }
        }
        bump((n) => n + 1);
        if (todo.length) step();
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [project.scenes, project.brand, project.aspect, project.style, imgTick]);

  if (cache.size > 400) for (const k of [...cache.keys()].slice(0, 200)) cache.delete(k);
  const out = new Map<string, string>();
  for (const s of project.scenes) {
    const url = cache.get(keyFor(project, s));
    if (url) out.set(s.id, url);
  }
  return { thumbs: out, width: Math.round((SHOW_H * ASPECT_SIZE[project.aspect][0]) / ASPECT_SIZE[project.aspect][1]) };
}

let posterRenderer: Renderer | null = null;
/** A small JPEG poster of a project for the dashboard: its second scene (or first) mid-animation. */
export function posterFor(p: Project, height = 180): string {
  if (!p.scenes.length) return "";
  const [W, H] = ASPECT_SIZE[p.aspect];
  const scale = height / H;
  if (!posterRenderer) posterRenderer = new Renderer(document.createElement("canvas"), W, H, scale);
  else posterRenderer.resize(W, H, scale);
  const s = p.scenes[Math.min(1, p.scenes.length - 1)];
  posterRenderer.render({ ...p, scenes: [{ ...s, transition: "cut" }], captions: false, grain: false }, momentFor(s), images.get);
  return posterRenderer.canvas.toDataURL("image/jpeg", 0.8);
}
