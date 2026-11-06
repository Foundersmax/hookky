import { useStudio, updateProject, setState, normalizeScene } from "../store";
import { TEMPLATES, TRANSITIONS, BACKGROUNDS, type Scene } from "../types";
import { timeline } from "../engine/render";
import { stripMarks } from "../engine/text";
import { clock } from "../clock";
import { sendToAgent } from "../agent/client";
import { uid } from "../engine/util";
import { Icon } from "./Icon";

const USES: Record<string, (keyof Scene)[]> = {
  "title-reveal": ["kicker", "headline", "subline", "align"],
  "kinetic-words": ["headline"],
  "product-hero": ["image", "kicker", "headline", "subline"],
  "split-feature": ["image", "kicker", "headline", "subline", "align"],
  "feature-list": ["kicker", "headline", "items"],
  "stat-counter": ["kicker", "stat", "headline", "align"],
  "image-mosaic": ["images", "headline"],
  fullbleed: ["image", "kicker", "headline", "subline", "align"],
  quote: ["headline", "author"],
  marquee: ["headline", "subline"],
  "shape-burst": ["headline"],
  "logo-sting": ["image", "headline", "subline"],
  "cta-end": ["headline", "subline", "cta", "url"],
};

export function SceneInspector() {
  const project = useStudio((s) => s.project);
  const assets = useStudio((s) => s.assets);
  const sel = Math.min(useStudio((s) => s.selected), project.scenes.length - 1);
  const scene = project.scenes[sel];
  const uses = USES[scene?.template] ?? [];

  const edit = (patch: Partial<Scene>) => updateProject((p) => ({ ...p, scenes: p.scenes.map((s, i) => (i === sel ? normalizeScene({ ...s, ...patch }, s.id) : s)) }));
  const select = (i: number) => {
    setState({ selected: i });
    clock.seek(timeline(project.scenes)[i].start + 0.001);
  };
  const move = (dir: -1 | 1) =>
    updateProject((p) => {
      const j = sel + dir;
      if (j < 0 || j >= p.scenes.length) return p;
      const s = [...p.scenes];
      [s[sel], s[j]] = [s[j], s[sel]];
      setState({ selected: j });
      return { ...p, scenes: s };
    });

  const imgOptions = assets.filter((a) => a.kind === "image" || a.kind === "logo");

  return (
    <>
      <div className="scene-list">
        {project.scenes.map((s, i) => (
          <div key={s.id} className={`scene-row ${i === sel ? "on" : ""}`} onClick={() => select(i)}>
            <span className="n">{String(i + 1).padStart(2, "0")}</span>
            <span className="t">{stripMarks(s.headline || s.cta || s.kicker || s.template)}</span>
            <span className="tiny">{s.duration.toFixed(1)}s</span>
          </div>
        ))}
      </div>
      <div className="row" style={{ gap: 4 }}>
        <button className="btn icon" title="Move up" onClick={() => move(-1)}><Icon name="up" /></button>
        <button className="btn icon" title="Move down" onClick={() => move(1)}><Icon name="down" /></button>
        <button className="btn icon" title="Duplicate" onClick={() => updateProject((p) => ({ ...p, scenes: [...p.scenes.slice(0, sel + 1), { ...scene, id: uid() }, ...p.scenes.slice(sel + 1)] }))}><Icon name="copy" /></button>
        <button className="btn icon" title="Add scene" onClick={() => updateProject((p) => ({ ...p, scenes: [...p.scenes.slice(0, sel + 1), normalizeScene({ template: "title-reveal", duration: 3, headline: "New *scene*" }), ...p.scenes.slice(sel + 1)] }))}><Icon name="plus" /></button>
        <button className="btn icon" title="Delete" disabled={project.scenes.length < 2} onClick={() => (updateProject((p) => ({ ...p, scenes: p.scenes.filter((_, i) => i !== sel) })), setState({ selected: Math.max(0, sel - 1) }))}><Icon name="trash" /></button>
      </div>
      {scene && (
        <>
          <div className="divider" />
          <div className="row">
            <div className="field">
              <label>Template</label>
              <select value={scene.template} onChange={(e) => edit({ template: e.target.value as Scene["template"] })}>
                {TEMPLATES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="field" style={{ maxWidth: 80 }}>
              <label>Seconds</label>
              <input type="number" step={0.1} min={0.8} value={scene.duration} onChange={(e) => edit({ duration: +e.target.value })} />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Transition in</label>
              <select value={scene.transition ?? "fade"} onChange={(e) => edit({ transition: e.target.value as Scene["transition"] })}>
                {TRANSITIONS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Background</label>
              <select value={scene.background ?? "solid"} onChange={(e) => edit({ background: e.target.value as Scene["background"] })}>
                {BACKGROUNDS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Motion</label>
              <select value={scene.motion ?? "snappy"} onChange={(e) => edit({ motion: e.target.value as Scene["motion"] })}>
                <option>snappy</option><option>calm</option><option>bouncy</option>
              </select>
            </div>
            {uses.includes("align") && (
              <div className="field">
                <label>Align</label>
                <select value={scene.align ?? "center"} onChange={(e) => edit({ align: e.target.value as Scene["align"] })}>
                  <option>center</option><option>left</option>
                </select>
              </div>
            )}
          </div>
          {uses.includes("kicker") && <Text label="Kicker" v={scene.kicker} on={(kicker) => edit({ kicker })} />}
          {uses.includes("headline") && <Text label={scene.template === "quote" ? "Quote" : "Headline · *accent*"} v={scene.headline} on={(headline) => edit({ headline })} area />}
          {uses.includes("subline") && <Text label="Subline" v={scene.subline} on={(subline) => edit({ subline })} />}
          {uses.includes("items") && (
            <div className="field">
              <label>Items (one per line)</label>
              <textarea value={(scene.items ?? []).join("\n")} onChange={(e) => edit({ items: e.target.value.split("\n") })} />
            </div>
          )}
          {uses.includes("stat") && (
            <div className="row">
              <Text label="Prefix" v={scene.stat?.prefix} on={(prefix) => edit({ stat: { value: 0, ...scene.stat, prefix } })} />
              <div className="field">
                <label>Value</label>
                <input type="number" value={scene.stat?.value ?? 0} onChange={(e) => edit({ stat: { ...scene.stat, value: +e.target.value } })} />
              </div>
              <Text label="Suffix" v={scene.stat?.suffix} on={(suffix) => edit({ stat: { value: 0, ...scene.stat, suffix } })} />
            </div>
          )}
          {uses.includes("stat") && <Text label="Stat label" v={scene.stat?.label} on={(label) => edit({ stat: { value: 0, ...scene.stat, label } })} />}
          {uses.includes("author") && <Text label="Author" v={scene.author} on={(author) => edit({ author })} />}
          {uses.includes("cta") && <Text label="Button" v={scene.cta} on={(cta) => edit({ cta })} />}
          {uses.includes("url") && <Text label="URL" v={scene.url} on={(url) => edit({ url })} />}
          {(uses.includes("image") || scene.background === "image") && (
            <div className="field">
              <label>Image</label>
              <select value={scene.image ?? ""} onChange={(e) => edit({ image: e.target.value || undefined })}>
                <option value="">— none —</option>
                {imgOptions.map((a) => <option key={a.id} value={a.id}>{a.source} · {a.title.slice(0, 34)}</option>)}
              </select>
            </div>
          )}
          {uses.includes("images") && (
            <div className="field">
              <label>Images ({scene.images?.length ?? 0}) — pick in Library</label>
              <div className="lib-grid" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
                {(scene.images ?? []).map((id, i) => {
                  const a = assets.find((x) => x.id === id);
                  return (
                    <div className="lib-item" key={i} onClick={() => edit({ images: scene.images!.filter((_, j) => j !== i) })} title="Click to remove">
                      {a && <img src={a.thumb ?? a.src} alt="" />}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="field">
            <label>Accent override</label>
            <div className="row">
              <input type="color" value={scene.accent ?? project.brand.accent} onChange={(e) => edit({ accent: e.target.value })} style={{ height: 32, flex: "none", width: 48 }} />
              <button className="btn ghost" onClick={() => edit({ accent: undefined })}>Reset</button>
            </div>
          </div>
          <button className="btn" onClick={() => sendToAgent(`Make scene ${sel + 1} more striking — keep the message, improve the copy, template and motion.`)}>
            <Icon name="wand" /> Ask agent to punch up this scene
          </button>
        </>
      )}
    </>
  );
}

function Text({ label, v, on, area }: { label: string; v?: string; on: (v: string) => void; area?: boolean }) {
  return (
    <div className="field">
      <label>{label}</label>
      {area ? <textarea rows={2} value={v ?? ""} onChange={(e) => on(e.target.value)} /> : <input type="text" value={v ?? ""} onChange={(e) => on(e.target.value)} />}
    </div>
  );
}
