import { useEffect, useRef } from "react";
import { useStudio, updateProject } from "../store";
import { cleanCaptionStyle } from "../sanitize";
import type { CaptionStyle, Word } from "../types";
import { CAPTION_DESIGNS, CAPTION_COLORS, renderCaptions } from "../engine/captions";

// A sample line for the thumbnails, with the third word being "spoken".
const SAMPLE: Word[] = ["Make", "every", "word", "land."].map((w, i) => ({ w, s: i * 0.4, e: i * 0.4 + 0.36 }));

function Thumb({ design, style }: { design: CaptionStyle["design"]; style: CaptionStyle }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const brand = useStudio((s) => s.project.brand);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = 168, H = 76;
    c.width = W * dpr;
    c.height = H * dpr;
    const x = c.getContext("2d")!;
    const draw = () => {
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      const g = x.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "#3b3f4a");
      g.addColorStop(1, "#14161b");
      x.fillStyle = g;
      x.fillRect(0, 0, W, H);
      // the thumbnail keeps the user's colour and capitals, but always its own design, centred
      renderCaptions(x, W, H, { words: SAMPLE, style: { ...style, design, position: "middle", size: "m", words: design === "pop" ? 2 : 4 }, brand, t: design === "pop" ? 0.55 : 0.95, zoom: design === "pop" ? 2.6 : 4.2 });
    };
    draw();
    // fonts may arrive after the first paint
    document.fonts?.ready.then(draw).catch(() => {});
  }, [design, style.color, style.upper, style.highlight, brand.accent, brand.fontDisplay, brand.fontBody]);
  return <canvas ref={ref} style={{ width: "100%", aspectRatio: "168 / 76", display: "block" }} aria-hidden />;
}

/**
 * Caption design and options. Bound to the project's captions by default; pass `value`/`onChange`
 * to drive another caption style (the "Caption a video" tool).
 */
export function CaptionControls({ value, onChange }: { value?: CaptionStyle; onChange?: (s: CaptionStyle | undefined) => void } = {}) {
  const own = useStudio((s) => s.project.captionStyle);
  const style = (onChange ? value : own) ?? {};
  const accent = useStudio((s) => s.project.brand.accent);
  const set = (patch: Partial<CaptionStyle>) =>
    onChange ? onChange(cleanCaptionStyle({ ...style, ...patch })) : updateProject((p) => ({ ...p, captionStyle: cleanCaptionStyle({ ...p.captionStyle, ...patch }) }));
  const placed = style.x !== undefined && style.y !== undefined;
  const design = CAPTION_DESIGNS.find((d) => d.id === style.design) ?? CAPTION_DESIGNS[0];
  const upper = style.upper ?? ["karaoke", "box", "pop"].includes(design.id);
  const seg = <T extends string>(label: string, value: T, opts: [T, string][], on: (v: T) => void) => (
    <div className="opt-row">
      <span className="opt-label">{label}</span>
      <div className="seg" role="group" aria-label={label}>
        {opts.map(([v, l]) => (
          <button key={v} className={value === v ? "on" : ""} onClick={() => on(v)}>{l}</button>
        ))}
      </div>
    </div>
  );
  return (
    <div className="caption-controls">
      <span className="label">Caption design</span>
      <div className="caption-grid" role="radiogroup" aria-label="Caption design">
        {CAPTION_DESIGNS.map((d) => (
          <button key={d.id} role="radio" aria-checked={design.id === d.id} className={`caption-card ${design.id === d.id ? "on" : ""}`} title={d.note} onClick={() => set({ design: d.id, words: undefined, upper: undefined })}>
            <Thumb design={d.id} style={style} />
            <small>{d.label}</small>
          </button>
        ))}
      </div>
      {seg("Position", (placed ? "" : style.position ?? "bottom") as "top" | "middle" | "bottom", [["top", "Top"], ["middle", "Middle"], ["bottom", "Bottom"]], (position) => set({ position, x: undefined, y: undefined }))}
      <span className="tiny">{placed ? "Placed by hand. Pick a position above to snap back." : "Or drag the captions on the preview to place them anywhere."}</span>
      {seg("Size", style.size ?? "m", [["s", "Small"], ["m", "Medium"], ["l", "Large"]], (size) => set({ size }))}
      <div className="opt-row">
        <span className="opt-label">Words at a time</span>
        <div className="seg" role="group" aria-label="Words at a time">
          <button className={!style.words ? "on" : ""} onClick={() => set({ words: undefined })} title={`This design's own (${design.words})`}>Auto</button>
          {[1, 2, 3, 4, 6].map((n) => (
            <button key={n} className={style.words === n ? "on" : ""} onClick={() => set({ words: n })}>{n}</button>
          ))}
        </div>
      </div>
      <div className="opt-row">
        <span className="opt-label">Highlight</span>
        <div className="caption-colors" role="group" aria-label="Highlight colour">
          <button className={`sw ${style.highlight !== false && !style.color ? "on" : ""}`} style={{ background: accent }} title="Brand colour" aria-label="Brand colour" onClick={() => set({ color: undefined, highlight: undefined })} />
          {CAPTION_COLORS.map((c) => (
            <button key={c} className={`sw ${style.highlight !== false && style.color?.toLowerCase() === c.toLowerCase() ? "on" : ""}`} style={{ background: c }} title={c} aria-label={`Highlight ${c}`} onClick={() => set({ color: c, highlight: undefined })} />
          ))}
          <button className={`sw none ${style.highlight === false ? "on" : ""}`} title="No highlight" aria-label="No highlight" onClick={() => set({ highlight: false })} />
        </div>
      </div>
      <label className="toggle">
        <input type="checkbox" checked={upper} onChange={(e) => set({ upper: e.target.checked })} />
        CAPITALS
      </label>
    </div>
  );
}
