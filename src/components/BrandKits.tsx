import { useState } from "react";
import type { Brand, BrandKit, Project } from "../types";
import { useStudio, saveKit, applyKit, renameKit, deleteKit, setDefaultKit, setState } from "../store";
import { presetById } from "../presets";
import { Icon } from "./Icon";

const LOOK: (keyof Brand)[] = ["bg", "fg", "accent", "muted", "fontDisplay", "fontBody", "logo", "radius", "name"];
/** Does the project currently wear this kit? */
const wearing = (p: Project, k: BrandKit) => p.style === k.style && LOOK.every((f) => (p.brand[f] ?? "") === (k.brand[f] ?? ""));

function Swatch({ b }: { b: Brand }) {
  return (
    <span className="kit-swatch" style={{ background: b.bg, color: b.fg, fontFamily: `"${b.fontDisplay}", var(--sans)` }} aria-hidden="true">
      Aa
      <i style={{ background: b.accent }} />
    </span>
  );
}

function NameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [v, setV] = useState(initial);
  return (
    <form className="row kit-name-form" onSubmit={(e) => (e.preventDefault(), onDone(v.trim() || null))}>
      <input type="text" autoFocus value={v} maxLength={40} placeholder="Kit name" aria-label="Kit name" onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onDone(null)} />
      <button className="btn primary" type="submit" disabled={!v.trim()}>Save</button>
      <button className="btn ghost" type="button" onClick={() => onDone(null)}>Cancel</button>
    </form>
  );
}

/** Saved brand kits: apply one, keep it up to date, choose the default for new projects. */
export function BrandKits() {
  const kits = useStudio((s) => s.kits);
  const project = useStudio((s) => s.project);
  const [naming, setNaming] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const notice = (s: string) => setState({ notice: s });
  const current = kits.find((k) => wearing(project, k));

  return (
    <div className="field kits">
      <label>Brand kits</label>
      {!!kits.length && (
        <ul className="kit-list">
          {kits.map((k) => (
            <li key={k.id} className={`kit ${current?.id === k.id ? "on" : ""}`}>
              {renaming === k.id ? (
                <NameInput initial={k.name} onDone={(n) => (n && renameKit(k.id, n), setRenaming(null))} />
              ) : (
                <>
                  <div className="kit-row">
                    <Swatch b={k.brand} />
                    <span className="kit-meta">
                      <span className="kit-name">{k.name}</span>
                      <span className="tiny">
                        {presetById(k.style).label} · {k.brand.fontDisplay}
                        {k.isDefault && " · default for new projects"}
                      </span>
                    </span>
                    {current?.id === k.id ? (
                      <span className="kit-badge">In use</span>
                    ) : (
                      <button className="btn" onClick={() => (applyKit(k.id), notice(`Applied “${k.name}”`))}>Apply</button>
                    )}
                    <button className="btn icon ghost" aria-label={`More for ${k.name}`} aria-expanded={open === k.id} onClick={() => setOpen((o) => (o === k.id ? null : k.id))}>
                      <Icon name="more" />
                    </button>
                  </div>
                  {open === k.id && (
                    <div className="kit-actions">
                      {current?.id !== k.id && <button className="btn ghost" onClick={() => (saveKit(k.name, k.id), setOpen(null), notice(`Updated “${k.name}” from this project`))}>Update from this project</button>}
                      <button className="btn ghost" onClick={() => (setDefaultKit(k.isDefault ? null : k.id), setOpen(null))}>{k.isDefault ? "Stop using for new projects" : "Use for new projects"}</button>
                      <button className="btn ghost" onClick={() => (setRenaming(k.id), setOpen(null))}>Rename</button>
                      <button className="btn ghost danger" onClick={() => (deleteKit(k.id), setOpen(null), notice(`Deleted “${k.name}”`))}>
                        <Icon name="trash" /> Delete
                      </button>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {naming ? (
        <NameInput initial={project.brand.name} onDone={(n) => (n && (saveKit(n), notice(`Saved “${n}” — apply it to any project`)), setNaming(false))} />
      ) : (
        !current && (
          <button className="btn" onClick={() => setNaming(true)}>
            <Icon name="plus" /> Save this look as a kit
          </button>
        )
      )}
      {!kits.length && <span className="tiny">Save colours, fonts and logo to reuse in any project.</span>}
    </div>
  );
}
