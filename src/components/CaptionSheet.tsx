import { useEffect, useRef, useState } from "react";
import { getState, setState } from "../store";
import { download } from "../export";
import { Icon } from "./Icon";
import { takeHandoff } from "../handoff";
import { CaptionControls } from "./CaptionControls";
import { renderCaptions, type CaptionBox } from "../engine/captions";
import { probe, type SourceInfo } from "../upscale/run";
import { captionVideo, transcribeVideo, spreadWords } from "../captionVideo";
import type { CaptionStyle, Word } from "../types";

type Loaded = SourceInfo & { url: string; video: HTMLVideoElement; file: File };
const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`);

/** Caption an uploaded video: transcribe its speech, pick a design, drag it into place, save. */
export function CaptionSheet() {
  const [src, setSrc] = useState<Loaded | null>(null);
  const [words, setWords] = useState<Word[]>([]);
  const [style, setStyle] = useState<CaptionStyle | undefined>({ design: "karaoke" });
  const [listening, setListening] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [script, setScript] = useState("");
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState<{ p: number; label: string } | null>(null);
  const [done, setDone] = useState<{ line: string; notes: string[] } | null>(null);
  const [opening, setOpening] = useState(false);
  const [guide, setGuide] = useState(false);
  const view = useRef<HTMLCanvasElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const box = useRef<CaptionBox | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const live = useRef({ words, style });
  live.current = { words, style };
  const brand = getState().project.brand;

  const close = () => {
    if (busy) return;
    setState({ sheet: undefined });
  };
  useEffect(
    () => () => {
      if (src) {
        src.video.pause();
        src.video.removeAttribute("src");
        src.video.load();
        URL.revokeObjectURL(src.url);
      }
    },
    [src],
  );

  async function listen(file: File) {
    setListening(true);
    setNote(null);
    try {
      const w = await transcribeVideo(file);
      setWords(w);
      setNote(`${w.length} words transcribed. Click any word to fix it.`);
    } catch (e: any) {
      setWords([]);
      setNote(`${e?.message ?? "The speech couldn't be transcribed."} You can type the words below instead.`);
    } finally {
      setListening(false);
    }
  }
  async function open(file?: File) {
    if (!file) return;
    setError(null);
    setDone(null);
    setOpening(true);
    try {
      const p = await probe(file);
      p.video.muted = false;
      setSrc({ ...p, file });
      setAt(0);
      setWords([]);
      void listen(file);
    } catch (e: any) {
      setSrc(null);
      setError(e?.message ?? "That file couldn't be opened.");
    } finally {
      setOpening(false);
    }
  }

  // Draw the frame with its captions; while playing, every animation frame.
  const paint = () => {
    const c = view.current;
    if (!c || !src) return;
    const wrap = c.parentElement!.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const fit = Math.min(wrap.width / src.w, (window.innerHeight * 0.5) / src.h);
    const cw = Math.round(src.w * fit), ch = Math.round(src.h * fit);
    if (c.style.width !== `${cw}px`) (c.style.width = `${cw}px`), (c.style.height = `${ch}px`);
    if (c.width !== Math.round(cw * dpr)) (c.width = Math.round(cw * dpr)), (c.height = Math.round(ch * dpr));
    const x = c.getContext("2d")!;
    // draw in the video's own pixel units, so captions sit exactly where the export puts them
    x.setTransform(c.width / src.w, 0, 0, c.height / src.h, 0, 0);
    x.drawImage(src.video, 0, 0, src.w, src.h);
    box.current = renderCaptions(x, src.w, src.h, { words: live.current.words, style: live.current.style, brand, t: src.video.currentTime });
  };
  useEffect(() => {
    if (!src || busy) return;
    let raf = 0;
    const v = src.video;
    if (playing) {
      const loop = () => {
        paint();
        setAt(v.currentTime);
        if (v.ended || v.paused) return setPlaying(false);
        raf = requestAnimationFrame(loop);
      };
      v.play().then(() => (raf = requestAnimationFrame(loop))).catch(() => setPlaying(false));
      return () => (cancelAnimationFrame(raf), v.pause());
    }
    const onSeek = () => paint();
    v.addEventListener("seeked", onSeek);
    if (Math.abs(v.currentTime - at) > 0.01) v.currentTime = at;
    else paint();
    return () => v.removeEventListener("seeked", onSeek);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, playing, at, words, style, busy]);

  // Dragging the captions on the preview.
  const toVideo = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * src!.w, y: ((e.clientY - r.top) / r.height) * src!.h };
  };
  const onDown = (e: React.PointerEvent) => {
    const b = box.current;
    if (!b || !src) return;
    const p = toVideo(e), m = Math.min(src.w, src.h) * 0.02;
    if (p.x < b.x - m || p.x > b.x + b.w + m || p.y < b.y - m || p.y > b.y + b.h + m) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { dx: p.x - (b.x + b.w / 2), dy: p.y - (b.y + b.h / 2) };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !src) return;
    const p = toVideo(e);
    let x = Math.min(1, Math.max(0, (p.x - drag.current.dx) / src.w));
    const y = Math.min(1, Math.max(0, (p.y - drag.current.dy) / src.h));
    const snap = Math.abs(x - 0.5) < 0.02;
    if (snap) x = 0.5;
    setGuide(snap);
    setStyle((s) => ({ ...s, x: +x.toFixed(3), y: +y.toFixed(3) }));
  };
  const onUp = () => ((drag.current = null), setGuide(false));

  async function run() {
    if (!src || !words.length) return;
    setError(null);
    setDone(null);
    setPlaying(false);
    abort.current = new AbortController();
    setBusy({ p: 0, label: "Starting" });
    try {
      const r = await captionVideo(src.file, { words, style, brand, signal: abort.current.signal, onProgress: (p, label) => setBusy({ p, label }) });
      const saved = await download(r.blob, `${src.file.name.replace(/\.[^.]+$/, "") || "video"}-captioned.mp4`);
      setDone({ line: `${saved ? "Saved" : "Ready"}: ${r.w}×${r.h} · ${r.frames} frames · ${r.codec}${r.audio ? ` + ${r.audio.toUpperCase()}` : ", no sound"} · ${mb(r.blob.size)}`, notes: r.notes });
    } catch (e: any) {
      if (e?.name !== "AbortError") setError(e?.message ?? "The captions couldn't be added.");
    } finally {
      setBusy(null);
    }
  }

  const now = words.findIndex((w) => at >= w.s && at <= w.e + 0.05);
  // a clip handed over from another tool (AI video) opens straight away
  useEffect(() => {
    const f = takeHandoff();
    if (f) void open(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="sheet sound-sheet upscale-sheet" role="dialog" aria-modal="true" aria-labelledby="caption-title">
        <div className="sheet-head">
          <div>
            <h3 id="caption-title">Caption a video</h3>
            <p className="sound-sub">Upload a video and its speech is transcribed into captions. Pick a design, drag them where you want, and save.</p>
          </div>
          <button className="btn icon ghost" onClick={close} aria-label="Close" disabled={!!busy}>
            <Icon name="minus" />
          </button>
        </div>
        {!src ? (
          <div className="upscale-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => (e.preventDefault(), void open([...e.dataTransfer.files].find((f) => f.type.startsWith("video/")) ?? e.dataTransfer.files[0]))}>
            <Icon name="mic" size={26} />
            <b>{opening ? "Opening…" : "Drop a video here"}</b>
            <span>MP4, MOV or WebM, with speech</span>
            <button className="btn primary" disabled={opening} onClick={() => fileIn.current?.click()}>Choose a video</button>
          </div>
        ) : (
          <div className="upscale-body">
            <div className="upscale-view">
              <div className="upscale-canvas">
                <canvas ref={view} aria-label="Preview. Drag the captions to move them." style={{ cursor: "grab", touchAction: "none" }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
                {guide && <i className="cap-guide" style={{ left: "50%", top: 0, bottom: 0 }} aria-hidden />}
              </div>
              <div className="upscale-scrub">
                <button className="btn icon" aria-label={playing ? "Pause" : "Play"} disabled={!!busy} onClick={() => setPlaying(!playing)}>
                  <Icon name={playing ? "pause" : "play"} />
                </button>
                <input type="range" min={0} max={Math.max(0.05, src.duration - 0.05)} step={0.01} value={at} aria-label="Position in the video" disabled={!!busy} onChange={(e) => (setPlaying(false), setAt(+e.target.value))} />
                <span className="tiny">{at.toFixed(1)}s / {src.duration.toFixed(1)}s</span>
              </div>
              <div className="caption-words" aria-label="Transcript">
                {listening && <span className="tiny">Listening to the speech…</span>}
                {words.map((w, i) =>
                  editing === i ? (
                    <input
                      key={i}
                      autoFocus
                      defaultValue={w.w}
                      size={Math.max(2, w.w.length)}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        setWords(v ? words.map((x, k) => (k === i ? { ...x, w: v } : x)) : words.filter((_, k) => k !== i));
                        setEditing(null);
                      }}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && e.currentTarget.blur()}
                    />
                  ) : (
                    <button key={i} className={i === now ? "on" : ""} title="Click to fix this word (empty it to remove)" disabled={!!busy} onClick={() => (setPlaying(false), setAt(w.s + 0.01), setEditing(i))}>{w.w}</button>
                  ),
                )}
              </div>
              {note && <span className="tiny">{note}</span>}
              {!listening && !words.length && (
                <div className="field">
                  <span className="label">Type or paste what's said</span>
                  <textarea rows={3} value={script} placeholder="The words spoken in the video, in order" onChange={(e) => setScript(e.target.value)} />
                  <div className="row">
                    <button className="btn" disabled={!script.trim()} onClick={() => (setWords(spreadWords(script, src.duration)), setNote("Timed evenly across the video. Scrub to check; click a word to fix it."))}>Use these words</button>
                    <button className="btn ghost" onClick={() => void listen(src.file)}>Try transcribing again</button>
                  </div>
                </div>
              )}
            </div>
            <aside className="upscale-side">
              <div className="upscale-file">
                <b title={src.file.name}>{src.file.name}</b>
                <span>{src.w}×{src.h} · {src.duration.toFixed(1)}s · {src.fps} fps · {mb(src.file.size)}</span>
                <button className="link" disabled={!!busy} onClick={() => (setPlaying(false), setSrc(null), setWords([]), setDone(null), setError(null), setNote(null))}>Choose another</button>
              </div>
              <CaptionControls value={style} onChange={setStyle} />
              {error && <p className="sound-error" role="alert">{error}</p>}
              {busy ? (
                <div className="upscale-progress" role="status">
                  <div className="bar"><i style={{ width: `${Math.round(busy.p * 100)}%` }} /></div>
                  <span>{busy.label} · {Math.round(busy.p * 100)}%</span>
                  <button className="btn" onClick={() => abort.current?.abort()}>Cancel</button>
                </div>
              ) : (
                <button className="btn primary sound-build" disabled={!words.length || listening} onClick={run}>
                  <Icon name="download" /> {listening ? "Listening…" : "Save with captions"}
                </button>
              )}
              {done && (
                <div className="upscale-done" role="status">
                  <b>{done.line}</b>
                  {done.notes.map((n) => <span key={n}>{n}</span>)}
                </div>
              )}
            </aside>
          </div>
        )}
        {!src && error && <p className="sound-error" role="alert">{error}</p>}
        <input ref={fileIn} type="file" hidden accept="video/*" onChange={(e) => (void open(e.target.files?.[0]), (e.target.value = ""))} />
      </div>
    </div>
  );
}
