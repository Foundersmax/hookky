import { useState } from "react";
import type { Effect, Grade, Scene } from "../types";
import { EFFECTS, GRADES } from "../types";
import { LOOKS, GRADE_LABEL, EFFECT_LABEL } from "../engine/fx";
import { updateProject, setState } from "../store";

const MAX_EFFECTS = 4;
const same = (a: readonly string[] = [], b: readonly string[] = []) => a.length === b.length && a.every((x) => b.includes(x));

/** Which Look a scene is wearing (exact grade + effects match), if any. */
export function lookOf(s: Scene) {
  if ((!s.grade || s.grade === "none") && !s.effects?.length) return "none";
  return LOOKS.find((l) => l.grade === (s.grade ?? "none") && same(l.effects, s.effects))?.id ?? "custom";
}

/** Effects for one scene: one-click Looks, or a grade, up to four effects and a strength. */
export function EffectsControls({ scene, onChange }: { scene: Scene; onChange: (patch: Partial<Scene>) => void }) {
  const current = lookOf(scene);
  const [open, setOpen] = useState(current === "custom");
  const effects = scene.effects ?? [];
  const amount = scene.fxAmount ?? 0.7;

  const toggle = (e: Effect) => {
    const next = effects.includes(e) ? effects.filter((x) => x !== e) : [...effects, e].slice(0, MAX_EFFECTS);
    onChange({ effects: next.length ? next : undefined });
  };
  const applyToAll = () => {
    const fx = { grade: scene.grade, effects: scene.effects, fxAmount: scene.fxAmount };
    updateProject((p) => ({ ...p, scenes: p.scenes.map((s) => ({ ...s, ...fx })) }));
    setState({ notice: current === "none" ? "Effects removed from every scene" : "Applied to every scene" });
  };

  return (
    <div className="field fx-controls">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="label">Effects</span>
        <button type="button" className="link-btn" onClick={applyToAll} title="Give every scene this scene's look">
          Apply to all scenes
        </button>
      </div>
      <div className="fx-looks" role="radiogroup" aria-label="Look">
        <button type="button" role="radio" aria-checked={current === "none"} className={`src-chip filter ${current === "none" ? "on" : ""}`} onClick={() => onChange({ grade: undefined, effects: undefined, fxAmount: undefined })}>
          None
        </button>
        {LOOKS.map((l) => (
          <button
            key={l.id}
            type="button"
            role="radio"
            aria-checked={current === l.id}
            title={l.note}
            className={`src-chip filter ${current === l.id ? "on" : ""}`}
            onClick={() => onChange({ grade: l.grade, effects: [...l.effects], fxAmount: l.amount })}
          >
            {l.label}
          </button>
        ))}
        {current === "custom" && <span className="src-chip filter on" aria-current="true">Custom</span>}
      </div>
      <button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "Hide details" : "Customize"}
      </button>
      {open && (
        <div className="fx-detail">
          <div className="opt-row">
            <span className="opt-label">Grade</span>
            <select value={scene.grade ?? "none"} onChange={(e) => onChange({ grade: e.target.value === "none" ? undefined : (e.target.value as Grade) })}>
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  {GRADE_LABEL[g]}
                </option>
              ))}
            </select>
          </div>
          <div className="fx-chips" role="group" aria-label={`Effects (up to ${MAX_EFFECTS})`}>
            {EFFECTS.map((e) => {
              const on = effects.includes(e);
              return (
                <button key={e} type="button" aria-pressed={on} disabled={!on && effects.length >= MAX_EFFECTS} className={`src-chip filter ${on ? "on" : ""}`} onClick={() => toggle(e)}>
                  {EFFECT_LABEL[e]}
                </button>
              );
            })}
          </div>
          <div className="opt-row">
            <span className="opt-label">Strength</span>
            <input type="range" min={0} max={1} step={0.05} value={amount} aria-label="Effect strength" onChange={(e) => onChange({ fxAmount: +e.target.value })} style={{ flex: 1, maxWidth: 160 }} />
            <span className="tiny clip-num">{Math.round(amount * 100)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
