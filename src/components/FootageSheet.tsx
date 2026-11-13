import { useEffect, useRef, useState } from "react";
import type { Aspect, Asset } from "../types";
import { useStudio, setState, getState } from "../store";
import { LOOKS_PROD, SHOT_TYPES, type ProdLook, type Shot, type TextMode } from "../footage/plan";
import { directFootage, stopDirecting } from "../footage/direct";
import { GENRES, parseDirection, type Genre } from "../footage/mind";
import { VIDEO_SOURCES, IMAGE_SOURCES } from "./FootageFinder";
import { initialCopy } from "../soundApply";
import { Icon } from "./Icon";
import { LicenseCard } from "./LicenseCard";

const ASPECTS: Aspect[] = ["16:9", "9:16", "1:1", "4:5"];
const TEXT: { id: TextMode; label: string; note: string }[] = [
  { id: "subtitles", label: "Subtitles", note: "Every word, burned in" },
  { id: "keywords", label: "Key lines", note: "Big words on a few shots" },
  { id: "clean", label: "Clean", note: "Footage only" },
];
const SHOT_LABEL: Record<(typeof SHOT_TYPES)[number], string> = { establishing: "Establishing", wide: "Wide", medium: "Medium", "close-up": "Close-up", detail: "Detail", people: "People", product: "Product", abstract: "Abstract" };
const tc = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const BRIEF_KEY = "hookky.footageBrief";
const DIRECTION_KEY = "rookker.footageDirection";
const GENRE_KEY = "rookker.footageGenre";
const SOURCE_NAMES: Record<string, string> = { freepik: "Freepik", pexels: "Pexels", pixabay: "Pixabay", coverr: "Coverr", unsplash: "Unsplash", openverse: "Openverse" };
const DIRECTION_IDEAS = [
  "Cinematic aerial drone shots, moody light, no people",
  "Real documentary footage, handheld, natural light, close-ups of hands at work",
  "Slow motion, golden hour, warm and hopeful",
  "Archival black and white photos and vintage footage",
  "Clean modern b-roll, bright, no text or logos",
];
const read = (k: string) => {
  try {
    return localStorage.getItem(k) || "";
  } catch {
    return "";
  }
};

