import { useEffect, useMemo, useRef, useState } from "react";
import type { Asset } from "../types";
import { useStudio, setState } from "../store";
import { search } from "../footage/cast";
import { scoreClip } from "../footage/plan";
import { swapFootage, footageOf, lookOf, sceneLine, suggestionsFor, takesFootage } from "../footage/swap";
import { LOOKS_PROD } from "../footage/plan";
import { fileToVideoAsset, fileToUploadAsset, isVideoFile } from "./ChatPanel";
import { clock } from "../clock";
import { Icon } from "./Icon";

export const VIDEO_SOURCES = ["freepik", "pexels", "pixabay", "coverr"];
export const IMAGE_SOURCES = ["freepik", "pexels", "pixabay", "unsplash", "openverse"];
const NAMES: Record<string, string> = { freepik: "Freepik", pexels: "Pexels", pixabay: "Pixabay", coverr: "Coverr", unsplash: "Unsplash", openverse: "Openverse" };
type Media = "video" | "photo" | "both";

function Result({ a, current, onUse }: { a: Asset; current: boolean; onUse: () => void }) {
  const v = useRef<HTMLVideoElement>(null);
  const [live, setLive] = useState(false);
  const isVideo = a.kind === "video";
  const play = () => {
    if (!isVideo) return;
    setLive(true);
    // the element mounts on the next frame
    requestAnimationFrame(() => v.current?.play().catch(() => {}));
  };
  const stop = () => (v.current?.pause(), setLive(false));
  return (
    <li className={`ff-card ${current ? "on" : ""}`}>
      <button className="ff-media" onMouseEnter={play} onMouseLeave={stop} onFocus={play} onBlur={stop} onClick={onUse} aria-label={`Use ${a.title || "this"} ${isVideo ? "clip" : "photo"} from ${NAMES[a.source] ?? a.source}`}>
        {a.thumb || !isVideo ? <img src={a.thumb ?? a.src} alt="" loading="lazy" /> : <span className="ff-nothumb"><Icon name="play" /></span>}
        {live && <video ref={v} src={/^https?:/.test(a.src) ? `/api/video?u=${encodeURIComponent(a.src)}` : a.src} muted loop playsInline preload="auto" />}
        <span className="ff-tags">
          <em>{isVideo ? (a.duration ? `${a.duration.toFixed(0)}s` : "Clip") : "Photo"}</em>
          {a.w && a.h ? <em>{Math.max(a.w, a.h) >= 3800 ? "4K" : Math.min(a.w, a.h) >= 1080 ? "HD" : `${Math.min(a.w, a.h)}p`}</em> : null}
        </span>
        <span className="ff-use">{current ? "In this scene" : "Use in scene"}</span>
      </button>
      <span className="ff-meta" title={a.title}>
        <b>{NAMES[a.source] ?? a.source}</b> {a.title}
      </span>
    </li>
  );
}

