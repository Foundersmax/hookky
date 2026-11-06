import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStudio, updateProject, getState } from "../store";
import { Renderer, timeline, totalDuration } from "../engine/render";
import { ASPECT_SIZE } from "../types";
import { clock, useClock } from "../clock";
import { images } from "../runtime";
import { Icon } from "./Icon";

export const fmt = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
};

export function Stage() {
  const project = useStudio((s) => s.project);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<Renderer | null>(null);
  const [box, setBox] = useState({ w: 640, h: 360 });
  const c = useClock();
  const [W, H] = ASPECT_SIZE[project.aspect];

  // fit canvas into the stage
  useLayoutEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const narrow = window.innerWidth <= 900; // stacked layout: size from width, cap at 70% of the screen
      const pad = narrow ? 24 : 32;
      const availW = r.width - pad;
      const availH = narrow ? window.innerHeight * 0.7 : r.height - pad;
      const s = Math.min(availW / W, availH / H);
      setBox({ w: Math.max(100, Math.floor(W * s)), h: Math.max(100, Math.floor(H * s)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);

  useEffect(() => {
    const scale = Math.min(1, (box.w * (window.devicePixelRatio || 1)) / W);
    if (!renderer.current) renderer.current = new Renderer(canvas.current!, W, H, scale);
    else renderer.current.resize(W, H, scale);
    draw();
  }, [box, W, H]);

  const draw = () => renderer.current?.render(getState().project, clock.time, images.get);
  useEffect(() => {
    images.onLoad = draw;
  }, []);
  useEffect(() => {
    clock.duration = totalDuration(project);
    draw();
  }, [project]);
  useEffect(() => clock.subscribe(draw), []);

  const tl = timeline(project.scenes);
  const cur = tl.find((e) => c.time >= e.start && c.time < e.end) ?? tl[tl.length - 1];

  return (
    <>
      <div className="stage" ref={wrap}>
        <canvas ref={canvas} style={{ width: box.w, height: box.h }} onClick={() => clock.toggle()} />
      </div>
      <div className="transport">
        <button className="btn icon primary" onClick={() => clock.toggle()} title="Play / pause (Space)">
          <Icon name={c.playing ? "pause" : "play"} />
        </button>
        <span className="time">
          {fmt(c.time)} / {fmt(totalDuration(project))}
        </span>
        <button className={`btn icon ghost`} title="Loop" style={{ color: c.loop ? "var(--text)" : "var(--text-3)" }} onClick={() => ((clock.loop = !clock.loop), clock.seek(clock.time))}>
          <Icon name="loop" />
        </button>
        <span className="scene-info">
          Scene {cur ? cur.index + 1 : 0}/{tl.length} · {cur?.scene.template} · {W}×{H}
        </span>
        <span className="spacer" />
        <label className="toggle">
          <input type="checkbox" checked={project.captions} onChange={(e) => updateProject((p) => ({ ...p, captions: e.target.checked }))} />
          Captions
        </label>
        <label className="toggle">
          <input type="checkbox" checked={project.grain} onChange={(e) => updateProject((p) => ({ ...p, grain: e.target.checked }))} />
          Film grain
        </label>
      </div>
    </>
  );
}
