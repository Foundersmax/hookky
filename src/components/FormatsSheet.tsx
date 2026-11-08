import { useEffect, useMemo, useState } from "react";
import type { Aspect, Project } from "../types";
import { useStudio, setState, getState, applyStoryboard } from "../store";
import { sanitizeScene } from "../sanitize";
import { brandWithStyle } from "../storyboard";
import { CATEGORIES, FORMATS, buildFormat, fill, type Brief, type Category, type Format } from "../formats";
import { pickImages } from "../soundApply";
import { LoopPreview } from "./SoundTemplates";
import { Icon } from "./Icon";

const BRIEF_KEY = "hookky.formatBrief";
const ASPECTS: Aspect[] = ["9:16", "1:1", "4:5", "16:9"];

function loadBrief(p: Project): Partial<Brief> {
  try {
    const saved = JSON.parse(localStorage.getItem(BRIEF_KEY) || "{}");
    return { ...saved, product: p.brand.name || saved.product || "" };
  } catch {
    return { product: p.brand.name };
  }
}

/** A project that shows a format: its draft in the brand (or the format's own look). */
function preview(f: Format, base: Project, brief: Partial<Brief>, imgs: string[], aspect: Aspect, keepBrand: boolean): Project {
  return {
    ...base,
    aspect,
    style: keepBrand ? base.style : f.style,
    brand: keepBrand ? base.brand : { ...brandWithStyle(base.brand, f.style), name: brief.product || base.brand.name },
    scenes: buildFormat(f, brief, imgs).map((s) => sanitizeScene(s)),
    captions: false,
    grain: false,
    audio: undefined,
    music: undefined,
  };
}

