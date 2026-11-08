import { useRef, useState } from "react";
import { useStudio, setBrand, setState, getState, addAssets } from "../store";
import { fontFamilies, fontFileToAsset, registerFonts } from "../fonts";
import type { Asset } from "../types";
import { Icon } from "./Icon";
import { BrandKits } from "./BrandKits";
import { STYLE_PRESETS, FONT_CHOICES } from "../presets";

function FontOptions({ custom, current }: { custom: string[]; current: string }) {
  const known = new Set([...FONT_CHOICES, ...custom]);
  return (
    <>
      {custom.length > 0 && (
        <optgroup label="Your fonts">
          {custom.map((f) => <option key={f}>{f}</option>)}
        </optgroup>
      )}
      <optgroup label="Built in">
        {FONT_CHOICES.map((f) => <option key={f}>{f}</option>)}
      </optgroup>
      {!known.has(current) && <option>{current}</option>}
    </>
  );
}

export function BrandPanel() {
  const fontInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const project = useStudio((s) => s.project);
  const assets = useStudio((s) => s.assets);
  const custom = fontFamilies(assets);
  const removeFont = (fam: string) => {
    setState((st) => ({ assets: st.assets.filter((a) => !(a.kind === "font" && a.family === fam)) }));
    if (getState().project.brand.fontDisplay === fam) setBrand({ fontDisplay: "Inter" });
    if (getState().project.brand.fontBody === fam) setBrand({ fontBody: "Inter" });
  };
  const b = project.brand;
  return (
    <>
      <BrandKits />
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
            <FontOptions custom={custom} current={b.fontDisplay} />
          </select>
        </div>
        <div className="field">
          <label>Body font</label>
          <select value={b.fontBody} onChange={(e) => setBrand({ fontBody: e.target.value })}>
            <FontOptions custom={custom} current={b.fontBody} />
          </select>
        </div>
      </div>
      <div className="field">
        <label>Brand fonts</label>
        {custom.length ? (
          <ul className="font-list">
            {custom.map((fam) => {
              const files = assets.filter((a) => a.kind === "font" && a.family === fam);
              return (
                <li key={fam}>
                  <span className="font-sample" style={{ fontFamily: `"${fam}", var(--sans)` }}>{fam}</span>
                  <span className="tiny">{files.map((f) => f.weight ?? 400).sort().join(" · ")}</span>
                  <button className="btn ghost" onClick={() => setBrand({ fontDisplay: fam })}>Use for titles</button>
                  <button className="btn icon ghost" aria-label={`Remove ${fam}`} onClick={() => removeFont(fam)}>
                    <Icon name="trash" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <span className="tiny">.woff2, .ttf or .otf, one file per weight.</span>
        )}
        <button className="btn" onClick={() => fontInput.current?.click()} disabled={busy}>
          <Icon name="plus" /> {busy ? "Adding…" : "Upload font files"}
        </button>
        <input
          ref={fontInput}
          type="file"
          hidden
          multiple
          accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf"
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (!files.length) return;
            setBusy(true);
            const added: Asset[] = [];
            for (const f of files) {
              try {
                added.push(await fontFileToAsset(f));
              } catch (err: any) {
                setState({ notice: err.message });
              }
            }
            if (added.length) {
              addAssets(added);
              await registerFonts([...getState().assets]);
              setState({ notice: `Added ${[...new Set(added.map((a) => a.family))].join(", ")}` });
            }
            setBusy(false);
          }}
        />
      </div>
      <div className="field">
        <label>Corner radius · {b.radius ?? 0}px</label>
        <input type="range" min={0} max={60} value={Math.min(60, b.radius ?? 0)} onChange={(e) => setBrand({ radius: +e.target.value })} />
      </div>
      <div className="field">
        <label>Logo</label>
        <select value={b.logo ?? ""} onChange={(e) => setBrand({ logo: e.target.value || undefined })}>
          <option value="">— none (uses brand name) —</option>
          {assets.filter((a) => a.kind !== "font").map((a) => <option key={a.id} value={a.id}>{a.title.slice(0, 40)}</option>)}
        </select>
        <span className="tiny">A transparent PNG or SVG works best.</span>
      </div>
    </>
  );
}
