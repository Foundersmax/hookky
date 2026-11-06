import type { Asset, Scene } from "../types";

const SPEEDS = [0.25, 0.5, 1, 1.5, 2];
const fmt = (s: number) => `${s.toFixed(1)}s`;

/** Trim and speed for the video clips in a scene. */
export function ClipControls({ scene, clip, onChange }: { scene: Scene; clip: Asset; onChange: (patch: Partial<Scene>) => void }) {
  const length = clip.duration ?? 0;
  const start = scene.clipStart ?? 0;
  const speed = scene.clipSpeed ?? 1;
  const needs = scene.duration * speed; // clip seconds the scene plays through
  const maxStart = Math.max(0, length - Math.min(needs, length));
  const loops = length > 0 && start + needs > length + 0.05;
  const fit = length > 0 ? Math.min(15, Math.max(0.8, (length - start) / speed)) : 0;

  return (
    <div className="field clip-controls">
      <label>Video clip</label>
      <div className="opt-row">
        <span className="opt-label">Start at</span>
        <div className="row" style={{ gap: 6, flex: 1, justifyContent: "flex-end" }}>
          <input
            type="range"
            aria-label="Clip start"
            min={0}
            max={Math.max(0.1, maxStart)}
            step={0.1}
            value={Math.min(start, maxStart)}
            disabled={maxStart <= 0}
            onChange={(e) => onChange({ clipStart: +e.target.value || undefined })}
            style={{ flex: 1, minWidth: 0 }}
          />
          <span className="tiny clip-num">{fmt(start)}</span>
        </div>
      </div>
      <div className="opt-row">
        <span className="opt-label">Speed</span>
        <div className="seg opt-seg" role="radiogroup" aria-label="Clip speed">
          {SPEEDS.map((v) => (
            <button key={v} role="radio" aria-checked={v === speed} className={v === speed ? "on" : ""} onClick={() => onChange({ clipSpeed: v === 1 ? undefined : v })}>
              {v}×
            </button>
          ))}
        </div>
      </div>
      <span className={`tiny ${loops ? "warn-text" : ""}`}>
        {length
          ? loops
            ? `The scene plays ${fmt(needs)} of a ${fmt(length - start)} clip, so it loops. Shorten the scene, slow less, or start earlier.`
            : `Plays ${fmt(start)}–${fmt(start + needs)} of the ${fmt(length)} clip${speed < 1 ? " in slow motion" : speed > 1 ? " sped up" : ""}.`
          : "Clip length unknown."}
      </span>
      {length > 0 && Math.abs(fit - scene.duration) > 0.1 && (
        <button className="btn ghost" style={{ alignSelf: "flex-start" }} onClick={() => onChange({ duration: +fit.toFixed(2) })}>
          Match scene length to clip ({fmt(fit)})
        </button>
      )}
    </div>
  );
}
