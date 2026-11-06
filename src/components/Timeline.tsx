import { useEffect, useRef, useState } from "react";
import { useStudio, setState, getState, updateProject } from "../store";
import { timeline, totalDuration } from "../engine/render";
import { clock, useClock } from "../clock";
import { stripMarks } from "../engine/text";

const TEMPLATE_COLORS: Record<string, string> = {
  "title-reveal": "#8B6CFF", "kinetic-words": "#C8FF3D", "product-hero": "#FF8A3D", "split-feature": "#3DB8FF", "feature-list": "#3DFFB1",
  "stat-counter": "#FF4D6D", "image-mosaic": "#FFD23D", fullbleed: "#FF9ED8", quote: "#B0A8FF", marquee: "#7DF9FF", "shape-burst": "#FFFFFF",
  "logo-sting": "#F5A3FF", "cta-end": "#FF4D1A",
};

export function Timeline() {
  const project = useStudio((s) => s.project);
  const selected = useStudio((s) => s.selected);
  const c = useClock();
  const track = useRef<HTMLDivElement>(null);
  const wave = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(800);
  const total = Math.max(totalDuration(project), project.audio?.duration ?? 0, 0.1);
  const pxs = width / total;
  const tl = timeline(project.scenes);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(track.current!);
    return () => ro.disconnect();
  }, []);

  // waveform
  useEffect(() => {
    const cv = wave.current;
    const a = project.audio;
    if (!cv || !a) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = width * dpr;
    cv.height = 40 * dpr;
    const ctx = cv.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, 40);
    const aw = a.duration * pxs;
    ctx.fillStyle = "rgba(128,128,128,.12)";
    for (const p of a.pauses) ctx.fillRect(p.s * pxs, 0, (p.e - p.s) * pxs, 40);
    const css = getComputedStyle(document.documentElement);
    ctx.fillStyle = css.getPropertyValue("--text-2").trim() || "#999";
    const n = a.peaks.length;
    for (let x = 0; x < aw; x += 2) {
      const v = a.peaks[Math.floor((x / aw) * n)] ?? 0;
      const h = Math.max(1, v * 34);
      ctx.fillRect(x, 20 - h / 2, 1.2, h);
    }
    if (a.words) {
      ctx.fillStyle = css.getPropertyValue("--accent").trim() || "#c8ff3d";
      for (const w of a.words) ctx.fillRect(w.s * pxs, 36, Math.max(1, (w.e - w.s) * pxs - 1), 3);
    }
  }, [project.audio, width, pxs]);

  const seekFromEvent = (e: React.PointerEvent | React.MouseEvent) => {
    const r = track.current!.getBoundingClientRect();
    clock.seek(((e.clientX - r.left) / r.width) * total);
  };

  const startResize = (e: React.PointerEvent, index: number) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const orig = getState().project;
    const d0 = orig.scenes[index].duration;
    const move = (ev: PointerEvent) => {
      const d = Math.max(0.8, Math.round((d0 + (ev.clientX - startX) / pxs) * 10) / 10);
      setState({ project: { ...orig, scenes: orig.scenes.map((s, i) => (i === index ? { ...s, duration: d } : s)) } });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const final = getState().project;
      setState({ project: orig });
      updateProject(() => final);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const ticks = Math.min(12, Math.ceil(total / 5));
  return (
    <div className="timeline">
      <div className="ruler">
        {Array.from({ length: ticks + 1 }, (_, i) => (
          <span key={i}>{((total / ticks) * i).toFixed(0)}s</span>
        ))}
      </div>
      <div className="tl-track" ref={track} onPointerDown={seekFromEvent}>
        {tl.map((e) => (
          <div
            key={e.scene.id}
            className={`tl-scene ${selected === e.index ? "sel" : ""}`}
            style={{ left: e.start * pxs + 2, width: Math.max(8, e.scene.duration * pxs - 4) }}
            onPointerDown={(ev) => {
              ev.stopPropagation();
              setState({ selected: e.index });
              clock.seek(e.start + 0.001);
            }}
            title={`${e.scene.template} · ${e.scene.duration.toFixed(1)}s`}
          >
            <i className="sw" style={{ background: TEMPLATE_COLORS[e.scene.template] }} />
            <b>{stripMarks(e.scene.headline || e.scene.kicker || e.scene.cta || e.scene.template)}</b>
            <span>
              {e.index + 1} · {e.scene.template} · {e.scene.duration.toFixed(1)}s
            </span>
            <div className="tl-handle" onPointerDown={(ev) => startResize(ev, e.index)} />
          </div>
        ))}
        <div className="playhead" style={{ left: (c.time / total) * width - 1 }} />
      </div>
      <div className="tl-audio" onPointerDown={seekFromEvent}>
        {project.audio ? <canvas ref={wave} /> : <div className="empty">Drop a voice-over in the chat or the Voice tab to sync the animation</div>}
      </div>
    </div>
  );
}
