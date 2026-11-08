import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStudio, updateProject, getState, setState, readField, writeField, assignImage, addAssets } from "../store";
import { Renderer, timeline, totalDuration, type HitRegion } from "../engine/render";
import { ASPECT_SIZE } from "../types";
import { clock, useClock } from "../clock";
import { images } from "../runtime";
import { Icon } from "./Icon";
import { fileToUploadAsset } from "./ChatPanel";
import { EmptyCanvas } from "./EmptyCanvas";

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
  // ---- direct editing on the canvas
  const [hover, setHover] = useState<HitRegion | null>(null);
  const [edit, setEdit] = useState<{ hit: HitRegion; scene: number; value: string } | null>(null);
  const [dropping, setDropping] = useState(false);
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

  const draw = () => {
    images.videos.playing = clock.playing;
    renderer.current?.render(getState().project, clock.time, images.get);
  };
  useEffect(() => images.listen(draw), []);
  useEffect(() => images.videos.listen(draw), []);
  useEffect(() => {
    clock.duration = totalDuration(project);
    if (clock.time > clock.duration) clock.seek(0);
    draw();
  }, [project]);
  useEffect(() => clock.subscribe(draw), []);

  /** Map a pointer position on the canvas to canvas (logical) pixels. */
  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const hitAt = (e: { clientX: number; clientY: number }) => {
    const rnd = renderer.current;
    if (!rnd) return null;
    const { x, y } = toCanvas(e);
    const padPx = Math.min(W, H) * 0.008;
    // smallest region first, so a label inside a bigger block wins
    const found = rnd.hits.filter((h) => x >= h.x - padPx && x <= h.x + h.w + padPx && y >= h.y - padPx && y <= h.y + h.h + padPx).sort((a, b) => a.w * a.h - b.w * b.h)[0];
    return found ?? null;
  };
  const onCanvasMove = (e: React.PointerEvent) => {
    if (clock.playing || edit || full !== "off") return;
    const h = hitAt(e);
    setHover((prev) => (prev?.field === h?.field && prev?.x === h?.x && prev?.y === h?.y ? prev : h));
  };
  const onCanvasClick = (e: React.MouseEvent) => {
    if (full !== "off" || clock.playing) return clock.toggle();
    const h = hitAt(e);
    const idx = renderer.current?.hitScene ?? -1;
    if (h && idx >= 0) {
      setState({ selected: idx });
      setHover(null);
      setEdit({ hit: h, scene: idx, value: readField(getState().project.scenes[idx], h.field) });
    } else clock.toggle();
  };
  const commitEdit = () => {
    setEdit((cur) => {
      if (cur && !writeField(cur.scene, cur.hit.field, cur.value)) setState({ notice: "That needs to be a number." });
      return null;
    });
  };
  const sceneOnScreen = () => {
    const t = timeline(getState().project.scenes);
    return Math.max(0, t.findIndex((x) => clock.time >= x.start && clock.time < x.end));
  };
  const onCanvasDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const idx = sceneOnScreen();
    const id = e.dataTransfer.getData("application/x-hookky-asset");
    if (id) return assignImage(idx, id);
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
    if (file) {
      const asset = await fileToUploadAsset(file);
      addAssets([asset]);
      assignImage(idx, asset.id);
    }
  };
  // Overlay geometry: canvas pixels → stage pixels.
  const place = (h: HitRegion) => {
    const el = canvas.current;
    const k = box.w / W;
    return { left: (el?.offsetLeft ?? 0) + h.x * k, top: (el?.offsetTop ?? 0) + h.y * k, width: h.w * k, height: h.h * k };
  };
  const outlineStyle = (h: HitRegion) => {
    const r = place(h);
    return { left: r.left - 6, top: r.top - 4, width: r.width + 12, height: r.height + 8 };
  };
  const editorStyle = (h: HitRegion) => {
    const r = place(h);
    const stageW = wrap.current?.clientWidth ?? 800;
    const width = Math.min(stageW - 24, Math.max(r.width + 24, 260));
    const left = Math.max(12, Math.min(stageW - width - 12, h.align === "center" ? r.left + r.width / 2 - width / 2 : r.left - 12));
    return { left, top: Math.max(8, r.top - 8), width };
  };

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
        <canvas
          ref={canvas}
          style={{ width: box.w, height: box.h, cursor: hover && !c.playing ? "text" : undefined }}
          onClick={onCanvasClick}
          onPointerMove={onCanvasMove}
          onPointerLeave={() => setHover(null)}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("application/x-hookky-asset") && !e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDropping(true);
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={onCanvasDrop}
          aria-label="Preview. Click text to edit it; drop an image to use it in this scene."
        />
        {!project.scenes.length && full === "off" && <EmptyCanvas />}
        {hover && !edit && !c.playing && full === "off" && <div className="hit-outline" style={outlineStyle(hover)} aria-hidden />}
        {dropping && <div className="drop-hint" style={{ width: box.w, height: box.h }}>Drop to use this image in the scene</div>}
        {edit && (
          <div className="text-editor" style={editorStyle(edit.hit)}>
            <textarea
              autoFocus
              value={edit.value}
              rows={Math.min(4, Math.max(1, edit.hit.lines))}
              aria-label={`Edit ${edit.hit.field}`}
              style={{ fontFamily: `"${/headline|stat.value|cta|kicker/.test(edit.hit.field) ? project.brand.fontDisplay : project.brand.fontBody}", Inter, sans-serif`, fontSize: Math.min(44, Math.max(14, edit.hit.size * (box.w / W))) }}
              onChange={(e) => setEdit({ ...edit, value: e.target.value })}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") setEdit(null);
                else if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  commitEdit();
                }
              }}
              onBlur={commitEdit}
            />
            <span className="text-editor-hint">
              {edit.hit.field === "stat.value" ? "A number" : "*word* for accent"} · <kbd>Enter</kbd> save · <kbd>Esc</kbd> cancel
            </span>
          </div>
        )}
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
        {!!tl.length && (
          <span className="scene-info" title={`${cur?.scene.template ?? ""} · ${W}×${H}`}>
            Scene {cur ? cur.index + 1 : 0}/{tl.length}
          </span>
        )}
        <span className="spacer" />
        <label className="toggle hide-sm">
          <input type="checkbox" checked={project.captions} onChange={(e) => updateProject((p) => ({ ...p, captions: e.target.checked }))} />
          Captions
        </label>
        <label className="toggle hide-sm">
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
