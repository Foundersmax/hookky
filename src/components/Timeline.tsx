import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStudio, setState, getState, updateProject, snapPoints, snapCutsToPauses } from "../store";
import { timeline, totalDuration } from "../engine/render";
import { clock, useClock } from "../clock";
import { stripMarks } from "../engine/text";
import { Icon } from "./Icon";
import { useNotes } from "./DirectorNotes";
import { useThumbs } from "./thumbs";

const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
const fmtTick = (t: number, step: number) =>
  t >= 60 ? `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}` : `${step < 1 ? +t.toFixed(2) : Math.round(t)}s`;
const MAX_CANVAS_PX = 30000; // stay under browsers' canvas width limit

const TEMPLATE_COLORS: Record<string, string> = {
  "title-reveal": "#8B6CFF", "kinetic-words": "#C8FF3D", "product-hero": "#FF8A3D", "split-feature": "#3DB8FF", "feature-list": "#3DFFB1",
  "stat-counter": "#FF4D6D", "image-mosaic": "#FFD23D", fullbleed: "#FF9ED8", quote: "#B0A8FF", marquee: "#7DF9FF", "shape-burst": "#FFFFFF",
  "logo-sting": "#F5A3FF", "cta-end": "#FF4D1A",
};

/** Move a scene to a new position (undoable) and keep it selected. */
export function moveScene(from: number, to: number) {
  const { scenes } = getState().project;
  if (from === to || from < 0 || to < 0 || from >= scenes.length || to >= scenes.length) return;
  updateProject((p) => {
    const next = [...p.scenes];
    const [s] = next.splice(from, 1);
    next.splice(to, 0, s);
    return { ...p, scenes: next };
  });
  const start = timeline(getState().project.scenes)[to].start;
  setState({ selected: to });
  clock.seek(start + 0.001);
}

