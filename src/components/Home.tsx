import { useEffect, useMemo, useRef, useState } from "react";
import { useStudio, openProject, createProject, duplicateProject, renameProject, deleteProject, defaultProject } from "../store";
import { STARTERS } from "../starters";
import { posterFor } from "./thumbs";
import { loadProject, type ProjectMeta } from "../persist";
import { Renderer, totalDuration } from "../engine/render";
import { ASPECT_SIZE } from "../types";
import { sanitizeProject } from "../sanitize";
import { images } from "../runtime";
import { Icon } from "./Icon";

const ago = (t: number) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 172800) return "yesterday";
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const secs = (d: number) => (d >= 60 ? `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, "0")}` : `${d.toFixed(1)}s`);

/** Plays a project on a canvas while the pointer is over its card. */
function useHoverPreview(meta: ProjectMeta) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!active || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0, stopped = false;
    (async () => {
      const rec = await loadProject(meta.id).catch(() => null);
      if (stopped || !rec?.project || !canvas.current) return;
      const p = sanitizeProject(rec.project, defaultProject());
      const [W, H] = ASPECT_SIZE[p.aspect];
      const el = canvas.current;
      const r = new Renderer(el, W, H, Math.min(1, ((el.clientHeight || 180) * (devicePixelRatio || 1)) / H));
      const total = Math.max(0.5, totalDuration(p));
      const t0 = performance.now();
      const loop = () => {
        if (stopped) return;
        r.render({ ...p, audio: undefined }, ((performance.now() - t0) / 1000) % total, images.get);
        raf = requestAnimationFrame(loop);
      };
      loop();
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [active, meta.id]);
  return { canvas, active, setActive };
}

function ProjectCard({ meta, current }: { meta: ProjectMeta; current: boolean }) {
  const { canvas, active, setActive } = useHoverPreview(meta);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(meta.title);
  useEffect(() => setTitle(meta.title), [meta.title]);
  const [W, H] = ASPECT_SIZE[meta.aspect];
  const commit = () => {
    setEditing(false);
    if (title.trim() && title !== meta.title) renameProject(meta.id, title);
    else setTitle(meta.title);
  };

  return (
    <article className={`pcard ${current ? "current" : ""}`} onPointerEnter={() => setActive(true)} onPointerLeave={() => (setActive(false), setMenu(false), setConfirm(false))}>
      <button className="pcard-media" onClick={() => openProject(meta.id)} aria-label={`Open ${meta.title}`}>
        <div className="pcard-frame" style={{ aspectRatio: `${W} / ${H}` }}>
          {meta.thumb ? <img src={meta.thumb} alt="" draggable={false} /> : <span className="pcard-empty" />}
          <canvas ref={canvas} className={active ? "on" : ""} aria-hidden />
        </div>
        {current && <span className="pcard-badge">Open</span>}
      </button>
      <div className="pcard-foot">
        <div className="pcard-text">
          {editing ? (
            <input
              className="pcard-rename"
              value={title}
              autoFocus
              aria-label="Project name"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") (setTitle(meta.title), setEditing(false));
              }}
            />
          ) : (
            <h3 onDoubleClick={() => setEditing(true)} title="Double-click to rename">{meta.title}</h3>
          )}
          <p>
            {meta.aspect} · {secs(meta.duration)} · {meta.scenes} scene{meta.scenes === 1 ? "" : "s"}
            {meta.hasAudio ? " · voice-over" : ""} · {ago(meta.updatedAt)}
          </p>
        </div>
        <div className="pcard-menu">
          <button className="btn icon ghost" aria-label="Project actions" aria-expanded={menu} onClick={() => (setMenu((m) => !m), setConfirm(false))}>
            <Icon name="more" />
          </button>
          {menu && (
            <div className="menu" role="menu">
              <button role="menuitem" onClick={() => openProject(meta.id)}>Open</button>
              <button role="menuitem" onClick={() => (setMenu(false), setEditing(true))}>Rename</button>
              <button role="menuitem" onClick={() => (setMenu(false), duplicateProject(meta.id))}>Duplicate</button>
              {confirm ? (
                <button role="menuitem" className="danger" onClick={() => (setMenu(false), deleteProject(meta.id))}>Delete for good</button>
              ) : (
                <button role="menuitem" className="danger" onClick={() => setConfirm(true)}>Delete…</button>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export function Home() {
  const projects = useStudio((s) => s.projects);
  const currentId = useStudio((s) => s.project.id);
  const [q, setQ] = useState("");
  const starterPosters = useMemo(() => STARTERS.map((s) => ({ ...s, project: s.build() })).map((s) => ({ ...s, poster: (() => { try { return posterFor(s.project, 160); } catch { return ""; } })() })), []);
  const shown = projects.filter((p) => p.title.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <main className="home">
      <div className="home-wrap">
        <section className="home-start" aria-labelledby="start-title">
          <div className="home-head">
            <h2 id="start-title">Start something new</h2>
          </div>
          <div className="starters">
            {starterPosters.map((s) => {
              const [W, H] = ASPECT_SIZE[s.project.aspect];
              return (
                <button key={s.id} className="starter" onClick={() => createProject(s.id)}>
                  <span className="starter-frame">
                    {s.poster ? <img src={s.poster} alt="" style={{ aspectRatio: `${W} / ${H}` }} /> : <Icon name="plus" />}
                  </span>
                  <span className="starter-text">
                    <b>{s.name}</b>
                    <small>{s.blurb}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="home-projects" aria-labelledby="projects-title">
          <div className="home-head">
            <h2 id="projects-title">
              Projects <span className="count">{projects.length}</span>
            </h2>
            {projects.length > 3 && (
              <label className="search">
                <Icon name="search" />
                <input type="search" placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
              </label>
            )}
          </div>
          {shown.length ? (
            <div className="pgrid">
              {shown.map((m) => (
                <ProjectCard key={m.id} meta={m} current={m.id === currentId} />
              ))}
            </div>
          ) : (
            <p className="muted home-empty">{projects.length ? `No projects match “${q}”.` : "Your projects will appear here. Pick a starter above to begin."}</p>
          )}
        </section>
      </div>
    </main>
  );
}