/** Research footage for one scene: search the stock libraries, preview clips and photos, replace the scene's footage. */
export function FootageFinder() {
  const project = useStudio((s) => s.project);
  const assets = useStudio((s) => s.assets);
  const sel = useStudio((s) => s.selected);
  const health = useStudio((s) => s.health);
  const scene = project.scenes[sel];
  const configured = (id: string) => !!health?.connectors.find((c) => c.id === id)?.configured;
  const videoIds = VIDEO_SOURCES.filter(configured);
  const imageIds = IMAGE_SOURCES.filter(configured);
  const [q, setQ] = useState("");
  const [media, setMedia] = useState<Media>("video");
  const [off, setOff] = useState<string[]>([]);
  const [results, setResults] = useState<Asset[] | null>(null);
  const [searched, setSearched] = useState("");
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const run = useRef(0);
  const close = () => setState({ sheet: undefined });
  const line = scene ? sceneLine(project, sel) : "";
  const ideas = useMemo(() => (scene ? suggestionsFor(project, sel) : []), [project.id, sel, scene?.id]);
  const currentSrc = scene ? assets.find((a) => a.id === footageOf(scene))?.src : undefined;
  const footageScenes = project.scenes.map((s, i) => (takesFootage(s) ? i : -1)).filter((i) => i >= 0);

  async function find(query = q, kind: Media = media, big = false) {
    const text = query.trim();
    if (!text || !scene) return;
    const id = ++run.current;
    setBusy(true);
    setSearched(text);
    setMore(big);
    try {
      const vs = videoIds.filter((s) => !off.includes(s)), is = imageIds.filter((s) => !off.includes(s));
      const n = big ? 30 : 18;
      const [videos, photos] = await Promise.all([
        kind !== "photo" && (vs.length || !videoIds.length) ? search(text, "video", project.aspect, 0, vs, n) : Promise.resolve([] as Asset[]),
        kind !== "video" && is.length ? search(text, "image", project.aspect, 0, is, n) : Promise.resolve([] as Asset[]),
      ]);
      if (id !== run.current) return;
      // best first: right shape, long enough for the scene, on subject, nothing the scene must avoid
      // one of the scene's own searches is judged on the scene's subject; a search of your own, on its words
      const own = [scene.shot?.query, ...(scene.shot?.queries ?? [])].some((s) => s?.toLowerCase() === text.toLowerCase());
      const shot = { s: 0, e: scene.duration, queries: [text], ...(own && scene.shot?.must?.length && { must: scene.shot.must }), avoid: scene.shot?.avoid, media: kind === "photo" ? ("photo" as const) : kind === "both" ? ("any" as const) : ("video" as const) };
      const speed = LOOKS_PROD[lookOf(scene)].speed;
      const rank = (list: Asset[]) => list.map((a, i) => ({ a, sc: scoreClip({ id: a.src, title: a.title, w: a.w, h: a.h, duration: a.duration, source: a.source, kind: a.kind === "video" ? "video" : "image", rank: i }, shot, project.aspect, speed) }));
      const all = [...rank(videos), ...rank(photos)].sort((x, y) => y.sc - x.sc).map((x) => x.a);
      const seen = new Set<string>();
      setResults(all.filter((a) => !seen.has(a.src) && seen.add(a.src)));
    } finally {
      if (id === run.current) setBusy(false);
    }
  }

  // Opening on a scene (or stepping to another): search what the director would.
  useEffect(() => {
    if (!scene) return;
    const first = ideas[0] ?? "";
    setQ(first);
    setResults(null);
    if (first) void find(first, media);
    clock.seek(project.scenes.slice(0, sel).reduce((t, s) => t + s.duration, 0) + 0.05);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, scene?.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), close());
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  if (!scene) return null;
  const at = footageScenes.indexOf(sel);
  const step = (d: number) => {
    const next = footageScenes[at + d];
    if (next !== undefined) setState({ selected: next });
  };
  const use = (a: Asset) => {
    swapFootage(sel, a, searched || q);
    setState({ notice: `Scene ${sel + 1} now shows this ${a.kind === "video" ? "clip" : "photo"} from ${NAMES[a.source] ?? a.source}. Undo brings the old one back.` });
  };
  const toggle = (id: string) => setOff((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  const shown = media === "photo" ? imageIds : media === "video" ? videoIds : [...new Set([...videoIds, ...imageIds])];

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="sheet ff-sheet" role="dialog" aria-modal="true" aria-labelledby="ff-title">
        <div className="sheet-head">
          <div className="ff-head">
            <h3 id="ff-title">Replace footage</h3>
            <span className="ff-step">
              <button className="btn icon ghost" aria-label="Previous scene" disabled={at <= 0} onClick={() => step(-1)}>‹</button>
              Scene {sel + 1} of {project.scenes.length} · {scene.duration.toFixed(1)}s
              <button className="btn icon ghost" aria-label="Next scene" disabled={at < 0 || at >= footageScenes.length - 1} onClick={() => step(1)}>›</button>
            </span>
          </div>
          <button className="btn primary" onClick={close}>Done</button>
        </div>
        {line && <q className="ff-line">{line}</q>}

        <form className="ff-search" onSubmit={(e) => (e.preventDefault(), void find())}>
          <input type="text" value={q} autoFocus placeholder="Describe the shot: subject, action, place (sea turtle swimming over coral)" aria-label="Search stock footage" onChange={(e) => setQ(e.target.value)} />
          <div className="seg" role="radiogroup" aria-label="Kind of footage">
            {(["video", "photo", "both"] as Media[]).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={media === m} className={media === m ? "on" : ""} onClick={() => (setMedia(m), void find(q, m))}>
                {m === "video" ? "Video" : m === "photo" ? "Photos" : "Both"}
              </button>
            ))}
          </div>
          <button className="btn primary" disabled={busy || !q.trim()}>{busy ? "Searching…" : "Search"}</button>
        </form>
        {ideas.length > 0 && (
          <div className="ff-ideas" aria-label="Searches to try">
            <span className="tiny">Try</span>
            {ideas.map((s) => (
              <button key={s} className={s === searched ? "on" : ""} onClick={() => (setQ(s), void find(s))}>{s}</button>
            ))}
          </div>
        )}
        {shown.length > 1 && (
          <div className="ff-sources" aria-label="Stock libraries">
            <span className="tiny">Libraries</span>
            {shown.map((id) => (
              <label key={id} className="toggle">
                <input type="checkbox" checked={!off.includes(id)} onChange={() => toggle(id)} /> {NAMES[id] ?? id}
              </label>
            ))}
          </div>
        )}

        <div className="ff-results" aria-live="polite">
          {busy && !results?.length ? (
            <ul className="ff-grid" aria-hidden>{Array.from({ length: 8 }, (_, i) => <li key={i} className="ff-card ghost"><span className="ff-media" /></li>)}</ul>
          ) : results === null ? (
            <p className="ff-empty">Search for the shot you have in mind, or pick one of the suggestions above.</p>
          ) : results.length === 0 ? (
            <p className="ff-empty">
              Nothing found for “{searched}”. Try fewer, simpler words (a subject and an action){media === "video" ? ", or look in Photos" : ""}.
              {!videoIds.length && media !== "photo" ? " No stock video library is connected on this server yet." : ""}
            </p>
          ) : (
            <>
              <ul className="ff-grid">
                {results.map((a) => (
                  <Result key={a.src} a={a} current={a.src === currentSrc} onUse={() => use(a)} />
                ))}
              </ul>
              {!more && results.length >= 12 && (
                <button className="btn ff-more" disabled={busy} onClick={() => void find(searched, media, true)}>{busy ? "Searching…" : "Show more"}</button>
              )}
            </>
          )}
        </div>
        <div className="ff-foot">
          <span className="tiny">Hover a clip to play it. Click to put it in the scene: it's timed to the scene's length and takes the scene's grade.</span>
          <button className="btn ghost" onClick={() => file.current?.click()}>
            <Icon name="plus" /> Use my own file
          </button>
        </div>
        <input
          ref={file}
          type="file"
          hidden
          accept="video/*,image/*"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              use(isVideoFile(f) ? await fileToVideoAsset(f) : await fileToUploadAsset(f));
            } catch (err: any) {
              setState({ notice: err.message });
            }
          }}
        />
      </div>
    </div>
  );
}
