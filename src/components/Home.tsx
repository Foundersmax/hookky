import { useEffect, useMemo, useRef, useState } from "react";
import { formatsIntent } from "../formats";
import { useStudio, setState, openProject, createProject, duplicateProject, renameProject, deleteProject, defaultProject } from "../store";
import { STARTERS } from "../starters";
import { posterFor } from "./thumbs";
import { loadProject, loadProjectOrder, saveProjectOrder, type ProjectMeta } from "../persist";
import { arrange, moveId, type SortMode } from "../projectOrder";
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
        r.render({ ...p, audio: undefined }, ((performance.now() - t0) / 1000) % total, images.still);
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

interface CardActions {
  trash: (m: ProjectMeta) => void;
  moveBy: (m: ProjectMeta, dir: -1 | 1) => void;
  drag: { id: string | null; over: string | null };
  onDragStart: (m: ProjectMeta) => void;
  onDragOver: (m: ProjectMeta) => void;
  onDrop: (m: ProjectMeta) => void;
  onDragEnd: () => void;
}

function ProjectCard({ meta, current, actions, first, last }: { meta: ProjectMeta; current: boolean; actions: CardActions; first: boolean; last: boolean }) {
  const { canvas, active, setActive } = useHoverPreview(meta);
  const [menu, setMenu] = useState(false);
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
    <article
      className={`pcard ${current ? "current" : ""} ${actions.drag.id === meta.id ? "dragging" : ""} ${actions.drag.over === meta.id && actions.drag.id !== meta.id ? "drop-before" : ""}`}
      onPointerEnter={() => setActive(true)}
      onPointerLeave={() => (setActive(false), setMenu(false))}
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/x-hookky-project", meta.id);
        actions.onDragStart(meta);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("application/x-hookky-project")) return;
        e.preventDefault();
        actions.onDragOver(meta);
      }}
      onDrop={(e) => (e.preventDefault(), actions.onDrop(meta))}
      onDragEnd={actions.onDragEnd}
    >
      <button className="pcard-trash" aria-label={`Delete ${meta.title}`} title="Delete (you can undo)" onClick={() => actions.trash(meta)}>
        <Icon name="trash" size={14} />
      </button>
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
          <button className="btn icon ghost" aria-label="Project actions" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            <Icon name="more" />
          </button>
          {menu && (
            <div className="menu" role="menu">
              <button role="menuitem" onClick={() => openProject(meta.id)}>Open</button>
              <button role="menuitem" onClick={() => (setMenu(false), setEditing(true))}>Rename</button>
              <button role="menuitem" onClick={() => (setMenu(false), duplicateProject(meta.id))}>Duplicate</button>
              {!first && <button role="menuitem" onClick={() => (setMenu(false), actions.moveBy(meta, -1))}>Move earlier</button>}
              {!last && <button role="menuitem" onClick={() => (setMenu(false), actions.moveBy(meta, 1))}>Move later</button>}
              <button role="menuitem" className="danger" onClick={() => (setMenu(false), actions.trash(meta))}>Delete</button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

const SORT_KEY = "hookky.projectSort";
const UNDO_MS = 6000;
const readSort = (): SortMode => {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return v === "name" || v === "custom" ? v : "recent";
  } catch {
    return "recent";
  }
};

export function Home() {
  const projects = useStudio((s) => s.projects);
  const currentId = useStudio((s) => s.project.id);
  const [q, setQ] = useState("");
  const [mode, setModeState] = useState<SortMode>(readSort);
  const [order, setOrder] = useState<string[]>([]);
  const [drag, setDrag] = useState<{ id: string | null; over: string | null }>({ id: null, over: null });
  // Deleted cards hide at once and are removed for good after a few seconds unless undone.
  const [trashed, setTrashed] = useState<ProjectMeta[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const starterPosters = useMemo(() => STARTERS.map((s) => ({ ...s, project: s.build() })).map((s) => ({ ...s, poster: (() => { try { return posterFor(s.project, 160); } catch { return ""; } })() })), []);

  useEffect(() => {
    loadProjectOrder().then(setOrder).catch(() => {});
    // Leaving the page finishes any pending deletes.
    const pending = timers.current;
    return () => {
      for (const [id, t] of pending) (clearTimeout(t), deleteProject(id));
      pending.clear();
    };
  }, []);

  const setMode = (m: SortMode) => {
    setModeState(m);
    try {
      localStorage.setItem(SORT_KEY, m);
    } catch {}
  };
  const hidden = new Set(trashed.map((t) => t.id));
  const arranged = arrange(projects.filter((p) => !hidden.has(p.id)), mode, order);
  const shown = arranged.filter((p) => p.title.toLowerCase().includes(q.trim().toLowerCase()));

  /** Save a new custom order (switching to Custom), starting from what's on screen. */
  const commitOrder = (ids: string[]) => {
    setOrder(ids);
    setMode("custom");
    saveProjectOrder(ids).catch(() => {});
  };
  const actions: CardActions = {
    drag,
    trash: (m) => {
      setTrashed((t) => [...t.filter((x) => x.id !== m.id), m]);
      timers.current.set(
        m.id,
        setTimeout(() => {
          timers.current.delete(m.id);
          deleteProject(m.id);
          setTrashed((t) => t.filter((x) => x.id !== m.id));
        }, UNDO_MS),
      );
    },
    moveBy: (m, dir) => {
      const ids = arranged.map((p) => p.id);
      const i = ids.indexOf(m.id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      commitOrder(ids);
    },
    onDragStart: (m) => setDrag({ id: m.id, over: null }),
    onDragOver: (m) => setDrag((d) => (d.over === m.id ? d : { ...d, over: m.id })),
    onDrop: (m) => {
      if (drag.id && drag.id !== m.id) commitOrder(moveId(arranged.map((p) => p.id), drag.id, m.id));
      setDrag({ id: null, over: null });
    },
    onDragEnd: () => setDrag({ id: null, over: null }),
  };
  const undo = (m: ProjectMeta) => {
    clearTimeout(timers.current.get(m.id));
    timers.current.delete(m.id);
    setTrashed((t) => t.filter((x) => x.id !== m.id));
  };
  const lastTrashed = trashed[trashed.length - 1];
  return (
    <main className="home">
      <div className="home-wrap">
        <section className="home-start" aria-labelledby="start-title">
          <div className="home-head">
            <h2 id="start-title">Start something new</h2>
            <span className="row" style={{ flex: "none" }}>
              <button className="btn primary" onClick={() => void createProject("blank").then(() => ((formatsIntent.section = "mograph"), setState({ sheet: "formats" })))}>
                <Icon name="mic" /> Voice-over → motion graphics
              </button>
              <button className="btn" onClick={() => void createProject("blank").then(() => setState({ sheet: "formats" }))}>
                <Icon name="sparkle" /> Creative formats
              </button>
              <button className="btn" onClick={() => setState({ sheet: "upscale" })}>
                <Icon name="expand" /> Upscale a video
              </button>
              <button className="btn" onClick={() => void createProject("blank").then(() => setState({ sheet: "footage" }))}>
                <Icon name="clip" /> Footage from a voice-over
              </button>
              <button className="btn" onClick={() => void createProject("blank").then(() => setState({ sheet: "sound" }))}>
                <Icon name="wave" /> Start from a sound
              </button>
            </span>
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
              Projects <span className="count">{arranged.length}</span>
            </h2>
            <span className="spacer" />
            {arranged.length > 1 && (
              <div className="seg opt-seg" role="radiogroup" aria-label="Arrange projects">
                {(["recent", "name", "custom"] as const).map((m) => (
                  <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""} onClick={() => setMode(m)} title={m === "custom" ? "Drag cards to arrange them" : undefined}>
                    {m === "recent" ? "Recent" : m === "name" ? "Name" : "Custom"}
                  </button>
                ))}
              </div>
            )}
            {projects.length > 3 && (
              <label className="search">
                <Icon name="search" />
                <input type="search" placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
              </label>
            )}
          </div>
          {shown.length ? (
            <div className="pgrid">
              {shown.map((m, i) => (
                <ProjectCard key={m.id} meta={m} current={m.id === currentId} actions={actions} first={i === 0} last={i === shown.length - 1} />
              ))}
            </div>
          ) : (
            <p className="muted home-empty">{arranged.length ? `No projects match “${q}”.` : "Your projects will appear here. Pick a starter above to begin."}</p>
          )}
          {lastTrashed && (
            <div className="undo-bar" role="status">
              <span>
                Deleted “{lastTrashed.title}”{trashed.length > 1 ? ` and ${trashed.length - 1} more` : ""}
              </span>
              <button className="btn" onClick={() => trashed.forEach(undo)}>
                Undo
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
