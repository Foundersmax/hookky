import { useRef, useState } from "react";
import type { Asset, Project, Scene } from "../types";
import { ASPECT_SIZE } from "../types";
import { clamp } from "../engine/util";

/** The frame a cropped image fills, as width/height, matching the templates' layouts. */
export function cropAspect(p: Project, s: Scene): number | null {
  const [W, H] = ASPECT_SIZE[p.aspect];
  const pad = Math.min(W, H) * 0.085;
  const portrait = H > W * 1.1;
  if (s.template === "fullbleed" || (s.background === "image" && !["split-feature", "product-hero", "image-mosaic", "logo-sting", "device-mockup", "logo-reveal", "before-after"].includes(s.template))) return W / H;
  if (s.template === "split-feature") return portrait ? (W - pad * 2) / (H * 0.5) : (W * 0.46) / (H - pad * 2);
  if (s.template === "device-mockup") return portrait || W / H < 1.2 ? 0.49 : 1 / 0.62; // phone or laptop screen
  return null;
}

/** Drag the focal point and set the zoom of a scene's image; the box shows exactly what the frame keeps. */
export function Framing({ project, scene, asset, onChange }: { project: Project; scene: Scene; asset: Asset; onChange: (patch: Partial<Scene>) => void }) {
  const aspect = cropAspect(project, scene);
  const box = useRef<HTMLDivElement>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  if (!aspect) return null;
  const fx = scene.focus?.x ?? 0.5, fy = scene.focus?.y ?? 0.5, zoom = scene.zoom ?? 1;

  // Same maths as drawCover: the crop window as fractions of the image.
  let win = { w: 1, h: 1, x: 0, y: 0 };
  if (nat) {
    const ir = nat.w / nat.h;
    let sw = 1, sh = 1;
    if (ir > aspect) sw = aspect / ir;
    else sh = ir / aspect;
    sw /= zoom;
    sh /= zoom;
    win = { w: sw, h: sh, x: (1 - sw) * fx, y: (1 - sh) * fy };
  }
  const setFrom = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    onChange({ focus: { x: +clamp((e.clientX - r.left) / r.width).toFixed(3), y: +clamp((e.clientY - r.top) / r.height).toFixed(3) } });
  };

  return (
    <div className="field framing">
      <label>Framing</label>
      <div
        ref={box}
        className="framing-box"
        style={{ aspectRatio: nat ? `${nat.w} / ${nat.h}` : "16 / 10", width: nat ? `min(100%, ${Math.round((220 * nat.w) / nat.h)}px)` : "100%" }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          setFrom(e);
        }}
        onPointerMove={(e) => e.buttons === 1 && setFrom(e)}
        role="slider"
        aria-label="Focal point"
        aria-valuetext={`${Math.round(fx * 100)}% across, ${Math.round(fy * 100)}% down`}
        tabIndex={0}
        onKeyDown={(e) => {
          const d = e.shiftKey ? 0.1 : 0.02;
          const m: Record<string, [number, number]> = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] };
          if (!m[e.key]) return;
          e.preventDefault();
          e.stopPropagation();
          onChange({ focus: { x: +clamp(fx + m[e.key][0]).toFixed(3), y: +clamp(fy + m[e.key][1]).toFixed(3) } });
        }}
      >
        <img src={asset.thumb ?? asset.src} alt="" draggable={false} onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
        <div className="framing-window" style={{ left: `${win.x * 100}%`, top: `${win.y * 100}%`, width: `${win.w * 100}%`, height: `${win.h * 100}%` }} />
        <span className="framing-dot" style={{ left: `${fx * 100}%`, top: `${fy * 100}%` }} />
      </div>
      <div className="row framing-zoom">
        <span className="tiny">Zoom {zoom.toFixed(1)}×</span>
        <input type="range" min={1} max={3} step={0.05} value={zoom} aria-label="Image zoom" onChange={(e) => onChange({ zoom: +e.target.value })} />
        <button className="btn ghost" disabled={!scene.focus && !scene.zoom} onClick={() => onChange({ focus: undefined, zoom: undefined })}>
          Reset
        </button>
      </div>
      <span className="tiny">Drag to set the focal point. The bright box is what the scene shows.</span>
    </div>
  );
}