/** Upload a voice-over and get an edit: a shot list, stock footage cast for every line, one look. */
export function FootageSheet() {
  const project = useStudio((s) => s.project);
  const audio = project.audio;
  const [voiceFile, setVoiceFile] = useState<File>();
  const [brief, setBrief] = useState(() => {
    try {
      return localStorage.getItem(BRIEF_KEY) || "";
    } catch {
      return "";
    }
  });
  const copy0 = initialCopy(getState().project);
  const [brand, setBrand] = useState(copy0.brand);
  const [title, setTitle] = useState(copy0.line);
  const [cta, setCta] = useState(copy0.cta);
  const [url, setUrl] = useState(copy0.url);
  const [script, setScript] = useState("");
  const [genre, setGenreState] = useState<Genre>(() => (read(GENRE_KEY) in GENRES ? (read(GENRE_KEY) as Genre) : "documentary"));
  const [direction, setDirection] = useState(() => read(DIRECTION_KEY));
  const [offSources, setOffSources] = useState<string[]>([]);
  const health = useStudio((s) => s.health);
  const connected = (id: string) => !!health?.connectors.find((c) => c.id === id)?.configured;
  const videoIds = VIDEO_SOURCES.filter(connected), imageIds = IMAGE_SOURCES.filter(connected);
  const libraries = [...new Set([...videoIds, ...imageIds])];
  const [look, setLook] = useState<ProdLook>(() => (read(GENRE_KEY) === "ad" ? "cinematic" : "documentary"));
  const setGenre = (g: Genre) => (setGenreState(g), setLook(g === "ad" ? "cinematic" : g === "documentary" ? "documentary" : look));
  const understood = parseDirection(direction);
  const [text, setText] = useState<TextMode>("subtitles");
  const [aspect, setAspect] = useState<Aspect>(project.aspect);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<{ shots: Shot[]; picks: (Asset | null | undefined)[]; by: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const close = () => setState({ sheet: undefined });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), close());
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const hasVoice = !!(voiceFile || audio);
  const hasWords = !voiceFile && !!audio?.words?.length;
  const transcribes = getState().health?.transcription && getState().health?.transcription !== "none";

  async function go() {
    setError(null);
    setDone(null);
    setRows(null);
    try {
      localStorage.setItem(BRIEF_KEY, brief);
      localStorage.setItem(DIRECTION_KEY, direction);
      localStorage.setItem(GENRE_KEY, genre);
    } catch {
      /* private mode */
    }
    // No brand typed: "Orbit, a smartwatch for…" names it.
    const named = brand.trim() || (brief.match(/^\s*([A-Z][\w&'.-]{1,30})\s*[,:—-]/)?.[1] ?? "");
    if (named && !brand.trim()) setBrand(named);
    try {
      const summary = await directFootage({
        voiceFile,
        script,
        brief: [brief, brand].filter(Boolean).join(" · "),
        genre,
        direction,
        // every connected library the person left ticked, searched together
        sources: { video: videoIds.filter((s) => !offSources.includes(s)), image: imageIds.filter((s) => !offSources.includes(s)) },
        look,
        text,
        aspect,
        brand: named,
        title,
        cta,
        url,
        onStep: setBusy,
        onPlan: (shots, by) => setRows({ shots, picks: shots.map(() => undefined), by }),
        onCast: (i, pick) => setRows((r) => (r ? { ...r, picks: r.picks.map((p, k) => (k === i ? pick ?? null : p)) } : r)),
      });
      setVoiceFile(undefined);
      setDone(summary);
      setState({ notice: summary });
    } catch (e: any) {
      setError(e?.message || "Couldn't build the edit.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="sheet footage-sheet" role="dialog" aria-modal="true" aria-labelledby="footage-title">
        <div className="sheet-head">
          <div>
            <h3 id="footage-title">Footage from your voice-over</h3>
            <p className="sound-sub">Rookker reads the whole voice-over, works out what each line is about, and casts footage that shows it from your stock libraries. Describe the footage you want and it follows that in every shot.</p>
          </div>
          <button className="btn icon ghost" onClick={close} aria-label="Close">
            <Icon name="minus" />
          </button>
        </div>

        <div className="footage-body">
          <section className="footage-setup">
            <div className={`sound-slot ${hasVoice ? "has" : ""}`}>
              <Icon name="mic" />
              <span className="sound-slot-text">
                <b>Voice-over</b>
                <small>
                  {voiceFile ? `${voiceFile.name} · transcribed when you start` : audio ? `${audio.name} · ${audio.duration.toFixed(1)}s · ${audio.words?.length ? `${audio.words.length} words` : "no transcript"}` : "MP3, WAV or M4A"}
                </small>
              </span>
              <button className="btn ghost" disabled={!!busy} onClick={() => file.current?.click()}>{hasVoice ? "Replace" : "Upload"}</button>
            </div>
            {hasVoice && !hasWords && !transcribes && (
              <label className="field">
                <span className="label">Script (lines it up word by word; without it, shots follow the pauses)</span>
                <textarea rows={3} value={script} placeholder="Paste what the voice-over says." onChange={(e) => setScript(e.target.value)} />
              </label>
            )}
            <span className="label">Kind of film</span>
            <div className="seg genre-seg" role="radiogroup" aria-label="Kind of film">
              {(Object.keys(GENRES) as Genre[]).map((g) => (
                <button key={g} role="radio" aria-checked={genre === g} title={GENRES[g].note} className={genre === g ? "on" : ""} onClick={() => setGenre(g)}>{GENRES[g].label}</button>
              ))}
            </div>
            <span className="tiny">{GENRES[genre].note}.</span>
            <label className="field">
              <span className="label">{genre === "ad" ? "What's the ad for?" : "What's it about?"}</span>
              <input type="text" value={brief} placeholder={genre === "ad" ? "A smartwatch for runners who sleep badly" : "The history of coffee, from Ethiopia to the world"} onChange={(e) => setBrief(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Describe the footage you want</span>
              <textarea rows={3} value={direction} maxLength={600} placeholder="Cinematic aerial shots, moody light, real places, no people. Black and white photos for the historical parts." onChange={(e) => setDirection(e.target.value)} />
            </label>
            {!direction.trim() ? (
              <div className="dir-ideas" aria-label="Examples">
                {DIRECTION_IDEAS.map((d) => (
                  <button key={d} onClick={() => setDirection(d)}>{d}</button>
                ))}
              </div>
            ) : (
              (understood.styles.length > 0 || understood.moods.length > 0 || understood.avoid.length > 0 || understood.media || understood.subjects.length > 0) && (
                <div className="dir-read" aria-label="How Rookker reads your description">
                  {understood.styles.map((s) => <span key={s} title="Added to the searches">{s}</span>)}
                  {understood.moods.map((s) => <span key={s} title="Clips with this feel are preferred">{s}</span>)}
                  {understood.subjects.map((s) => <span key={s} title="Searched as a subject">{s}</span>)}
                  {understood.media && <span title="What to cast">{understood.media === "photo" ? "photos" : understood.media === "any" ? "video + photos" : "video only"}</span>}
                  {understood.avoid.map((s) => <span key={s} className="no" title="Kept out of every shot">no {s}</span>)}
                </div>
              )
            )}
            {libraries.length > 0 && (
              <div className="field">
                <span className="label">Stock libraries to search</span>
                <div className="lib-row">
                  {libraries.map((id) => (
                    <label key={id} className="toggle">
                      <input type="checkbox" checked={!offSources.includes(id)} onChange={() => setOffSources((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]))} /> {SOURCE_NAMES[id] ?? id}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <span className="label">Look</span>
            <div className="look-grid" role="radiogroup" aria-label="Look">
              {(Object.keys(LOOKS_PROD) as ProdLook[]).map((k) => (
                <button key={k} role="radio" aria-checked={look === k} className={`look-chip look-${k} ${look === k ? "on" : ""}`} onClick={() => setLook(k)}>
                  <b>{LOOKS_PROD[k].label}</b>
                  <small>{LOOKS_PROD[k].note}</small>
                </button>
              ))}
            </div>

            <div className="opt-row">
              <span className="opt-label">Words on screen</span>
              <div className="seg" role="group" aria-label="Words on screen">
                {TEXT.map((t) => (
                  <button key={t.id} title={t.note} className={text === t.id ? "on" : ""} onClick={() => setText(t.id)}>{t.label}</button>
                ))}
              </div>
            </div>
            <div className="opt-row">
              <span className="opt-label">Format</span>
              <div className="seg" role="group" aria-label="Format">
                {ASPECTS.map((a) => (
                  <button key={a} className={aspect === a ? "on" : ""} onClick={() => setAspect(a)}>{a}</button>
                ))}
              </div>
            </div>

            <details className="sound-copy">
              <summary>Title and end card</summary>
              <div className="row">
                <label className="field"><span className="label">Brand</span><input type="text" value={brand} placeholder="Orbit" onChange={(e) => setBrand(e.target.value)} /></label>
                <label className="field"><span className="label">Opening title</span><input type="text" value={title} placeholder="Time, rethought" onChange={(e) => setTitle(e.target.value)} /></label>
              </div>
              <div className="row">
                <label className="field"><span className="label">Button</span><input type="text" value={cta} placeholder="Pre-order" onChange={(e) => setCta(e.target.value)} /></label>
                <label className="field"><span className="label">Link</span><input type="text" value={url} placeholder="orbit.watch" onChange={(e) => setUrl(e.target.value)} /></label>
              </div>
            </details>

            {error && <p className="sound-error" role="alert">{error}</p>}
            {busy ? (
              <button className="btn sound-build" onClick={() => stopDirecting()}>
                <span className="wave" aria-hidden="true">{[0, 1, 2, 3].map((i) => <i key={i} style={{ animationDelay: `${i * 0.11}s` }} />)}</span> {busy} · Stop
              </button>
            ) : (
              <button className="btn primary sound-build" disabled={!hasVoice} onClick={go}>
                <Icon name="sparkle" /> {rows ? "Direct it again" : "Direct the footage"}
              </button>
            )}
            {project.scenes.length > 0 && !rows && <span className="tiny">Replaces this project's scenes. Undo brings them back.</span>}
          </section>

          <section className="footage-shots" aria-label="Shot list">
            {!rows ? (
              <div className="footage-empty">
                <div className="footage-reel" aria-hidden="true">
                  {["establishing", "medium", "close-up", "detail", "product"].map((t, i) => (
                    <span key={t} style={{ animationDelay: `${i * 0.18}s` }}>{SHOT_LABEL[t as keyof typeof SHOT_LABEL]}</span>
                  ))}
                </div>
                <p>The shot list appears here: each line of your voice-over, the shot it gets, and the footage cast for it.</p>
                <p className="tiny">Don't like a shot? Press Swap on it to browse the libraries yourself, preview clips and photos, and replace it.</p>
              </div>
            ) : (
              <>
                <div className="footage-shots-head">
                  <b>{rows.shots.length} shots</b>
                  <span className="tiny">shot list by {rows.by === "claude" ? "Claude" : "the local director"}</span>
                </div>
                <ol className="shot-list">
                  {rows.shots.map((s, i) => {
                    const p = rows.picks[i];
                    return (
                      <li key={i} className={`shot-row ${p === undefined ? "casting" : p ? "cast" : "none"}`} onClick={() => setState({ selected: i })}>
                        <span className="shot-thumb">
                          {p?.thumb || p?.src ? <img src={p.thumb ?? p.src} alt="" /> : <span className="shot-wait" />}
                          {p?.kind === "video" && p.duration ? <em>{p.duration.toFixed(0)}s</em> : null}
                        </span>
                        <span className="shot-text">
                          <span className="shot-meta">
                            <span className="shot-type">{SHOT_LABEL[s.type] ?? s.type}</span>
                            <span className="tiny">{tc(s.s)} · {(s.e - s.s).toFixed(1)}s</span>
                          </span>
                          <q>{s.line || "(no words)"}</q>
                          <small>{p === undefined ? `searching “${s.queries[0]}”` : p ? `${p.kind === "video" ? "clip" : "photo"} from ${SOURCE_NAMES[p.source] ?? p.source} · ${s.visual ?? `“${s.queries[0]}”`}` : "no footage found: shown as type"}</small>
                        </span>
                        {p !== undefined && done && (
                          <button className="btn shot-swap" title="Browse the stock libraries and replace this shot" onClick={(e) => (e.stopPropagation(), setState({ selected: i, sheet: "finder" }))}>Swap</button>
                        )}
                      </li>
                    );
                  })}
                </ol>
                {done && <LicenseCard />}
                {done && (
                  <button className="btn primary" onClick={() => (close(), setState({ selected: 0 }))}>
                    <Icon name="play" size={13} /> Watch the edit
                  </button>
                )}
              </>
            )}
          </section>
        </div>
        <input
          ref={file}
          type="file"
          hidden
          accept="audio/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) setVoiceFile(f);
          }}
        />
      </div>
    </div>
  );
}