export function Timeline() {
  const project = useStudio((s) => s.project);
  const selected = useStudio((s) => s.selected);
  const c = useClock();
  const track = useRef<HTMLDivElement>(null);
  const wave = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(800);
  const total = Math.max(totalDuration(project), project.audio?.duration ?? 0, 0.1);
  const tl = timeline(project.scenes);
  const notes = useNotes();
  const { thumbs, width: thumbW } = useThumbs(project);
  const sceneWarn = new Map<number, string>();
  for (const n of notes) if (n.level === "warn" && n.scene !== null && !sceneWarn.has(n.scene)) sceneWarn.set(n.scene, n.message);

  // Zoom: 1 = whole project fits the view. Content gets wider and the view scrolls.
  const dpr = window.devicePixelRatio || 1;
  const maxZoom = Math.max(1, Math.min(40, MAX_CANVAS_PX / Math.max(1, viewW * dpr), (total * 300) / Math.max(1, viewW)));
  const [zoomRaw, setZoomRaw] = useState(1);
  const zoom = Math.min(Math.max(1, zoomRaw), maxZoom);
  const width = Math.round(viewW * zoom);
  const pxs = width / total;
  const anchor = useRef<{ t: number; x: number } | null>(null);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setViewW(e.contentRect.width));
    ro.observe(viewport.current!);
    return () => ro.disconnect();
  }, []);

  /** Zoom keeping time `t` under viewport x-offset `x` (defaults: playhead, or view centre). */
  const zoomTo = (z: number, t?: number, x?: number) => {
    const vp = viewport.current!;
    const curPxs = width / total;
    const ax = x ?? (t !== undefined ? vp.clientWidth / 2 : Math.min(Math.max(clock.time * curPxs - vp.scrollLeft, 0), vp.clientWidth) || vp.clientWidth / 2);
    const at = t ?? (vp.scrollLeft + ax) / curPxs;
    anchor.current = { t: at, x: ax };
    setZoomRaw(Math.min(Math.max(1, z), maxZoom));
  };
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a || !viewport.current) return;
    viewport.current.scrollLeft = Math.max(0, a.t * pxs - a.x);
    anchor.current = null;
  }, [pxs]);

  // ⌘/Ctrl + wheel (and trackpad pinch) zooms around the cursor; needs a non-passive listener.
  const zoomRef = useRef({ zoom, zoomTo });
  zoomRef.current = { zoom, zoomTo };
  useEffect(() => {
    const vp = viewport.current!;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const x = e.clientX - vp.getBoundingClientRect().left;
      const { zoom, zoomTo } = zoomRef.current;
      zoomTo(zoom * Math.exp(-e.deltaY * 0.004), undefined, x);
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, []);

  // = / - / 0 keys, ignored while typing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el.tagName === "INPUT" && !["range", "checkbox", "radio", "button", "color"].includes((el as HTMLInputElement).type))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const { zoom, zoomTo } = zoomRef.current;
      if (e.key === "=" || e.key === "+") zoomTo(zoom * 1.5);
      else if (e.key === "-" || e.key === "_") zoomTo(zoom / 1.5);
      else if (e.key === "0") zoomTo(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Keep the playhead in view during playback when zoomed in.
  useLayoutEffect(() => {
    const vp = viewport.current;
    if (!vp || zoom <= 1 || !c.playing) return;
    const x = c.time * pxs;
    if (x < vp.scrollLeft || x > vp.scrollLeft + vp.clientWidth - 24) vp.scrollLeft = Math.max(0, x - vp.clientWidth * 0.1);
  });

  const zoomToScene = (i: number) => {
    const e = tl[i];
    if (!e) return;
    const z = (total / e.scene.duration) * 0.6;
    zoomTo(z, e.start + e.scene.duration / 2);
  };

  // ruler: pick a tick step that keeps labels at least ~70px apart
  const step = TICK_STEPS.find((s) => s * pxs >= 70) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const tickTimes = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => +(i * step).toFixed(3));

  // waveform
  useEffect(() => {
    const cv = wave.current;
    const a = project.audio;
    if (!cv || !a) return;
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
  }, [project.audio, width, pxs, dpr]);

  const seekFromEvent = (e: React.PointerEvent | React.MouseEvent) => {
    const r = track.current!.getBoundingClientRect();
    clock.seek(((e.clientX - r.left) / r.width) * total);
  };

  // ---- snap-to-pause: cuts dragged within SNAP_PX of a pause snap to it (hold Alt to resize freely)
  const [snapOn, setSnapOn] = useState(() => {
    try {
      return localStorage.getItem("hookky.snap") !== "off";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("hookky.snap", snapOn ? "on" : "off");
    } catch {}
  }, [snapOn]);
  const [snapAt, setSnapAt] = useState<number | null>(null);
  const audio = project.audio;
  const points = audio ? snapPoints(audio) : [];
  const SNAP_PX = 10;

  // ---- drag to reorder: click selects; moving 4px+ starts a drag. Others slide aside to preview the drop.
  const [drag, setDrag] = useState<{ id: string; from: number; to: number; blockStart: number } | null>(null);
  const startDrag = (ev: React.PointerEvent, index: number) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    const scenes = getState().project.scenes;
    const entry = timeline(scenes)[index];
    setState({ selected: index });
    clock.seek(entry.start + 0.001);
    // Touch: a sideways swipe should scroll the timeline, so tapping only selects (reorder via the Scene panel).
    if (scenes.length < 2 || ev.pointerType === "touch") return;
    const content = viewport.current!.firstElementChild as HTMLElement;
    const timeAt = (clientX: number) => (clientX - content.getBoundingClientRect().left) / pxs;
    const grab = timeAt(ev.clientX) - entry.start;
    const startX = ev.clientX;
    const dur = entry.scene.duration;
    const total = scenes.reduce((a, s) => a + s.duration, 0);
    let dragging = false;
    let lastX = ev.clientX;
    let current = { to: index, blockStart: entry.start };
    const update = (clientX: number) => {
      const pointer = timeAt(clientX);
      const blockStart = Math.min(Math.max(0, pointer - grab), Math.max(0, total - dur));
      // insertion slot = how many of the other scenes have their midpoint left of the pointer
      let t = 0, to = 0;
      scenes.forEach((s, i) => {
        if (i === index) return;
        if (t + s.duration / 2 < pointer) to++;
        t += s.duration;
      });
      current = { to, blockStart };
      setDrag({ id: entry.scene.id, from: index, to, blockStart });
    };
    // auto-scroll when dragging near the viewport edges (zoomed timelines)
    const edgeTimer = window.setInterval(() => {
      if (!dragging) return;
      const vp = viewport.current!;
      const r = vp.getBoundingClientRect();
      const d = lastX < r.left + 40 ? -14 : lastX > r.right - 40 ? 14 : 0;
      if (d) {
        vp.scrollLeft += d;
        update(lastX);
      }
    }, 16);
    const move = (e: PointerEvent) => {
      lastX = e.clientX;
      if (!dragging && Math.abs(e.clientX - startX) < 4) return;
      dragging = true;
      document.body.classList.add("tl-dragging");
      update(e.clientX);
    };
    const end = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", esc);
      clearInterval(edgeTimer);
      document.body.classList.remove("tl-dragging");
      setDrag(null);
      if (commit && dragging && current.to !== index) moveScene(index, current.to);
    };
    const up = () => end(true);
    const cancel = () => end(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && end(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", esc);
  };

  const startResize = (e: React.PointerEvent, index: number) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const orig = getState().project;
    const d0 = orig.scenes[index].duration;
    const sceneStart = orig.scenes.slice(0, index).reduce((a, s) => a + s.duration, 0);
    const pts = orig.audio && snapOn ? snapPoints(orig.audio) : [];
    const move = (ev: PointerEvent) => {
      const raw = d0 + (ev.clientX - startX) / pxs;
      let d = Math.round(raw * 10) / 10;
      let snapped: number | null = null;
      if (pts.length && !ev.altKey) {
        const end = sceneStart + raw;
        let best = Infinity;
        for (const m of pts) if (Math.abs(m - end) * pxs <= SNAP_PX && Math.abs(m - end) < Math.abs(best - end)) best = m;
        if (best !== Infinity && best - sceneStart >= 0.8) {
          snapped = best;
          d = +(best - sceneStart).toFixed(2);
        }
      }
      d = Math.max(0.8, d);
      setSnapAt(snapped);
      setState({ project: { ...orig, scenes: orig.scenes.map((s, i) => (i === index ? { ...s, duration: d } : s)) } });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setSnapAt(null);
      const final = getState().project;
      setState({ project: orig });
      if (final.scenes[index].duration !== d0) updateProject(() => final);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const snapAllCuts = () => {
    const p = getState().project;
    if (!p.audio) return;
    const { scenes, moved } = snapCutsToPauses(p.scenes, p.audio);
    if (moved) updateProject((pr) => ({ ...pr, scenes }));
    setSnapNote(moved ? `Moved ${moved} cut${moved === 1 ? "" : "s"} onto pauses` : "Cuts already sit on pauses");
    window.setTimeout(() => setSnapNote(null), 2500);
  };
  const [snapNote, setSnapNote] = useState<string | null>(null);

  // While dragging, lay scenes out in the previewed order; the dragged block follows the pointer.
  const layout = (() => {
    if (!drag) return tl;
    const order = tl.filter((e) => e.scene.id !== drag.id);
    order.splice(drag.to, 0, tl[drag.from]);
    let t = 0;
    return order.map((e) => {
      const start = e.scene.id === drag.id ? drag.blockStart : t;
      t += e.scene.duration;
      return { ...e, start };
    });
  })();

  const zoomPct = maxZoom > 1 ? Math.log(zoom) / Math.log(maxZoom) : 0;
  return (
    <div className="timeline">
      <div className="tl-head">
        <span className="label">Timeline</span>
        <span className="tiny tl-hint">Drag scenes to reorder · ⌘/Ctrl + scroll to zoom · double-click to zoom to a scene{audio && snapOn ? " · hold Alt to resize without snapping" : ""}</span>
        <span className="spacer" />
        {snapNote && <span className="tiny tl-note" role="status">{snapNote}</span>}
        <div className="tl-snap" role="group" aria-label="Snap to pauses">
          <button
            className={`btn ghost tl-snap-btn ${snapOn && audio ? "on" : ""}`}
            aria-pressed={snapOn}
            disabled={!audio}
            title={audio ? (snapOn ? "Snapping cuts to voice-over pauses (hold Alt to resize freely)" : "Snapping off") : "Load a voice-over to snap cuts to its pauses"}
            onClick={() => setSnapOn((v) => !v)}
          >
            <Icon name="magnet" /> Snap
          </button>
          <button className="btn ghost tl-snap-btn" disabled={!audio} title="Move every cut onto the nearest pause" onClick={snapAllCuts}>
            Snap cuts
          </button>
        </div>
        <div className="tl-zoom" role="group" aria-label="Timeline zoom">
          <button className="btn icon ghost" title="Zoom out (-)" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => zoomTo(zoom / 1.5)}>
            <Icon name="minus" />
          </button>
          <input
            type="range"
            aria-label="Zoom level"
            min={0}
            max={1}
            step={0.001}
            value={zoomPct}
            disabled={maxZoom <= 1}
            onChange={(e) => zoomTo(Math.pow(maxZoom, +e.target.value))}
          />
          <button className="btn icon ghost" title="Zoom in (=)" aria-label="Zoom in" disabled={zoom >= maxZoom} onClick={() => zoomTo(zoom * 1.5)}>
            <Icon name="plus" />
          </button>
          <span className="tl-zoom-val">{zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}×</span>
          <button className="btn ghost tl-fit" title="Fit the whole timeline (0)" disabled={zoom <= 1} onClick={() => zoomTo(1)}>
            Fit
          </button>
        </div>
      </div>
      <div className="tl-viewport" ref={viewport}>
        <div className="tl-content" style={{ width }}>
          <div className="ruler" onPointerDown={seekFromEvent}>
            {points.map((m, i) => {
              const pause = audio!.pauses[i];
              const strong = !pause || pause.e - pause.s >= 0.5;
              return (
                <i
                  key={`p${i}`}
                  className={`tl-pause-mark ${strong ? "strong" : ""} ${snapAt !== null && Math.abs(snapAt - m) < 0.005 ? "hit" : ""}`}
                  style={{ left: m * pxs }}
                  title={pause ? `Pause ${pause.s.toFixed(2)}–${pause.e.toFixed(2)}s` : "End of voice-over"}
                />
              );
            })}
            {tickTimes.map((t) => (
              <span key={t} style={{ left: t * pxs }} className={t === 0 ? "first" : ""}>
                {fmtTick(t, step)}
              </span>
            ))}
          </div>
          <div className="tl-track" ref={track} onPointerDown={seekFromEvent}>
            {zoom > 1 && tickTimes.map((t) => <i key={t} className="tl-grid" style={{ left: t * pxs }} />)}
            {points.map((m, i) => (
              <i key={`pl${i}`} className={`tl-pause-line ${snapAt !== null && Math.abs(snapAt - m) < 0.005 ? "hit" : ""}`} style={{ left: m * pxs }} />
            ))}
            {layout.map((e) => (
              <div
                key={e.scene.id}
                data-thumb={thumbs.has(e.scene.id) && e.scene.duration * pxs - 4 >= thumbW + 64 ? "" : undefined}
                className={`tl-scene ${selected === e.index ? "sel" : ""} ${drag?.id === e.scene.id ? "dragging" : drag ? "shifting" : ""}`}
                style={{ left: e.start * pxs + 2, width: Math.max(8, e.scene.duration * pxs - 4), ["--thumb-w" as string]: `${thumbW}px` }}
                onPointerDown={(ev) => startDrag(ev, e.index)}
                onDoubleClick={() => zoomToScene(e.index)}
                title={`${e.scene.template} · ${e.scene.duration.toFixed(1)}s · drag to reorder, double-click to zoom`}
              >
                <i className="sw" style={{ background: TEMPLATE_COLORS[e.scene.template] }} />
                {thumbs.has(e.scene.id) && e.scene.duration * pxs - 4 >= thumbW + 64 && (
                  <img className="tl-thumb" src={thumbs.get(e.scene.id)} alt="" draggable={false} style={{ width: thumbW }} />
                )}
                {sceneWarn.has(e.index) && <i className="tl-warn" title={sceneWarn.get(e.index)} aria-label="Has a director's note" />}
                <b>{stripMarks(e.scene.headline || e.scene.kicker || e.scene.cta || e.scene.template)}</b>
                <span>
                  {e.index + 1} · {e.scene.template} · {e.scene.duration.toFixed(1)}s
                </span>
                <div className="tl-handle" onPointerDown={(ev) => startResize(ev, e.index)} />
              </div>
            ))}
            <div className="playhead" style={{ left: c.time * pxs - 1 }} />
          </div>
          <div className="tl-audio" onPointerDown={seekFromEvent}>
            {project.audio ? <canvas ref={wave} style={{ width }} /> : <div className="empty">Drop a voice-over in the chat or the Voice tab to sync the animation</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