/** Creative formats: pick an attention structure, describe the product, get a finished ad. */
export function FormatsSheet() {
  const project = useStudio((s) => s.project);
  const assets = useStudio((s) => s.assets);
  const health = useStudio((s) => s.health);
  const [cat, setCat] = useState<Category | "All">("All");
  const [pick, setPick] = useState<Format>(FORMATS[0]);
  const [hover, setHover] = useState<string | null>(null);
  const [brief, setBrief] = useState<Partial<Brief>>(() => loadBrief(getState().project));
  const [aspect, setAspect] = useState<Aspect>(FORMATS[0].aspect);
  const [aspectTouched, setAspectTouched] = useState(false);
  const [keepBrand, setKeepBrand] = useState(() => !!getState().kits.find((k) => k.isDefault));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const imgs = useMemo(() => pickImages(assets), [assets]);
  const claudeOk = health?.agent === "claude" && health?.claude?.state !== "invalid-key" && health?.claude?.state !== "no-credit" && health?.claude?.state !== "missing";
  const close = () => setState({ sheet: undefined });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && (e.stopPropagation(), close());
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [busy]);
  useEffect(() => {
    try {
      localStorage.setItem(BRIEF_KEY, JSON.stringify(brief));
    } catch {
      /* private mode */
    }
  }, [brief]);

  const shown = FORMATS.filter((f) => cat === "All" || f.category === cat);
  const big = useMemo(() => preview(pick, project, brief, imgs, aspect, keepBrand), [pick, project.brand, project.style, brief, imgs, aspect, keepBrand]);
  const cards = useMemo(() => shown.map((f) => ({ f, p: preview(f, project, brief, imgs, f.aspect, keepBrand) })), [cat, project.brand, project.style, brief.product, brief.what, imgs, keepBrand]);
  const choose = (f: Format) => {
    setPick(f);
    if (!aspectTouched) setAspect(f.aspect);
  };
  const set = (k: keyof Brief, v: string) => setBrief((b) => ({ ...b, [k]: k === "benefits" ? v.split("\n") : v }));

  async function create(withClaude: boolean) {
    setError(null);
    const draft = buildFormat(pick, brief, imgs);
    let scenes: unknown[] = draft;
    let title = `${fill(brief).product} · ${pick.name}`;
    let note = "";
    if (withClaude) {
      setBusy("Claude is writing your ad");
      try {
        const r = await fetch("/api/format", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ format: { name: pick.name, hook: pick.hook, beats: pick.beats, aspect }, brief: fill(brief), draft }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok && Array.isArray(j.scenes) && j.scenes.length >= 3) {
          scenes = j.scenes;
          if (j.title) title = j.title;
        } else note = ` (Claude unavailable: ${String(j.error ?? r.status).replace(/\.$/, "")}; used the studio's draft)`;
      } catch (e: any) {
        note = ` (couldn't reach Claude: ${e.message}; used the studio's draft)`;
      }
    }
    applyStoryboard({ title, aspect, ...(keepBrand ? {} : { style: pick.style }), fit_to_voiceover: false, scenes: scenes as never });
    if (!keepBrand && brief.product) setState((st) => ({ project: { ...st.project, brand: { ...st.project.brand, name: brief.product! } } }));
    setBusy(null);
    close();
    setState({ notice: `${pick.name} is ready${note}. Press play.` });
  }

  const field = (k: keyof Brief, label: string, ph: string) => (
    <label className="field">
      <span className="label">{label}</span>
      <input type="text" value={(brief[k] as string) ?? ""} placeholder={ph} onChange={(e) => set(k, e.target.value)} />
    </label>
  );

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <div className="sheet sound-sheet formats-sheet" role="dialog" aria-modal="true" aria-labelledby="formats-title">
        <div className="sheet-head">
          <div>
            <h3 id="formats-title">Creative formats</h3>
            <p className="sound-sub">{FORMATS.length} attention structures that stop the scroll. Describe your product{claudeOk ? " and Claude writes the ad." : "; the studio writes a draft (Claude takes over once its key works)."}</p>
          </div>
          <button className="btn icon ghost" onClick={close} aria-label="Close" disabled={!!busy}>
            <Icon name="minus" />
          </button>
        </div>
        <div className="seg format-cats" role="tablist" aria-label="Categories">
          {(["All", ...CATEGORIES] as const).map((c) => (
            <button key={c} role="tab" aria-selected={cat === c} className={cat === c ? "on" : ""} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>

        <div className="sound-body">
          <div className="sound-grid" role="listbox" aria-label="Formats">
            {cards.map(({ f, p }) => (
              <button
                key={f.id}
                role="option"
                aria-selected={pick.id === f.id}
                className={`sound-card ${pick.id === f.id ? "on" : ""}`}
                onClick={() => choose(f)}
                onPointerEnter={() => setHover(f.id)}
                onPointerLeave={() => setHover((h) => (h === f.id ? null : h))}
                onFocus={() => setHover(f.id)}
                onBlur={() => setHover(null)}
              >
                <span className="sound-frame" style={{ background: `linear-gradient(135deg, ${f.swatch[0]}, ${f.swatch[0]} 60%, ${f.swatch[1]})` }}>
                  <LoopPreview project={p} height={132} live={hover === f.id} />
                </span>
                <span className="sound-meta">
                  <b>{f.name}</b>
                  <span className="sound-need">
                    <Icon name="sparkle" size={12} /> {f.hook} · {f.aspect}
                  </span>
                  <small>{f.blurb}</small>
                </span>
              </button>
            ))}
          </div>

          <aside className="sound-side">
            <div className="sound-stage" style={{ background: big.brand.bg }}>
              <LoopPreview project={big} height={300} live />
              <span className="sound-badge">{pick.category} · {big.scenes.reduce((a, s) => a + s.duration, 0).toFixed(1)}s</span>
            </div>
            <p className="format-beats"><b>{pick.name}:</b> {pick.blurb}</p>
            {field("product", "Product or brand", "Orbit")}
            {field("what", "What it is", "a smartwatch that coaches your sleep")}
            {field("audience", "Who it's for", "runners who sleep badly")}
            <label className="field">
              <span className="label">Benefits, one per line</span>
              <textarea rows={3} value={(brief.benefits ?? []).join("\n")} placeholder={"Ten-day battery\nSleep coaching that works\nTitanium light"} onChange={(e) => set("benefits", e.target.value)} />
            </label>
            <div className="row">
              {field("offer", "Offer (optional)", "30% off launch week")}
              {field("cta", "Button", "Pre-order")}
            </div>
            {field("url", "Link", "orbit.watch")}
            <div className="opt-row">
              <span className="opt-label">Format</span>
              <div className="seg" role="group" aria-label="Format">
                {ASPECTS.map((a) => (
                  <button key={a} className={aspect === a ? "on" : ""} onClick={() => (setAspect(a), setAspectTouched(true))}>{a}</button>
                ))}
              </div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={keepBrand} onChange={(e) => setKeepBrand(e.target.checked)} />
              Keep my brand colours and fonts
            </label>
            <span className="tiny">{imgs.length ? `Uses ${imgs.length} image${imgs.length > 1 ? "s" : ""} from your library.` : "Add product shots in the Library and they're used in the reveal beats."}</span>
            {error && <p className="sound-error" role="alert">{error}</p>}
            <button className="btn primary sound-build" disabled={!!busy} onClick={() => create(true)}>
              {busy ? <span className="wave" aria-hidden="true">{[0, 1, 2, 3].map((i) => <i key={i} style={{ animationDelay: `${i * 0.11}s` }} />)}</span> : <Icon name="sparkle" />} {busy ?? (claudeOk ? "Create with Claude" : "Create")}
            </button>
            {claudeOk && (
              <button className="btn ghost" disabled={!!busy} onClick={() => create(false)}>
                Use the instant draft
              </button>
            )}
            {project.scenes.length > 0 && <span className="tiny">Replaces this project's scenes. Undo brings them back.</span>}
          </aside>
        </div>
      </div>
    </div>
  );
}
