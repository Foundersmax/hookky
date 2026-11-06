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

  // Fullscreen: real browser fullscreen when allowed, otherwise a full-window player.
  const [full, setFull] = useState<"off" | "native" | "window">("off");
  const fullRef = useRef(full);
  fullRef.current = full;
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<number>(0);

  const enterFull = async () => {
    const el = wrap.current!;
    if (document.fullscreenEnabled && el.requestFullscreen) {
      try {
        await el.requestFullscreen();
        return; // fullscreenchange sets the state
      } catch {
        /* blocked in this view: fall back below */
      }
    }
    setFull("window");
  };
  const exitFull = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setFull("off");
  };
  useEffect(() => {
    const onChange = () => setFull((f) => (document.fullscreenElement === wrap.current ? "native" : f === "native" ? "off" : f));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  // The command bar asks for fullscreen with an event.
  useEffect(() => {
    const onReq = () => enterFull();
    window.addEventListener("hookky:fullscreen", onReq);
    return () => window.removeEventListener("hookky:fullscreen", onReq);
  }, []);
  useEffect(() => {
    if (full === "off") return;
    // Browsers exit real fullscreen on Esc themselves; this covers the full-window player and any view that passes Esc through.
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && exitFull();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);
  // Controls show on pointer movement and hide after 2.5s while playing.
  const wake = () => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => clock.playing && setIdle(true), 2500);
  };
  useEffect(() => {
    if (full === "off") return setIdle(false);
    wake();
    return () => clearTimeout(idleTimer.current);
  }, [full, c.playing]);

  // fit canvas into the stage
  useLayoutEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const isFull = fullRef.current !== "off";
      const narrow = !isFull && window.innerWidth <= 900; // stacked layout: size from width, cap at 70% of the screen
      const pad = isFull ? 0 : narrow ? 24 : 32;
      const availW = r.width - pad;
      const availH = narrow ? window.innerHeight * 0.7 : r.height - pad;
      const s = Math.min(availW / W, availH / H);
      setBox({ w: Math.max(100, Math.floor(W * s)), h: Math.max(100, Math.floor(H * s)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H, full]);

  useEffect(() => {
    const scale = Math.min(1, (box.w * (window.devicePixelRatio || 1)) / W);
    if (!renderer.current) renderer.current = new Renderer(canvas.current!, W, H, scale);
    else renderer.current.resize(W, H, scale);
    draw();
  }, [box, W, H]);

  const draw = () => renderer.current?.render(getState().project, clock.time, images.get);
  useEffect(() => images.listen(draw), []);
  useEffect(() => {
    clock.duration = totalDuration(project);
    draw();
  }, [project]);
  useEffect(() => clock.subscribe(draw), []);

  const tl = timeline(project.scenes);
  const cur = tl.find((e) => c.time >= e.start && c.time < e.end) ?? tl[tl.length - 1];

  return (
    <>
      <div
        className={`stage ${full !== "off" ? "is-full" : ""} ${full === "window" ? "window-full" : ""} ${idle ? "idle" : ""}`}
        ref={wrap}
        onPointerMove={full !== "off" ? wake : undefined}
        role={full === "window" ? "dialog" : undefined}
        aria-label={full === "window" ? "Fullscreen preview" : undefined}
      >
        <canvas ref={canvas} style={{ width: box.w, height: box.h }} onClick={() => clock.toggle()} />
        {full !== "off" && (
          <div className="fs-controls" onPointerMove={wake}>
            <button className="fs-btn" onClick={() => clock.toggle()} aria-label={c.playing ? "Pause" : "Play"}>
              <Icon name={c.playing ? "pause" : "play"} size={18} />
            </button>
            <input
              className="fs-scrub"
              type="range"
              aria-label="Seek"
              min={0}
              max={Math.max(0.01, totalDuration(project))}
              step={0.01}
              value={Math.min(c.time, totalDuration(project))}
              onChange={(e) => clock.seek(+e.target.value)}
            />
            <span className="fs-time">
              {fmt(c.time)} / {fmt(totalDuration(project))}
            </span>
            <button className="fs-btn" onClick={exitFull} aria-label="Exit fullscreen" title="Exit fullscreen (Esc)">
              <Icon name="shrink" size={18} />
            </button>
          </div>
        )}
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
        <button className="btn icon ghost" title="Fullscreen preview" aria-label="Fullscreen preview" onClick={enterFull}>
          <Icon name="expand" />
        </button>
      </div>
    </>
  );
}
