import { useEffect, useRef, useState } from "react";
import type { Aspect, Asset } from "../types";
import { useStudio, setState, getState } from "../store";
import { LOOKS_PROD, SHOT_TYPES, type ProdLook, type Shot, type TextMode } from "../footage/plan";
import { directFootage, stopDirecting } from "../footage/direct";
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
  const [look, setLook] = useState<ProdLook>("cinematic");
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
            <p className="sound-sub">Each line gets a shot, like a real edit: a shot list, stock footage cast for every line, one grade across it all.</p>
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
            <label className="field">
              <span className="label">What's the ad for?</span>
              <input type="text" value={brief} placeholder="A smartwatch for runners who sleep badly" onChange={(e) => setBrief(e.target.value)} />
            </label>

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
                <Icon name="sparkle" /> {rows ? "Shoot it again" : "Direct the footage"}
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
                <p className="tiny">Swap any shot later in the Scene tab: search again, pick another take, or drop in your own clip.</p>
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
                          <small>{p === undefined ? `searching “${s.queries[0]}”` : p ? `${p.source} · “${s.queries[0]}”` : "no footage found: shown as type"}</small>
                        </span>
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
