import { useEffect, useRef } from "react";
import type { ChatMessage, Direction, Project, Scene } from "../types";
import { ASPECT_SIZE } from "../types";
import { Renderer } from "../engine/render";
import { images } from "../runtime";
import { presetById } from "../presets";
import { brandWithStyle } from "../storyboard";
import { useStudio } from "../store";
import { pickDirection } from "../agent/client";
import { LOOKS } from "../engine/fx";

const PREVIEW_H = 112;
const LOOP = 3.2;
const SETTLED = 1.9;

/** A one-scene project showing a direction's look: its style, accent, motion and hook. */
function previewProject(p: Project, d: Direction): Project {
  const preset = presetById(d.style);
  const brand = { ...brandWithStyle(p.brand, d.style), ...(d.accent && { accent: d.accent }) };
  const look = LOOKS.find((l) => l.id === d.look);
  const scene: Scene = { id: "preview", template: "title-reveal", duration: LOOP, kicker: brand.name || undefined, headline: d.hook, background: preset.defaultBackground, motion: d.motion, transition: "cut", align: "center", ...(look && { grade: look.grade, effects: [...look.effects], fxAmount: look.amount }) };
  return { ...p, aspect: "16:9", style: d.style, brand, scenes: [scene], captions: false, grain: false, audio: undefined };
}

function Preview({ d }: { d: Direction }) {
  const project = useStudio((s) => s.project);
  const canvas = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const [W, H] = ASPECT_SIZE["16:9"];
    const r = new Renderer(c, W, H, (PREVIEW_H * 2) / H);
    const proj = previewProject(project, d);
    const still = () => {
      try {
        r.render(proj, SETTLED, images.still);
      } catch {
        /* a preview that can't draw stays blank */
      }
    };
    still();
    const off = images.listen(still);
    const play = () => {
      const t0 = performance.now();
      cancelAnimationFrame(raf.current);
      const tick = (now: number) => {
        try {
          r.render(proj, ((now - t0) / 1000) % LOOP, images.still);
        } catch {
          return;
        }
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    };
    const stop = () => (cancelAnimationFrame(raf.current), still());
    const host = c.parentElement!;
    host.addEventListener("pointerenter", play);
    host.addEventListener("pointerleave", stop);
    host.addEventListener("focusin", play);
    host.addEventListener("focusout", stop);
    return () => {
      off();
      cancelAnimationFrame(raf.current);
      host.removeEventListener("pointerenter", play);
      host.removeEventListener("pointerleave", stop);
      host.removeEventListener("focusin", play);
      host.removeEventListener("focusout", stop);
    };
  }, [d, project.brand.name, project.brand.logo, project.brand.fontDisplay, project.brand.fontBody]);

  return <canvas ref={canvas} className="dir-canvas" aria-hidden="true" />;
}

const PACE_LABEL = { punchy: "Punchy cuts", steady: "Steady", cinematic: "Cinematic" } as const;

export function DirectionCards({ m }: { m: ChatMessage }) {
  const busy = useStudio((s) => s.busy);
  if (!m.directions?.length) return null;
  return (
    <div className="directions" role="list" aria-label="Creative directions">
      {m.directions.map((d, i) => {
        const picked = m.picked === i;
        return (
          <div key={i} role="listitem" className={`dir-card ${picked ? "picked" : ""} ${m.picked !== undefined && !picked ? "dim" : ""}`}>
            <div className="dir-preview">
              <Preview d={d} />
              <span className="dir-num">{picked ? "✓" : i + 1}</span>
            </div>
            <div className="dir-body">
              <div className="dir-name">{d.name}</div>
              {d.pitch && <p className="dir-pitch">{d.pitch}</p>}
              <div className="dir-foot">
                <span className="dir-tags">
                  {presetById(d.style).label} · {d.motion[0].toUpperCase() + d.motion.slice(1)} · {PACE_LABEL[d.pace]}
                  {d.look && ` · ${LOOKS.find((l) => l.id === d.look)?.label ?? ""}`}
                </span>
                <button className={`btn ${picked ? "" : "primary"} dir-go`} disabled={busy} onClick={() => pickDirection(m.id, i)} aria-label={`${picked ? "Build again" : "Build"}: ${d.name}`}>
                  {picked ? "Rebuild" : m.picked !== undefined ? "Try this" : "Build"}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
