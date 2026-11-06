import { useStudio, setBrand } from "../store";
import { STYLE_PRESETS, FONT_CHOICES } from "../presets";

export function BrandPanel() {
  const project = useStudio((s) => s.project);
  const assets = useStudio((s) => s.assets);
  const b = project.brand;
  return (
    <>
      <div className="field">
        <label>Style</label>
        <div className="presets">
          {STYLE_PRESETS.map((p) => (
            <button key={p.id} className={`preset ${project.style === p.id ? "on" : ""}`} onClick={() => setBrand({ style: p.id })} title={p.mood}>
              <div className="pv" style={{ background: p.brand.bg, color: p.brand.fg, fontFamily: `"${p.brand.fontDisplay}"`, fontWeight: /Serif/.test(p.brand.fontDisplay) ? 400 : 650 }}>
                Aa <i style={{ background: p.brand.accent }} />
              </div>
              <div className="nm">{p.label}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Brand name</label>
        <input type="text" value={b.name} onChange={(e) => setBrand({ name: e.target.value })} />
      </div>
      <div className="field">
        <label>Palette</label>
        <div className="swatches">
          {(["bg", "fg", "accent", "muted"] as const).map((k) => (
            <label className="swatch" key={k}>
              <input type="color" value={b[k]} onChange={(e) => setBrand({ [k]: e.target.value })} />
              {k === "bg" ? "Background" : k === "fg" ? "Text" : k === "accent" ? "Accent" : "Muted"}
            </label>
          ))}
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label>Display font</label>
          <select value={b.fontDisplay} onChange={(e) => setBrand({ fontDisplay: e.target.value })}>
            {FONT_CHOICES.map((f) => <option key={f}>{f}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Body font</label>
          <select value={b.fontBody} onChange={(e) => setBrand({ fontBody: e.target.value })}>
            {FONT_CHOICES.map((f) => <option key={f}>{f}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Corner radius · {b.radius ?? 0}px</label>
        <input type="range" min={0} max={60} value={Math.min(60, b.radius ?? 0)} onChange={(e) => setBrand({ radius: +e.target.value })} />
      </div>
      <div className="field">
        <label>Logo</label>
        <select value={b.logo ?? ""} onChange={(e) => setBrand({ logo: e.target.value || undefined })}>
          <option value="">— none (uses brand name) —</option>
          {assets.map((a) => <option key={a.id} value={a.id}>{a.title.slice(0, 40)}</option>)}
        </select>
        <span className="tiny">Upload a PNG/SVG with a transparent background for best results.</span>
      </div>
    </>
  );
}
